import {
  KrakenPublicMarketClient,
  type KrakenPublicEvidence,
} from "../exchanges/krakenPublic.ts";
import {
  summariseKrakenMarketQuality,
  type KrakenOrderBook,
  type KrakenTickerObservation,
} from "../marketData/krakenQuality.ts";
import type { SpotPairDefinition } from "../marketData/pairs.ts";
import { sha256Hex } from "../utils/crypto.ts";
import {
  resolveAudValuationPath,
  type AudConversionQuote,
  type MarketDataQualityState,
  type UniverseIngestionBatch,
  type UniverseIngestionInput,
  type UniverseSourceEvidence,
  type VenueMarketObservationInput,
} from "./ingestion.ts";

const DEFAULT_ROTATION_INTERVAL_MS = 900_000;
const UNFILLABLE_IMPACT_BPS = 10_000;
const QUALITY_STATES = new Set<MarketDataQualityState>([
  "complete",
  "gap",
  "conflict",
  "stale",
  "ambiguous",
]);

type PublicFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface KrakenUniverseHistoryEvidence {
  readonly dailyCommittedCandles: number;
  readonly hourlyCommittedCandles: number;
  readonly annualisedVolatility: number;
  readonly dataQualityState: MarketDataQualityState;
}

export interface KrakenPublicUniverseOptions {
  readonly scheduledAtMs: number;
  readonly fetchImpl?: PublicFetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly nowMs?: () => number;
  readonly historyByPair?: Readonly<Record<string, KrakenUniverseHistoryEvidence>>;
  readonly maximumDepthPairs?: number;
  readonly rotationIntervalMs?: number;
  readonly depthLevelCount?: number;
  readonly referenceOrderAud?: number;
  readonly maximumAudQuoteAgeMs?: number;
  readonly requestSpacingMs?: number;
  readonly retryBaseDelayMs?: number;
  readonly maximumAttempts?: number;
  readonly requestTimeoutMs?: number;
  readonly maximumResponseBytes?: number;
}

export interface KrakenPublicUniversePrepared {
  readonly input: UniverseIngestionInput;
  readonly selectedPairs: readonly string[];
  readonly skippedPairs: readonly string[];
  readonly requestCount: number;
}

export interface UniverseBatchSink {
  persistBatch(input: UniverseIngestionInput): Promise<UniverseIngestionBatch>;
}

export interface KrakenPublicUniverseCycleResult {
  readonly batch: UniverseIngestionBatch;
  readonly selectedPairs: readonly string[];
  readonly skippedPairs: readonly string[];
  readonly requestCount: number;
}

function assertSafeTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertPositiveInteger(
  name: string,
  value: number,
  maximum: number,
): void {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Cannot hash a non-finite value");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error("Cannot hash an unsupported value");
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function isTransient(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /HTTP (429|5\d\d)|Rate limit|Throttled|Unavailable|network|fetch failed|timed out|timeout/i.test(
    message,
  );
}

async function withRetry<T>(
  operation: string,
  maximumAttempts: number,
  retryBaseDelayMs: number,
  sleep: (milliseconds: number) => Promise<void>,
  action: () => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await action();
    } catch (error: unknown) {
      if (attempt === maximumAttempts || !isTransient(error)) throw error;
      await sleep(retryBaseDelayMs * attempt);
    }
  }
  throw new Error(`${operation} exhausted retries`);
}

async function readBoundedResponse(
  response: Response,
  maximumResponseBytes: number,
): Promise<Response> {
  if (response.redirected) {
    throw new Error("Kraken public response was redirected");
  }
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumResponseBytes) {
        await reader.cancel("response size limit exceeded");
        throw new Error("Kraken public response exceeded the size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function controlledFetcher(
  base: PublicFetch,
  requestTimeoutMs: number,
  maximumResponseBytes: number,
  requestSpacingMs: number,
  sleep: (milliseconds: number) => Promise<void>,
  counter: { value: number },
): PublicFetch {
  let hasAttemptedRequest = false;
  return async (input, init) => {
    if (hasAttemptedRequest && requestSpacingMs > 0) {
      await sleep(requestSpacingMs);
    }
    hasAttemptedRequest = true;
    counter.value += 1;
    const response = await base(input, {
      ...init,
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    return readBoundedResponse(response, maximumResponseBytes);
  };
}

function validateHistory(
  pair: string,
  supplied: KrakenUniverseHistoryEvidence | undefined,
): KrakenUniverseHistoryEvidence {
  const value = supplied ?? {
    dailyCommittedCandles: 0,
    hourlyCommittedCandles: 0,
    annualisedVolatility: 0,
    dataQualityState: "gap" as const,
  };
  if (
    !Number.isInteger(value.dailyCommittedCandles) ||
    value.dailyCommittedCandles < 0 ||
    !Number.isInteger(value.hourlyCommittedCandles) ||
    value.hourlyCommittedCandles < 0 ||
    !Number.isFinite(value.annualisedVolatility) ||
    value.annualisedVolatility < 0 ||
    !QUALITY_STATES.has(value.dataQualityState)
  ) {
    throw new Error(`${pair} history evidence is invalid`);
  }
  return value;
}

function rotatePairs(
  pairs: readonly SpotPairDefinition[],
  scheduledAtMs: number,
  maximumDepthPairs: number,
  rotationIntervalMs: number,
): readonly SpotPairDefinition[] {
  if (pairs.length === 0) {
    throw new Error("Kraken returned no valuation-ready AU spot pairs");
  }
  const count = Math.min(maximumDepthPairs, pairs.length);
  const slot = Math.floor(scheduledAtMs / rotationIntervalMs);
  const start = (slot * count) % pairs.length;
  return Array.from(
    { length: count },
    (_, index) => pairs[(start + index) % pairs.length],
  )
    .filter((pair): pair is SpotPairDefinition => pair !== undefined)
    .sort((left, right) =>
      left.canonicalSymbol.localeCompare(right.canonicalSymbol),
    );
}

function sourceEvidence(
  sourceKind: UniverseSourceEvidence["sourceKind"],
  evidence: KrakenPublicEvidence<unknown>,
): UniverseSourceEvidence {
  return {
    sourceId: evidence.sourceId,
    sourceKind,
    sourceRef: evidence.sourceRef,
    fetchedAtMs: evidence.fetchedAtMs,
    payloadSha256: evidence.payloadSha256,
  };
}

export async function prepareScheduledKrakenUniverse(
  options: KrakenPublicUniverseOptions,
): Promise<KrakenPublicUniversePrepared> {
  assertSafeTime("scheduledAtMs", options.scheduledAtMs);
  const maximumDepthPairs = options.maximumDepthPairs ?? 6;
  const rotationIntervalMs =
    options.rotationIntervalMs ?? DEFAULT_ROTATION_INTERVAL_MS;
  const depthLevelCount = options.depthLevelCount ?? 50;
  const referenceOrderAud = options.referenceOrderAud ?? 200;
  const maximumAudQuoteAgeMs = options.maximumAudQuoteAgeMs ?? 300_000;
  const requestSpacingMs = options.requestSpacingMs ?? 350;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
  const maximumAttempts = options.maximumAttempts ?? 2;
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  const maximumResponseBytes = options.maximumResponseBytes ?? 10_000_000;

  assertPositiveInteger("maximumDepthPairs", maximumDepthPairs, 20);
  assertPositiveInteger("rotationIntervalMs", rotationIntervalMs, 86_400_000);
  assertPositiveInteger("depthLevelCount", depthLevelCount, 500);
  assertPositiveInteger("maximumAttempts", maximumAttempts, 4);
  assertPositiveInteger("requestTimeoutMs", requestTimeoutMs, 60_000);
  assertPositiveInteger(
    "maximumResponseBytes",
    maximumResponseBytes,
    25_000_000,
  );
  assertSafeTime("maximumAudQuoteAgeMs", maximumAudQuoteAgeMs);
  assertSafeTime("requestSpacingMs", requestSpacingMs);
  assertSafeTime("retryBaseDelayMs", retryBaseDelayMs);
  if (!Number.isFinite(referenceOrderAud) || referenceOrderAud <= 0) {
    throw new Error("referenceOrderAud must be positive");
  }

  const sleep = options.sleep ?? defaultSleep;
  const clock = options.nowMs ?? Date.now;
  const requestCounter = { value: 0 };
  const client = new KrakenPublicMarketClient(
    controlledFetcher(
      options.fetchImpl ?? fetch,
      requestTimeoutMs,
      maximumResponseBytes,
      requestSpacingMs,
      sleep,
      requestCounter,
    ),
    clock,
  );

  const metadata = await withRetry(
    "AssetPairs",
    maximumAttempts,
    retryBaseDelayMs,
    sleep,
    () => client.fetchAssetPairs("AU"),
  );
  const onlinePairs = metadata.data.filter((pair) => pair.status === "online");
  const tickerEvidence = await withRetry(
    "Ticker",
    maximumAttempts,
    retryBaseDelayMs,
    sleep,
    () => client.fetchTickers(),
  );
  const tickerByPair = new Map(
    tickerEvidence.data.map((ticker) => [ticker.canonicalPair, ticker]),
  );

  const conversionQuotes: AudConversionQuote[] = onlinePairs.flatMap((pair) => {
    const ticker = tickerByPair.get(pair.canonicalSymbol);
    return ticker === undefined
      ? []
      : [
          {
            baseAsset: pair.baseAsset,
            quoteAsset: pair.quoteAsset,
            rate: (ticker.ask + ticker.bid) / 2,
            observedAtMs: tickerEvidence.fetchedAtMs,
            availableAtMs: tickerEvidence.fetchedAtMs,
            payloadSha256: tickerEvidence.payloadSha256,
          },
        ];
  });

  const skippedPairs: string[] = [];
  const valuationReady = onlinePairs.filter((pair) => {
    try {
      resolveAudValuationPath(
        pair.quoteAsset,
        conversionQuotes,
        tickerEvidence.fetchedAtMs,
        maximumAudQuoteAgeMs,
      );
      return true;
    } catch {
      skippedPairs.push(pair.canonicalSymbol);
      return false;
    }
  });
  const selected = rotatePairs(
    valuationReady,
    options.scheduledAtMs,
    maximumDepthPairs,
    rotationIntervalMs,
  );

  const books: Array<{
    readonly pair: SpotPairDefinition;
    readonly evidence: KrakenPublicEvidence<KrakenOrderBook>;
    readonly ticker: KrakenTickerObservation;
  }> = [];
  for (const pair of selected) {
    const evidence = await withRetry(
      `Depth ${pair.canonicalSymbol}`,
      maximumAttempts,
      retryBaseDelayMs,
      sleep,
      () => client.fetchOrderBook(pair.canonicalSymbol, depthLevelCount),
    );
    const ticker = tickerByPair.get(pair.canonicalSymbol);
    if (ticker === undefined) {
      throw new Error(`Kraken Ticker omitted ${pair.canonicalSymbol}`);
    }
    books.push({ pair, evidence, ticker });
  }

  const recordedAtMs = Math.max(
    options.scheduledAtMs,
    metadata.fetchedAtMs,
    tickerEvidence.fetchedAtMs,
    ...books.map((item) => item.evidence.fetchedAtMs),
  );
  assertSafeTime("recordedAtMs", recordedAtMs);
  const qualityDigest = await sha256Hex(
    canonicalJson({
      version: "kraken-public-quality-v2",
      referenceOrderAud,
      depthLevelCount,
      rotationIntervalMs,
      ticker: {
        sourceRef: tickerEvidence.sourceRef,
        payloadSha256: tickerEvidence.payloadSha256,
      },
      depths: books.map((item) => ({
        pair: item.pair.canonicalSymbol,
        sourceRef: item.evidence.sourceRef,
        payloadSha256: item.evidence.payloadSha256,
      })),
    }),
  );
  const qualitySource: UniverseSourceEvidence = {
    sourceId: `kraken:market-quality:${recordedAtMs}:${qualityDigest.slice(0, 16)}`,
    sourceKind: "venue-market-quality",
    sourceRef: `kraken:public-quality:v2:depth=${depthLevelCount}:aud=${referenceOrderAud}`,
    fetchedAtMs: recordedAtMs,
    payloadSha256: qualityDigest,
  };

  const markets: VenueMarketObservationInput[] = books.map(
    ({ pair, evidence, ticker }) => {
      const valuation = resolveAudValuationPath(
        pair.quoteAsset,
        conversionQuotes,
        evidence.fetchedAtMs,
        maximumAudQuoteAgeMs,
      );
      const summary = summariseKrakenMarketQuality(
        ticker,
        evidence.data,
        referenceOrderAud / valuation.rateToAud,
      );
      const mid = (ticker.ask + ticker.bid) / 2;
      const storedHistory = validateHistory(
        pair.canonicalSymbol,
        options.historyByPair?.[pair.canonicalSymbol],
      );
      return {
        canonicalPair: pair.canonicalSymbol,
        exchangePair: pair.exchangeSymbol,
        baseAsset: pair.baseAsset,
        quoteAsset: pair.quoteAsset,
        instrumentKind: "spot",
        observedAtMs: evidence.fetchedAtMs,
        availableAtMs: evidence.fetchedAtMs,
        spreadBps: summary.spreadBps,
        quoteTurnover24h: ticker.quoteTurnover24h,
        availableQuoteVolume: summary.availableQuoteVolume,
        estimatedImpactBps:
          summary.estimatedImpactBps ?? UNFILLABLE_IMPACT_BPS,
        minimumOrderQuote: Math.max(
          pair.minimumOrderCostQuote,
          pair.minimumOrderVolume * mid,
        ),
        dailyCommittedCandles: storedHistory.dailyCommittedCandles,
        hourlyCommittedCandles: storedHistory.hourlyCommittedCandles,
        annualisedVolatility: storedHistory.annualisedVolatility,
        dataQualityState:
          summary.estimatedImpactBps === null &&
          storedHistory.dataQualityState === "complete"
            ? "gap"
            : storedHistory.dataQualityState,
      };
    },
  );

  return {
    input: {
      venue: "kraken",
      recordedAtMs,
      maximumAudQuoteAgeMs,
      metadataSource: sourceEvidence("venue-metadata", metadata),
      qualitySource,
      conversionQuotes,
      markets,
      lifecycleAnnouncements: [],
    },
    selectedPairs: selected.map((pair) => pair.canonicalSymbol),
    skippedPairs: skippedPairs.sort(),
    requestCount: requestCounter.value,
  };
}

export async function runScheduledKrakenUniverseCycle(
  sink: UniverseBatchSink,
  options: KrakenPublicUniverseOptions,
): Promise<KrakenPublicUniverseCycleResult> {
  const prepared = await prepareScheduledKrakenUniverse(options);
  return {
    batch: await sink.persistBatch(prepared.input),
    selectedPairs: prepared.selectedPairs,
    skippedPairs: prepared.skippedPairs,
    requestCount: prepared.requestCount,
  };
}
