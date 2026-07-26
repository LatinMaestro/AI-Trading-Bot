import {
  DAY_MS,
  HOUR_MS,
  intervalMs,
  type CandleIntervalMinutes,
} from "./candleIntervals.ts";
import type { MarketDataQualityState } from "../universe/types.ts";

const MAXIMUM_PAIRS_PER_QUERY = 20;
const MINIMUM_VOLATILITY_CANDLES = 3;
const MAXIMUM_HOURLY_AGE_MS = 2 * HOUR_MS;
const MAXIMUM_DAILY_AGE_MS = 2 * DAY_MS;

export interface KrakenUniverseHistoryEvidence {
  readonly dailyCommittedCandles: number;
  readonly hourlyCommittedCandles: number;
  readonly annualisedVolatility: number;
  readonly dataQualityState: MarketDataQualityState;
}

export interface StoredCandleHistoryRow {
  readonly canonicalPair: string;
  readonly intervalMinutes: number;
  readonly openTimeMs: number;
  readonly closeTimeMs: number;
  readonly close: number;
  readonly fetchedAt: string;
}

export interface HistoryEvidenceOptions {
  readonly maximumHourlyAgeMs?: number;
  readonly maximumDailyAgeMs?: number;
}

function assertSafeTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertCanonicalPair(value: string): void {
  if (
    value.trim() !== value ||
    value !== value.toUpperCase() ||
    !/^[A-Z0-9.]+\/[A-Z0-9.]+$/.test(value)
  ) {
    throw new Error(`Invalid canonical pair ${value}`);
  }
}

function assertMaximumAge(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

function validatedRow(
  row: StoredCandleHistoryRow,
  requested: ReadonlySet<string>,
  asOfMs: number,
): StoredCandleHistoryRow {
  assertCanonicalPair(row.canonicalPair);
  if (!requested.has(row.canonicalPair)) {
    throw new Error(`Unexpected candle pair ${row.canonicalPair}`);
  }
  if (row.intervalMinutes !== 60 && row.intervalMinutes !== 1440) {
    throw new Error(`${row.canonicalPair} has an unsupported candle interval`);
  }
  const stepMs = intervalMs(row.intervalMinutes);
  assertSafeTime("candle openTimeMs", row.openTimeMs);
  assertSafeTime("candle closeTimeMs", row.closeTimeMs);
  if (
    row.openTimeMs % stepMs !== 0 ||
    row.closeTimeMs !== row.openTimeMs + stepMs ||
    row.closeTimeMs > asOfMs
  ) {
    throw new Error(`${row.canonicalPair} has invalid candle chronology`);
  }
  if (!Number.isFinite(row.close) || row.close <= 0) {
    throw new Error(`${row.canonicalPair} has an invalid close`);
  }
  const fetchedAtMs = Date.parse(row.fetchedAt);
  if (
    !Number.isSafeInteger(fetchedAtMs) ||
    new Date(fetchedAtMs).toISOString() !== row.fetchedAt ||
    fetchedAtMs > asOfMs
  ) {
    throw new Error(`${row.canonicalPair} has invalid availability time`);
  }
  return row;
}

function intervalHasGap(
  rows: readonly StoredCandleHistoryRow[],
  interval: CandleIntervalMinutes,
): boolean {
  const stepMs = intervalMs(interval);
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (
      previous === undefined ||
      current === undefined ||
      current.openTimeMs - previous.openTimeMs !== stepMs
    ) {
      return true;
    }
  }
  return false;
}

function annualisedDailyVolatility(
  rows: readonly StoredCandleHistoryRow[],
): number {
  if (rows.length < MINIMUM_VOLATILITY_CANDLES) return 0;
  const returns: number[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1]?.close;
    const current = rows[index]?.close;
    if (previous === undefined || current === undefined) {
      throw new Error("Daily volatility input is incomplete");
    }
    returns.push(Math.log(current / previous));
  }
  const mean =
    returns.reduce((total, value) => total + value, 0) / returns.length;
  const variance =
    returns.reduce((total, value) => total + (value - mean) ** 2, 0) /
    (returns.length - 1);
  const annualised = Math.sqrt(variance * 365);
  if (!Number.isFinite(annualised) || annualised < 0) {
    throw new Error("Annualised volatility calculation failed");
  }
  return annualised;
}

export function summariseStoredCandleHistory(
  pairs: readonly string[],
  rows: readonly StoredCandleHistoryRow[],
  asOfMs: number,
  options: HistoryEvidenceOptions = {},
): Readonly<Record<string, KrakenUniverseHistoryEvidence>> {
  assertSafeTime("asOfMs", asOfMs);
  if (pairs.length === 0 || pairs.length > MAXIMUM_PAIRS_PER_QUERY) {
    throw new Error(`History query requires 1 to ${MAXIMUM_PAIRS_PER_QUERY} pairs`);
  }
  const requested = new Set<string>();
  for (const pair of pairs) {
    assertCanonicalPair(pair);
    if (requested.has(pair)) throw new Error(`Duplicate history pair ${pair}`);
    requested.add(pair);
  }
  const maximumHourlyAgeMs =
    options.maximumHourlyAgeMs ?? MAXIMUM_HOURLY_AGE_MS;
  const maximumDailyAgeMs =
    options.maximumDailyAgeMs ?? MAXIMUM_DAILY_AGE_MS;
  assertMaximumAge("maximumHourlyAgeMs", maximumHourlyAgeMs);
  assertMaximumAge("maximumDailyAgeMs", maximumDailyAgeMs);

  const grouped = new Map<
    string,
    { hourly: StoredCandleHistoryRow[]; daily: StoredCandleHistoryRow[] }
  >(
    pairs.map((pair) => [pair, { hourly: [], daily: [] }]),
  );
  for (const sourceRow of rows) {
    const row = validatedRow(sourceRow, requested, asOfMs);
    const group = grouped.get(row.canonicalPair);
    if (group === undefined) throw new Error("History grouping failed");
    (row.intervalMinutes === 60 ? group.hourly : group.daily).push(row);
  }

  const result: Record<string, KrakenUniverseHistoryEvidence> = {};
  for (const pair of pairs) {
    const group = grouped.get(pair);
    if (group === undefined) throw new Error("History pair is missing");
    group.hourly.sort((left, right) => left.openTimeMs - right.openTimeMs);
    group.daily.sort((left, right) => left.openTimeMs - right.openTimeMs);

    const hourlyGap = intervalHasGap(group.hourly, 60);
    const dailyGap = intervalHasGap(group.daily, 1440);
    const latestHourlyClose = group.hourly.at(-1)?.closeTimeMs;
    const latestDailyClose = group.daily.at(-1)?.closeTimeMs;
    const stale =
      (latestHourlyClose !== undefined &&
        asOfMs - latestHourlyClose > maximumHourlyAgeMs) ||
      (latestDailyClose !== undefined &&
        asOfMs - latestDailyClose > maximumDailyAgeMs);
    const incomplete =
      group.hourly.length === 0 ||
      group.daily.length < MINIMUM_VOLATILITY_CANDLES ||
      hourlyGap ||
      dailyGap;

    result[pair] = {
      dailyCommittedCandles: group.daily.length,
      hourlyCommittedCandles: group.hourly.length,
      annualisedVolatility: annualisedDailyVolatility(group.daily),
      dataQualityState: stale ? "stale" : incomplete ? "gap" : "complete",
    };
  }
  return result;
}

export class MarketCandleHistoryRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async loadKrakenHistoryByPair(
    pairs: readonly string[],
    asOfMs: number,
  ): Promise<Readonly<Record<string, KrakenUniverseHistoryEvidence>>> {
    assertSafeTime("asOfMs", asOfMs);
    if (pairs.length === 0 || pairs.length > MAXIMUM_PAIRS_PER_QUERY) {
      throw new Error(`History query requires 1 to ${MAXIMUM_PAIRS_PER_QUERY} pairs`);
    }
    const placeholders = pairs.map(() => "?").join(", ");
    const fetchedBy = new Date(asOfMs).toISOString();
    const result = await this.db
      .prepare(
        `SELECT
           candle.canonical_pair AS canonicalPair,
           candle.interval_minutes AS intervalMinutes,
           candle.open_time_ms AS openTimeMs,
           candle.close_time_ms AS closeTimeMs,
           candle.close AS close,
           batch.fetched_at AS fetchedAt
         FROM market_candles candle
         JOIN market_data_batches batch
           ON batch.batch_id = candle.source_batch_id
         WHERE candle.venue = ?
           AND candle.canonical_pair IN (${placeholders})
           AND candle.interval_minutes IN (60, 1440)
           AND candle.close_time_ms <= ?
           AND batch.fetched_at <= ?
         ORDER BY candle.canonical_pair, candle.interval_minutes, candle.open_time_ms`,
      )
      .bind("kraken", ...pairs, asOfMs, fetchedBy)
      .all<StoredCandleHistoryRow>();
    return summariseStoredCandleHistory(pairs, result.results, asOfMs);
  }
}
