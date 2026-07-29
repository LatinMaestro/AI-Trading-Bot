import type { Candle } from "../domain/types.ts";
import {
  DAY_MS,
  HOUR_MS,
  intervalMs,
  type CandleIntervalMinutes,
} from "./candleIntervals.ts";

export { DAY_MS, HOUR_MS };
export const MIN_DAILY_CANDLES = 220;
export const MIN_HOURLY_CANDLES = 220;
export const MAX_COMMITTED_DAILY_CANDLE_AGE_MS = 49 * HOUR_MS;
export const MAX_COMMITTED_HOURLY_CANDLE_AGE_MS = 3 * HOUR_MS;

export interface CandleQualityOptions {
  readonly nowMs?: number;
  readonly minimumCandles?: number;
  readonly maximumAgeMs?: number;
}

export function assertCandlesUsable(
  pair: string,
  intervalMinutes: CandleIntervalMinutes,
  candles: readonly Candle[],
  options: CandleQualityOptions = {},
): void {
  const nowMs = options.nowMs ?? Date.now();
  const minimumCandles =
    options.minimumCandles ??
    (intervalMinutes === 60 ? MIN_HOURLY_CANDLES : MIN_DAILY_CANDLES);
  const maximumAgeMs =
    options.maximumAgeMs ??
    (intervalMinutes === 60
      ? MAX_COMMITTED_HOURLY_CANDLE_AGE_MS
      : MAX_COMMITTED_DAILY_CANDLE_AGE_MS);
  const stepMs = intervalMs(intervalMinutes);

  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    !Number.isSafeInteger(minimumCandles) ||
    minimumCandles < 1 ||
    !Number.isSafeInteger(maximumAgeMs) ||
    maximumAgeMs < stepMs
  ) {
    throw new Error(`${pair} candle quality options are invalid`);
  }
  if (candles.length < minimumCandles) {
    throw new Error(
      `${pair} requires at least ${minimumCandles} committed ${intervalMinutes}-minute candles`,
    );
  }

  let previousTimestamp: number | undefined;
  for (const candle of candles) {
    const values = [
      candle.timestampMs,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
    ];
    if (!values.every(Number.isFinite)) {
      throw new Error(`${pair} contains non-finite candle data`);
    }
    if (
      !Number.isSafeInteger(candle.timestampMs) ||
      candle.timestampMs < 0 ||
      candle.open <= 0 ||
      candle.high <= 0 ||
      candle.low <= 0 ||
      candle.close <= 0 ||
      candle.volume < 0
    ) {
      throw new Error(`${pair} contains invalid candle values`);
    }
    if (
      candle.high < Math.max(candle.open, candle.close) ||
      candle.low > Math.min(candle.open, candle.close) ||
      candle.low > candle.high
    ) {
      throw new Error(`${pair} contains inconsistent OHLC bounds`);
    }
    if (candle.timestampMs % stepMs !== 0) {
      throw new Error(
        `${pair} contains a candle that is not ${intervalMinutes}-minute aligned`,
      );
    }
    if (
      previousTimestamp !== undefined &&
      candle.timestampMs - previousTimestamp !== stepMs
    ) {
      throw new Error(
        `${pair} contains a missing, duplicate or unordered ${intervalMinutes}-minute candle`,
      );
    }
    previousTimestamp = candle.timestampMs;
  }

  const latestTimestamp = candles.at(-1)?.timestampMs;
  if (
    latestTimestamp === undefined ||
    latestTimestamp + stepMs > nowMs
  ) {
    throw new Error(`${pair} has an invalid latest committed candle timestamp`);
  }
  if (nowMs - (latestTimestamp + stepMs) > maximumAgeMs) {
    throw new Error(
      `${pair} committed ${intervalMinutes}-minute candle data is stale`,
    );
  }
}

export function assertDailyCandlesUsable(
  pair: string,
  candles: readonly Candle[],
  options: CandleQualityOptions = {},
): void {
  assertCandlesUsable(pair, 1440, candles, options);
}

export function assertHourlyCandlesUsable(
  pair: string,
  candles: readonly Candle[],
  options: CandleQualityOptions = {},
): void {
  assertCandlesUsable(pair, 60, candles, options);
}
