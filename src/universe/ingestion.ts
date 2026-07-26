import { sha256Hex } from "../utils/crypto.ts";
import type {
  InstrumentKind,
  MarketDataQualityState,
  MarketDefinition,
  MarketLifecycleEvent,
  MarketLifecycleEventType,
  MarketQualityObservation,
  UniverseTier,
} from "./types.ts";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const EPSILON = 1e-12;

export type UniverseSourceKind =
  | "venue-metadata"
  | "venue-market-quality"
  | "official-lifecycle-announcement"
  | "aud-conversion";

export interface UniverseSourceEvidence {
  readonly sourceId: string;
  readonly sourceKind: UniverseSourceKind;
  readonly sourceRef: string;
  readonly fetchedAtMs: number;
  readonly payloadSha256: string;
}

export interface AudConversionQuote {
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly rate: number;
  readonly observedAtMs: number;
  readonly availableAtMs: number;
  readonly payloadSha256: string;
}

export interface AudValuationPath {
  readonly sourceAsset: string;
  readonly rateToAud: number;
  readonly assets: readonly string[];
  readonly sourceDigests: readonly string[];
}

export interface VenueMarketObservationInput {
  readonly canonicalPair: string;
  readonly exchangePair: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly instrumentKind: InstrumentKind;
  readonly observedAtMs: number;
  readonly availableAtMs: number;
  readonly spreadBps: number;
  readonly quoteTurnover24h: number;
  readonly availableQuoteVolume: number;
  readonly estimatedImpactBps: number;
  readonly minimumOrderQuote: number;
  readonly dailyCommittedCandles: number;
  readonly hourlyCommittedCandles: number;
  readonly annualisedVolatility: number;
  readonly dataQualityState: MarketDataQualityState;
}

export interface LifecycleAnnouncementInput {
  readonly canonicalPair: string;
  readonly eventType: MarketLifecycleEventType;
  readonly effectiveAtMs: number;
  readonly publishedAtMs: number;
}

export interface UniverseIngestionInput {
  readonly venue: string;
  readonly recordedAtMs: number;
  readonly maximumAudQuoteAgeMs: number;
  readonly metadataSource: UniverseSourceEvidence;
  readonly qualitySource: UniverseSourceEvidence;
  readonly conversionQuotes: readonly AudConversionQuote[];
  readonly markets: readonly VenueMarketObservationInput[];
  readonly lifecycleAnnouncements?: readonly {
    readonly source: UniverseSourceEvidence;
    readonly announcement: LifecycleAnnouncementInput;
  }[];
}

export interface UniverseIngestionBatch {
  readonly venue: string;
  readonly recordedAtMs: number;
  readonly definitions: readonly MarketDefinition[];
  readonly lifecycleEvents: readonly MarketLifecycleEvent[];
  readonly observations: readonly MarketQualityObservation[];
  readonly sourceDigests: readonly string[];
  readonly batchSha256: string;
}

export interface UniverseCalibrationSample {
  readonly venue: string;
  readonly canonicalPair: string;
  readonly tier: UniverseTier;
  readonly observedAtMs: number;
  readonly equityAud: number;
  readonly spreadBps: number;
  readonly quoteTurnoverAud24h: number;
  readonly availableQuoteVolumeAud: number;
  readonly estimatedImpactBps: number;
  readonly payloadSha256: string;
}

export interface UniverseTierCalibrationSummary {
  readonly tier: UniverseTier;
  readonly sampleCount: number;
  readonly distinctPairCount: number;
  readonly observedFromMs: number;
  readonly observedToMs: number;
  readonly equityAud: { readonly minimum: number; readonly maximum: number };
  readonly spreadBps: { readonly p50: number; readonly p90: number };
  readonly quoteTurnoverAud24h: { readonly p10: number; readonly p50: number };
  readonly availableQuoteVolumeAud: { readonly p10: number; readonly p50: number };
  readonly estimatedImpactBps: { readonly p50: number; readonly p90: number };
  readonly evidenceSha256: string;
}

function assertCanonical(name: string, value: string): void {
  if (value.trim() !== value || value.length === 0) {
    throw new Error(`${name} must be a non-empty canonical string`);
  }
}

function assertTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be finite and non-negative`);
  }
}

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be finite and positive`);
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

function validateSource(source: UniverseSourceEvidence, recordedAtMs: number): void {
  assertCanonical("sourceId", source.sourceId);
  assertCanonical("sourceRef", source.sourceRef);
  assertTime("source fetchedAtMs", source.fetchedAtMs);
  assertDigest("source payloadSha256", source.payloadSha256);
  if (source.fetchedAtMs > recordedAtMs) {
    throw new Error("Source cannot be fetched after recordedAtMs");
  }
}

interface ConversionEdge {
  readonly from: string;
  readonly to: string;
  readonly rate: number;
  readonly digest: string;
}

function conversionEdges(
  quotes: readonly AudConversionQuote[],
  asOfMs: number,
  maximumAgeMs: number,
): readonly ConversionEdge[] {
  assertTime("asOfMs", asOfMs);
  assertTime("maximumAudQuoteAgeMs", maximumAgeMs);
  const identities = new Set<string>();
  const edges: ConversionEdge[] = [];
  for (const quote of quotes) {
    assertCanonical("conversion baseAsset", quote.baseAsset);
    assertCanonical("conversion quoteAsset", quote.quoteAsset);
    assertPositive("conversion rate", quote.rate);
    assertTime("conversion observedAtMs", quote.observedAtMs);
    assertTime("conversion availableAtMs", quote.availableAtMs);
    assertDigest("conversion payloadSha256", quote.payloadSha256);
    if (quote.baseAsset === quote.quoteAsset) {
      throw new Error("Conversion assets must differ");
    }
    const identity = `${quote.baseAsset}/${quote.quoteAsset}@${quote.observedAtMs}`;
    if (identities.has(identity)) throw new Error(`Duplicate conversion quote ${identity}`);
    identities.add(identity);
    if (
      quote.availableAtMs > asOfMs ||
      quote.observedAtMs > asOfMs ||
      asOfMs - quote.observedAtMs > maximumAgeMs
    ) {
      continue;
    }
    edges.push(
      {
        from: quote.baseAsset,
        to: quote.quoteAsset,
        rate: quote.rate,
        digest: quote.payloadSha256,
      },
      {
        from: quote.quoteAsset,
        to: quote.baseAsset,
        rate: 1 / quote.rate,
        digest: quote.payloadSha256,
      },
    );
  }
  return edges.sort((left, right) =>
    `${left.from}:${left.to}:${left.digest}`.localeCompare(
      `${right.from}:${right.to}:${right.digest}`,
    ),
  );
}

export function resolveAudValuationPath(
  sourceAsset: string,
  quotes: readonly AudConversionQuote[],
  asOfMs: number,
  maximumAgeMs: number,
  maximumHops = 3,
): AudValuationPath {
  assertCanonical("sourceAsset", sourceAsset);
  if (!Number.isInteger(maximumHops) || maximumHops < 1 || maximumHops > 4) {
    throw new Error("maximumHops must be an integer between 1 and 4");
  }
  if (sourceAsset === "AUD") {
    return { sourceAsset, rateToAud: 1, assets: ["AUD"], sourceDigests: [] };
  }
  const edges = conversionEdges(quotes, asOfMs, maximumAgeMs);
  type Candidate = {
    asset: string;
    rate: number;
    assets: string[];
    digests: string[];
  };
  let frontier: Candidate[] = [
    { asset: sourceAsset, rate: 1, assets: [sourceAsset], digests: [] },
  ];
  for (let hop = 1; hop <= maximumHops; hop += 1) {
    const next: Candidate[] = [];
    const matches: Candidate[] = [];
    for (const candidate of frontier) {
      for (const edge of edges) {
        if (edge.from !== candidate.asset || candidate.assets.includes(edge.to)) continue;
        const extended: Candidate = {
          asset: edge.to,
          rate: candidate.rate * edge.rate,
          assets: [...candidate.assets, edge.to],
          digests: [...candidate.digests, edge.digest],
        };
        if (edge.to === "AUD") matches.push(extended);
        else next.push(extended);
      }
    }
    if (matches.length === 1) {
      const match = matches[0];
      if (match === undefined) throw new Error("AUD valuation path missing");
      return {
        sourceAsset,
        rateToAud: match.rate,
        assets: match.assets,
        sourceDigests: [...new Set(match.digests)].sort(),
      };
    }
    if (matches.length > 1) {
      const baseline = matches[0]?.rate;
      if (baseline === undefined) throw new Error("AUD valuation path missing");
      const materiallyDifferent = matches.some(
        (match) => Math.abs(match.rate / baseline - 1) > EPSILON,
      );
      throw new Error(
        materiallyDifferent
          ? `Ambiguous AUD valuation paths for ${sourceAsset} disagree`
          : `Ambiguous AUD valuation paths for ${sourceAsset}`,
      );
    }
    frontier = next;
  }
  throw new Error(`No fresh AUD valuation path for ${sourceAsset}`);
}

function validateMarket(
  market: VenueMarketObservationInput,
  recordedAtMs: number,
): void {
  assertCanonical("canonicalPair", market.canonicalPair);
  assertCanonical("exchangePair", market.exchangePair);
  assertCanonical("baseAsset", market.baseAsset);
  assertCanonical("quoteAsset", market.quoteAsset);
  assertTime("market observedAtMs", market.observedAtMs);
  assertTime("market availableAtMs", market.availableAtMs);
  if (market.observedAtMs > market.availableAtMs || market.availableAtMs > recordedAtMs) {
    throw new Error(`${market.canonicalPair} has invalid observation chronology`);
  }
  assertNonNegative("spreadBps", market.spreadBps);
  assertNonNegative("quoteTurnover24h", market.quoteTurnover24h);
  assertNonNegative("availableQuoteVolume", market.availableQuoteVolume);
  assertNonNegative("estimatedImpactBps", market.estimatedImpactBps);
  assertNonNegative("minimumOrderQuote", market.minimumOrderQuote);
  assertNonNegative("annualisedVolatility", market.annualisedVolatility);
  if (!Number.isInteger(market.dailyCommittedCandles) || market.dailyCommittedCandles < 0) {
    throw new Error("dailyCommittedCandles must be a non-negative integer");
  }
  if (!Number.isInteger(market.hourlyCommittedCandles) || market.hourlyCommittedCandles < 0) {
    throw new Error("hourlyCommittedCandles must be a non-negative integer");
  }
}

async function prepareDefinition(
  venue: string,
  market: VenueMarketObservationInput,
  source: UniverseSourceEvidence,
): Promise<MarketDefinition> {
  const content = {
    venue,
    canonicalPair: market.canonicalPair,
    exchangePair: market.exchangePair,
    baseAsset: market.baseAsset,
    quoteAsset: market.quoteAsset,
    instrumentKind: market.instrumentKind,
    availableAtMs: market.availableAtMs,
    sourceRef: source.sourceRef,
    sourcePayloadSha256: source.payloadSha256,
  };
  const payloadSha256 = await sha256Hex(canonicalJson(content));
  return {
    definitionId: `definition:${venue}:${market.canonicalPair}:${market.availableAtMs}:${payloadSha256.slice(0, 16)}`,
    venue,
    canonicalPair: market.canonicalPair,
    exchangePair: market.exchangePair,
    baseAsset: market.baseAsset,
    quoteAsset: market.quoteAsset,
    instrumentKind: market.instrumentKind,
    availableAtMs: market.availableAtMs,
    sourceRef: source.sourceRef,
    payloadSha256,
  };
}

async function prepareObservation(
  venue: string,
  market: VenueMarketObservationInput,
  source: UniverseSourceEvidence,
  valuation: AudValuationPath,
): Promise<MarketQualityObservation> {
  const quoteTurnoverAud24h = market.quoteTurnover24h * valuation.rateToAud;
  const availableQuoteVolumeAud =
    market.availableQuoteVolume * valuation.rateToAud;
  const minimumOrderAud = market.minimumOrderQuote * valuation.rateToAud;
  const content = {
    venue,
    canonicalPair: market.canonicalPair,
    observedAtMs: market.observedAtMs,
    availableAtMs: market.availableAtMs,
    spreadBps: market.spreadBps,
    quoteTurnoverAud24h,
    availableQuoteVolumeAud,
    estimatedImpactBps: market.estimatedImpactBps,
    minimumOrderAud,
    dailyCommittedCandles: market.dailyCommittedCandles,
    hourlyCommittedCandles: market.hourlyCommittedCandles,
    annualisedVolatility: market.annualisedVolatility,
    dataQualityState: market.dataQualityState,
    valuationAssets: valuation.assets,
    valuationSourceDigests: valuation.sourceDigests,
    sourcePayloadSha256: source.payloadSha256,
  };
  const payloadSha256 = await sha256Hex(canonicalJson(content));
  return {
    observationId: `observation:${venue}:${market.canonicalPair}:${market.observedAtMs}:${payloadSha256.slice(0, 16)}`,
    venue,
    canonicalPair: market.canonicalPair,
    observedAtMs: market.observedAtMs,
    availableAtMs: market.availableAtMs,
    spreadBps: market.spreadBps,
    quoteTurnoverAud24h,
    availableQuoteVolumeAud,
    estimatedImpactBps: market.estimatedImpactBps,
    minimumOrderAud,
    audValuationComplete: true,
    dailyCommittedCandles: market.dailyCommittedCandles,
    hourlyCommittedCandles: market.hourlyCommittedCandles,
    annualisedVolatility: market.annualisedVolatility,
    dataQualityState: market.dataQualityState,
    payloadSha256,
  };
}

async function prepareLifecycleEvent(
  venue: string,
  recordedAtMs: number,
  source: UniverseSourceEvidence,
  announcement: LifecycleAnnouncementInput,
): Promise<MarketLifecycleEvent> {
  assertCanonical("lifecycle canonicalPair", announcement.canonicalPair);
  assertTime("lifecycle effectiveAtMs", announcement.effectiveAtMs);
  assertTime("lifecycle publishedAtMs", announcement.publishedAtMs);
  if (
    announcement.effectiveAtMs > announcement.publishedAtMs ||
    announcement.publishedAtMs > source.fetchedAtMs ||
    source.fetchedAtMs > recordedAtMs
  ) {
    throw new Error(`${announcement.canonicalPair} has invalid lifecycle chronology`);
  }
  if (source.sourceKind !== "official-lifecycle-announcement") {
    throw new Error("Lifecycle events require official-lifecycle-announcement evidence");
  }
  const content = {
    venue,
    canonicalPair: announcement.canonicalPair,
    eventType: announcement.eventType,
    effectiveAtMs: announcement.effectiveAtMs,
    publishedAtMs: announcement.publishedAtMs,
    recordedAtMs,
    sourceRef: source.sourceRef,
    sourcePayloadSha256: source.payloadSha256,
  };
  const payloadSha256 = await sha256Hex(canonicalJson(content));
  return {
    eventId: `event:${venue}:${announcement.canonicalPair}:${announcement.eventType}:${announcement.effectiveAtMs}:${payloadSha256.slice(0, 16)}`,
    venue,
    canonicalPair: announcement.canonicalPair,
    eventType: announcement.eventType,
    effectiveAtMs: announcement.effectiveAtMs,
    publishedAtMs: announcement.publishedAtMs,
    recordedAtMs,
    sourceRef: source.sourceRef,
    payloadSha256,
  };
}

export async function prepareUniverseIngestionBatch(
  input: UniverseIngestionInput,
): Promise<UniverseIngestionBatch> {
  assertCanonical("venue", input.venue);
  assertTime("recordedAtMs", input.recordedAtMs);
  assertTime("maximumAudQuoteAgeMs", input.maximumAudQuoteAgeMs);
  validateSource(input.metadataSource, input.recordedAtMs);
  validateSource(input.qualitySource, input.recordedAtMs);
  if (input.metadataSource.sourceKind !== "venue-metadata") {
    throw new Error("metadataSource must use venue-metadata");
  }
  if (input.qualitySource.sourceKind !== "venue-market-quality") {
    throw new Error("qualitySource must use venue-market-quality");
  }
  const marketIds = new Set<string>();
  const sortedMarkets = [...input.markets].sort((left, right) =>
    left.canonicalPair.localeCompare(right.canonicalPair),
  );
  const definitions: MarketDefinition[] = [];
  const observations: MarketQualityObservation[] = [];
  const sourceDigests = new Set<string>([
    input.metadataSource.payloadSha256,
    input.qualitySource.payloadSha256,
  ]);
  for (const market of sortedMarkets) {
    validateMarket(market, input.recordedAtMs);
    if (marketIds.has(market.canonicalPair)) {
      throw new Error(`Duplicate market ${market.canonicalPair}`);
    }
    marketIds.add(market.canonicalPair);
    const valuation = resolveAudValuationPath(
      market.quoteAsset,
      input.conversionQuotes,
      market.observedAtMs,
      input.maximumAudQuoteAgeMs,
    );
    for (const digest of valuation.sourceDigests) sourceDigests.add(digest);
    definitions.push(
      await prepareDefinition(input.venue, market, input.metadataSource),
    );
    observations.push(
      await prepareObservation(input.venue, market, input.qualitySource, valuation),
    );
  }

  const lifecycleEvents: MarketLifecycleEvent[] = [];
  const lifecycleIdentities = new Set<string>();
  for (const item of [...(input.lifecycleAnnouncements ?? [])].sort((left, right) =>
    `${left.announcement.canonicalPair}:${left.announcement.effectiveAtMs}:${left.announcement.eventType}`.localeCompare(
      `${right.announcement.canonicalPair}:${right.announcement.effectiveAtMs}:${right.announcement.eventType}`,
    ),
  )) {
    validateSource(item.source, input.recordedAtMs);
    const identity = `${item.announcement.canonicalPair}:${item.announcement.effectiveAtMs}:${item.announcement.eventType}`;
    if (lifecycleIdentities.has(identity)) {
      throw new Error(`Duplicate lifecycle announcement ${identity}`);
    }
    lifecycleIdentities.add(identity);
    sourceDigests.add(item.source.payloadSha256);
    lifecycleEvents.push(
      await prepareLifecycleEvent(
        input.venue,
        input.recordedAtMs,
        item.source,
        item.announcement,
      ),
    );
  }

  const canonical = {
    venue: input.venue,
    recordedAtMs: input.recordedAtMs,
    definitions,
    lifecycleEvents,
    observations,
    sourceDigests: [...sourceDigests].sort(),
  };
  return {
    ...canonical,
    batchSha256: await sha256Hex(canonicalJson(canonical)),
  };
}

function percentile(sorted: readonly number[], probability: number): number {
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined) {
    throw new Error("Calibration percentile failed");
  }
  return lower + (upper - lower) * (position - lowerIndex);
}

export async function summariseUniverseCalibration(
  tier: UniverseTier,
  samples: readonly UniverseCalibrationSample[],
  minimumSamples: number,
): Promise<UniverseTierCalibrationSummary> {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 2) {
    throw new Error("minimumSamples must be an integer of at least 2");
  }
  const filtered = samples
    .filter((sample) => sample.tier === tier)
    .sort((left, right) =>
      `${left.observedAtMs}:${left.venue}:${left.canonicalPair}:${left.payloadSha256}`.localeCompare(
        `${right.observedAtMs}:${right.venue}:${right.canonicalPair}:${right.payloadSha256}`,
      ),
    );
  if (filtered.length < minimumSamples) {
    throw new Error(`${tier} calibration requires at least ${minimumSamples} samples`);
  }
  const identities = new Set<string>();
  for (const sample of filtered) {
    assertCanonical("calibration venue", sample.venue);
    assertCanonical("calibration canonicalPair", sample.canonicalPair);
    assertTime("calibration observedAtMs", sample.observedAtMs);
    assertPositive("calibration equityAud", sample.equityAud);
    assertNonNegative("calibration spreadBps", sample.spreadBps);
    assertNonNegative(
      "calibration quoteTurnoverAud24h",
      sample.quoteTurnoverAud24h,
    );
    assertNonNegative(
      "calibration availableQuoteVolumeAud",
      sample.availableQuoteVolumeAud,
    );
    assertNonNegative("calibration estimatedImpactBps", sample.estimatedImpactBps);
    assertDigest("calibration payloadSha256", sample.payloadSha256);
    const identity = `${sample.venue}:${sample.canonicalPair}:${sample.observedAtMs}:${sample.payloadSha256}`;
    if (identities.has(identity)) {
      throw new Error(`Duplicate calibration sample ${identity}`);
    }
    identities.add(identity);
  }
  const values = (selector: (sample: UniverseCalibrationSample) => number) =>
    filtered.map(selector).sort((left, right) => left - right);
  const spread = values((sample) => sample.spreadBps);
  const turnover = values((sample) => sample.quoteTurnoverAud24h);
  const depth = values((sample) => sample.availableQuoteVolumeAud);
  const impact = values((sample) => sample.estimatedImpactBps);
  const equity = values((sample) => sample.equityAud);
  const evidenceSha256 = await sha256Hex(canonicalJson(filtered));
  return {
    tier,
    sampleCount: filtered.length,
    distinctPairCount: new Set(
      filtered.map((sample) => `${sample.venue}:${sample.canonicalPair}`),
    ).size,
    observedFromMs: filtered[0]?.observedAtMs ?? 0,
    observedToMs: filtered.at(-1)?.observedAtMs ?? 0,
    equityAud: { minimum: equity[0] ?? 0, maximum: equity.at(-1) ?? 0 },
    spreadBps: {
      p50: percentile(spread, 0.5),
      p90: percentile(spread, 0.9),
    },
    quoteTurnoverAud24h: {
      p10: percentile(turnover, 0.1),
      p50: percentile(turnover, 0.5),
    },
    availableQuoteVolumeAud: {
      p10: percentile(depth, 0.1),
      p50: percentile(depth, 0.5),
    },
    estimatedImpactBps: {
      p50: percentile(impact, 0.5),
      p90: percentile(impact, 0.9),
    },
    evidenceSha256,
  };
}
