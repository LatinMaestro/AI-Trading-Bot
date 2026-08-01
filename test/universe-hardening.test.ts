import assert from "node:assert/strict";
import test from "node:test";
import { reconstructUniverseAt } from "../src/universe/index.ts";
import type {
  MarketDefinition,
  MarketLifecycleEvent,
  MarketQualityObservation,
  UniversePolicy,
} from "../src/universe/types.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const AS_OF = Date.UTC(2026, 6, 26, 8);
const DIGEST = "a".repeat(64);

const policy: UniversePolicy = {
  venue: "kraken",
  countryCode: "AU",
  candidateOrderAud: 100,
  maximumObservationAgeMs: 2 * HOUR_MS,
  newListingMaximumAgeMs: 30 * DAY_MS,
  newListingMinimumHourlyCandles: 48,
  establishedMinimumAgeMs: 180 * DAY_MS,
  establishedMinimumDailyCandles: 180,
  establishedMinimumHourlyCandles: 1_000,
  highVolatilityAnnualisedThreshold: 1.5,
  tierLimits: {
    established: {
      minimumQuoteTurnoverAud24h: 500_000,
      minimumAvailableQuoteVolumeAud: 50_000,
      maximumSpreadBps: 50,
      maximumEstimatedImpactBps: 30,
    },
    "high-volatility": {
      minimumQuoteTurnoverAud24h: 250_000,
      minimumAvailableQuoteVolumeAud: 25_000,
      maximumSpreadBps: 100,
      maximumEstimatedImpactBps: 60,
    },
    "new-listing": {
      minimumQuoteTurnoverAud24h: 100_000,
      minimumAvailableQuoteVolumeAud: 10_000,
      maximumSpreadBps: 150,
      maximumEstimatedImpactBps: 100,
    },
  },
};

const definition: MarketDefinition = {
  definitionId: "definition:BTC/AUD",
  venue: "kraken",
  canonicalPair: "BTC/AUD",
  exchangePair: "XBTAUD",
  baseAsset: "BTC",
  quoteAsset: "AUD",
  instrumentKind: "spot",
  availableAtMs: AS_OF - 365 * DAY_MS,
  sourceRef: "asset-pairs",
  payloadSha256: DIGEST,
};

const events: MarketLifecycleEvent[] = [
  "listed",
  "trading-online",
  "au-enabled",
].map((eventType) => ({
  eventId: `event:${eventType}`,
  venue: "kraken",
  canonicalPair: "BTC/AUD",
  eventType: eventType as MarketLifecycleEvent["eventType"],
  effectiveAtMs: AS_OF - 365 * DAY_MS,
  publishedAtMs: AS_OF - 365 * DAY_MS,
  recordedAtMs: AS_OF - 365 * DAY_MS + 1,
  sourceRef: `source:${eventType}`,
  payloadSha256: DIGEST,
}));

function observation(
  overrides: Partial<MarketQualityObservation> = {},
): MarketQualityObservation {
  return {
    observationId: "observation:BTC/AUD",
    venue: "kraken",
    canonicalPair: "BTC/AUD",
    observedAtMs: AS_OF - HOUR_MS,
    availableAtMs: AS_OF - HOUR_MS + 1,
    spreadBps: 20,
    quoteTurnoverAud24h: 1_000_000,
    availableQuoteVolumeAud: 100_000,
    estimatedImpactBps: 10,
    minimumOrderAud: 10,
    audValuationComplete: true,
    dailyCommittedCandles: 365,
    hourlyCommittedCandles: 2_000,
    annualisedVolatility: 0.8,
    dataQualityState: "complete",
    payloadSha256: DIGEST,
    ...overrides,
  };
}

test("delayed ingestion cannot make an old market observation appear fresh", () => {
  const snapshot = reconstructUniverseAt(
    AS_OF,
    [definition],
    events,
    [
      observation({
        observedAtMs: AS_OF - 4 * HOUR_MS,
        availableAtMs: AS_OF - 1,
      }),
    ],
    policy,
  );
  assert.equal(snapshot.candidates[0]?.eligible, false);
  assert.ok(
    snapshot.candidates[0]?.reasons.includes("stale-quality-observation"),
  );
});

test("fractional timestamps and candle counts fail closed", () => {
  assert.throws(
    () =>
      reconstructUniverseAt(
        AS_OF + 0.5,
        [definition],
        events,
        [observation()],
        policy,
      ),
    /asOfMs must be a non-negative integer/,
  );
  assert.throws(
    () =>
      reconstructUniverseAt(
        AS_OF,
        [definition],
        events,
        [observation({ hourlyCommittedCandles: 2_000.5 })],
        policy,
      ),
    /hourlyCommittedCandles must be a non-negative integer/,
  );
});
