import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const DIGEST = "a".repeat(64);

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync("migrations/0001_init.sql", "utf8"));
  db.exec(readFileSync("migrations/0002_cycle_and_order_idempotency.sql", "utf8"));
  db.exec(readFileSync("migrations/0003_market_candles.sql", "utf8"));
  db.exec(readFileSync("migrations/0004_market_universe.sql", "utf8"));
  return db;
}

function insertDefinition(db: DatabaseSync, digest = DIGEST): void {
  db.prepare(
    `INSERT OR IGNORE INTO market_universe_definitions (
      definition_id, venue, canonical_pair, exchange_pair, base_asset,
      quote_asset, instrument_kind, available_at_ms, source_ref, payload_sha256
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "definition:BTC/AUD",
    "kraken",
    "BTC/AUD",
    "XBTAUD",
    "BTC",
    "AUD",
    "spot",
    100,
    "asset-pairs:100",
    digest,
  );
}

function insertEvent(db: DatabaseSync, eventType = "listed"): void {
  db.prepare(
    `INSERT OR IGNORE INTO market_universe_events (
      event_id, venue, canonical_pair, event_type, effective_at_ms,
      published_at_ms, recorded_at_ms, source_ref, payload_sha256
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "event:BTC/AUD:listed",
    "kraken",
    "BTC/AUD",
    eventType,
    100,
    100,
    101,
    "listing:BTC/AUD",
    DIGEST,
  );
}

function insertObservation(db: DatabaseSync, spreadBps = 20): void {
  db.prepare(
    `INSERT OR IGNORE INTO market_quality_observations (
      observation_id, venue, canonical_pair, observed_at_ms, available_at_ms,
      spread_bps, quote_turnover_aud_24h, available_quote_volume_aud,
      estimated_impact_bps, minimum_order_aud, aud_valuation_complete,
      daily_committed_candles, hourly_committed_candles,
      annualised_volatility, data_quality_state, payload_sha256
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "observation:BTC/AUD:200",
    "kraken",
    "BTC/AUD",
    200,
    201,
    spreadBps,
    1_000_000,
    100_000,
    10,
    10,
    1,
    365,
    2_000,
    0.8,
    "complete",
    DIGEST,
  );
}

test("universe records are idempotent and immutable", () => {
  const db = database();
  insertDefinition(db);
  insertDefinition(db);
  insertEvent(db);
  insertEvent(db);
  insertObservation(db);
  insertObservation(db);

  assert.equal(
    (
      db
        .prepare("SELECT COUNT(*) AS count FROM market_universe_definitions")
        .get() as { count: number }
    ).count,
    1,
  );
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS count FROM market_universe_events").get() as {
        count: number;
      }
    ).count,
    1,
  );
  assert.equal(
    (
      db
        .prepare("SELECT COUNT(*) AS count FROM market_quality_observations")
        .get() as { count: number }
    ).count,
    1,
  );
  assert.throws(
    () =>
      db
        .prepare("UPDATE market_universe_events SET event_type = 'delisted'")
        .run(),
    /market universe events are immutable/,
  );
  assert.throws(
    () => db.prepare("DELETE FROM market_quality_observations").run(),
    /market quality observations are immutable/,
  );
});

test("identity reuse with changed content fails closed", () => {
  const db = database();
  insertDefinition(db);
  insertEvent(db);
  insertObservation(db);
  assert.throws(
    () => insertDefinition(db, "b".repeat(64)),
    /definition payload conflict/,
  );
  assert.throws(() => insertEvent(db, "delisted"), /event payload conflict/);
  assert.throws(
    () => insertObservation(db, 25),
    /observation payload conflict/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO market_universe_definitions (
            definition_id, venue, canonical_pair, exchange_pair, base_asset,
            quote_asset, instrument_kind, available_at_ms, source_ref, payload_sha256
          ) VALUES ('another-id', 'kraken', 'BTC/AUD', 'XBTAUD', 'BTC', 'AUD', 'spot', 100, 'different-source', ?)`,
        )
        .run("c".repeat(64)),
    /definition payload conflict/,
  );
});

test("chronology, instrument, state and numeric constraints are enforced", () => {
  const db = database();
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO market_universe_events (
            event_id, venue, canonical_pair, event_type, effective_at_ms,
            published_at_ms, recorded_at_ms, source_ref, payload_sha256
          ) VALUES ('bad-event', 'kraken', 'BAD/AUD', 'listed', 1, 3, 2, 'source', ?)`,
        )
        .run(DIGEST),
    /CHECK constraint failed/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO market_universe_definitions (
            definition_id, venue, canonical_pair, exchange_pair, base_asset,
            quote_asset, instrument_kind, available_at_ms, source_ref, payload_sha256
          ) VALUES ('bad-definition', 'kraken', 'BAD/AUD', 'BADAUD', 'BAD', 'AUD', 'future', 1, 'source', ?)`,
        )
        .run(DIGEST),
    /CHECK constraint failed/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO market_quality_observations (
            observation_id, venue, canonical_pair, observed_at_ms, available_at_ms,
            spread_bps, quote_turnover_aud_24h, available_quote_volume_aud,
            estimated_impact_bps, minimum_order_aud, aud_valuation_complete,
            daily_committed_candles, hourly_committed_candles,
            annualised_volatility, data_quality_state, payload_sha256
          ) VALUES ('bad-observation', 'kraken', 'BAD/AUD', 3, 2, -1, 0, 0, 0, 0, 1, 0, 0, 0, 'complete', ?)`,
        )
        .run(DIGEST),
    /CHECK constraint failed/,
  );
});

test("universe digests must be lowercase SHA-256 hex", () => {
  const db = database();
  const statement = db.prepare(
    `INSERT INTO market_universe_definitions (
      definition_id, venue, canonical_pair, exchange_pair, base_asset,
      quote_asset, instrument_kind, available_at_ms, source_ref, payload_sha256
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  assert.throws(
    () =>
      statement.run(
        "definition:BTC/AUD",
        "kraken",
        "BTC/AUD",
        "XBTAUD",
        "BTC",
        "AUD",
        "spot",
        100,
        "asset-pairs:100",
        "A".repeat(64),
      ),
    /CHECK constraint failed/,
  );
});
