import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  INSERT_UNIVERSE_DEFINITION_MEMBERSHIPS_JSON_SQL,
  INSERT_UNIVERSE_DEFINITIONS_JSON_SQL,
  INSERT_UNIVERSE_INGESTION_BATCH_SQL,
  INSERT_UNIVERSE_INGESTION_COMMIT_SQL,
  INSERT_UNIVERSE_INGESTION_SOURCES_JSON_SQL,
  UniverseIngestionRepository,
  prepareUniversePersistence,
  type UniversePersistenceStatement,
} from "../src/storage/universeIngestion.ts";
import type { UniverseIngestionInput } from "../src/universe/ingestion.ts";

const NOW = Date.UTC(2026, 6, 26, 12);
const digest = (value: string) => value.repeat(64).slice(0, 64);

function input(metadataDigest = digest("a")): UniverseIngestionInput {
  return {
    venue: "kraken",
    recordedAtMs: NOW,
    maximumAudQuoteAgeMs: 3_600_000,
    metadataSource: {
      sourceId: "asset-pairs-1",
      sourceKind: "venue-metadata",
      sourceRef: `kraken:asset-pairs:${metadataDigest.slice(0, 4)}`,
      fetchedAtMs: NOW,
      payloadSha256: metadataDigest,
    },
    qualitySource: {
      sourceId: "quality-1",
      sourceKind: "venue-market-quality",
      sourceRef: "kraken:market-quality",
      fetchedAtMs: NOW,
      payloadSha256: digest("b"),
    },
    conversionQuotes: [],
    markets: [
      {
        canonicalPair: "BTC/AUD",
        exchangePair: "XBTAUD",
        baseAsset: "BTC",
        quoteAsset: "AUD",
        instrumentKind: "spot",
        observedAtMs: NOW - 1_000,
        availableAtMs: NOW - 500,
        spreadBps: 10,
        quoteTurnover24h: 1_000_000,
        availableQuoteVolume: 100_000,
        estimatedImpactBps: 5,
        minimumOrderQuote: 10,
        dailyCommittedCandles: 365,
        hourlyCommittedCandles: 2_000,
        annualisedVolatility: 0.8,
        dataQualityState: "complete",
      },
    ],
    lifecycleAnnouncements: [
      {
        source: {
          sourceId: "listing-1",
          sourceKind: "official-lifecycle-announcement",
          sourceRef: "kraken:listing:BTC",
          fetchedAtMs: NOW - 100,
          payloadSha256: digest("c"),
        },
        announcement: {
          canonicalPair: "BTC/AUD",
          eventType: "listed",
          effectiveAtMs: NOW - 10_000,
          publishedAtMs: NOW - 5_000,
        },
      },
    ],
  };
}

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const migration of [
    "migrations/0001_init.sql",
    "migrations/0002_cycle_and_order_idempotency.sql",
    "migrations/0003_market_candles.sql",
    "migrations/0004_market_universe.sql",
    "migrations/0005_universe_integer_hardening.sql",
    "migrations/0006_universe_ingestion_batches.sql",
  ]) {
    db.exec(readFileSync(migration, "utf8"));
  }
  return db;
}

function executeAtomically(
  db: DatabaseSync,
  statements: readonly UniversePersistenceStatement[],
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

function count(db: DatabaseSync, table: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    }
  ).count;
}

test("prepared universe batches persist atomically and retry idempotently", async () => {
  const db = database();
  const prepared = await prepareUniversePersistence(input());
  executeAtomically(db, prepared.statements);
  executeAtomically(db, prepared.statements);

  assert.equal(prepared.statements.length, 9);
  assert.equal(count(db, "universe_ingestion_batches"), 1);
  assert.equal(count(db, "universe_ingestion_batch_commits"), 1);
  assert.equal(count(db, "universe_ingestion_batch_sources"), 3);
  assert.equal(count(db, "universe_ingestion_batch_definitions"), 1);
  assert.equal(count(db, "universe_ingestion_batch_events"), 1);
  assert.equal(count(db, "universe_ingestion_batch_observations"), 1);
  assert.equal(count(db, "market_universe_definitions"), 1);
  assert.equal(count(db, "market_universe_events"), 1);
  assert.equal(count(db, "market_quality_observations"), 1);
});

test("record conflict rolls back batch provenance and all memberships", async () => {
  const db = database();
  const original = await prepareUniversePersistence(input());
  executeAtomically(db, original.statements);

  const conflicting = await prepareUniversePersistence(input(digest("d")));
  assert.notEqual(conflicting.batch.batchSha256, original.batch.batchSha256);
  assert.throws(
    () => executeAtomically(db, conflicting.statements),
    /market universe definition payload conflict/,
  );

  assert.equal(
    db
      .prepare(
        "SELECT batch_sha256 FROM universe_ingestion_batches WHERE batch_sha256 = ?",
      )
      .get(conflicting.batch.batchSha256),
    undefined,
  );
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM universe_ingestion_batch_sources WHERE batch_sha256 = ?",
        )
        .get(conflicting.batch.batchSha256) as { count: number }
    ).count,
    0,
  );
});

test("incomplete batches cannot receive a commit marker", () => {
  const db = database();
  const batchDigest = digest("f");
  db.prepare(INSERT_UNIVERSE_INGESTION_BATCH_SQL).run(
    batchDigest,
    "kraken",
    NOW,
    1,
    0,
    0,
    1,
  );
  db.prepare(INSERT_UNIVERSE_INGESTION_SOURCES_JSON_SQL).run(
    batchDigest,
    JSON.stringify([digest("a")]),
  );
  assert.throws(
    () => db.prepare(INSERT_UNIVERSE_INGESTION_COMMIT_SQL).run(batchDigest),
    /universe ingestion batch is incomplete/,
  );
});

test("batch provenance and memberships are immutable and venue-bound", async () => {
  const db = database();
  const prepared = await prepareUniversePersistence(input());
  executeAtomically(db, prepared.statements);

  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE universe_ingestion_batches SET recorded_at_ms = recorded_at_ms + 1",
        )
        .run(),
    /universe ingestion batches are immutable/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM universe_ingestion_batch_commits").run(),
    /commit markers are immutable/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM universe_ingestion_batch_sources").run(),
    /source memberships are immutable/,
  );

  const otherDefinition = {
    definitionId: "definition:other",
    venue: "other-venue",
    canonicalPair: "ETH/AUD",
    exchangePair: "ETHAUD",
    baseAsset: "ETH",
    quoteAsset: "AUD",
    instrumentKind: "spot",
    availableAtMs: NOW,
    sourceRef: "other:source",
    payloadSha256: digest("e"),
  };
  db.prepare(INSERT_UNIVERSE_DEFINITIONS_JSON_SQL).run(
    JSON.stringify([otherDefinition]),
  );
  assert.throws(
    () =>
      db
        .prepare(INSERT_UNIVERSE_DEFINITION_MEMBERSHIPS_JSON_SQL)
        .run(prepared.batch.batchSha256, JSON.stringify([otherDefinition])),
    /invalid universe definition batch membership/,
  );
});

test("committed batches reject new memberships while exact retries remain idempotent", async () => {
  const db = database();
  const prepared = await prepareUniversePersistence(input());
  executeAtomically(db, prepared.statements);

  assert.throws(
    () =>
      db
        .prepare(INSERT_UNIVERSE_INGESTION_SOURCES_JSON_SQL)
        .run(prepared.batch.batchSha256, JSON.stringify([digest("d")])),
    /committed universe ingestion batch cannot gain source memberships/,
  );

  const sameVenueDefinition = {
    definitionId: "definition:late",
    venue: "kraken",
    canonicalPair: "ETH/AUD",
    exchangePair: "ETHAUD",
    baseAsset: "ETH",
    quoteAsset: "AUD",
    instrumentKind: "spot",
    availableAtMs: NOW,
    sourceRef: "kraken:late-definition",
    payloadSha256: digest("e"),
  };
  db.prepare(INSERT_UNIVERSE_DEFINITIONS_JSON_SQL).run(
    JSON.stringify([sameVenueDefinition]),
  );
  assert.throws(
    () =>
      db
        .prepare(INSERT_UNIVERSE_DEFINITION_MEMBERSHIPS_JSON_SQL)
        .run(prepared.batch.batchSha256, JSON.stringify([sameVenueDefinition])),
    /committed universe ingestion batch cannot gain definition memberships/,
  );

  assert.equal(count(db, "universe_ingestion_batch_sources"), 3);
  assert.equal(count(db, "universe_ingestion_batch_definitions"), 1);
  executeAtomically(db, prepared.statements);
});

test("repository submits a fixed nine-statement D1 batch for multiple markets", async () => {
  const prepared: Array<{ readonly sql: string; readonly values: readonly unknown[] }> = [];
  let calls = 0;
  const fakeDb = {
    prepare(sql: string) {
      return {
        bind(...values: readonly unknown[]) {
          const statement = { sql, values };
          prepared.push(statement);
          return statement;
        },
      };
    },
    async batch(statements: readonly unknown[]) {
      calls += 1;
      assert.equal(statements.length, 9);
      return [];
    },
  };

  const base = input();
  const firstMarket = base.markets[0];
  if (firstMarket === undefined) throw new Error("Missing market fixture");
  const multiMarket: UniverseIngestionInput = {
    ...base,
    markets: [
      firstMarket,
      {
        ...firstMarket,
        canonicalPair: "ETH/AUD",
        exchangePair: "ETHAUD",
        baseAsset: "ETH",
      },
    ],
  };
  const batch = await new UniverseIngestionRepository(
    fakeDb as unknown as D1Database,
  ).persistBatch(multiMarket);

  assert.equal(calls, 1);
  assert.equal(prepared.length, 9);
  assert.equal(batch.definitions.length, 2);
  assert.equal(batch.sourceDigests.length, 3);
});
