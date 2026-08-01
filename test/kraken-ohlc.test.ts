import assert from "node:assert/strict";
import test from "node:test";
import { parseCommittedOhlcRows } from "../src/exchanges/kraken.ts";

const rows = [
  [1_000, "10", "12", "9", "11", "10.5", "100", 5],
  [2_000, "11", "13", "10", "12", "11.5", "120", 6],
  [3_000, "12", "99", "1", "50", "20", "999", 99],
] as const;

test("Kraken parser excludes the live uncommitted final candle", () => {
  const candles = parseCommittedOhlcRows("XBTAUD", rows);
  assert.equal(candles.length, 2);
  assert.equal(candles.at(-1)?.close, 12);
  assert.equal(candles.at(-1)?.timestampMs, 2_000_000);
});

test("Kraken parser fails closed without a committed candle", () => {
  assert.throws(
    () => parseCommittedOhlcRows("XBTAUD", [rows[0]]),
    /no committed candles/,
  );
});
