import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  prepareKrakenLifecycleDocumentCapturePersistence,
  SELECT_LATEST_COMMITTED_KRAKEN_LISTING_INDEX_PAGES_SQL,
  type KrakenLifecycleDocumentCaptureStatement,
} from "../src/storage/krakenLifecycleDocumentCapture.ts";
import type { KrakenLifecycleDocumentCapture } from "../src/universe/krakenLifecycleDocumentCapture.ts";

const NOW = Date.UTC(2026, 6, 28);
const SOURCE_CAPTURE = "1".repeat(64);
const SOURCE_PAYLOAD = "2".repeat(64);
const DOCUMENT_CAPTURE = "3".repeat(64);
const DOCUMENT_PAYLOAD = "4".repeat(64);
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

function capture(
  overrides: Partial<KrakenLifecycleDocumentCapture> = {},
): KrakenLifecycleDocumentCapture {
  const payloadText = "<html>document</html>";
  return {
    captureId: DOCUMENT_CAPTURE,
    sourceKind: "asset-listing-document",
    sourceRef: "https://blog.kraken.com/product/asset-listings/example",
    discoveredFromCaptureId: SOURCE_CAPTURE,
    discoveredFromPayloadSha256: SOURCE_PAYLOAD,
    discoverySha256: DISCOVERY,
    fetchedAtMs: NOW,
    payloadSha256: DOCUMENT_PAYLOAD,
    payloadByteLength: new TextEncoder().encode(payloadText).byteLength,
    payloadText,
    contentType: "text/html",
    etag: null,
    lastModified: null,
    ...overrides,
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

test("persists exact retries with committed discovery provenance", () => {
  const db = database();
  const statements = prepareKrakenLifecycleDocumentCapturePersistence(
    [capture()],
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

test("rejects incomplete provenance, changed identities and mutation", () => {
  const db = database();
  assert.throws(
    () =>
      execute(
        db,
        prepareKrakenLifecycleDocumentCapturePersistence(
          [
            capture({
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
    prepareKrakenLifecycleDocumentCapturePersistence([capture()], NOW + 1),
  );
  assert.throws(
    () =>
      execute(
        db,
        prepareKrakenLifecycleDocumentCapturePersistence(
          [capture({ payloadSha256: "6".repeat(64) })],
          NOW + 1,
        ),
      ),
    /document capture conflict/u,
  );
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE kraken_lifecycle_document_captures SET fetched_at_ms = fetched_at_ms + 1",
        )
        .run(),
    /captures are immutable/u,
  );
});

test("rejects noncanonical paths and commits before fetch", () => {
  assert.throws(
    () =>
      prepareKrakenLifecycleDocumentCapturePersistence(
        [
          capture({
            sourceRef:
              "https://blog.kraken.com/product/asset-listings/example?bad=1",
          }),
        ],
        NOW + 1,
      ),
    /not canonical/u,
  );
  assert.throws(
    () =>
      prepareKrakenLifecycleDocumentCapturePersistence(
        [capture()],
        NOW - 1,
      ),
    /precedes/u,
  );
});

test("accepts canonical multi-digit listing index pages", () => {
  const db = database();
  execute(
    db,
    prepareKrakenLifecycleDocumentCapturePersistence(
      [
        capture({
          captureId: "7".repeat(64),
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
        "SELECT source_ref FROM kraken_lifecycle_document_captures WHERE capture_id = ?",
      )
      .get("7".repeat(64))?.source_ref,
    "https://blog.kraken.com/category/product/asset-listings/page/10",
  );
});

test("accepts a committed listing page as exact recursive provenance", () => {
  const db = database();
  const pagePayloadText =
    '<a href="https://blog.kraken.com/product/asset-listings/older">older</a>';
  const pagePayload = "6".repeat(64);
  const pageCapture = capture({
    captureId: "7".repeat(64),
    sourceKind: "asset-listings-index-page",
    sourceRef:
      "https://blog.kraken.com/category/product/asset-listings/page/2",
    payloadSha256: pagePayload,
    payloadByteLength: new TextEncoder().encode(pagePayloadText).byteLength,
    payloadText: pagePayloadText,
  });
  execute(
    db,
    prepareKrakenLifecycleDocumentCapturePersistence([pageCapture], NOW + 1),
  );
  execute(
    db,
    prepareKrakenLifecycleDocumentCapturePersistence(
      [
        capture({
          captureId: "8".repeat(64),
          sourceRef:
            "https://blog.kraken.com/product/asset-listings/older",
          discoveredFromCaptureId: pageCapture.captureId,
          discoveredFromPayloadSha256: pagePayload,
          fetchedAtMs: NOW + 2,
          payloadSha256: "9".repeat(64),
        }),
      ],
      NOW + 3,
    ),
  );
  assert.equal(
    db
      .prepare(
        "SELECT discovered_from_capture_id FROM kraken_lifecycle_document_captures WHERE capture_id = ?",
      )
      .get("8".repeat(64))?.discovered_from_capture_id,
    pageCapture.captureId,
  );
});

test("loads a bounded latest-page window from the requested rotation", () => {
  const db = database();
  execute(
    db,
    prepareKrakenLifecycleDocumentCapturePersistence(
      [
        capture({
          captureId: "6".repeat(64),
          sourceKind: "asset-listings-index-page",
          sourceRef:
            "https://blog.kraken.com/category/product/asset-listings/page/2",
          fetchedAtMs: NOW,
          payloadSha256: "7".repeat(64),
        }),
        capture({
          captureId: "8".repeat(64),
          sourceKind: "asset-listings-index-page",
          sourceRef:
            "https://blog.kraken.com/category/product/asset-listings/page/10",
          fetchedAtMs: NOW + 1,
          payloadSha256: "9".repeat(64),
        }),
      ],
      NOW + 2,
    ),
  );
  const rows = db
    .prepare(SELECT_LATEST_COMMITTED_KRAKEN_LISTING_INDEX_PAGES_SQL)
    .all(10);
  assert.deepEqual(
    rows.map((row) => row.source_ref),
    [
      "https://blog.kraken.com/category/product/asset-listings/page/10",
      "https://blog.kraken.com/category/product/asset-listings/page/2",
    ],
  );
});

test("caps the recursive page window at 32 rows and eight MiB", () => {
  const db = database();
  const seeds = ["3", "4", "5", "6", "7", "8", "9", "a", "b"];
  const payloadSeeds = ["0", "3", "4", "5", "6", "7", "8", "9", "a"];
  const captures = seeds.map((seed, index) => {
    const payloadText = `${index}` + "x".repeat(1_048_575);
    return capture({
      captureId: seed.repeat(64),
      sourceKind: "asset-listings-index-page",
      sourceRef:
        `https://blog.kraken.com/category/product/asset-listings/page/${index + 2}`,
      fetchedAtMs: NOW + index,
      payloadSha256: (payloadSeeds[index] ?? "f").repeat(64),
      payloadByteLength: 1_048_576,
      payloadText,
    });
  });
  execute(
    db,
    prepareKrakenLifecycleDocumentCapturePersistence(captures, NOW + 10),
  );
  const rows = db
    .prepare(SELECT_LATEST_COMMITTED_KRAKEN_LISTING_INDEX_PAGES_SQL)
    .all(2);
  assert.equal(rows.length, 8);
  assert.equal(
    rows.reduce(
      (total, row) => total + Number(row.payload_byte_length),
      0,
    ),
    8_388_608,
  );
});
