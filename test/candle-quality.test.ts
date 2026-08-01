import assert from "node:assert/strict";
import test from "node:test";
import type { Candle } from "../src/domain/types.ts";
import {
  assertDailyCandlesUsable,
  DAY_MS,
} from "../src/marketData/candleQuality.ts";

function candles(count = 220): Candle[] {
  return Array.from({ length: count }, (_, index) => ({
    timestampMs: index * DAY_MS,
    open: 100 + index,
    high: 102 + index,
    low: 99 + index,
    close: 101 + index,
    volume: 1_000 + index,
  }));
}

const freshNow = 220 * DAY_MS + 60 * 60 * 1_000;

test("complete contiguous committed daily candles are accepted", () => {
  assert.doesNotThrow(() =>
    assertDailyCandlesUsable("BTC/AUD", candles(), { nowMs: freshNow }),
  );
});

test("a daily candle gap is rejected", () => {
  const withGap = candles();
  withGap[100] = { ...withGap[100]!, timestampMs: 101 * DAY_MS };
  assert.throws(
    () => assertDailyCandlesUsable("BTC/AUD", withGap, { nowMs: freshNow }),
    /missing, duplicate or unordered/,
  );
});

test("stale committed daily candles are rejected", () => {
  assert.throws(
    () =>
      assertDailyCandlesUsable("BTC/AUD", candles(), {
        nowMs: freshNow + 72 * 60 * 60 * 1_000,
      }),
    /is stale/,
  );
});

test("inconsistent OHLC bounds are rejected", () => {
  const invalid = candles();
  invalid[10] = { ...invalid[10]!, high: 50 };
  assert.throws(
    () => assertDailyCandlesUsable("BTC/AUD", invalid, { nowMs: freshNow }),
    /inconsistent OHLC bounds/,
  );
});
