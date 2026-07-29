import type { Candle } from "../domain/types.ts";
import { HOUR_MS, MIN_HOURLY_CANDLES } from "../marketData/candleQuality.ts";

const CANONICAL_AUD_PAIR = /^[A-Z0-9]{2,20}\/AUD$/u;

export const HOURLY_TREND_BREAKOUT_STRATEGY_VERSION =
  "hourly-trend-breakout-v0.1.0";

export interface HourlyTrendBreakoutPolicy {
  readonly entryLookbackHours: number;
  readonly exitLookbackHours: number;
  readonly emaPeriodHours: number;
  readonly momentumLookbackHours: number;
  readonly targetExposurePct: number;
}

export const HOURLY_TREND_BREAKOUT_BASELINE_POLICY: HourlyTrendBreakoutPolicy =
  Object.freeze({
    entryLookbackHours: 168,
    exitLookbackHours: 72,
    emaPeriodHours: 200,
    momentumLookbackHours: 168,
    targetExposurePct: 90,
  });

export interface HourlyTrendBreakoutSignal {
  readonly pair: string;
  readonly entryEligible: boolean;
  readonly exitTriggered: boolean;
  readonly latestClose: number;
  readonly priorEntryHigh: number;
  readonly priorExitLow: number;
  readonly ema: number;
  readonly momentumReturn: number;
  readonly breakoutStrength: number;
  readonly trendStrength: number;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface HourlyTrendBreakoutDecision {
  readonly strategyVersion: typeof HOURLY_TREND_BREAKOUT_STRATEGY_VERSION;
  readonly policy: HourlyTrendBreakoutPolicy;
  readonly targetPair: string | null;
  readonly targetExposurePct: number;
  readonly reason: string;
  readonly signals: readonly HourlyTrendBreakoutSignal[];
}

function assertPolicy(policy: HourlyTrendBreakoutPolicy): void {
  const integerValues = [
    policy.entryLookbackHours,
    policy.exitLookbackHours,
    policy.emaPeriodHours,
    policy.momentumLookbackHours,
  ];
  if (
    integerValues.some(
      (value) =>
        !Number.isSafeInteger(value) || value < 2 || value > 24 * 365,
    ) ||
    policy.exitLookbackHours >= policy.entryLookbackHours ||
    !Number.isFinite(policy.targetExposurePct) ||
    policy.targetExposurePct <= 0 ||
    policy.targetExposurePct > 100
  ) {
    throw new Error("Hourly trend/breakout policy is invalid");
  }
}

function assertHourlyHistory(
  pair: string,
  candles: readonly Candle[],
  policy: HourlyTrendBreakoutPolicy,
): void {
  if (!CANONICAL_AUD_PAIR.test(pair)) {
    throw new Error(`${pair} is not a canonical AUD pair`);
  }
  const required =
    Math.max(
      MIN_HOURLY_CANDLES,
      policy.entryLookbackHours + 1,
      policy.exitLookbackHours + 1,
      policy.emaPeriodHours,
      policy.momentumLookbackHours + 1,
    );
  if (candles.length < required) {
    throw new Error(`${pair} requires at least ${required} hourly candles`);
  }

  let previousTimestampMs: number | undefined;
  for (const candle of candles) {
    if (
      !Number.isSafeInteger(candle.timestampMs) ||
      candle.timestampMs < 0 ||
      candle.timestampMs % HOUR_MS !== 0 ||
      (previousTimestampMs !== undefined &&
        candle.timestampMs - previousTimestampMs !== HOUR_MS) ||
      ![candle.open, candle.high, candle.low, candle.close, candle.volume].every(
        Number.isFinite,
      ) ||
      candle.open <= 0 ||
      candle.high <= 0 ||
      candle.low <= 0 ||
      candle.close <= 0 ||
      candle.volume < 0 ||
      candle.high < Math.max(candle.open, candle.close) ||
      candle.low > Math.min(candle.open, candle.close) ||
      candle.low > candle.high
    ) {
      throw new Error(`${pair} hourly candles are invalid or non-contiguous`);
    }
    previousTimestampMs = candle.timestampMs;
  }
}

function ema(values: readonly number[], period: number): number {
  const seed = values.at(-(period + 1));
  if (seed === undefined) throw new Error("EMA history is insufficient");
  const alpha = 2 / (period + 1);
  let result = seed;
  for (const value of values.slice(-period)) {
    result = alpha * value + (1 - alpha) * result;
  }
  return result;
}

function precedingCandles(
  candles: readonly Candle[],
  lookbackHours: number,
): readonly Candle[] {
  return candles.slice(-(lookbackHours + 1), -1);
}

export function buildHourlyTrendBreakoutSignal(
  pair: string,
  candles: readonly Candle[],
  policy: HourlyTrendBreakoutPolicy = HOURLY_TREND_BREAKOUT_BASELINE_POLICY,
): HourlyTrendBreakoutSignal {
  assertPolicy(policy);
  assertHourlyHistory(pair, candles, policy);

  const latest = candles.at(-1)!;
  const closes = candles.map((candle) => candle.close);
  const priorEntryHigh = Math.max(
    ...precedingCandles(candles, policy.entryLookbackHours).map(
      (candle) => candle.high,
    ),
  );
  const priorExitLow = Math.min(
    ...precedingCandles(candles, policy.exitLookbackHours).map(
      (candle) => candle.low,
    ),
  );
  const momentumReference = closes.at(-(policy.momentumLookbackHours + 1))!;
  const emaValue = ema(closes, policy.emaPeriodHours);
  const momentumReturn = latest.close / momentumReference - 1;
  const breakoutStrength = latest.close / priorEntryHigh - 1;
  const trendStrength = latest.close / emaValue - 1;
  const breakoutEligible = latest.close > priorEntryHigh;
  const trendEligible = latest.close > emaValue;
  const momentumEligible = momentumReturn > 0;
  const entryEligible =
    breakoutEligible && trendEligible && momentumEligible;
  const exitTriggered =
    latest.close < priorExitLow || !trendEligible || !momentumEligible;
  const score = breakoutStrength + trendStrength + momentumReturn;
  if (
    ![
      priorEntryHigh,
      priorExitLow,
      emaValue,
      momentumReturn,
      breakoutStrength,
      trendStrength,
      score,
    ].every(Number.isFinite) ||
    priorEntryHigh <= 0 ||
    priorExitLow <= 0 ||
    emaValue <= 0
  ) {
    throw new Error(`${pair} produced invalid hourly strategy metrics`);
  }

  return {
    pair,
    entryEligible,
    exitTriggered,
    latestClose: latest.close,
    priorEntryHigh,
    priorExitLow,
    ema: emaValue,
    momentumReturn,
    breakoutStrength,
    trendStrength,
    score,
    reasons: [
      breakoutEligible ? "donchian-entry-breakout" : "inside-entry-channel",
      trendEligible ? "above-hourly-ema" : "below-hourly-ema",
      momentumEligible ? "positive-hourly-momentum" : "non-positive-momentum",
      latest.close < priorExitLow
        ? "donchian-exit-break"
        : "no-donchian-exit-break",
    ],
  };
}

export function decideHourlyTrendBreakout(
  candlesByPair: Readonly<Record<string, readonly Candle[]>>,
  currentPair: string | null,
  policy: HourlyTrendBreakoutPolicy = HOURLY_TREND_BREAKOUT_BASELINE_POLICY,
): HourlyTrendBreakoutDecision {
  assertPolicy(policy);
  const decisionPolicy = Object.freeze({ ...policy });
  const entries = Object.entries(candlesByPair).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (entries.length === 0 || entries.length > 500) {
    throw new Error("Hourly trend/breakout universe is empty or unbounded");
  }
  const signals = entries.map(([pair, candles]) =>
    buildHourlyTrendBreakoutSignal(pair, candles, policy),
  );

  if (currentPair !== null) {
    if (!CANONICAL_AUD_PAIR.test(currentPair)) {
      throw new Error("Current pair is not canonical");
    }
    const held = signals.find((signal) => signal.pair === currentPair);
    if (held === undefined) {
      throw new Error("Current pair is absent from strategy evidence");
    }
    if (held.exitTriggered) {
      return {
        strategyVersion: HOURLY_TREND_BREAKOUT_STRATEGY_VERSION,
        policy: decisionPolicy,
        targetPair: null,
        targetExposurePct: 0,
        reason: `${currentPair} triggered a deterministic exit to AUD cash`,
        signals,
      };
    }
    return {
      strategyVersion: HOURLY_TREND_BREAKOUT_STRATEGY_VERSION,
      policy: decisionPolicy,
      targetPair: currentPair,
      targetExposurePct: policy.targetExposurePct,
      reason: `${currentPair} has not breached a deterministic exit gate`,
      signals,
    };
  }

  const winner = [...signals]
    .filter((signal) => signal.entryEligible)
    .sort(
      (left, right) =>
        right.score - left.score || left.pair.localeCompare(right.pair),
    )[0];
  if (winner === undefined) {
    return {
      strategyVersion: HOURLY_TREND_BREAKOUT_STRATEGY_VERSION,
      policy: decisionPolicy,
      targetPair: null,
      targetExposurePct: 0,
      reason: "No pair passed the hourly Donchian, EMA and momentum entry gates",
      signals,
    };
  }
  return {
    strategyVersion: HOURLY_TREND_BREAKOUT_STRATEGY_VERSION,
    policy: decisionPolicy,
    targetPair: winner.pair,
    targetExposurePct: policy.targetExposurePct,
    reason: `${winner.pair} has the strongest eligible hourly breakout score`,
    signals,
  };
}
