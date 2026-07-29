import type { Candle } from "../domain/types.ts";
import type { SpotPairDefinition } from "./pairs.ts";
import {
  assertCandlesUsable,
  MIN_DAILY_CANDLES,
  MIN_HOURLY_CANDLES,
} from "./candleQuality.ts";
import type { CandleIntervalMinutes } from "./candleIntervals.ts";
import type {
  MarketCandleBatchSink,
  PreparedMarketDataBatch,
} from "../storage/marketCandles.ts";
import { sha256Hex } from "../utils/crypto.ts";

const KRAKEN_API_ORIGIN = "https://api.kraken.com";
const INTERVALS = [60, 1440] as const;
const MAXIMUM_RESPONSE_BYTES = 1_048_576;
const MAXIMUM_ATTEMPTS = 2;

type PublicFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ScheduledCandleHistoryEvidence {
  readonly dailyCommittedCandles: number;
  readonly hourlyCommittedCandles: number;
  readonly dataQualityState:
    | "complete"
    | "gap"
    | "conflict"
    | "stale"
    | "ambiguous";
}

export interface ScheduledKrakenCandleOptions {
  readonly scheduledAtMs: number;
  readonly pairs: readonly SpotPairDefinition[];
  readonly store: MarketCandleBatchSink;
  readonly historyProvider: (
    pairs: readonly string[],
    asOfMs: number,
  ) => Promise<
    Readonly<Record<string, ScheduledCandleHistoryEvidence | undefined>>
  >;
  readonly fetchImpl?: PublicFetch;
  readonly nowMs?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly requestSpacingMs?: number;
  readonly retryBaseDelayMs?: number;
  readonly maximumAttempts?: number;
  readonly requestTimeoutMs?: number;
  readonly maximumResponseBytes?: number;
}

export interface ScheduledKrakenCandleCapture {
  readonly canonicalPair: string;
  readonly exchangePair: string;
  readonly intervalMinutes: CandleIntervalMinutes;
  readonly requestUrl: string;
  readonly requestedSinceSeconds: number | null;
  readonly requestStartedAtMs: number;
  readonly receivedAtMs: number;
  readonly availableAtMs: number;
  readonly responseByteLength: number;
  readonly responseSha256: string;
  readonly sourceCursor: string;
  readonly batch: PreparedMarketDataBatch;
}

export interface ScheduledKrakenCandleResult {
  readonly captures: readonly ScheduledKrakenCandleCapture[];
  readonly requestCount: number;
  readonly historyAsOfMs: number;
}

interface KrakenOhlcPayload {
  readonly candles: readonly Candle[];
  readonly sourceCursor: number;
}

class TransientKrakenOhlcError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSafeTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function positiveInteger(
  name: string,
  value: number,
  maximum: number,
): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
}

function parseNumber(
  pair: string,
  intervalMinutes: CandleIntervalMinutes,
  field: string,
  value: unknown,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      `Kraken ${pair} ${intervalMinutes}-minute OHLC ${field} is invalid`,
    );
  }
  return parsed;
}

function parseKrakenOhlc(
  canonicalPair: string,
  intervalMinutes: CandleIntervalMinutes,
  payload: unknown,
): KrakenOhlcPayload {
  if (!isRecord(payload) || !Array.isArray(payload.error)) {
    throw new Error("Kraken OHLC envelope is invalid");
  }
  if (
    !payload.error.every((entry) => typeof entry === "string") ||
    payload.error.length > 0
  ) {
    throw new Error("Kraken OHLC returned an API error");
  }
  if (!isRecord(payload.result)) {
    throw new Error("Kraken OHLC result is invalid");
  }
  const sourceCursor = Number(payload.result.last);
  if (!Number.isSafeInteger(sourceCursor) || sourceCursor < 0) {
    throw new Error("Kraken OHLC cursor is invalid");
  }
  const entries = Object.entries(payload.result).filter(
    ([key]) => key !== "last",
  );
  if (
    entries.length !== 1 ||
    entries[0]?.[0] !== canonicalPair ||
    !Array.isArray(entries[0][1])
  ) {
    throw new Error(
      `Kraken OHLC result identity does not match ${canonicalPair}`,
    );
  }
  const rows = entries[0][1];
  if (rows.length < 2 || rows.length > 720) {
    throw new Error(
      `Kraken ${canonicalPair} OHLC must include committed and current rows`,
    );
  }
  const candles = rows.slice(0, -1).map((row, index) => {
    if (!Array.isArray(row) || row.length !== 8) {
      throw new Error(
        `Kraken ${canonicalPair} OHLC row ${index} is malformed`,
      );
    }
    const timestampSeconds = parseNumber(
      canonicalPair,
      intervalMinutes,
      "timestamp",
      row[0],
    );
    const tradeCount = parseNumber(
      canonicalPair,
      intervalMinutes,
      "trade count",
      row[7],
    );
    const vwap = parseNumber(
      canonicalPair,
      intervalMinutes,
      "VWAP",
      row[5],
    );
    if (
      !Number.isSafeInteger(timestampSeconds) ||
      timestampSeconds < 0 ||
      !Number.isSafeInteger(tradeCount) ||
      tradeCount < 0 ||
      vwap <= 0
    ) {
      throw new Error(
        `Kraken ${canonicalPair} ${intervalMinutes}-minute OHLC metadata is invalid`,
      );
    }
    return {
      timestampMs: timestampSeconds * 1000,
      open: parseNumber(canonicalPair, intervalMinutes, "open", row[1]),
      high: parseNumber(canonicalPair, intervalMinutes, "high", row[2]),
      low: parseNumber(canonicalPair, intervalMinutes, "low", row[3]),
      close: parseNumber(canonicalPair, intervalMinutes, "close", row[4]),
      volume: parseNumber(canonicalPair, intervalMinutes, "volume", row[6]),
    };
  });
  return { candles, sourceCursor };
}

function buildRequestUrl(
  exchangePair: string,
  intervalMinutes: CandleIntervalMinutes,
  sinceSeconds: number | null,
): URL {
  const url = new URL("/0/public/OHLC", KRAKEN_API_ORIGIN);
  url.searchParams.set("pair", exchangePair);
  url.searchParams.set("assetVersion", "1");
  url.searchParams.set("interval", String(intervalMinutes));
  if (sinceSeconds !== null) {
    url.searchParams.set("since", String(sinceSeconds));
  }
  return url;
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchOne(
  fetchImpl: PublicFetch,
  url: URL,
  requestTimeoutMs: number,
  maximumResponseBytes: number,
  clock: () => number,
): Promise<{
  readonly requestStartedAtMs: number;
  readonly receivedAtMs: number;
  readonly availableAtMs: number;
  readonly text: string;
}> {
  const requestStartedAtMs = clock();
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const receivedAtMs = clock();
  if (
    response.status === 408 ||
    response.status === 429 ||
    response.status >= 500
  ) {
    throw new TransientKrakenOhlcError(
      `Kraken OHLC returned HTTP ${response.status}`,
    );
  }
  if (!response.ok) {
    throw new Error(`Kraken OHLC returned HTTP ${response.status}`);
  }
  const mediaType = response.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new Error("Kraken OHLC returned an unsupported media type");
  }
  const declaredLength = response.headers.get("Content-Length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) ||
      Number(declaredLength) > maximumResponseBytes)
  ) {
    throw new Error("Kraken OHLC declared length is invalid or oversized");
  }
  const text = await response.text();
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength === 0 || byteLength > maximumResponseBytes) {
    throw new Error("Kraken OHLC body is empty or oversized");
  }
  const availableAtMs = clock();
  if (
    receivedAtMs < requestStartedAtMs ||
    availableAtMs < receivedAtMs
  ) {
    throw new Error("Kraken OHLC acquisition chronology is invalid");
  }
  return { requestStartedAtMs, receivedAtMs, availableAtMs, text };
}

async function fetchWithRetry(
  fetchImpl: PublicFetch,
  url: URL,
  maximumAttempts: number,
  retryBaseDelayMs: number,
  requestTimeoutMs: number,
  maximumResponseBytes: number,
  sleep: (milliseconds: number) => Promise<void>,
  clock: () => number,
  counter: { value: number },
): Promise<Awaited<ReturnType<typeof fetchOne>>> {
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    counter.value += 1;
    try {
      return await fetchOne(
        fetchImpl,
        url,
        requestTimeoutMs,
        maximumResponseBytes,
        clock,
      );
    } catch (error: unknown) {
      const transient =
        error instanceof TransientKrakenOhlcError ||
        error instanceof TypeError ||
        (error instanceof Error &&
          /network|fetch failed|timed out|timeout/iu.test(error.message));
      if (!transient || attempt === maximumAttempts) throw error;
      await sleep(retryBaseDelayMs * attempt);
    }
  }
  throw new Error("Kraken OHLC retries exhausted");
}

function validateHistory(
  pairs: readonly SpotPairDefinition[],
  evidence: Readonly<
    Record<string, ScheduledCandleHistoryEvidence | undefined>
  >,
): void {
  for (const pair of pairs) {
    const history = evidence[pair.canonicalSymbol];
    if (
      history === undefined ||
      !Number.isSafeInteger(history.hourlyCommittedCandles) ||
      history.hourlyCommittedCandles < MIN_HOURLY_CANDLES ||
      !Number.isSafeInteger(history.dailyCommittedCandles) ||
      history.dailyCommittedCandles < MIN_DAILY_CANDLES ||
      history.dataQualityState !== "complete"
    ) {
      throw new Error(
        `${pair.canonicalSymbol} persisted hourly/daily candle history is incomplete`,
      );
    }
  }
}

export async function runScheduledKrakenCandleCycle(
  options: ScheduledKrakenCandleOptions,
): Promise<ScheduledKrakenCandleResult> {
  assertSafeTime("scheduledAtMs", options.scheduledAtMs);
  if (options.pairs.length < 1 || options.pairs.length > 8) {
    throw new Error("Scheduled candle cycle requires 1 to 8 pairs");
  }
  const canonicalPairs = options.pairs.map((pair) => pair.canonicalSymbol);
  if (
    new Set(canonicalPairs).size !== canonicalPairs.length ||
    options.pairs.some(
      (pair) =>
        pair.canonicalSymbol !== pair.canonicalSymbol.trim() ||
        !/^[A-Z0-9]+\/AUD$/u.test(pair.canonicalSymbol) ||
        pair.exchangeSymbol !== pair.exchangeSymbol.trim() ||
        !/^[A-Z0-9.]+$/u.test(pair.exchangeSymbol),
    )
  ) {
    throw new Error("Scheduled candle pairs must be unique and canonical");
  }
  const maximumAttempts = options.maximumAttempts ?? MAXIMUM_ATTEMPTS;
  const maximumResponseBytes =
    options.maximumResponseBytes ?? MAXIMUM_RESPONSE_BYTES;
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  const requestSpacingMs = options.requestSpacingMs ?? 350;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
  positiveInteger("maximumAttempts", maximumAttempts, 3);
  positiveInteger(
    "maximumResponseBytes",
    maximumResponseBytes,
    MAXIMUM_RESPONSE_BYTES,
  );
  positiveInteger("requestTimeoutMs", requestTimeoutMs, 30_000);
  if (
    !Number.isSafeInteger(requestSpacingMs) ||
    requestSpacingMs < 0 ||
    requestSpacingMs > 10_000 ||
    !Number.isSafeInteger(retryBaseDelayMs) ||
    retryBaseDelayMs < 0 ||
    retryBaseDelayMs > 10_000
  ) {
    throw new Error("Scheduled candle request timing is invalid");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const clock = options.nowMs ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const requestCounter = { value: 0 };
  const captures: ScheduledKrakenCandleCapture[] = [];

  const sortedPairs = [...options.pairs].sort((left, right) =>
    left.canonicalSymbol.localeCompare(right.canonicalSymbol),
  );
  for (const pair of sortedPairs) {
    for (const intervalMinutes of INTERVALS) {
      if (captures.length > 0 && requestSpacingMs > 0) {
        await sleep(requestSpacingMs);
      }
      const latestOpenTimeMs = await options.store.loadLatestOpenTimeMs(
        pair.canonicalSymbol,
        intervalMinutes,
      );
      const sinceSeconds =
        latestOpenTimeMs === null ? null : latestOpenTimeMs / 1000;
      const url = buildRequestUrl(
        pair.exchangeSymbol,
        intervalMinutes,
        sinceSeconds,
      );
      const acquired = await fetchWithRetry(
        fetchImpl,
        url,
        maximumAttempts,
        retryBaseDelayMs,
        requestTimeoutMs,
        maximumResponseBytes,
        sleep,
        clock,
        requestCounter,
      );
      if (acquired.requestStartedAtMs < options.scheduledAtMs) {
        throw new Error(
          "Kraken OHLC request cannot precede its scheduled cycle",
        );
      }
      const responseBytes = new TextEncoder().encode(acquired.text);
      const responseSha256 = await sha256Hex(acquired.text);
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(acquired.text) as unknown;
      } catch {
        throw new Error("Kraken OHLC returned invalid JSON");
      }
      const parsed = parseKrakenOhlc(
        pair.canonicalSymbol,
        intervalMinutes,
        parsedJson,
      );
      assertCandlesUsable(
        pair.canonicalSymbol,
        intervalMinutes,
        parsed.candles,
        {
          nowMs: acquired.availableAtMs,
          minimumCandles: 1,
        },
      );
      const sourceCursor =
        `last=${parsed.sourceCursor};response-sha256=${responseSha256}`;
      const batchId = await sha256Hex(
        JSON.stringify([
          "scheduled-kraken-ohlc-v1",
          pair.canonicalSymbol,
          pair.exchangeSymbol,
          intervalMinutes,
          url.toString(),
          acquired.requestStartedAtMs,
          acquired.receivedAtMs,
          acquired.availableAtMs,
          responseBytes.byteLength,
          responseSha256,
        ]),
      );
      const batch = await options.store.persistBatch({
        batchId,
        venue: "kraken",
        canonicalPair: pair.canonicalSymbol,
        exchangePair: pair.exchangeSymbol,
        intervalMinutes,
        ...(sinceSeconds === null
          ? {}
          : { requestedSinceSeconds: sinceSeconds }),
        sourceCursor,
        fetchedAt: new Date(acquired.availableAtMs).toISOString(),
        candles: parsed.candles,
      });
      captures.push({
        canonicalPair: pair.canonicalSymbol,
        exchangePair: pair.exchangeSymbol,
        intervalMinutes,
        requestUrl: url.toString(),
        requestedSinceSeconds: sinceSeconds,
        requestStartedAtMs: acquired.requestStartedAtMs,
        receivedAtMs: acquired.receivedAtMs,
        availableAtMs: acquired.availableAtMs,
        responseByteLength: responseBytes.byteLength,
        responseSha256,
        sourceCursor,
        batch,
      });
    }
  }
  const historyAsOfMs = Math.max(
    ...captures.map((capture) => capture.availableAtMs),
  );
  const history = await options.historyProvider(
    canonicalPairs,
    historyAsOfMs,
  );
  validateHistory(sortedPairs, history);
  return {
    captures,
    requestCount: requestCounter.value,
    historyAsOfMs,
  };
}
