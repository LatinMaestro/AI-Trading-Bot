import assert from "node:assert/strict";
import test from "node:test";
import type { Candle } from "../src/domain/types.ts";
import {
  buildSignal,
  decideMomentumRotation,
} from "../src/strategies/momentumRotation.ts";

function candles(start: number, dailyGrowth: number, count = 240): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = start * (1 + dailyGrowth) ** index;
    return {
      timestampMs: Date.UTC(2025, 0, 1 + index),
      open: close * 0.995,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 1_000_000,
    };
  });
}

test("positive trend is eligible", () => {
  const signal = buildSignal("XBTAUD", candles(100, 0.002));
  assert.equal(signal.eligible, true);
  assert.ok(signal.latestPrice > signal.ema200);
});

test("falling assets produce a cash decision", () => {
  const decision = decideMomentumRotation({
    XBTAUD: candles(100, -0.001),
    ETHAUD: candles(100, -0.002),
  });
  assert.equal(decision.action, "hold");
  assert.equal(decision.targetExposurePct, 0);
});

test("highest eligible score wins", () => {
  const decision = decideMomentumRotation({
    XBTAUD: candles(100, 0.001),
    ETHAUD: candles(100, 0.002),
  });
  assert.equal(decision.action, "buy");
  assert.equal(decision.targetPair, "ETHAUD");
});
