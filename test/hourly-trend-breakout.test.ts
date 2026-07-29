import assert from "node:assert/strict";
import test from "node:test";
import type { Candle } from "../src/domain/types.ts";
import { HOUR_MS } from "../src/marketData/candleQuality.ts";
import {
  buildHourlyTrendBreakoutSignal,
  decideHourlyTrendBreakout,
  HOURLY_TREND_BREAKOUT_BASELINE_POLICY,
} from "../src/strategies/hourlyTrendBreakout.ts";

function hourlyCandles(latestClose: number, latestHigh?: number): Candle[] {
  return Array.from({ length: 240 }, (_, index) => {
    const close = index === 239 ? latestClose : 100 + index * 0.01;
    return {
      timestampMs: index * HOUR_MS,
      open: close,
      high: index === 239 ? (latestHigh ?? close + 0.2) : close + 0.2,
      low: close - 0.2,
      close,
      volume: 1_000,
    };
  });
}

test("enters only after the closed candle clears all three entry gates", () => {
  const decision = decideHourlyTrendBreakout(
    {
      "BTC/AUD": hourlyCandles(110),
      "ETH/AUD": hourlyCandles(105),
    },
    null,
  );
  assert.equal(decision.targetPair, "BTC/AUD");
  assert.equal(
    decision.targetExposurePct,
    HOURLY_TREND_BREAKOUT_BASELINE_POLICY.targetExposurePct,
  );
  assert.deepEqual(decision.policy, HOURLY_TREND_BREAKOUT_BASELINE_POLICY);
  assert.notEqual(decision.policy, HOURLY_TREND_BREAKOUT_BASELINE_POLICY);
  assert.equal(decision.signals.every((signal) => signal.entryEligible), true);
});

test("excludes the signal candle from the prior Donchian channel", () => {
  const signal = buildHourlyTrendBreakoutSignal(
    "BTC/AUD",
    hourlyCandles(110, 150),
  );
  assert.equal(signal.entryEligible, true);
  assert.ok(signal.priorEntryHigh < signal.latestClose);
});

test("remains in AUD cash when no pair breaks its prior entry channel", () => {
  const decision = decideHourlyTrendBreakout(
    {
      "BTC/AUD": hourlyCandles(102.39),
      "ETH/AUD": hourlyCandles(102.38),
    },
    null,
  );
  assert.equal(decision.targetPair, null);
  assert.equal(decision.targetExposurePct, 0);
});

test("preserves one held position instead of rotating to a stronger entrant", () => {
  const decision = decideHourlyTrendBreakout(
    {
      "BTC/AUD": hourlyCandles(110),
      "ETH/AUD": hourlyCandles(130),
    },
    "BTC/AUD",
  );
  assert.equal(decision.targetPair, "BTC/AUD");
  assert.equal(decision.targetExposurePct, 90);
});

test("exits to AUD cash without same-candle rotation", () => {
  const decision = decideHourlyTrendBreakout(
    {
      "BTC/AUD": hourlyCandles(80),
      "ETH/AUD": hourlyCandles(130),
    },
    "BTC/AUD",
  );
  assert.equal(decision.targetPair, null);
  assert.equal(decision.targetExposurePct, 0);
  assert.equal(decision.signals[0]?.exitTriggered, true);
});

test("rejects malformed policy, chronology and current-position evidence", () => {
  assert.throws(
    () =>
      decideHourlyTrendBreakout(
        { "BTC/AUD": hourlyCandles(110) },
        null,
        {
          ...HOURLY_TREND_BREAKOUT_BASELINE_POLICY,
          exitLookbackHours: 168,
        },
      ),
    /policy is invalid/u,
  );
  const unordered = hourlyCandles(110);
  [unordered[10], unordered[11]] = [unordered[11]!, unordered[10]!];
  assert.throws(
    () => decideHourlyTrendBreakout({ "BTC/AUD": unordered }, null),
    /invalid or non-contiguous/u,
  );
  assert.throws(
    () =>
      decideHourlyTrendBreakout(
        { "BTC/AUD": hourlyCandles(110) },
        "ETH/AUD",
    ),
    /absent from strategy evidence/u,
  );
  const overflow = hourlyCandles(110);
  overflow[71] = {
    ...overflow[71]!,
    open: Number.MIN_VALUE,
    high: Number.MIN_VALUE,
    low: Number.MIN_VALUE,
    close: Number.MIN_VALUE,
  };
  assert.throws(
    () => decideHourlyTrendBreakout({ "BTC/AUD": overflow }, null),
    /invalid hourly strategy metrics/u,
  );
});
