import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  prepareKrakenLifecycleDocumentCapturePersistence,
  type KrakenLifecycleDocumentCaptureStatement,
} from "../src/storage/krakenLifecycleDocumentCapture.ts";
import type { KrakenLifecycleDocumentCapture } from "../src/universe/krakenLifecycleDocumentCapture.ts";
import { sha256Hex } from "../src/utils/crypto.ts";

const NOW = Date.UTC(2026, 6, 28);
const SOURCE_CAPTURE = "1".repeat(64);
const SOURCE_PAYLOAD = "2".repeat(64);
const DISCOVERY = "5".repeat(64);

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync("migrations/0007_kraken_lifecycle_source_captures.sql", "utf8"));
  db.exec(readFileSync("migrations/0011_kraken_lifecycle_document_captures.sql", "utf8"));
  db.prepare(
    `INSERT INTO kraken_lifecycle_source_payloads
      (payload_sha256, payload_byte_length, payload_text)
     VALUES (?, ?, ?)`,
  ).run(SOURCE_PAYLOAD, 5, "index");
  db.prepare(
    `INSERT INTO kraken_lifecycle_source_captures
      (capture_id, source_kind, source_ref, fetched_at_ms, payload_sha256,
       content_type, etag, last_modified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    SOURCE_CAPTURE,
    "asset-listings-index",
    "https://blog.kraken.com/category/product/asset-listings",
    NOW - 10,
    SOURCE_PAYLOAD,
    "text/html",
    null,
    null,
  );
  db.prepare(
    `INSERT INTO kraken_lifecycle_source_capture_commits
      (capture_id, committed_at_ms)
     VALUES (?, ?)`,
  ).run(SOURCE_CAPTURE, NOW - 9);
  return db;
}

async function capture(
  overrides: Partial<KrakenLifecycleDocumentCapture> = {},
): Promise<KrakenLifecycleDocumentCapture> {
  const payloadText = overrides.payloadText ?? "<html>document</html>";
  const payloadSha256 = await sha256Hex(payloadText);
  const value = {
    sourceKind: "asset-listing-document" as const,
    sourceRef: "https://blog.kraken.com/product/asset-listings/example",
    discoveredFromCaptureId: SOURCE_CAPTURE,
    discoveredFromPayloadSha256: SOURCE_PAYLOAD,
    discoverySha256: DISCOVERY,
    fetchedAtMs: NOW,
    payloadSha256,
    payloadByteLength: new TextEncoder().encode(payloadText).byteLength,
    payloadText,
    contentType: "text/html" as const,
    etag: null,
    lastModified: null,
    ...overrides,
  };
  const captureId = await sha256Hex(
    JSON.stringify({
      schemaVersion: "kraken-lifecycle-document-capture-v1",
      sourceKind: value.sourceKind,
      sourceRef: value.sourceRef,
      discoveredFromCaptureId: value.discoveredFromCaptureId,
      discoveredFromPayloadSha256: value.discoveredFromPayloadSha256,
      discoverySha256: value.discoverySha256,
      fetchedAtMs: value.fetchedAtMs,
      payloadSha256: value.payloadSha256,
      payloadByteLength: value.payloadByteLength,
      contentType: value.contentType,
      etag: value.etag,
      lastModified: value.lastModified,
    }),
  );
  return {
    ...value,
    captureId: overrides.captureId ?? captureId,
  };
}

function execute(
  db: DatabaseSync,
  statements: readonly KrakenLifecycleDocumentCaptureStatement[],
): void {
  db.exec("BEGIN");
  try {
    for (const statement of statements) {
      db.prepare(statement.sql).run(...statement.params);
    }
    db.exec("COMMIT");
  } catch (error: unknown) {
    db.exec("ROLLBACK");
    throw error;
  }
}

test("persists exact retries with committed discovery provenance", async () => {
  const db = database();
  const statements = await prepareKrakenLifecycleDocumentCapturePersistence(
    [await capture()],
    NOW + 1,
  );
  execute(db, statements);
  execute(db, statements);
  assert.equal(
    db.prepare("SELECT count(*) AS count FROM kraken_lifecycle_document_captures").get()
      ?.count,
    1,
  );
  assert.equal(
    db
      .prepare(
        "SELECT count(*) AS count FROM kraken_lifecycle_document_capture_commits",
      )
      .get()?.count,
    1,
  );
});

test("rejects incomplete provenance, changed identities and mutation", async () => {
  const db = database();
  await assert.rejects(
    async () =>
      execute(
        db,
        await prepareKrakenLifecycleDocumentCapturePersistence(
          [
            await capture({
              discoveredFromCaptureId: "9".repeat(64),
            }),
          ],
          NOW + 1,
        ),
      ),
    /discovery provenance is incomplete/u,
  );
  execute(
    db,
    await prepareKrakenLifecycleDocumentCapturePersistence([await capture()], NOW + 1),
  );
  await assert.rejects(
    async () =>
      execute(
        db,
        await prepareKrakenLifecycleDocumentCapturePersistence(
          [await capture({ etag: '"changed"' })],
          NOW + 1,
        ),
      ),
    /natural identity conflict/u,
  );
  await assert.rejects(
    async () =>
      db
        .prepare(
          "UPDATE kraken_lifecycle_document_captures SET fetched_at_ms = fetched_at_ms + 1",
        )
        .run(),
    /captures are immutable/u,
  );
});

test("rejects noncanonical paths and commits before fetch", async () => {
  await assert.rejects(
    async () =>
      await prepareKrakenLifecycleDocumentCapturePersistence(
        [
          await capture({
            sourceRef:
              "https://blog.kraken.com/product/asset-listings/example?bad=1",
          }),
        ],
        NOW + 1,
      ),
    /not canonical/u,
  );
  await assert.rejects(
    async () =>
      await prepareKrakenLifecycleDocumentCapturePersistence(
        [await capture()],
        NOW - 1,
      ),
    /precedes/u,
  );
});

test("accepts canonical multi-digit listing index pages", async () => {
  const db = database();
  execute(
    db,
    await prepareKrakenLifecycleDocumentCapturePersistence(
      [
        await capture({
          sourceKind: "asset-listings-index-page",
          sourceRef:
            "https://blog.kraken.com/category/product/asset-listings/page/10",
        }),
      ],
      NOW + 1,
    ),
  );
  assert.equal(
    db
      .prepare(
        "SELECT source_ref FROM kraken_lifecycle_document_captures WHERE source_ref = ?",
      )
      .get(
        "https://blog.kraken.com/category/product/asset-listings/page/10",
      )?.source_ref,
    "https://blog.kraken.com/category/product/asset-listings/page/10",
  );
});


test("rejects forged content identities before preparing D1 writes", async () => {
  const valid = await capture();
  await assert.rejects(
    prepareKrakenLifecycleDocumentCapturePersistence(
      [{ ...valid, payloadSha256: "6".repeat(64) }],
      NOW + 1,
    ),
    /payload digest does not match/u,
  );
  await assert.rejects(
    prepareKrakenLifecycleDocumentCapturePersistence(
      [{ ...valid, captureId: "7".repeat(64) }],
      NOW + 1,
    ),
    /capture digest does not match/u,
  );
  await assert.rejects(
    prepareKrakenLifecycleDocumentCapturePersistence(
      [{ ...valid, etag: "good\r\ninjected: bad" }],
      NOW + 1,
    ),
    /unsafe cache header/u,
  );
});

test("D1 independently rejects malformed paths, injected headers and commit drift", async () => {
  const db = database();
  const valid = await capture();
  const statements = await prepareKrakenLifecycleDocumentCapturePersistence(
    [valid],
    NOW + 1,
  );
  execute(db, statements);

  const captureInsert = statements[1];
  assert.ok(captureInsert);
  const malformedPath = [...captureInsert.params];
  malformedPath[0] = "8".repeat(64);
  malformedPath[2] =
    "https://blog.kraken.com/product/asset-listings/example bad";
  malformedPath[6] = NOW + 2;
  assert.throws(
    () => db.prepare(captureInsert.sql).run(...malformedPath),
    /CHECK constraint failed/u,
  );

  const injectedHeader = [...captureInsert.params];
  injectedHeader[0] = "9".repeat(64);
  injectedHeader[6] = NOW + 3;
  injectedHeader[9] = "ok\r\nInjected: bad";
  assert.throws(
    () => db.prepare(captureInsert.sql).run(...injectedHeader),
    /CHECK constraint failed/u,
  );

  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO kraken_lifecycle_document_capture_commits
             (capture_id, committed_at_ms)
           VALUES (?, ?)
           ON CONFLICT(capture_id) DO NOTHING`,
        )
        .run(valid.captureId, NOW + 2),
    /commit conflict/u,
  );
});
