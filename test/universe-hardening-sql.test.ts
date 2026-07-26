import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const DIGEST = "a".repeat(64);

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const migration of [
    "0001_init.sql",
    "0002_cycle_and_order_idempotency.sql",
    "0003_market_candles.sql",
    "0004_market_universe.sql",
    "0005_universe_integer_hardening.sql",
  ]) {
    db.exec(readFileSync(`migrations/${migration}`, "utf8"));
  }
  return db;
}

test("universe ledger rejects fractional historical times and counts", () => {
  const db = database();
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO market_universe_definitions (
            definition_id, venue, canonical_pair, exchange_pair, base_asset,
            quote_asset, instrument_kind, available_at_ms, source_ref, payload_sha256
          ) VALUES ('fractional-definition', 'kraken', 'BTC/AUD', 'XBTAUD', 'BTC', 'AUD', 'spot', 1.5, 'source', ?)`,
        )
        .run(DIGEST),
    /time must be a non-negative integer/,
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
          ) VALUES ('fractional-observation', 'kraken', 'BTC/AUD', 1, 2, 1, 1, 1, 1, 1, 1, 1.5, 2, 1, 'complete', ?)`,
        )
        .run(DIGEST),
    /times and counts must be non-negative integers/,
  );
});
