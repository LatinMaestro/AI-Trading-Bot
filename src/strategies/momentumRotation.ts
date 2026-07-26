import type {
  AssetSignal,
  Candle,
  StrategyDecision,
} from "../domain/types.ts";
import { MIN_DAILY_CANDLES } from "../marketData/candleQuality.ts";

const STRATEGY_VERSION = "momentum-rotation-v0.1.0";

function returnOver(closes: readonly number[], days: number): number {
  const current = closes.at(-1);
  const previous = closes.at(-(days + 1));
  if (current === undefined || previous === undefined || previous <= 0) {
    throw new Error(`Insufficient closes for ${days}-day return`);
  }
  return current / previous - 1;
}

function ema(values: readonly number[], period: number): number {
  if (values.length < period) {
    throw new Error(`EMA requires at least ${period} values`);
  }
  const alpha = 2 / (period + 1);
  let result = values[0];
  if (result === undefined) {
    throw new Error("EMA values cannot be empty");
  }
  for (const value of values.slice(1)) {
    result = alpha * value + (1 - alpha) * result;
  }
  return result;
}

function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function maximumDrawdown(closes: readonly number[]): number {
  let peak = closes[0] ?? 0;
  let maxDrawdown = 0;
  for (const close of closes) {
    peak = Math.max(peak, close);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, 1 - close / peak);
  }
  return maxDrawdown;
}

export function buildSignal(pair: string, candles: readonly Candle[]): AssetSignal {
  if (candles.length < MIN_DAILY_CANDLES) {
    throw new Error(`${pair} requires at least ${MIN_DAILY_CANDLES} daily candles`);
  }

  const sorted = [...candles].sort((a, b) => a.timestampMs - b.timestampMs);
  const closes = sorted.map((candle) => candle.close);
  const latestPrice = closes.at(-1);
  if (latestPrice === undefined || latestPrice <= 0) {
    throw new Error(`${pair} has an invalid latest close`);
  }

  const dailyReturns = closes.slice(1).map((close, index) => {
    const previous = closes[index];
    if (previous === undefined || previous <= 0) return 0;
    return close / previous - 1;
  });

  const return7d = returnOver(closes, 7);
  const return30d = returnOver(closes, 30);
  const return90d = returnOver(closes, 90);
  const ema200 = ema(closes, 200);
  const annualisedVolatility = standardDeviation(dailyReturns.slice(-30)) * Math.sqrt(365);
  const recentDrawdown = maximumDrawdown(closes.slice(-90));
  const trendEligible = latestPrice > ema200;
  const momentumEligible = return30d > 0 && return90d > 0;
  const volatilityEligible = annualisedVolatility <= 1.5;
  const eligible = trendEligible && momentumEligible && volatilityEligible;

  const score =
    0.2 * return7d +
    0.45 * return30d +
    0.35 * return90d -
    0.15 * annualisedVolatility -
    0.25 * recentDrawdown;

  const reasons = [
    trendEligible ? "above-ema200" : "below-ema200",
    momentumEligible ? "positive-medium-momentum" : "negative-medium-momentum",
    volatilityEligible ? "volatility-within-limit" : "volatility-too-high",
  ];

  return {
    pair,
    eligible,
    latestPrice,
    ema200,
    return7d,
    return30d,
    return90d,
    annualisedVolatility,
    recentDrawdown,
    score,
    reasons,
  };
}

export function decideMomentumRotation(
  candlesByPair: Readonly<Record<string, readonly Candle[]>>,
): StrategyDecision {
  const signals = Object.entries(candlesByPair).map(([pair, candles]) =>
    buildSignal(pair, candles),
  );
  const ranked = signals
    .filter((signal) => signal.eligible)
    .sort((a, b) => b.score - a.score);
  const winner = ranked[0];

  if (winner === undefined || winner.score <= 0) {
    return {
      strategyVersion: STRATEGY_VERSION,
      action: "hold",
      targetExposurePct: 0,
      reason: "No approved asset has positive risk-adjusted momentum",
      signals,
    };
  }

  return {
    strategyVersion: STRATEGY_VERSION,
    action: "buy",
    targetPair: winner.pair,
    targetExposurePct: 90,
    reason: `${winner.pair} has the highest eligible momentum score`,
    signals,
  };
}
