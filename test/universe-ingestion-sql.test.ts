import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  INSERT_UNIVERSE_DEFINITION_MEMBERSHIP_SQL,
  INSERT_UNIVERSE_DEFINITION_SQL,
  INSERT_UNIVERSE_EVENT_MEMBERSHIP_SQL,
  INSERT_UNIVERSE_EVENT_SQL,
  INSERT_UNIVERSE_INGESTION_BATCH_SQL,
  INSERT_UNIVERSE_INGESTION_COMMIT_SQL,
  INSERT_UNIVERSE_INGESTION_SOURCE_SQL,
  INSERT_UNIVERSE_OBSERVATION_MEMBERSHIP_SQL,
  INSERT_UNIVERSE_OBSERVATION_SQL,
  UniverseIngestionRepository,
} from "../src/storage/universeIngestion.ts";
import {
  prepareUniverseIngestionBatch,
  type UniverseIngestionBatch,
  type UniverseIngestionInput,
} from "../src/universe/ingestion.ts";

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

function persistPrepared(
  db: DatabaseSync,
  batch: UniverseIngestionBatch,
): void {
  db.exec("BEGIN");
  try {
    db.prepare(INSERT_UNIVERSE_INGESTION_BATCH_SQL).run(
      batch.batchSha256,
      batch.venue,
      batch.recordedAtMs,
      batch.definitions.length,
      batch.lifecycleEvents.length,
      batch.observations.length,
      batch.sourceDigests.length,
    );
    for (const sourceDigest of batch.sourceDigests) {
      db.prepare(INSERT_UNIVERSE_INGESTION_SOURCE_SQL).run(
        batch.batchSha256,
        sourceDigest,
      );
    }
    for (const definition of batch.definitions) {
      db.prepare(INSERT_UNIVERSE_DEFINITION_SQL).run(
        definition.definitionId,
        definition.venue,
        definition.canonicalPair,
        definition.exchangePair,
        definition.baseAsset,
        definition.quoteAsset,
        definition.instrumentKind,
        definition.availableAtMs,
        definition.sourceRef,
        definition.payloadSha256,
      );
      db.prepare(INSERT_UNIVERSE_DEFINITION_MEMBERSHIP_SQL).run(
        batch.batchSha256,
        definition.definitionId,
      );
    }
    for (const event of batch.lifecycleEvents) {
      db.prepare(INSERT_UNIVERSE_EVENT_SQL).run(
        event.eventId,
        event.venue,
        event.canonicalPair,
        event.eventType,
        event.effectiveAtMs,
        event.publishedAtMs,
        event.recordedAtMs,
        event.sourceRef,
        event.payloadSha256,
      );
      db.prepare(INSERT_UNIVERSE_EVENT_MEMBERSHIP_SQL).run(
        batch.batchSha256,
        event.eventId,
      );
    }
    for (const observation of batch.observations) {
      db.prepare(INSERT_UNIVERSE_OBSERVATION_SQL).run(
        observation.observationId,
        observation.venue,
        observation.canonicalPair,
        observation.observedAtMs,
        observation.availableAtMs,
        observation.spreadBps,
        observation.quoteTurnoverAud24h,
        observation.availableQuoteVolumeAud,
        observation.estimatedImpactBps,
        observation.minimumOrderAud,
        observation.audValuationComplete ? 1 : 0,
        observation.dailyCommittedCandles,
        observation.hourlyCommittedCandles,
        observation.annualisedVolatility,
        observation.dataQualityState,
        observation.payloadSha256,
      );
      db.prepare(INSERT_UNIVERSE_OBSERVATION_MEMBERSHIP_SQL).run(
        batch.batchSha256,
        observation.observationId,
      );
    }
    db.prepare(INSERT_UNIVERSE_INGESTION_COMMIT_SQL).run(
      batch.batchSha256,
    );
    db.exec("COMMIT");
  } catch (error: unknown) {
    db.exec("ROLLBACK");
    throw error;
  }
}

test("prepared universe batches persist atomically and retry idempotently", async () => {
  const db = database();
  const batch = await prepareUniverseIngestionBatch(input());
  persistPrepared(db, batch);
  persistPrepared(db, batch);

  const count = (table: string): number =>
    (
      db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
        count: number;
      }
    ).count;

  assert.equal(count("universe_ingestion_batches"), 1);
  assert.equal(count("universe_ingestion_batch_commits"), 1);
  assert.equal(count("universe_ingestion_batch_sources"), 3);
  assert.equal(count("universe_ingestion_batch_definitions"), 1);
  assert.equal(count("universe_ingestion_batch_events"), 1);
  assert.equal(count("universe_ingestion_batch_observations"), 1);
  assert.equal(count("market_universe_definitions"), 1);
  assert.equal(count("market_universe_events"), 1);
  assert.equal(count("market_quality_observations"), 1);
});

test("record conflict rolls back batch provenance and all memberships", async () => {
  const db = database();
  const original = await prepareUniverseIngestionBatch(input());
  persistPrepared(db, original);

  const conflicting = await prepareUniverseIngestionBatch(input(digest("d")));
  assert.notEqual(conflicting.batchSha256, original.batchSha256);
  assert.throws(
    () => persistPrepared(db, conflicting),
    /market universe definition payload conflict/,
  );

  const row = db
    .prepare(
      "SELECT batch_sha256 FROM universe_ingestion_batches WHERE batch_sha256 = ?",
    )
    .get(conflicting.batchSha256);
  assert.equal(row, undefined);
  assert.equal(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM universe_ingestion_batch_sources WHERE batch_sha256 = ?",
        )
        .get(conflicting.batchSha256) as { count: number }
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
  db.prepare(INSERT_UNIVERSE_INGESTION_SOURCE_SQL).run(
    batchDigest,
    digest("a"),
  );
  assert.throws(
    () =>
      db
        .prepare(INSERT_UNIVERSE_INGESTION_COMMIT_SQL)
        .run(batchDigest),
    /universe ingestion batch is incomplete/,
  );
});

test("batch provenance and memberships are immutable and venue-bound", async () => {
  const db = database();
  const batch = await prepareUniverseIngestionBatch(input());
  persistPrepared(db, batch);

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

  db.prepare(
    `INSERT INTO market_universe_definitions (
      definition_id, venue, canonical_pair, exchange_pair, base_asset,
      quote_asset, instrument_kind, available_at_ms, source_ref, payload_sha256
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "definition:other",
    "other-venue",
    "ETH/AUD",
    "ETHAUD",
    "ETH",
    "AUD",
    "spot",
    NOW,
    "other:source",
    digest("e"),
  );
  assert.throws(
    () =>
      db
        .prepare(INSERT_UNIVERSE_DEFINITION_MEMBERSHIP_SQL)
        .run(batch.batchSha256, "definition:other"),
    /invalid universe definition batch membership/,
  );
});

test("repository submits every record in one D1 batch", async () => {
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
      assert.equal(statements.length, prepared.length);
      return [];
    },
  };

  const batch = await new UniverseIngestionRepository(
    fakeDb as unknown as D1Database,
  ).persistBatch(input());

  assert.equal(calls, 1);
  assert.equal(prepared.length, 11);
  assert.equal(
    prepared.filter((statement) =>
      statement.sql.includes("universe_ingestion_batches"),
    ).length,
    1,
  );
  assert.equal(batch.sourceDigests.length, 3);
});
