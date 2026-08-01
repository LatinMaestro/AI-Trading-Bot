import type { Candle } from "../domain/types.ts";
import {
  assertSupportedInterval,
  intervalMs,
  type CandleIntervalMinutes,
} from "../marketData/candleIntervals.ts";
import { sha256Hex } from "../utils/crypto.ts";

export const INSERT_MARKET_DATA_BATCH_SQL = `INSERT INTO market_data_batches
  (batch_id, venue, canonical_pair, exchange_pair, interval_minutes,
   requested_since_seconds, source_cursor, fetched_at, committed_count,
   first_open_time_ms, last_open_time_ms, payload_sha256)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
 ON CONFLICT(batch_id) DO NOTHING`;

export const INSERT_MARKET_CANDLE_SQL = `INSERT INTO market_candles
  (venue, canonical_pair, exchange_pair, interval_minutes, open_time_ms,
   close_time_ms, open, high, low, close, volume, source_batch_id, candle_sha256)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
 ON CONFLICT(venue, canonical_pair, interval_minutes, open_time_ms) DO NOTHING`;

export interface MarketDataBatchInput {
  readonly batchId: string;
  readonly venue: string;
  readonly canonicalPair: string;
  readonly exchangePair: string;
  readonly intervalMinutes: CandleIntervalMinutes;
  readonly requestedSinceSeconds?: number;
  readonly sourceCursor?: string;
  readonly fetchedAt: string;
  readonly candles: readonly Candle[];
}

export interface PreparedMarketCandle {
  readonly venue: string;
  readonly canonicalPair: string;
  readonly exchangePair: string;
  readonly intervalMinutes: CandleIntervalMinutes;
  readonly openTimeMs: number;
  readonly closeTimeMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly sourceBatchId: string;
  readonly candleSha256: string;
}

export interface PreparedMarketDataBatch {
  readonly batchId: string;
  readonly venue: string;
  readonly canonicalPair: string;
  readonly exchangePair: string;
  readonly intervalMinutes: CandleIntervalMinutes;
  readonly requestedSinceSeconds: number | null;
  readonly sourceCursor: string | null;
  readonly fetchedAt: string;
  readonly committedCount: number;
  readonly firstOpenTimeMs: number;
  readonly lastOpenTimeMs: number;
  readonly payloadSha256: string;
  readonly candles: readonly PreparedMarketCandle[];
}

function assertCanonicalText(name: string, value: string): void {
  if (value.length === 0) throw new Error(`${name} must not be empty`);
  if (value !== value.trim()) throw new Error(`${name} must not contain surrounding whitespace`);
}

function canonicalCandlePayload(
  input: Omit<PreparedMarketCandle, "sourceBatchId" | "candleSha256">,
): string {
  return JSON.stringify([
    input.venue,
    input.canonicalPair,
    input.exchangePair,
    input.intervalMinutes,
    input.openTimeMs,
    input.closeTimeMs,
    input.open,
    input.high,
    input.low,
    input.close,
    input.volume,
  ]);
}

function assertCandleValues(pair: string, candle: Candle): void {
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
}

export async function prepareMarketDataBatch(
  input: MarketDataBatchInput,
): Promise<PreparedMarketDataBatch> {
  assertCanonicalText("batchId", input.batchId);
  assertCanonicalText("venue", input.venue);
  assertCanonicalText("canonicalPair", input.canonicalPair);
  assertCanonicalText("exchangePair", input.exchangePair);
  if (input.sourceCursor !== undefined) {
    assertCanonicalText("sourceCursor", input.sourceCursor);
  }
  assertSupportedInterval(input.intervalMinutes);
  if (input.candles.length === 0) throw new Error("Market data batch must contain candles");

  const fetchedAtMs = Date.parse(input.fetchedAt);
  if (!Number.isFinite(fetchedAtMs) || new Date(fetchedAtMs).toISOString() !== input.fetchedAt) {
    throw new Error("fetchedAt must be a canonical ISO-8601 timestamp");
  }
  if (
    input.requestedSinceSeconds !== undefined &&
    (!Number.isSafeInteger(input.requestedSinceSeconds) || input.requestedSinceSeconds < 0)
  ) {
    throw new Error("requestedSinceSeconds must be a non-negative integer");
  }

  const stepMs = intervalMs(input.intervalMinutes);
  const preparedCandles: PreparedMarketCandle[] = [];
  let previousOpenTimeMs: number | undefined;

  for (const candle of input.candles) {
    assertCandleValues(input.canonicalPair, candle);
    if (!Number.isSafeInteger(candle.timestampMs) || candle.timestampMs < 0) {
      throw new Error(`${input.canonicalPair} contains an invalid candle timestamp`);
    }
    if (candle.timestampMs % stepMs !== 0) {
      throw new Error(`${input.canonicalPair} contains a misaligned candle timestamp`);
    }
    if (
      previousOpenTimeMs !== undefined &&
      candle.timestampMs - previousOpenTimeMs !== stepMs
    ) {
      throw new Error(`${input.canonicalPair} batch must be contiguous and strictly ordered`);
    }
    previousOpenTimeMs = candle.timestampMs;

    const unhashed = {
      venue: input.venue,
      canonicalPair: input.canonicalPair,
      exchangePair: input.exchangePair,
      intervalMinutes: input.intervalMinutes,
      openTimeMs: candle.timestampMs,
      closeTimeMs: candle.timestampMs + stepMs,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    } as const;
    preparedCandles.push({
      ...unhashed,
      sourceBatchId: input.batchId,
      candleSha256: await sha256Hex(canonicalCandlePayload(unhashed)),
    });
  }

  const firstOpenTimeMs = preparedCandles[0]?.openTimeMs;
  const lastOpenTimeMs = preparedCandles.at(-1)?.openTimeMs;
  if (firstOpenTimeMs === undefined || lastOpenTimeMs === undefined) {
    throw new Error("Market data batch preparation failed");
  }
  if (fetchedAtMs < lastOpenTimeMs + stepMs) {
    throw new Error("Market data batch contains an uncommitted candle");
  }

  const requestedSinceSeconds = input.requestedSinceSeconds ?? null;
  const sourceCursor = input.sourceCursor ?? null;
  const payloadSha256 = await sha256Hex(
    JSON.stringify([
      input.venue,
      input.canonicalPair,
      input.exchangePair,
      input.intervalMinutes,
      requestedSinceSeconds,
      sourceCursor,
      input.fetchedAt,
      preparedCandles.map((candle) => candle.candleSha256),
    ]),
  );

  return {
    batchId: input.batchId,
    venue: input.venue,
    canonicalPair: input.canonicalPair,
    exchangePair: input.exchangePair,
    intervalMinutes: input.intervalMinutes,
    requestedSinceSeconds,
    sourceCursor,
    fetchedAt: input.fetchedAt,
    committedCount: preparedCandles.length,
    firstOpenTimeMs,
    lastOpenTimeMs,
    payloadSha256,
    candles: preparedCandles,
  };
}

export class MarketCandleRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async persistBatch(input: MarketDataBatchInput): Promise<PreparedMarketDataBatch> {
    const batch = await prepareMarketDataBatch(input);
    const statements: D1PreparedStatement[] = [
      this.db.prepare(INSERT_MARKET_DATA_BATCH_SQL).bind(
        batch.batchId,
        batch.venue,
        batch.canonicalPair,
        batch.exchangePair,
        batch.intervalMinutes,
        batch.requestedSinceSeconds,
        batch.sourceCursor,
        batch.fetchedAt,
        batch.committedCount,
        batch.firstOpenTimeMs,
        batch.lastOpenTimeMs,
        batch.payloadSha256,
      ),
    ];

    for (const candle of batch.candles) {
      statements.push(
        this.db.prepare(INSERT_MARKET_CANDLE_SQL).bind(
          candle.venue,
          candle.canonicalPair,
          candle.exchangePair,
          candle.intervalMinutes,
          candle.openTimeMs,
          candle.closeTimeMs,
          candle.open,
          candle.high,
          candle.low,
          candle.close,
          candle.volume,
          candle.sourceBatchId,
          candle.candleSha256,
        ),
      );
    }

    await this.db.batch(statements);
    return batch;
  }
}
