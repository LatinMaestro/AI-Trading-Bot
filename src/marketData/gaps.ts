import {
  assertSupportedInterval,
  intervalMs,
  type CandleIntervalMinutes,
} from "./candleIntervals.ts";

export interface CandleGap {
  readonly startOpenTimeMs: number;
  readonly endOpenTimeMs: number;
  readonly missingCount: number;
}

export interface KrakenRepairPlan {
  readonly repairable: readonly CandleGap[];
  readonly unavailableFromRest: readonly CandleGap[];
  readonly earliestRestOpenTimeMs: number;
}

function assertAligned(name: string, value: number, stepMs: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value % stepMs !== 0) {
    throw new Error(`${name} must be a non-negative aligned integer timestamp`);
  }
}

export function findCandleGaps(
  openTimesMs: readonly number[],
  intervalMinutes: CandleIntervalMinutes,
  expectedStartOpenTimeMs: number,
  expectedEndOpenTimeMs: number,
): readonly CandleGap[] {
  assertSupportedInterval(intervalMinutes);
  const stepMs = intervalMs(intervalMinutes);
  assertAligned("expectedStartOpenTimeMs", expectedStartOpenTimeMs, stepMs);
  assertAligned("expectedEndOpenTimeMs", expectedEndOpenTimeMs, stepMs);
  if (expectedStartOpenTimeMs > expectedEndOpenTimeMs) {
    throw new Error("Expected candle range start must not be after its end");
  }

  let previous: number | undefined;
  for (const openTimeMs of openTimesMs) {
    assertAligned("openTimeMs", openTimeMs, stepMs);
    if (openTimeMs < expectedStartOpenTimeMs || openTimeMs > expectedEndOpenTimeMs) {
      throw new Error("Stored candle timestamp is outside the expected range");
    }
    if (previous !== undefined && openTimeMs <= previous) {
      throw new Error("Stored candle timestamps must be unique and strictly ordered");
    }
    previous = openTimeMs;
  }

  const gaps: CandleGap[] = [];
  let cursor = expectedStartOpenTimeMs;
  for (const openTimeMs of openTimesMs) {
    if (openTimeMs > cursor) {
      gaps.push({
        startOpenTimeMs: cursor,
        endOpenTimeMs: openTimeMs - stepMs,
        missingCount: (openTimeMs - cursor) / stepMs,
      });
    }
    cursor = openTimeMs + stepMs;
  }
  if (cursor <= expectedEndOpenTimeMs) {
    gaps.push({
      startOpenTimeMs: cursor,
      endOpenTimeMs: expectedEndOpenTimeMs,
      missingCount: (expectedEndOpenTimeMs - cursor) / stepMs + 1,
    });
  }
  return gaps;
}

export function planKrakenRestGapRepair(
  gaps: readonly CandleGap[],
  intervalMinutes: CandleIntervalMinutes,
  currentOpenTimeMs: number,
): KrakenRepairPlan {
  assertSupportedInterval(intervalMinutes);
  const stepMs = intervalMs(intervalMinutes);
  assertAligned("currentOpenTimeMs", currentOpenTimeMs, stepMs);

  // Kraken returns at most 720 rows and always includes the current uncommitted row.
  // Therefore only the preceding 719 committed opens are reliably available.
  const earliestRestOpenTimeMs = currentOpenTimeMs - 719 * stepMs;
  const repairable: CandleGap[] = [];
  const unavailableFromRest: CandleGap[] = [];

  for (const gap of gaps) {
    assertAligned("gap.startOpenTimeMs", gap.startOpenTimeMs, stepMs);
    assertAligned("gap.endOpenTimeMs", gap.endOpenTimeMs, stepMs);
    if (gap.startOpenTimeMs > gap.endOpenTimeMs) {
      throw new Error("Gap start must not be after its end");
    }
    if (gap.endOpenTimeMs >= currentOpenTimeMs) {
      throw new Error("Gap repair accepts committed intervals only");
    }
    const calculatedCount = (gap.endOpenTimeMs - gap.startOpenTimeMs) / stepMs + 1;
    if (gap.missingCount !== calculatedCount) {
      throw new Error("Gap missingCount does not match its timestamp range");
    }

    if (gap.endOpenTimeMs < earliestRestOpenTimeMs) {
      unavailableFromRest.push(gap);
      continue;
    }
    if (gap.startOpenTimeMs < earliestRestOpenTimeMs) {
      unavailableFromRest.push({
        startOpenTimeMs: gap.startOpenTimeMs,
        endOpenTimeMs: earliestRestOpenTimeMs - stepMs,
        missingCount: (earliestRestOpenTimeMs - gap.startOpenTimeMs) / stepMs,
      });
      repairable.push({
        startOpenTimeMs: earliestRestOpenTimeMs,
        endOpenTimeMs: gap.endOpenTimeMs,
        missingCount: (gap.endOpenTimeMs - earliestRestOpenTimeMs) / stepMs + 1,
      });
      continue;
    }
    repairable.push(gap);
  }

  return { repairable, unavailableFromRest, earliestRestOpenTimeMs };
}
