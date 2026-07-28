import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  persistKrakenLifecycleBackfillManifest,
  prepareKrakenLifecycleBackfillManifest,
  type KrakenLifecycleBackfillManifestInput,
} from "../src/universe/krakenLifecycleBackfill.ts";

const RECORDED_AT_MS = Date.UTC(2026, 6, 29);
const digest = (character: string): string => character.repeat(64);

function input(
  overrides: Partial<KrakenLifecycleBackfillManifestInput> = {},
): KrakenLifecycleBackfillManifestInput {
  return {
    recordedAtMs: RECORDED_AT_MS,
    bindingSha256: digest("a"),
    evidenceSha256: digest("b"),
    expectedPairs: ["BTC/AUD", "ETH/AUD"],
    documentCount: 2,
    declarationCount: 6,
    coverage: [
      {
        canonicalPair: "BTC/AUD",
        complete: true,
        missingEvidence: [],
      },
      {
        canonicalPair: "ETH/AUD",
        complete: false,
        missingEvidence: ["australian-availability-history"],
      },
    ],
    ...overrides,
  };
}

test("prepares deterministic partial backfill evidence that is non-authoritative", async () => {
  const first = await prepareKrakenLifecycleBackfillManifest(input());
  const second = await prepareKrakenLifecycleBackfillManifest({
    ...input(),
    expectedPairs: ["ETH/AUD", "BTC/AUD"],
    coverage: [...input().coverage].reverse(),
  });
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.equal(first.status, "partial");
  assert.equal(first.coverageAuthoritative, false);
  assert.equal(first.completePairCount, 1);
  assert.deepEqual(
    first.coverage.map((item) => item.canonicalPair),
    ["BTC/AUD", "ETH/AUD"],
  );
});

test("marks only complete all-pair coverage as lifecycle-authoritative", async () => {
  const manifest = await prepareKrakenLifecycleBackfillManifest(
    input({
      coverage: input().coverage.map((item) => ({
        ...item,
        complete: true,
        missingEvidence: [],
      })),
    }),
  );
  assert.equal(manifest.status, "complete");
  assert.equal(manifest.coverageAuthoritative, true);
  assert.equal(manifest.completePairCount, 2);
});

test("rejects missing pairs and contradictory or unknown coverage", async () => {
  await assert.rejects(
    prepareKrakenLifecycleBackfillManifest(
      input({ coverage: input().coverage.slice(0, 1) }),
    ),
    /coverage count is incomplete/,
  );
  await assert.rejects(
    prepareKrakenLifecycleBackfillManifest(
      input({
        coverage: [
          input().coverage[0]!,
          {
            canonicalPair: "ETH/AUD",
            complete: true,
            missingEvidence: ["trading-history"],
          },
        ],
      }),
    ),
    /completeness conflicts/,
  );
  await assert.rejects(
    prepareKrakenLifecycleBackfillManifest(
      input({
        coverage: [
          input().coverage[0]!,
          {
            canonicalPair: "DOGE/AUD",
            complete: false,
            missingEvidence: ["listing-history"],
          },
        ],
      }),
    ),
    /does not match expected pairs/,
  );
});

interface BoundStatement {
  readonly sql: string;
  readonly values: readonly (
    | string
    | number
    | bigint
    | Uint8Array<ArrayBuffer>
    | null
  )[];
}

function sqliteD1(database: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(
          ...values: (
            | string
            | number
            | bigint
            | Uint8Array<ArrayBuffer>
            | null
          )[]
        ) {
          return { sql, values } as unknown as D1PreparedStatement;
        },
      } as D1PreparedStatement;
    },
    async batch(statements: D1PreparedStatement[]) {
      database.exec("BEGIN");
      try {
        for (const statement of statements) {
          const bound = statement as unknown as BoundStatement;
          database.prepare(bound.sql).run(...bound.values);
        }
        database.exec("COMMIT");
      } catch (error: unknown) {
        database.exec("ROLLBACK");
        throw error;
      }
      return [] as D1Result<unknown>[];
    },
  } as D1Database;
}

test("persists immutable partial and complete manifests with verified commits", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(
    readFileSync(
      new URL(
        "../migrations/0016_kraken_lifecycle_backfill_manifests.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const d1 = sqliteD1(database);
  const partial = await prepareKrakenLifecycleBackfillManifest(input());
  await persistKrakenLifecycleBackfillManifest(
    d1,
    partial,
    RECORDED_AT_MS + 1,
  );
  await persistKrakenLifecycleBackfillManifest(
    d1,
    partial,
    RECORDED_AT_MS + 2,
  );
  assert.deepEqual(
    {
      ...database
      .prepare(
        `SELECT status, coverage_authoritative, pair_count, complete_pair_count
         FROM kraken_lifecycle_backfill_manifests`,
      )
      .get(),
    },
    {
      status: "partial",
      coverage_authoritative: 0,
      pair_count: 2,
      complete_pair_count: 1,
    },
  );
  assert.equal(
    database
      .prepare(
        "SELECT committed_at_ms FROM kraken_lifecycle_backfill_manifest_commits",
      )
      .get()?.committed_at_ms,
    RECORDED_AT_MS + 1,
  );

  const complete = await prepareKrakenLifecycleBackfillManifest(
    input({
      evidenceSha256: digest("c"),
      coverage: input().coverage.map((item) => ({
        ...item,
        complete: true,
        missingEvidence: [],
      })),
    }),
  );
  await persistKrakenLifecycleBackfillManifest(
    d1,
    complete,
    RECORDED_AT_MS + 3,
  );
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM kraken_lifecycle_backfill_manifests
         WHERE coverage_authoritative = 1`,
      )
      .get()?.count,
    1,
  );
  assert.throws(
    () =>
      database
        .prepare(
          "UPDATE kraken_lifecycle_backfill_manifests SET status = 'partial'",
        )
        .run(),
    /immutable/,
  );
  database.close();
});

test("database commit rejects incomplete or falsely complete membership", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(
    readFileSync(
      new URL(
        "../migrations/0016_kraken_lifecycle_backfill_manifests.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  database
    .prepare(
      `INSERT INTO kraken_lifecycle_backfill_manifests VALUES (
        ?, 'kraken-lifecycle-backfill-v1', ?, ?, ?, 'complete', 1, 2, 2, 2, 6
      )`,
    )
    .run(
      digest("d"),
      RECORDED_AT_MS,
      digest("e"),
      digest("f"),
    );
  database
    .prepare(
      `INSERT INTO kraken_lifecycle_backfill_pair_coverage
       VALUES (?, 'BTC/AUD', 1, '[]')`,
    )
    .run(digest("d"));
  assert.throws(
    () =>
      database
        .prepare(
          "INSERT INTO kraken_lifecycle_backfill_manifest_commits VALUES (?, ?)",
        )
        .run(digest("d"), RECORDED_AT_MS + 1),
    /incomplete/,
  );
  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO kraken_lifecycle_backfill_pair_coverage
           VALUES (?, 'ETH/AUD', 0, '["unknown-history"]')`,
        )
        .run(digest("d")),
    /inconsistent/,
  );
  database.close();
});
