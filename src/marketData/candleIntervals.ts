export type CandleIntervalMinutes = 60 | 1440;

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export function intervalMs(intervalMinutes: CandleIntervalMinutes): number {
  return intervalMinutes * 60_000;
}

export function assertSupportedInterval(
  intervalMinutes: number,
): asserts intervalMinutes is CandleIntervalMinutes {
  if (intervalMinutes !== 60 && intervalMinutes !== 1440) {
    throw new Error(`Unsupported candle interval: ${intervalMinutes}`);
  }
}
