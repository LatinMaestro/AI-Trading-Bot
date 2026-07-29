import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  bindReviewedKrakenLifecycleDocuments,
  D1KrakenLifecycleCommittedCaptureRepository,
  prepareCommittedKrakenLifecycleEvidence,
  type CommittedKrakenLifecycleCapture,
  type KrakenLifecycleCommittedCaptureRepository,
  type ReviewedKrakenLifecycleDocument,
} from "../src/universe/krakenLifecycleCommittedEvidence.ts";

const RECORDED_AT_MS = Date.UTC(2026, 6, 29);
const digest = (character: string): string => character.repeat(64);

function reviewed(
  overrides: Partial<ReviewedKrakenLifecycleDocument> = {},
): ReviewedKrakenLifecycleDocument {
  return {
    captureId: digest("a"),
    documentId: "btc-aud-listing",
    sourceClass: "asset-listing",
    sourceRef:
      "https://blog.kraken.com/product/asset-listings/btc-aud-trading",
    publishedAtMs: RECORDED_AT_MS - 3_000,
    fetchedAtMs: RECORDED_AT_MS - 2_000,
    payloadSha256: digest("b"),
    declarations: [
      {
        canonicalPair: "BTC/AUD",
        eventType: "listed",
        effectiveAtMs: RECORDED_AT_MS - 3_000,
        scope: "global",
      },
    ],
    ...overrides,
  };
}

function committed(
  overrides: Partial<CommittedKrakenLifecycleCapture> = {},
): CommittedKrakenLifecycleCapture {
  return {
    captureId: digest("a"),
    storageKind: "discovered-document",
    sourceKind: "asset-listing-document",
    sourceRef:
      "https://blog.kraken.com/product/asset-listings/btc-aud-trading",
    fetchedAtMs: RECORDED_AT_MS - 2_000,
    payloadSha256: digest("b"),
    committedAtMs: RECORDED_AT_MS - 1_000,
    ...overrides,
  };
}

class StaticRepository
  implements KrakenLifecycleCommittedCaptureRepository
{
  private readonly captures: readonly CommittedKrakenLifecycleCapture[];

  constructor(captures: readonly CommittedKrakenLifecycleCapture[]) {
    this.captures = captures;
  }

  async loadCommittedCaptures(): Promise<
    readonly CommittedKrakenLifecycleCapture[]
  > {
    return this.captures;
  }
}

test("binds reviewed declarations only to exact committed payload evidence", async () => {
  const first = await bindReviewedKrakenLifecycleDocuments(
    [reviewed()],
    RECORDED_AT_MS,
    new StaticRepository([committed()]),
  );
  const second = await bindReviewedKrakenLifecycleDocuments(
    [reviewed()],
    RECORDED_AT_MS,
    new StaticRepository([committed()]),
  );
  assert.equal(first.bindingSha256, second.bindingSha256);
  assert.deepEqual(first.documents, [
    {
      documentId: "btc-aud-listing",
      sourceClass: "asset-listing",
      sourceRef:
        "https://blog.kraken.com/product/asset-listings/btc-aud-trading",
      publishedAtMs: RECORDED_AT_MS - 3_000,
      fetchedAtMs: RECORDED_AT_MS - 2_000,
      payloadSha256: digest("b"),
      declarations: reviewed().declarations,
    },
  ]);
  assert.equal(first.bindings[0]?.captureId, digest("a"));
  assert.equal(first.bindings[0]?.committedAtMs, RECORDED_AT_MS - 1_000);
});

test("prepares evidence only after committed binding succeeds", async () => {
  let calls = 0;
  const prepared = await prepareCommittedKrakenLifecycleEvidence(
    [reviewed()],
    RECORDED_AT_MS,
    new StaticRepository([committed()]),
    async (documents, recordedAtMs) => {
      calls += 1;
      return {
        documentId: documents[0]?.documentId,
        recordedAtMs,
      };
    },
  );
  assert.equal(calls, 1);
  assert.equal(prepared.preparedEvidence.documentId, "btc-aud-listing");
  assert.equal(prepared.bindings.length, 1);

  await assert.rejects(
    prepareCommittedKrakenLifecycleEvidence(
      [reviewed()],
      RECORDED_AT_MS,
      new StaticRepository([]),
      async () => {
        calls += 1;
        return {};
      },
    ),
    /is not committed/,
  );
  assert.equal(calls, 1);
});

test("rejects missing, mismatched and not-yet-available commits", async () => {
  await assert.rejects(
    bindReviewedKrakenLifecycleDocuments(
      [reviewed()],
      RECORDED_AT_MS,
      new StaticRepository([]),
    ),
    /is not committed/,
  );
  await assert.rejects(
    bindReviewedKrakenLifecycleDocuments(
      [reviewed()],
      RECORDED_AT_MS,
      new StaticRepository([committed({ payloadSha256: digest("c") })]),
    ),
    /does not match/,
  );
  await assert.rejects(
    bindReviewedKrakenLifecycleDocuments(
      [reviewed()],
      RECORDED_AT_MS,
      new StaticRepository([
        committed({ committedAtMs: RECORDED_AT_MS + 1 }),
      ]),
    ),
    /unavailable commit chronology/,
  );
});

test("enforces declaration source-class compatibility", async () => {
  await assert.rejects(
    bindReviewedKrakenLifecycleDocuments(
      [
        reviewed({
          sourceClass: "regional-availability",
          declarations: [
            {
              canonicalPair: "BTC/AUD",
              eventType: "au-enabled",
              effectiveAtMs: RECORDED_AT_MS - 3_000,
              scope: "AU",
            },
          ],
        }),
      ],
      RECORDED_AT_MS,
      new StaticRepository([committed()]),
    ),
    /incompatible committed source/,
  );
  const status = reviewed({
    captureId: digest("c"),
    documentId: "kraken-status-incident",
    sourceClass: "status-incident",
    sourceRef: "https://status.kraken.com/api/v2/incidents.json",
    payloadSha256: digest("d"),
    declarations: [
      {
        canonicalPair: "BTC/AUD",
        eventType: "trading-suspended",
        effectiveAtMs: RECORDED_AT_MS - 3_000,
        scope: "global",
      },
    ],
  });
  const result = await bindReviewedKrakenLifecycleDocuments(
    [status],
    RECORDED_AT_MS,
    new StaticRepository([
      committed({
        captureId: digest("c"),
        storageKind: "fixed-source",
        sourceKind: "status-incidents",
        sourceRef: status.sourceRef,
        payloadSha256: digest("d"),
      }),
    ]),
  );
  assert.equal(result.bindings[0]?.sourceKind, "status-incidents");
});

test("rejects source-incompatible events and geographic scope", async () => {
  await assert.rejects(
    bindReviewedKrakenLifecycleDocuments(
      [
        reviewed({
          declarations: [
            {
              canonicalPair: "BTC/AUD",
              eventType: "au-enabled",
              effectiveAtMs: RECORDED_AT_MS - 3_000,
              scope: "global",
            },
          ],
        }),
      ],
      RECORDED_AT_MS,
      new StaticRepository([committed()]),
    ),
    /incompatible with source class/,
  );
  await assert.rejects(
    bindReviewedKrakenLifecycleDocuments(
      [
        reviewed({
          sourceClass: "regional-availability",
          declarations: [
            {
              canonicalPair: "BTC/AUD",
              eventType: "au-enabled",
              effectiveAtMs: RECORDED_AT_MS - 3_000,
              scope: "global",
            },
          ],
        }),
      ],
      RECORDED_AT_MS,
      new StaticRepository([committed()]),
    ),
    /requires AU scope/,
  );
});

test("rejects noncanonical identities and invalid document chronology", async () => {
  await assert.rejects(
    bindReviewedKrakenLifecycleDocuments(
      [
        reviewed({
          declarations: [
            {
              canonicalPair: "XBT/AUD ",
              eventType: "listed",
              effectiveAtMs: RECORDED_AT_MS - 3_000,
              scope: "global",
            },
          ],
        }),
      ],
      RECORDED_AT_MS,
      new StaticRepository([committed()]),
    ),
    /is not canonical AUD/,
  );
  await assert.rejects(
    bindReviewedKrakenLifecycleDocuments(
      [reviewed({ documentId: "BTC AUD listing" })],
      RECORDED_AT_MS,
      new StaticRepository([committed()]),
    ),
    /documentId .* is not canonical/,
  );
  await assert.rejects(
    bindReviewedKrakenLifecycleDocuments(
      [
        reviewed({
          publishedAtMs: RECORDED_AT_MS - 1_000,
          fetchedAtMs: RECORDED_AT_MS - 2_000,
        }),
      ],
      RECORDED_AT_MS,
      new StaticRepository([committed()]),
    ),
    /invalid publication\/fetch chronology/,
  );
  await assert.rejects(
    bindReviewedKrakenLifecycleDocuments(
      [reviewed({ fetchedAtMs: RECORDED_AT_MS + 1 })],
      RECORDED_AT_MS,
      new StaticRepository([committed()]),
    ),
    /invalid publication\/fetch chronology/,
  );
});

test("rejects empty and duplicate declarations while allowing future-effective evidence", async () => {
  await assert.rejects(
    bindReviewedKrakenLifecycleDocuments(
      [reviewed({ declarations: [] })],
      RECORDED_AT_MS,
      new StaticRepository([committed()]),
    ),
    /requires 1 to 500 declarations/,
  );
  await assert.rejects(
    bindReviewedKrakenLifecycleDocuments(
      [
        reviewed(),
        reviewed({
          captureId: digest("c"),
          documentId: "duplicate-btc-listing",
        }),
      ],
      RECORDED_AT_MS,
      new StaticRepository([]),
    ),
    /Duplicate reviewed lifecycle declaration/,
  );

  const futureEffective = reviewed({
    declarations: [
      {
        canonicalPair: "BTC/AUD",
        eventType: "listed",
        effectiveAtMs: RECORDED_AT_MS + 86_400_000,
        scope: "global",
      },
    ],
  });
  const result = await bindReviewedKrakenLifecycleDocuments(
    [futureEffective],
    RECORDED_AT_MS,
    new StaticRepository([committed()]),
  );
  assert.equal(
    result.documents[0]?.declarations[0]?.effectiveAtMs,
    RECORDED_AT_MS + 86_400_000,
  );
});

test("loads only captures with exact database commit markers", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE kraken_lifecycle_source_captures (
      capture_id TEXT PRIMARY KEY,
      source_kind TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      fetched_at_ms INTEGER NOT NULL,
      payload_sha256 TEXT NOT NULL
    );
    CREATE TABLE kraken_lifecycle_source_capture_commits (
      capture_id TEXT PRIMARY KEY,
      committed_at_ms INTEGER NOT NULL
    );
    CREATE TABLE kraken_lifecycle_document_captures (
      capture_id TEXT PRIMARY KEY,
      source_kind TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      fetched_at_ms INTEGER NOT NULL,
      payload_sha256 TEXT NOT NULL
    );
    CREATE TABLE kraken_lifecycle_document_capture_commits (
      capture_id TEXT PRIMARY KEY,
      committed_at_ms INTEGER NOT NULL
    );
  `);
  database
    .prepare(
      "INSERT INTO kraken_lifecycle_source_captures VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      digest("c"),
      "status-incidents",
      "https://status.kraken.com/api/v2/incidents.json",
      RECORDED_AT_MS - 2_000,
      digest("d"),
    );
  database
    .prepare(
      "INSERT INTO kraken_lifecycle_source_capture_commits VALUES (?, ?)",
    )
    .run(digest("c"), RECORDED_AT_MS - 1_000);
  database
    .prepare(
      "INSERT INTO kraken_lifecycle_document_captures VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      digest("a"),
      "asset-listing-document",
      "https://blog.kraken.com/product/asset-listings/btc-aud-trading",
      RECORDED_AT_MS - 2_000,
      digest("b"),
    );
  database
    .prepare(
      "INSERT INTO kraken_lifecycle_document_capture_commits VALUES (?, ?)",
    )
    .run(digest("a"), RECORDED_AT_MS - 1_000);
  database
    .prepare(
      "INSERT INTO kraken_lifecycle_document_captures VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      digest("e"),
      "support-lifecycle-document",
      "https://support.kraken.com/articles/uncommitted",
      RECORDED_AT_MS - 2_000,
      digest("f"),
    );

  const d1 = {
    prepare: (sql: string) => ({
      bind: (
        ...values: (string | number | bigint | Uint8Array<ArrayBuffer> | null)[]
      ) => ({
        all: async <T>() => ({
          success: true,
          meta: {},
          results: database.prepare(sql).all(...values) as T[],
        }),
      }),
    }),
  };
  const repository = new D1KrakenLifecycleCommittedCaptureRepository(
    d1 as unknown as D1Database,
  );
  const captures = await repository.loadCommittedCaptures([
    digest("a"),
    digest("c"),
    digest("e"),
  ]);
  assert.deepEqual(
    captures.map((capture) => capture.captureId),
    [digest("a"), digest("c")],
  );
  database.close();
});
