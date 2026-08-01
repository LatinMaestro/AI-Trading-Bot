import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  buildOrderRequestFingerprint,
  RESERVE_ORDER_INTENT_SQL,
} from "../src/storage/orderIntents.ts";

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync("migrations/0001_init.sql", "utf8"));
  db.exec(readFileSync("migrations/0002_cycle_and_order_idempotency.sql", "utf8"));
  db.prepare(
    `INSERT INTO strategy_decisions
     (decision_id, cycle_id, strategy_version, mode, pair, action,
      target_exposure_pct, reference_price_aud, reason_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "decision-a",
    "cycle-a",
    "momentum-v1",
    "paper",
    "BTC/AUD",
    "buy",
    90,
    100_000,
    "{}",
    "2026-07-26T06:30:00.000Z",
  );
  return db;
}

const fingerprintInput = {
  scheduleKey: "scheduled:2026-07-26T06:30:00.000Z",
  strategyVersion: "momentum-v1",
  pair: "BTC/AUD",
  side: "buy",
  priceQuote: "100000.0",
  volume: "0.0001",
} as const;

test("logical order fingerprint is deterministic and change-sensitive", async () => {
  const first = await buildOrderRequestFingerprint(fingerprintInput);
  const second = await buildOrderRequestFingerprint(fingerprintInput);
  const changed = await buildOrderRequestFingerprint({
    ...fingerprintInput,
    priceQuote: "100000.1",
  });
  const equivalentFormatting = await buildOrderRequestFingerprint({
    ...fingerprintInput,
    pair: "XBTAUD",
    priceQuote: "0100000.00",
    volume: "0.0001000",
  });
  assert.equal(first, second);
  assert.equal(first, equivalentFormatting);
  assert.notEqual(first, changed);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("database permits only one intent for a request fingerprint", async () => {
  const db = database();
  const fingerprint = await buildOrderRequestFingerprint(fingerprintInput);
  const reserve = db.prepare(RESERVE_ORDER_INTENT_SQL);
  const common = [
    "decision-a",
    "paper",
    "BTC/AUD",
    "buy",
    100_000,
    0.0001,
    10,
    fingerprint,
    "2026-07-26T06:30:00.000Z",
    "2026-07-26T06:30:00.000Z",
  ] as const;

  assert.equal(reserve.run("intent-a", ...common).changes, 1);
  assert.equal(reserve.run("intent-b", ...common).changes, 0);
  const row = db
    .prepare(
      "SELECT intent_id FROM order_intents WHERE request_fingerprint = ?",
    )
    .get(fingerprint) as { intent_id: string };
  assert.equal(row.intent_id, "intent-a");
});
