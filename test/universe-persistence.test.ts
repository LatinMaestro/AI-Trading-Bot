import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  UniverseIngestionRepository,
  prepareUniversePersistence,
  type UniversePersistenceStatement,
} from "../src/storage/universeIngestion.ts";
import type { UniverseIngestionInput } from "../src/universe/ingestion.ts";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 6, 26, 12);
const digest = (value: string) => value.repeat(64).slice(0, 64);

const baseMarket = {
  canonicalPair: "NEW/USDT",
  exchangePair: "NEWUSDT",
  baseAsset: "NEW",
  quoteAsset: "USDT",
  instrumentKind: "spot" as const,
  observedAtMs: NOW - 1_000,
  availableAtMs: NOW - 500,
  spreadBps: 50,
  quoteTurnover24h: 1_000,
  availableQuoteVolume: 200,
  estimatedImpactBps: 20,
  minimumOrderQuote: 5,
  dailyCommittedCandles: 10,
  hourlyCommittedCandles: 100,
  annualisedVolatility: 2,
  dataQualityState: "complete" as const,
};

function input(
  recordedAtMs = NOW,
  market = baseMarket,
  lifecyclePair = "NEW/USDT",
): UniverseIngestionInput {
  return {
    venue: "kraken",
    recordedAtMs,
    maximumAudQuoteAgeMs: HOUR,
    metadataSource: {
      sourceId: `asset-pairs-${recordedAtMs}`,
      sourceKind: "venue-metadata",
      sourceRef: "kraken:asset-pairs",
      fetchedAtMs: recordedAtMs,
      payloadSha256: digest("a"),
    },
    qualitySource: {
      sourceId: `quality-${recordedAtMs}`,
      sourceKind: "venue-market-quality",
      sourceRef: "kraken:market-quality",
      fetchedAtMs: recordedAtMs,
      payloadSha256: digest("b"),
    },
    conversionQuotes: [
      {
        baseAsset: "USDT",
        quoteAsset: "AUD",
        rate: 1.5,
        observedAtMs: market.observedAtMs - 1_000,
        availableAtMs: market.observedAtMs - 500,
        payloadSha256: digest("c"),
      },
    ],
    markets: [market],
    lifecycleAnnouncements: [
      {
        source: {
          sourceId: `listing-${lifecyclePair}-${recordedAtMs}`,
          sourceKind: "official-lifecycle-announcement",
          sourceRef: `kraken:announcement:${lifecyclePair}`,
          fetchedAtMs: recordedAtMs - 100,
          payloadSha256: digest(lifecyclePair === "NEW/USDT" ? "d" : "e"),
        },
        announcement: {
          canonicalPair: lifecyclePair,
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
  for (const migration of [
    "0001_init.sql",
    "0002_cycle_and_order_idempotency.sql",
    "0003_market_candles.sql",
    "0004_market_universe.sql",
    "0005_universe_integer_hardening.sql",
    "0006_universe_ingestion_batches.sql",
  ]) {
    db.exec(readFileSync(`migrations/${migration}`, "utf8"));
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
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function count(db: DatabaseSync, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
    .count;
}

test("prepares five bounded statements for an arbitrarily sized snapshot", async () => {
  const prepared = await prepareUniversePersistence(input());
  assert.equal(prepared.statements.length, 5);
  assert.equal(prepared.statements[0]?.params[4], 1);
  assert.equal(prepared.statements[0]?.params[5], 1);
  assert.equal(prepared.statements[0]?.params[6], 1);
  assert.match(prepared.batch.batchSha256, /^[0-9a-f]{64}$/);
});

test("persists an exact retry idempotently with a complete batch manifest", async () => {
  const db = database();
  const prepared = await prepareUniversePersistence(input());
  executeAtomically(db, prepared.statements);
  executeAtomically(db, prepared.statements);

  assert.equal(count(db, "market_universe_ingestion_batches"), 1);
  assert.equal(count(db, "market_universe_definitions"), 1);
  assert.equal(count(db, "market_universe_events"), 1);
  assert.equal(count(db, "market_quality_observations"), 1);
  assert.equal(count(db, "market_universe_ingestion_batch_items"), 3);

  const manifest = db
    .prepare(
      `SELECT definition_count, event_count, observation_count
       FROM market_universe_ingestion_batches`,
    )
    .get() as {
    definition_count: number;
    event_count: number;
    observation_count: number;
  };
  assert.deepEqual(manifest, {
    definition_count: 1,
    event_count: 1,
    observation_count: 1,
  });
});

test("a late observation conflict rolls back the manifest and earlier event", async () => {
  const db = database();
  const first = await prepareUniversePersistence(input());
  executeAtomically(db, first.statements);

  const second = await prepareUniversePersistence(
    input(NOW + 1_000, { ...baseMarket, spreadBps: 75 }, "ETH/AUD"),
  );
  assert.throws(
    () => executeAtomically(db, second.statements),
    /market quality observation payload conflict/,
  );

  assert.equal(count(db, "market_universe_ingestion_batches"), 1);
  assert.equal(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM market_universe_events
           WHERE canonical_pair = 'ETH/AUD'`,
        )
        .get() as { count: number }
    ).count,
    0,
  );
});

test("batch manifests and membership links are immutable", async () => {
  const db = database();
  const prepared = await prepareUniversePersistence(input());
  executeAtomically(db, prepared.statements);
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE market_universe_ingestion_batches SET definition_count = 2",
        )
        .run(),
    /ingestion batches are immutable/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM market_universe_ingestion_batch_items").run(),
    /batch items are immutable/,
  );
});

test("repository submits one transactional D1 batch", async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  let batchCalls = 0;
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: readonly unknown[]) {
          calls.push({ sql, params });
          return { sql, params };
        },
      };
    },
    async batch(statements: readonly unknown[]) {
      batchCalls += 1;
      assert.equal(statements.length, 5);
      return [];
    },
  };

  const repository = new UniverseIngestionRepository(db as unknown as D1Database);
  const batch = await repository.persistBatch(input());
  assert.equal(batchCalls, 1);
  assert.equal(calls.length, 5);
  assert.match(batch.batchSha256, /^[0-9a-f]{64}$/);
});
