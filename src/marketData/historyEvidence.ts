import {
  DAY_MS,
  HOUR_MS,
  intervalMs,
  type CandleIntervalMinutes,
} from "./candleIntervals.ts";
import type { MarketDataQualityState } from "../universe/types.ts";

const MAXIMUM_PAIRS_PER_QUERY = 20;
const DAILY_VOLATILITY_SAMPLE_CANDLES = 366;
const MINIMUM_VOLATILITY_CANDLES = 3;
const MAXIMUM_HOURLY_AGE_MS = 2 * HOUR_MS;
const MAXIMUM_DAILY_AGE_MS = 2 * DAY_MS;

export interface KrakenUniverseHistoryEvidence {
  readonly dailyCommittedCandles: number;
  readonly hourlyCommittedCandles: number;
  readonly annualisedVolatility: number;
  readonly dataQualityState: MarketDataQualityState;
}

export interface StoredCandleHistorySummaryRow {
  readonly canonicalPair: string;
  readonly intervalMinutes: number;
  readonly committedCount: number;
  readonly firstOpenTimeMs: number;
  readonly lastOpenTimeMs: number;
  readonly latestCloseTimeMs: number;
}

export interface StoredDailyCloseRow {
  readonly canonicalPair: string;
  readonly openTimeMs: number;
  readonly closeTimeMs: number;
  readonly close: number;
  readonly fetchedAt: string;
}

export interface HistoryEvidenceOptions {
  readonly maximumHourlyAgeMs?: number;
  readonly maximumDailyAgeMs?: number;
}

interface ValidatedSummary {
  readonly intervalMinutes: CandleIntervalMinutes;
  readonly committedCount: number;
  readonly latestCloseTimeMs: number;
  readonly hasGap: boolean;
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

function validateSummary(
  row: StoredCandleHistorySummaryRow,
  requested: ReadonlySet<string>,
  asOfMs: number,
): ValidatedSummary {
  assertCanonicalPair(row.canonicalPair);
  if (!requested.has(row.canonicalPair)) {
    throw new Error(`Unexpected candle pair ${row.canonicalPair}`);
  }
  if (row.intervalMinutes !== 60 && row.intervalMinutes !== 1440) {
    throw new Error(`${row.canonicalPair} has an unsupported candle interval`);
  }
  if (!Number.isSafeInteger(row.committedCount) || row.committedCount < 1) {
    throw new Error(`${row.canonicalPair} has an invalid committed count`);
  }
  const stepMs = intervalMs(row.intervalMinutes);
  assertSafeTime("firstOpenTimeMs", row.firstOpenTimeMs);
  assertSafeTime("lastOpenTimeMs", row.lastOpenTimeMs);
  assertSafeTime("latestCloseTimeMs", row.latestCloseTimeMs);
  if (
    row.firstOpenTimeMs % stepMs !== 0 ||
    row.lastOpenTimeMs % stepMs !== 0 ||
    row.lastOpenTimeMs < row.firstOpenTimeMs ||
    row.latestCloseTimeMs !== row.lastOpenTimeMs + stepMs ||
    row.latestCloseTimeMs > asOfMs
  ) {
    throw new Error(`${row.canonicalPair} has invalid history chronology`);
  }
  const spanCount =
    (row.lastOpenTimeMs - row.firstOpenTimeMs) / stepMs + 1;
  if (!Number.isSafeInteger(spanCount) || row.committedCount > spanCount) {
    throw new Error(`${row.canonicalPair} has an impossible committed count`);
  }
  return {
    intervalMinutes: row.intervalMinutes,
    committedCount: row.committedCount,
    latestCloseTimeMs: row.latestCloseTimeMs,
    hasGap: row.committedCount !== spanCount,
  };
}

function validateDailyClose(
  row: StoredDailyCloseRow,
  requested: ReadonlySet<string>,
  asOfMs: number,
): StoredDailyCloseRow {
  assertCanonicalPair(row.canonicalPair);
  if (!requested.has(row.canonicalPair)) {
    throw new Error(`Unexpected candle pair ${row.canonicalPair}`);
  }
  assertSafeTime("daily openTimeMs", row.openTimeMs);
  assertSafeTime("daily closeTimeMs", row.closeTimeMs);
  if (
    row.openTimeMs % DAY_MS !== 0 ||
    row.closeTimeMs !== row.openTimeMs + DAY_MS ||
    row.closeTimeMs > asOfMs
  ) {
    throw new Error(`${row.canonicalPair} has invalid daily chronology`);
  }
  if (!Number.isFinite(row.close) || row.close <= 0) {
    throw new Error(`${row.canonicalPair} has an invalid daily close`);
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

function annualisedDailyVolatility(
  rows: readonly StoredDailyCloseRow[],
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
  summaries: readonly StoredCandleHistorySummaryRow[],
  dailyCloses: readonly StoredDailyCloseRow[],
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

  const summaryByIdentity = new Map<string, ValidatedSummary>();
  for (const source of summaries) {
    const summary = validateSummary(source, requested, asOfMs);
    const identity = `${source.canonicalPair}:${summary.intervalMinutes}`;
    if (summaryByIdentity.has(identity)) {
      throw new Error(`Duplicate history summary ${identity}`);
    }
    summaryByIdentity.set(identity, summary);
  }

  const dailyByPair = new Map<string, StoredDailyCloseRow[]>(
    pairs.map((pair) => [pair, []]),
  );
  for (const source of dailyCloses) {
    const row = validateDailyClose(source, requested, asOfMs);
    dailyByPair.get(row.canonicalPair)?.push(row);
  }

  const result: Record<string, KrakenUniverseHistoryEvidence> = {};
  for (const pair of pairs) {
    const hourly = summaryByIdentity.get(`${pair}:60`);
    const daily = summaryByIdentity.get(`${pair}:1440`);
    const closes = dailyByPair.get(pair) ?? [];
    closes.sort((left, right) => left.openTimeMs - right.openTimeMs);
    for (let index = 1; index < closes.length; index += 1) {
      if (
        closes[index]?.openTimeMs !==
        (closes[index - 1]?.openTimeMs ?? 0) + DAY_MS
      ) {
        throw new Error(`${pair} daily volatility sample is not contiguous`);
      }
    }
    const expectedSampleCount =
      daily === undefined
        ? 0
        : Math.min(daily.committedCount, DAILY_VOLATILITY_SAMPLE_CANDLES);
    if (closes.length !== expectedSampleCount) {
      throw new Error(`${pair} daily volatility sample is incomplete`);
    }
    if (
      daily !== undefined &&
      closes.at(-1)?.closeTimeMs !== daily.latestCloseTimeMs
    ) {
      throw new Error(
        `${pair} daily volatility sample does not end at the latest committed candle`,
      );
    }

    const stale =
      (hourly !== undefined &&
        asOfMs - hourly.latestCloseTimeMs > maximumHourlyAgeMs) ||
      (daily !== undefined &&
        asOfMs - daily.latestCloseTimeMs > maximumDailyAgeMs);
    const incomplete =
      hourly === undefined ||
      daily === undefined ||
      daily.committedCount < MINIMUM_VOLATILITY_CANDLES ||
      hourly.hasGap ||
      daily.hasGap;

    result[pair] = {
      dailyCommittedCandles: daily?.committedCount ?? 0,
      hourlyCommittedCandles: hourly?.committedCount ?? 0,
      annualisedVolatility: annualisedDailyVolatility(closes),
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
    const sharedWhere = `candle.venue = ?
      AND candle.canonical_pair IN (${placeholders})
      AND candle.close_time_ms <= ?
      AND batch.fetched_at <= ?`;
    const summaryStatement = this.db
      .prepare(
        `SELECT
           candle.canonical_pair AS canonicalPair,
           candle.interval_minutes AS intervalMinutes,
           COUNT(*) AS committedCount,
           MIN(candle.open_time_ms) AS firstOpenTimeMs,
           MAX(candle.open_time_ms) AS lastOpenTimeMs,
           MAX(candle.close_time_ms) AS latestCloseTimeMs
         FROM market_candles candle
         JOIN market_data_batches batch
           ON batch.batch_id = candle.source_batch_id
         WHERE ${sharedWhere}
           AND candle.interval_minutes IN (60, 1440)
         GROUP BY candle.canonical_pair, candle.interval_minutes
         ORDER BY candle.canonical_pair, candle.interval_minutes`,
      )
      .bind("kraken", ...pairs, asOfMs, fetchedBy);
    const dailyStatement = this.db
      .prepare(
        `SELECT canonicalPair, openTimeMs, closeTimeMs, close, fetchedAt
         FROM (
           SELECT
             candle.canonical_pair AS canonicalPair,
             candle.open_time_ms AS openTimeMs,
             candle.close_time_ms AS closeTimeMs,
             candle.close AS close,
             batch.fetched_at AS fetchedAt,
             ROW_NUMBER() OVER (
               PARTITION BY candle.canonical_pair
               ORDER BY candle.open_time_ms DESC
             ) AS sampleRank
           FROM market_candles candle
           JOIN market_data_batches batch
             ON batch.batch_id = candle.source_batch_id
           WHERE ${sharedWhere}
             AND candle.interval_minutes = 1440
         )
         WHERE sampleRank <= ?
         ORDER BY canonicalPair, openTimeMs`,
      )
      .bind(
        "kraken",
        ...pairs,
        asOfMs,
        fetchedBy,
        DAILY_VOLATILITY_SAMPLE_CANDLES,
      );
    const results = await this.db.batch([summaryStatement, dailyStatement]);
    const summaryResult = results[0];
    const dailyResult = results[1];
    if (summaryResult === undefined || dailyResult === undefined) {
      throw new Error("Market history query returned incomplete results");
    }
    return summariseStoredCandleHistory(
      pairs,
      summaryResult.results as unknown as StoredCandleHistorySummaryRow[],
      dailyResult.results as unknown as StoredDailyCloseRow[],
      asOfMs,
    );
  }
}
