import assert from "node:assert/strict";
import test from "node:test";
import { reconstructUniverseAt } from "../src/universe/reconstruct.ts";
import type {
  MarketDefinition,
  MarketLifecycleEvent,
  MarketQualityObservation,
  UniversePolicy,
} from "../src/universe/types.ts";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
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

function definition(
  pair: string,
  overrides: Partial<MarketDefinition> = {},
): MarketDefinition {
  return {
    definitionId: `definition:${pair}`,
    venue: "kraken",
    canonicalPair: pair,
    exchangePair: pair.replace("/", ""),
    baseAsset: pair.split("/")[0] ?? "UNKNOWN",
    quoteAsset: "AUD",
    instrumentKind: "spot",
    availableAtMs: AS_OF - 365 * DAY_MS,
    sourceRef: `source:${pair}`,
    payloadSha256: DIGEST,
    ...overrides,
  };
}

function event(
  pair: string,
  eventType: MarketLifecycleEvent["eventType"],
  effectiveAtMs: number,
  overrides: Partial<MarketLifecycleEvent> = {},
): MarketLifecycleEvent {
  return {
    eventId: `${pair}:${eventType}:${effectiveAtMs}`,
    venue: "kraken",
    canonicalPair: pair,
    eventType,
    effectiveAtMs,
    publishedAtMs: effectiveAtMs,
    recordedAtMs: effectiveAtMs + HOUR_MS,
    sourceRef: `event-source:${pair}:${eventType}`,
    payloadSha256: DIGEST,
    ...overrides,
  };
}

function lifecycle(pair: string, listedAtMs: number): MarketLifecycleEvent[] {
  return [
    event(pair, "listed", listedAtMs),
    event(pair, "trading-online", listedAtMs),
    event(pair, "au-enabled", listedAtMs),
  ];
}

function observation(
  pair: string,
  overrides: Partial<MarketQualityObservation> = {},
): MarketQualityObservation {
  return {
    observationId: `observation:${pair}`,
    venue: "kraken",
    canonicalPair: pair,
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

test("reconstructs established, high-volatility and new-listing tiers", () => {
  const snapshot = reconstructUniverseAt(
    AS_OF,
    [definition("BTC/AUD"), definition("VOL/AUD"), definition("NEW/AUD")],
    [
      ...lifecycle("BTC/AUD", AS_OF - 365 * DAY_MS),
      ...lifecycle("VOL/AUD", AS_OF - 250 * DAY_MS),
      ...lifecycle("NEW/AUD", AS_OF - 10 * DAY_MS),
    ],
    [
      observation("BTC/AUD"),
      observation("VOL/AUD", { annualisedVolatility: 2.2 }),
      observation("NEW/AUD", {
        dailyCommittedCandles: 10,
        hourlyCommittedCandles: 120,
        quoteTurnoverAud24h: 200_000,
        availableQuoteVolumeAud: 20_000,
        spreadBps: 120,
        estimatedImpactBps: 80,
      }),
    ],
    policy,
  );

  assert.deepEqual(snapshot.eligiblePairs, ["BTC/AUD", "NEW/AUD", "VOL/AUD"]);
  assert.equal(
    snapshot.candidates.find((candidate) => candidate.canonicalPair === "BTC/AUD")?.tier,
    "established",
  );
  assert.equal(
    snapshot.candidates.find((candidate) => candidate.canonicalPair === "VOL/AUD")?.tier,
    "high-volatility",
  );
  assert.equal(
    snapshot.candidates.find((candidate) => candidate.canonicalPair === "NEW/AUD")?.tier,
    "new-listing",
  );
});

test("published-time reconstruction excludes later-known suspension from earlier snapshots", () => {
  const pair = "HIST/AUD";
  const listedAt = AS_OF - 365 * DAY_MS;
  const suspension = event(pair, "trading-suspended", AS_OF - 2 * HOUR_MS, {
    publishedAtMs: AS_OF + HOUR_MS,
    recordedAtMs: AS_OF + 2 * HOUR_MS,
  });
  const earlier = reconstructUniverseAt(
    AS_OF,
    [definition(pair)],
    [...lifecycle(pair, listedAt), suspension],
    [observation(pair)],
    policy,
  );
  assert.equal(earlier.candidates[0]?.eligible, true);

  const later = reconstructUniverseAt(
    AS_OF + 3 * HOUR_MS,
    [definition(pair)],
    [...lifecycle(pair, listedAt), suspension],
    [
      observation(pair, {
        observedAtMs: AS_OF + 2 * HOUR_MS,
        availableAtMs: AS_OF + 2 * HOUR_MS,
      }),
    ],
    policy,
  );
  assert.equal(later.candidates[0]?.eligible, false);
  assert.ok(later.candidates[0]?.reasons.includes("not-online-at-signal-time"));
});

test("delisted and Australian-disabled markets remain in history but are ineligible", () => {
  const pair = "OLD/AUD";
  const listedAt = AS_OF - 365 * DAY_MS;
  const snapshot = reconstructUniverseAt(
    AS_OF,
    [definition(pair)],
    [
      ...lifecycle(pair, listedAt),
      event(pair, "au-disabled", AS_OF - 2 * DAY_MS),
      event(pair, "delisted", AS_OF - DAY_MS),
    ],
    [observation(pair)],
    policy,
  );
  const candidate = snapshot.candidates[0];
  assert.equal(candidate?.eligible, false);
  assert.ok(candidate?.reasons.includes("delisted-at-signal-time"));
  assert.ok(candidate?.reasons.includes("not-available-in-australia"));
});

test("a later published relisting starts a new listing era", () => {
  const pair = "RELIST/AUD";
  const firstListing = AS_OF - 400 * DAY_MS;
  const relistedAt = AS_OF - 10 * DAY_MS;
  const snapshot = reconstructUniverseAt(
    AS_OF,
    [definition(pair)],
    [
      ...lifecycle(pair, firstListing),
      event(pair, "delisted", AS_OF - 60 * DAY_MS),
      event(pair, "listed", relistedAt),
      event(pair, "trading-resumed", relistedAt),
      event(pair, "au-enabled", relistedAt),
    ],
    [
      observation(pair, {
        dailyCommittedCandles: 10,
        hourlyCommittedCandles: 120,
        quoteTurnoverAud24h: 200_000,
        availableQuoteVolumeAud: 20_000,
        spreadBps: 120,
        estimatedImpactBps: 80,
      }),
    ],
    policy,
  );
  assert.equal(snapshot.candidates[0]?.eligible, true);
  assert.equal(snapshot.candidates[0]?.tier, "new-listing");
  assert.equal(snapshot.candidates[0]?.lifecycle.listedAtMs, relistedAt);
  assert.equal(snapshot.candidates[0]?.lifecycle.delistedAtMs, undefined);
});

test("instrument, valuation, data, order and liquidity gates fail closed", () => {
  const pair = "BAD/AUD";
  const snapshot = reconstructUniverseAt(
    AS_OF,
    [definition(pair, { instrumentKind: "leveraged-token" })],
    lifecycle(pair, AS_OF - 365 * DAY_MS),
    [
      observation(pair, {
        availableAtMs: AS_OF - 3 * HOUR_MS,
        observedAtMs: AS_OF - 3 * HOUR_MS - 1,
        spreadBps: 500,
        quoteTurnoverAud24h: 10,
        availableQuoteVolumeAud: 10,
        estimatedImpactBps: 500,
        minimumOrderAud: 500,
        audValuationComplete: false,
        dataQualityState: "conflict",
      }),
    ],
    policy,
  );
  const reasons = snapshot.candidates[0]?.reasons ?? [];
  for (const expected of [
    "unsupported-instrument-kind",
    "stale-quality-observation",
    "missing-aud-valuation-path",
    "unresolved-market-data-state",
    "candidate-order-below-venue-minimum",
    "insufficient-quote-turnover",
    "insufficient-execution-depth",
    "spread-too-wide",
    "estimated-impact-too-high",
  ]) {
    assert.ok(reasons.includes(expected), `missing ${expected}`);
  }
});

test("assets between the new-listing and established windows are not silently promoted", () => {
  const pair = "MIDAGE/AUD";
  const snapshot = reconstructUniverseAt(
    AS_OF,
    [definition(pair)],
    lifecycle(pair, AS_OF - 90 * DAY_MS),
    [observation(pair)],
    policy,
  );
  assert.equal(snapshot.candidates[0]?.eligible, false);
  assert.ok(
    snapshot.candidates[0]?.reasons.includes(
      "listing-age-between-research-tiers",
    ),
  );
});

test("future definitions and future-available observations cannot enter the snapshot", () => {
  const pair = "FUTURE/AUD";
  const hiddenDefinition = reconstructUniverseAt(
    AS_OF,
    [definition(pair, { availableAtMs: AS_OF + HOUR_MS })],
    lifecycle(pair, AS_OF - 365 * DAY_MS),
    [observation(pair)],
    policy,
  );
  assert.equal(hiddenDefinition.candidates.length, 0);

  const hiddenObservation = reconstructUniverseAt(
    AS_OF,
    [definition(pair)],
    lifecycle(pair, AS_OF - 365 * DAY_MS),
    [observation(pair, { availableAtMs: AS_OF + HOUR_MS })],
    policy,
  );
  assert.ok(
    hiddenObservation.candidates[0]?.reasons.includes(
      "missing-quality-observation",
    ),
  );
});

test("conflicting immutable identities and malformed chronology fail closed", () => {
  const pair = "CONFLICT/AUD";
  assert.throws(
    () =>
      reconstructUniverseAt(
        AS_OF,
        [
          definition(pair),
          definition(pair, {
            definitionId: `definition:${pair}`,
            payloadSha256: "b".repeat(64),
          }),
        ],
        lifecycle(pair, AS_OF - 365 * DAY_MS),
        [observation(pair)],
        policy,
      ),
    /conflicting payloads/,
  );

  assert.throws(
    () =>
      reconstructUniverseAt(
        AS_OF,
        [definition(pair)],
        [
          event(pair, "listed", AS_OF - DAY_MS, {
            publishedAtMs: AS_OF,
            recordedAtMs: AS_OF - 1,
          }),
        ],
        [observation(pair)],
        policy,
      ),
    /recorded before publication/,
  );

  assert.throws(
    () =>
      reconstructUniverseAt(
        AS_OF,
        [
          definition(pair),
          definition(pair, {
            definitionId: "another-definition-id",
            payloadSha256: "c".repeat(64),
          }),
        ],
        lifecycle(pair, AS_OF - 365 * DAY_MS),
        [observation(pair)],
        policy,
      ),
    /Definition natural identity/,
  );

  assert.throws(
    () =>
      reconstructUniverseAt(
        AS_OF,
        [definition(pair)],
        [
          ...lifecycle(pair, AS_OF - 365 * DAY_MS),
          event(pair, "trading-suspended", AS_OF - HOUR_MS),
          event(pair, "trading-resumed", AS_OF - HOUR_MS, {
            publishedAtMs: AS_OF - HOUR_MS,
            recordedAtMs: AS_OF,
          }),
        ],
        [observation(pair)],
        policy,
      ),
    /ambiguous simultaneous states/,
  );
});
