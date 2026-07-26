import type { KrakenPublicEvidence } from "../exchanges/krakenPublic.ts";
import {
  normalizeKrakenDisplayPair,
  summariseKrakenMarketQuality,
  type KrakenOrderBook,
  type KrakenTickerObservation,
} from "../marketData/krakenQuality.ts";
import type { SpotPairDefinition } from "../marketData/pairs.ts";
import type { UniverseIngestionRepository } from "../storage/universeIngestion.ts";
import { sha256Hex } from "../utils/crypto.ts";
import {
  resolveAudValuationPath,
  type AudConversionQuote,
  type LifecycleAnnouncementInput,
  type UniverseIngestionBatch,
  type UniverseSourceEvidence,
  type VenueMarketObservationInput,
} from "./ingestion.ts";
import type { MarketDataQualityState } from "./types.ts";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface KrakenPublicClientLike {
  fetchAssetPairs(
    countryCode?: string,
  ): Promise<KrakenPublicEvidence<readonly SpotPairDefinition[]>>;
  fetchTickers(
    pairs?: readonly string[],
  ): Promise<KrakenPublicEvidence<readonly KrakenTickerObservation[]>>;
  fetchOrderBook(
    pair: string,
    count?: number,
  ): Promise<KrakenPublicEvidence<KrakenOrderBook>>;
}

export interface UniverseBatchRepositoryLike {
  persistBatch(
    input: Parameters<UniverseIngestionRepository["persistBatch"]>[0],
  ): Promise<UniverseIngestionBatch>;
}

export interface CommittedCandleEvidence {
  readonly canonicalPair: string;
  readonly dailyCommittedCandles: number;
  readonly hourlyCommittedCandles: number;
  readonly latestDailyCommittedAtMs: number;
  readonly latestHourlyCommittedAtMs: number;
  readonly annualisedVolatility: number;
  readonly availableAtMs: number;
  readonly dataQualityState: MarketDataQualityState;
  readonly source: UniverseSourceEvidence;
}

export interface KrakenQualityManifestEntry {
  readonly sourceId: string;
  readonly sourceRef: string;
  readonly fetchedAtMs: number;
  readonly payloadSha256: string;
}

export interface KrakenQualityManifest {
  readonly schemaVersion: "kraken-universe-quality-manifest-v1";
  readonly recordedAtMs: number;
  readonly candidateOrderAud: number;
  readonly ticker: KrakenQualityManifestEntry;
  readonly depth: readonly KrakenQualityManifestEntry[];
  readonly candles: readonly KrakenQualityManifestEntry[];
  readonly conversionQuoteDigests: readonly string[];
  readonly manifestSha256: string;
}

export interface KrakenScheduledUniverseInput {
  readonly canonicalPairs: readonly string[];
  readonly candidateOrderAud: number;
  readonly maximumPairs: number;
  readonly depthCount: number;
  readonly maximumConcurrentDepthRequests: number;
  readonly maximumEvidenceSkewMs: number;
  readonly maximumHourlyCandleAgeMs: number;
  readonly maximumDailyCandleAgeMs: number;
  readonly maximumAudQuoteAgeMs: number;
  readonly candleEvidence: readonly CommittedCandleEvidence[];
  readonly conversionQuotes: readonly AudConversionQuote[];
  readonly lifecycleAnnouncements?: readonly {
    readonly source: UniverseSourceEvidence;
    readonly announcement: LifecycleAnnouncementInput;
  }[];
}

export interface KrakenScheduledUniverseDependencies {
  readonly client: KrakenPublicClientLike;
  readonly repository: UniverseBatchRepositoryLike;
  readonly clock?: () => number;
}

export interface KrakenScheduledUniverseResult {
  readonly batch: UniverseIngestionBatch;
  readonly qualityManifest: KrakenQualityManifest;
}

function assertCanonical(name: string, value: string): void {
  if (value.trim() !== value || value.length === 0) {
    throw new Error(`${name} must be a non-empty canonical string`);
  }
}

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be finite and positive`);
  }
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

function assertDigest(name: string, value: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256 value`);
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot hash a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error("Cannot hash unsupported value");
}

function evidenceEntry(
  evidence: KrakenPublicEvidence<unknown> | UniverseSourceEvidence,
): KrakenQualityManifestEntry {
  assertCanonical("evidence sourceId", evidence.sourceId);
  assertCanonical("evidence sourceRef", evidence.sourceRef);
  assertNonNegativeInteger("evidence fetchedAtMs", evidence.fetchedAtMs);
  assertDigest("evidence payloadSha256", evidence.payloadSha256);
  return {
    sourceId: evidence.sourceId,
    sourceRef: evidence.sourceRef,
    fetchedAtMs: evidence.fetchedAtMs,
    payloadSha256: evidence.payloadSha256,
  };
}

async function mapBounded<T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<R>,
): Promise<readonly R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, values.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      const value = values[index];
      if (value === undefined) throw new Error("Bounded work index is invalid");
      results[index] = await task(value, index);
    }
  });
  await Promise.all(workers);
  return results;
}

function validateCandleEvidence(
  evidence: CommittedCandleEvidence,
  observationAtMs: number,
  input: KrakenScheduledUniverseInput,
): void {
  assertCanonical("candle canonicalPair", evidence.canonicalPair);
  assertNonNegativeInteger(
    "dailyCommittedCandles",
    evidence.dailyCommittedCandles,
  );
  assertNonNegativeInteger(
    "hourlyCommittedCandles",
    evidence.hourlyCommittedCandles,
  );
  assertNonNegativeInteger(
    "latestDailyCommittedAtMs",
    evidence.latestDailyCommittedAtMs,
  );
  assertNonNegativeInteger(
    "latestHourlyCommittedAtMs",
    evidence.latestHourlyCommittedAtMs,
  );
  assertNonNegativeInteger("candle availableAtMs", evidence.availableAtMs);
  if (
    !Number.isFinite(evidence.annualisedVolatility) ||
    evidence.annualisedVolatility < 0
  ) {
    throw new Error(`${evidence.canonicalPair} annualised volatility is invalid`);
  }
  if (evidence.dataQualityState !== "complete") {
    throw new Error(`${evidence.canonicalPair} candle evidence is not complete`);
  }
  if (
    evidence.latestDailyCommittedAtMs > observationAtMs ||
    evidence.latestHourlyCommittedAtMs > observationAtMs ||
    evidence.availableAtMs > observationAtMs
  ) {
    throw new Error(`${evidence.canonicalPair} candle evidence is not knowable`);
  }
  if (
    observationAtMs - evidence.latestDailyCommittedAtMs >
      input.maximumDailyCandleAgeMs ||
    observationAtMs - evidence.latestHourlyCommittedAtMs >
      input.maximumHourlyCandleAgeMs
  ) {
    throw new Error(`${evidence.canonicalPair} candle evidence is stale`);
  }
  if (evidence.source.sourceKind !== "venue-market-quality") {
    throw new Error("Candle evidence must use venue-market-quality source evidence");
  }
  evidenceEntry(evidence.source);
}

function validateInput(input: KrakenScheduledUniverseInput): readonly string[] {
  assertPositive("candidateOrderAud", input.candidateOrderAud);
  assertPositiveInteger("maximumPairs", input.maximumPairs);
  assertPositiveInteger("depthCount", input.depthCount);
  if (input.depthCount > 500) throw new Error("depthCount cannot exceed 500");
  assertPositiveInteger(
    "maximumConcurrentDepthRequests",
    input.maximumConcurrentDepthRequests,
  );
  if (input.maximumConcurrentDepthRequests > 10) {
    throw new Error("maximumConcurrentDepthRequests cannot exceed 10");
  }
  assertNonNegativeInteger("maximumEvidenceSkewMs", input.maximumEvidenceSkewMs);
  assertNonNegativeInteger(
    "maximumHourlyCandleAgeMs",
    input.maximumHourlyCandleAgeMs,
  );
  assertNonNegativeInteger(
    "maximumDailyCandleAgeMs",
    input.maximumDailyCandleAgeMs,
  );
  assertNonNegativeInteger("maximumAudQuoteAgeMs", input.maximumAudQuoteAgeMs);
  if (input.canonicalPairs.length === 0) {
    throw new Error("canonicalPairs cannot be empty");
  }
  if (input.canonicalPairs.length > input.maximumPairs) {
    throw new Error("canonicalPairs exceed the configured maximumPairs");
  }
  const pairs = input.canonicalPairs.map(normalizeKrakenDisplayPair).sort();
  if (new Set(pairs).size !== pairs.length) {
    throw new Error("canonicalPairs contain duplicates");
  }
  return pairs;
}

function selectDefinitions(
  available: readonly SpotPairDefinition[],
  pairs: readonly string[],
): readonly SpotPairDefinition[] {
  const byPair = new Map<string, SpotPairDefinition>();
  for (const definition of available) {
    if (byPair.has(definition.canonicalSymbol)) {
      throw new Error(`Kraken returned duplicate definition ${definition.canonicalSymbol}`);
    }
    byPair.set(definition.canonicalSymbol, definition);
  }
  return pairs.map((pair) => {
    const definition = byPair.get(pair);
    if (definition === undefined) throw new Error(`Kraken pair ${pair} is unavailable`);
    if (definition.status !== "online") throw new Error(`Kraken pair ${pair} is not online`);
    return definition;
  });
}

export async function runKrakenScheduledUniverseIngestion(
  input: KrakenScheduledUniverseInput,
  dependencies: KrakenScheduledUniverseDependencies,
): Promise<KrakenScheduledUniverseResult> {
  const pairs = validateInput(input);
  const candleByPair = new Map<string, CommittedCandleEvidence>();
  for (const evidence of input.candleEvidence) {
    const pair = normalizeKrakenDisplayPair(evidence.canonicalPair);
    if (candleByPair.has(pair)) throw new Error(`Duplicate candle evidence ${pair}`);
    candleByPair.set(pair, evidence);
  }
  if (
    candleByPair.size !== pairs.length ||
    pairs.some((pair) => !candleByPair.has(pair))
  ) {
    throw new Error("Candle evidence must exactly match canonicalPairs");
  }

  const metadata = await dependencies.client.fetchAssetPairs("AU");
  const definitions = selectDefinitions(metadata.data, pairs);
  const tickers = await dependencies.client.fetchTickers(pairs);
  const tickerByPair = new Map(
    tickers.data.map((ticker) => [ticker.canonicalPair, ticker]),
  );
  if (tickerByPair.size !== pairs.length) {
    throw new Error("Ticker evidence must exactly match canonicalPairs");
  }

  const depthEvidence = await mapBounded(
    pairs,
    input.maximumConcurrentDepthRequests,
    (pair) => dependencies.client.fetchOrderBook(pair, input.depthCount),
  );

  const markets: VenueMarketObservationInput[] = [];
  const depthManifest: KrakenQualityManifestEntry[] = [];
  const candleManifest: KrakenQualityManifestEntry[] = [];
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    const definition = definitions[index];
    const depth = depthEvidence[index];
    const ticker = pair === undefined ? undefined : tickerByPair.get(pair);
    const candle = pair === undefined ? undefined : candleByPair.get(pair);
    if (
      pair === undefined ||
      definition === undefined ||
      depth === undefined ||
      ticker === undefined ||
      candle === undefined
    ) {
      throw new Error("Kraken universe join index is incomplete");
    }
    if (
      depth.data.canonicalPair !== pair ||
      definition.canonicalSymbol !== pair
    ) {
      throw new Error(`${pair} evidence definitions do not match`);
    }
    const observationAtMs = Math.min(tickers.fetchedAtMs, depth.fetchedAtMs);
    const evidenceSkewMs = Math.abs(tickers.fetchedAtMs - depth.fetchedAtMs);
    if (evidenceSkewMs > input.maximumEvidenceSkewMs) {
      throw new Error(`${pair} ticker/depth evidence skew is too large`);
    }
    validateCandleEvidence(candle, observationAtMs, input);
    const valuation = resolveAudValuationPath(
      definition.quoteAsset,
      input.conversionQuotes,
      observationAtMs,
      input.maximumAudQuoteAgeMs,
    );
    const candidateOrderQuote = input.candidateOrderAud / valuation.rateToAud;
    const quality = summariseKrakenMarketQuality(
      ticker,
      depth.data,
      candidateOrderQuote,
    );
    if (quality.estimatedImpactBps === null) {
      throw new Error(`${pair} displayed depth cannot fill the candidate order`);
    }
    const minimumOrderQuote = Math.max(
      definition.minimumOrderCostQuote,
      definition.minimumOrderVolume * ticker.last,
    );
    markets.push({
      canonicalPair: pair,
      exchangePair: definition.exchangeSymbol,
      baseAsset: definition.baseAsset,
      quoteAsset: definition.quoteAsset,
      instrumentKind: "spot",
      observedAtMs: observationAtMs,
      availableAtMs: Math.max(
        metadata.fetchedAtMs,
        tickers.fetchedAtMs,
        depth.fetchedAtMs,
        candle.availableAtMs,
      ),
      spreadBps: quality.spreadBps,
      quoteTurnover24h: ticker.quoteTurnover24h,
      availableQuoteVolume: quality.availableQuoteVolume,
      estimatedImpactBps: quality.estimatedImpactBps,
      minimumOrderQuote,
      dailyCommittedCandles: candle.dailyCommittedCandles,
      hourlyCommittedCandles: candle.hourlyCommittedCandles,
      annualisedVolatility: candle.annualisedVolatility,
      dataQualityState: "complete",
    });
    depthManifest.push(evidenceEntry(depth));
    candleManifest.push(evidenceEntry(candle.source));
  }

  const clock = dependencies.clock ?? Date.now;
  const recordedAtMs = clock();
  assertNonNegativeInteger("recordedAtMs", recordedAtMs);
  const latestAvailability = Math.max(
    metadata.fetchedAtMs,
    tickers.fetchedAtMs,
    ...depthEvidence.map((entry) => entry.fetchedAtMs),
    ...input.candleEvidence.map((entry) => entry.availableAtMs),
  );
  if (recordedAtMs < latestAvailability) {
    throw new Error("recordedAtMs precedes joined evidence availability");
  }

  const manifestContent = {
    schemaVersion: "kraken-universe-quality-manifest-v1" as const,
    recordedAtMs,
    candidateOrderAud: input.candidateOrderAud,
    ticker: evidenceEntry(tickers),
    depth: depthManifest.sort((left, right) =>
      left.sourceId.localeCompare(right.sourceId),
    ),
    candles: candleManifest.sort((left, right) =>
      left.sourceId.localeCompare(right.sourceId),
    ),
    conversionQuoteDigests: [
      ...new Set(input.conversionQuotes.map((quote) => quote.payloadSha256)),
    ].sort(),
  };
  for (const digest of manifestContent.conversionQuoteDigests) {
    assertDigest("conversion quote digest", digest);
  }
  const manifestSha256 = await sha256Hex(canonicalJson(manifestContent));
  const qualityManifest: KrakenQualityManifest = {
    ...manifestContent,
    manifestSha256,
  };

  const batch = await dependencies.repository.persistBatch({
    venue: "kraken",
    recordedAtMs,
    maximumAudQuoteAgeMs: input.maximumAudQuoteAgeMs,
    metadataSource: {
      sourceId: metadata.sourceId,
      sourceKind: "venue-metadata",
      sourceRef: metadata.sourceRef,
      fetchedAtMs: metadata.fetchedAtMs,
      payloadSha256: metadata.payloadSha256,
    },
    qualitySource: {
      sourceId: `kraken:quality-manifest:${recordedAtMs}:${manifestSha256.slice(0, 16)}`,
      sourceKind: "venue-market-quality",
      sourceRef: `urn:ai-trading-bot:kraken-quality-manifest:${manifestSha256}`,
      fetchedAtMs: recordedAtMs,
      payloadSha256: manifestSha256,
    },
    conversionQuotes: input.conversionQuotes,
    markets,
    ...(input.lifecycleAnnouncements === undefined
      ? {}
      : { lifecycleAnnouncements: input.lifecycleAnnouncements }),
  });

  return { batch, qualityManifest };
}
