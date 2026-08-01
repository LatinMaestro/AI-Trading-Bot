import type {
  MarketDefinition,
  MarketLifecycleEvent,
  MarketQualityObservation,
  UniverseCandidate,
  UniverseLifecycleState,
  UniversePolicy,
  UniverseSnapshot,
  UniverseTier,
  UniverseTierLimits,
} from "./types.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/;
const EPSILON = 1e-9;
const INSTRUMENT_KINDS = new Set([
  "spot",
  "leveraged-token",
  "inverse-token",
  "derivative-wrapper",
  "unknown",
]);
const LIFECYCLE_EVENT_TYPES = new Set([
  "listed",
  "trading-online",
  "trading-suspended",
  "trading-resumed",
  "delisted",
  "au-enabled",
  "au-disabled",
]);
const LIFECYCLE_EVENT_ORDER: Record<
  MarketLifecycleEvent["eventType"],
  number
> = {
  listed: 0,
  "trading-online": 1,
  "trading-suspended": 1,
  "trading-resumed": 1,
  delisted: 1,
  "au-enabled": 2,
  "au-disabled": 2,
};
const DATA_QUALITY_STATES = new Set([
  "complete",
  "gap",
  "conflict",
  "stale",
  "ambiguous",
]);

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function assertNonNegative(name: string, value: number): void {
  assertFinite(name, value);
  if (value < 0) throw new Error(`${name} cannot be negative`);
}

function assertCanonicalText(name: string, value: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(`${name} must be a non-empty canonical string`);
  }
}

function assertDigest(name: string, value: string): void {
  if (!SHA256_HEX.test(value)) {
    throw new Error(`${name} must be lowercase SHA-256 hex`);
  }
}

function recordKey(...parts: readonly (string | number)[]): string {
  return JSON.stringify(parts);
}

function marketKey(venue: string, canonicalPair: string): string {
  return recordKey(venue, canonicalPair);
}

function validateTierLimits(
  tier: UniverseTier,
  limits: UniverseTierLimits,
): void {
  assertNonNegative(
    `${tier}.minimumQuoteTurnoverAud24h`,
    limits.minimumQuoteTurnoverAud24h,
  );
  assertNonNegative(
    `${tier}.minimumAvailableQuoteVolumeAud`,
    limits.minimumAvailableQuoteVolumeAud,
  );
  assertNonNegative(`${tier}.maximumSpreadBps`, limits.maximumSpreadBps);
  assertNonNegative(
    `${tier}.maximumEstimatedImpactBps`,
    limits.maximumEstimatedImpactBps,
  );
}

function validatePolicy(policy: UniversePolicy): void {
  assertCanonicalText("policy.venue", policy.venue);
  if (policy.countryCode !== "AU") {
    throw new Error("Only AU universe reconstruction is supported");
  }
  assertFinite("policy.candidateOrderAud", policy.candidateOrderAud);
  if (policy.candidateOrderAud <= 0) {
    throw new Error("policy.candidateOrderAud must be positive");
  }
  assertNonNegative(
    "policy.maximumObservationAgeMs",
    policy.maximumObservationAgeMs,
  );
  assertNonNegative(
    "policy.newListingMaximumAgeMs",
    policy.newListingMaximumAgeMs,
  );
  assertNonNegative(
    "policy.newListingMinimumHourlyCandles",
    policy.newListingMinimumHourlyCandles,
  );
  assertNonNegative(
    "policy.establishedMinimumAgeMs",
    policy.establishedMinimumAgeMs,
  );
  assertNonNegative(
    "policy.establishedMinimumDailyCandles",
    policy.establishedMinimumDailyCandles,
  );
  assertNonNegative(
    "policy.establishedMinimumHourlyCandles",
    policy.establishedMinimumHourlyCandles,
  );
  assertNonNegative(
    "policy.highVolatilityAnnualisedThreshold",
    policy.highVolatilityAnnualisedThreshold,
  );
  if (policy.establishedMinimumAgeMs < policy.newListingMaximumAgeMs) {
    throw new Error(
      "Established minimum age cannot be less than new-listing maximum age",
    );
  }
  for (const tier of [
    "established",
    "high-volatility",
    "new-listing",
  ] as const) {
    validateTierLimits(tier, policy.tierLimits[tier]);
  }
}

function validateDefinition(definition: MarketDefinition): void {
  assertCanonicalText("definitionId", definition.definitionId);
  assertCanonicalText("venue", definition.venue);
  assertCanonicalText("canonicalPair", definition.canonicalPair);
  assertCanonicalText("exchangePair", definition.exchangePair);
  assertCanonicalText("baseAsset", definition.baseAsset);
  assertCanonicalText("quoteAsset", definition.quoteAsset);
  assertCanonicalText("sourceRef", definition.sourceRef);
  if (!INSTRUMENT_KINDS.has(definition.instrumentKind)) {
    throw new Error("definition.instrumentKind is invalid");
  }
  assertFinite("definition.availableAtMs", definition.availableAtMs);
  assertDigest("definition.payloadSha256", definition.payloadSha256);
}

function validateLifecycleEvent(event: MarketLifecycleEvent): void {
  assertCanonicalText("eventId", event.eventId);
  assertCanonicalText("event.venue", event.venue);
  assertCanonicalText("event.canonicalPair", event.canonicalPair);
  assertCanonicalText("event.sourceRef", event.sourceRef);
  if (!LIFECYCLE_EVENT_TYPES.has(event.eventType)) {
    throw new Error(`Lifecycle event ${event.eventId} has an invalid type`);
  }
  assertFinite("event.effectiveAtMs", event.effectiveAtMs);
  assertFinite("event.publishedAtMs", event.publishedAtMs);
  assertFinite("event.recordedAtMs", event.recordedAtMs);
  if (event.publishedAtMs > event.recordedAtMs) {
    throw new Error(
      `Lifecycle event ${event.eventId} was recorded before publication`,
    );
  }
  assertDigest("event.payloadSha256", event.payloadSha256);
}

function validateObservation(observation: MarketQualityObservation): void {
  assertCanonicalText("observationId", observation.observationId);
  assertCanonicalText("observation.venue", observation.venue);
  assertCanonicalText("observation.canonicalPair", observation.canonicalPair);
  assertFinite("observation.observedAtMs", observation.observedAtMs);
  assertFinite("observation.availableAtMs", observation.availableAtMs);
  if (observation.observedAtMs > observation.availableAtMs) {
    throw new Error(
      `Observation ${observation.observationId} is available before it was observed`,
    );
  }
  assertNonNegative("observation.spreadBps", observation.spreadBps);
  assertNonNegative(
    "observation.quoteTurnoverAud24h",
    observation.quoteTurnoverAud24h,
  );
  assertNonNegative(
    "observation.availableQuoteVolumeAud",
    observation.availableQuoteVolumeAud,
  );
  assertNonNegative(
    "observation.estimatedImpactBps",
    observation.estimatedImpactBps,
  );
  assertNonNegative("observation.minimumOrderAud", observation.minimumOrderAud);
  assertNonNegative(
    "observation.dailyCommittedCandles",
    observation.dailyCommittedCandles,
  );
  assertNonNegative(
    "observation.hourlyCommittedCandles",
    observation.hourlyCommittedCandles,
  );
  assertNonNegative(
    "observation.annualisedVolatility",
    observation.annualisedVolatility,
  );
  if (!DATA_QUALITY_STATES.has(observation.dataQualityState)) {
    throw new Error(
      `Observation ${observation.observationId} has an invalid data-quality state`,
    );
  }
  assertDigest("observation.payloadSha256", observation.payloadSha256);
}

function assertUniqueIdentity<T>(
  records: readonly T[],
  keyOf: (record: T) => string,
  digestOf: (record: T) => string,
  label: string,
): void {
  const digests = new Map<string, string>();
  for (const record of records) {
    const key = keyOf(record);
    const digest = digestOf(record);
    const existing = digests.get(key);
    if (existing !== undefined && existing !== digest) {
      throw new Error(`${label} identity ${key} has conflicting payloads`);
    }
    digests.set(key, digest);
  }
}

function assertNoAmbiguousLifecycleEvents(
  events: readonly MarketLifecycleEvent[],
): void {
  const stateByMoment = new Map<
    string,
    MarketLifecycleEvent["eventType"]
  >();
  for (const event of events) {
    const dimensions =
      event.eventType === "au-enabled" || event.eventType === "au-disabled"
        ? ["australia"]
        : event.eventType === "listed"
          ? ["listing"]
          : event.eventType === "delisted"
            ? ["listing", "trading"]
            : ["trading"];
    for (const dimension of dimensions) {
      const key = recordKey(
        event.venue,
        event.canonicalPair,
        dimension,
        event.effectiveAtMs,
        event.publishedAtMs,
      );
      const existing = stateByMoment.get(key);
      if (existing !== undefined && existing !== event.eventType) {
        throw new Error(
          `Lifecycle history ${key} has ambiguous simultaneous states`,
        );
      }
      stateByMoment.set(key, event.eventType);
    }
  }
}

function reconstructLifecycle(
  events: readonly MarketLifecycleEvent[],
  asOfMs: number,
): UniverseLifecycleState {
  const knowable = events
    .filter(
      (event) =>
        event.publishedAtMs <= asOfMs && event.effectiveAtMs <= asOfMs,
    )
    .sort(
      (left, right) =>
        left.effectiveAtMs - right.effectiveAtMs ||
        left.publishedAtMs - right.publishedAtMs ||
        LIFECYCLE_EVENT_ORDER[left.eventType] -
          LIFECYCLE_EVENT_ORDER[right.eventType] ||
        left.eventId.localeCompare(right.eventId),
    );

  let listedAtMs: number | undefined;
  let delistedAtMs: number | undefined;
  let online = false;
  let availableInAustralia = false;
  let latestTradingEvent: MarketLifecycleEvent["eventType"] | undefined;
  let latestAustraliaEvent: MarketLifecycleEvent["eventType"] | undefined;

  for (const event of knowable) {
    switch (event.eventType) {
      case "listed":
        if (listedAtMs === undefined || delistedAtMs !== undefined) {
          listedAtMs = event.effectiveAtMs;
          delistedAtMs = undefined;
          online = false;
          latestTradingEvent = undefined;
          availableInAustralia = false;
          latestAustraliaEvent = undefined;
        }
        break;
      case "trading-online":
      case "trading-resumed":
        online = true;
        latestTradingEvent = event.eventType;
        break;
      case "trading-suspended":
        online = false;
        latestTradingEvent = event.eventType;
        break;
      case "delisted":
        delistedAtMs = event.effectiveAtMs;
        online = false;
        latestTradingEvent = event.eventType;
        break;
      case "au-enabled":
        availableInAustralia = true;
        latestAustraliaEvent = event.eventType;
        break;
      case "au-disabled":
        availableInAustralia = false;
        latestAustraliaEvent = event.eventType;
        break;
    }
  }

  return {
    ...(listedAtMs === undefined ? {} : { listedAtMs }),
    ...(delistedAtMs === undefined ? {} : { delistedAtMs }),
    online,
    availableInAustralia,
    ...(latestTradingEvent === undefined ? {} : { latestTradingEvent }),
    ...(latestAustraliaEvent === undefined ? {} : { latestAustraliaEvent }),
  };
}

function latestDefinitionAt(
  definitions: readonly MarketDefinition[],
  asOfMs: number,
): readonly MarketDefinition[] {
  const latest = new Map<string, MarketDefinition>();
  for (const definition of definitions) {
    if (definition.availableAtMs > asOfMs) continue;
    const key = marketKey(definition.venue, definition.canonicalPair);
    const existing = latest.get(key);
    if (
      existing === undefined ||
      definition.availableAtMs > existing.availableAtMs ||
      (definition.availableAtMs === existing.availableAtMs &&
        definition.definitionId.localeCompare(existing.definitionId) > 0)
    ) {
      latest.set(key, definition);
    }
  }
  return [...latest.values()].sort((left, right) =>
    left.canonicalPair.localeCompare(right.canonicalPair),
  );
}

function latestObservationAt(
  observations: readonly MarketQualityObservation[],
  venue: string,
  canonicalPair: string,
  asOfMs: number,
): MarketQualityObservation | undefined {
  return observations
    .filter(
      (observation) =>
        observation.venue === venue &&
        observation.canonicalPair === canonicalPair &&
        observation.availableAtMs <= asOfMs &&
        observation.observedAtMs <= asOfMs,
    )
    .sort(
      (left, right) =>
        right.observedAtMs - left.observedAtMs ||
        right.availableAtMs - left.availableAtMs ||
        right.observationId.localeCompare(left.observationId),
    )[0];
}

function classifyTier(
  lifecycle: UniverseLifecycleState,
  observation: MarketQualityObservation,
  asOfMs: number,
  policy: UniversePolicy,
  reasons: string[],
): UniverseTier | undefined {
  const listedAtMs = lifecycle.listedAtMs;
  if (listedAtMs === undefined) {
    reasons.push("missing-listing-history");
    return undefined;
  }
  const listingAgeMs = asOfMs - listedAtMs;
  if (listingAgeMs < 0) {
    reasons.push("listing-is-in-the-future");
    return undefined;
  }

  if (listingAgeMs <= policy.newListingMaximumAgeMs) {
    if (
      observation.hourlyCommittedCandles <
      policy.newListingMinimumHourlyCandles
    ) {
      reasons.push("insufficient-new-listing-history");
      return undefined;
    }
    return "new-listing";
  }

  if (listingAgeMs < policy.establishedMinimumAgeMs) {
    reasons.push("listing-age-between-research-tiers");
    return undefined;
  }
  if (
    observation.dailyCommittedCandles <
      policy.establishedMinimumDailyCandles ||
    observation.hourlyCommittedCandles <
      policy.establishedMinimumHourlyCandles
  ) {
    reasons.push("insufficient-established-history");
    return undefined;
  }
  return observation.annualisedVolatility >=
    policy.highVolatilityAnnualisedThreshold
    ? "high-volatility"
    : "established";
}

function applyTierLimits(
  tier: UniverseTier,
  observation: MarketQualityObservation,
  policy: UniversePolicy,
  reasons: string[],
): void {
  const limits = policy.tierLimits[tier];
  if (
    observation.quoteTurnoverAud24h < limits.minimumQuoteTurnoverAud24h
  ) {
    reasons.push("insufficient-quote-turnover");
  }
  if (
    observation.availableQuoteVolumeAud <
    limits.minimumAvailableQuoteVolumeAud
  ) {
    reasons.push("insufficient-execution-depth");
  }
  if (observation.spreadBps > limits.maximumSpreadBps) {
    reasons.push("spread-too-wide");
  }
  if (observation.estimatedImpactBps > limits.maximumEstimatedImpactBps) {
    reasons.push("estimated-impact-too-high");
  }
}

function candidateFor(
  definition: MarketDefinition,
  lifecycleEvents: readonly MarketLifecycleEvent[],
  observations: readonly MarketQualityObservation[],
  asOfMs: number,
  policy: UniversePolicy,
): UniverseCandidate {
  const lifecycle = reconstructLifecycle(lifecycleEvents, asOfMs);
  const reasons: string[] = [];
  const observation = latestObservationAt(
    observations,
    definition.venue,
    definition.canonicalPair,
    asOfMs,
  );

  if (definition.instrumentKind !== "spot") {
    reasons.push("unsupported-instrument-kind");
  }
  if (lifecycle.listedAtMs === undefined) {
    reasons.push("not-listed-at-signal-time");
  }
  if (lifecycle.delistedAtMs !== undefined) {
    reasons.push("delisted-at-signal-time");
  }
  if (!lifecycle.online) reasons.push("not-online-at-signal-time");
  if (!lifecycle.availableInAustralia) {
    reasons.push("not-available-in-australia");
  }
  if (observation === undefined) reasons.push("missing-quality-observation");

  let tier: UniverseTier | undefined;
  if (observation !== undefined) {
    if (asOfMs - observation.availableAtMs > policy.maximumObservationAgeMs) {
      reasons.push("stale-quality-observation");
    }
    if (!observation.audValuationComplete) {
      reasons.push("missing-aud-valuation-path");
    }
    if (observation.dataQualityState !== "complete") {
      reasons.push("unresolved-market-data-state");
    }
    if (policy.candidateOrderAud + EPSILON < observation.minimumOrderAud) {
      reasons.push("candidate-order-below-venue-minimum");
    }
    tier = classifyTier(lifecycle, observation, asOfMs, policy, reasons);
    if (tier !== undefined) {
      applyTierLimits(tier, observation, policy, reasons);
    }
  }

  const listingAgeMs =
    lifecycle.listedAtMs === undefined
      ? undefined
      : asOfMs - lifecycle.listedAtMs;
  return {
    venue: definition.venue,
    canonicalPair: definition.canonicalPair,
    exchangePair: definition.exchangePair,
    eligible: reasons.length === 0 && tier !== undefined,
    ...(tier === undefined ? {} : { tier }),
    reasons,
    definitionId: definition.definitionId,
    ...(observation === undefined
      ? {}
      : { observationId: observation.observationId }),
    lifecycle,
    ...(listingAgeMs === undefined ? {} : { listingAgeMs }),
  };
}

export function reconstructUniverseAt(
  asOfMs: number,
  definitions: readonly MarketDefinition[],
  lifecycleEvents: readonly MarketLifecycleEvent[],
  observations: readonly MarketQualityObservation[],
  policy: UniversePolicy,
): UniverseSnapshot {
  assertFinite("asOfMs", asOfMs);
  validatePolicy(policy);
  definitions.forEach(validateDefinition);
  lifecycleEvents.forEach(validateLifecycleEvent);
  observations.forEach(validateObservation);
  assertUniqueIdentity(
    definitions,
    (record) => record.definitionId,
    (record) => record.payloadSha256,
    "Definition",
  );
  assertUniqueIdentity(
    definitions,
    (record) =>
      recordKey(record.venue, record.canonicalPair, record.availableAtMs),
    (record) => recordKey(record.definitionId, record.payloadSha256),
    "Definition natural",
  );
  assertUniqueIdentity(
    lifecycleEvents,
    (record) => record.eventId,
    (record) => record.payloadSha256,
    "Lifecycle event",
  );
  assertUniqueIdentity(
    lifecycleEvents,
    (record) =>
      recordKey(
        record.venue,
        record.canonicalPair,
        record.eventType,
        record.effectiveAtMs,
        record.publishedAtMs,
      ),
    (record) => recordKey(record.eventId, record.payloadSha256),
    "Lifecycle event natural",
  );
  assertUniqueIdentity(
    observations,
    (record) => record.observationId,
    (record) => record.payloadSha256,
    "Observation",
  );
  assertUniqueIdentity(
    observations,
    (record) =>
      recordKey(
        record.venue,
        record.canonicalPair,
        record.observedAtMs,
        record.availableAtMs,
      ),
    (record) => recordKey(record.observationId, record.payloadSha256),
    "Observation natural",
  );
  assertNoAmbiguousLifecycleEvents(lifecycleEvents);

  const venueDefinitions = latestDefinitionAt(
    definitions.filter((definition) => definition.venue === policy.venue),
    asOfMs,
  );
  const candidates = venueDefinitions.map((definition) =>
    candidateFor(
      definition,
      lifecycleEvents.filter(
        (event) =>
          event.venue === definition.venue &&
          event.canonicalPair === definition.canonicalPair,
      ),
      observations,
      asOfMs,
      policy,
    ),
  );

  return {
    asOfMs,
    venue: policy.venue,
    countryCode: "AU",
    candidates,
    eligiblePairs: candidates
      .filter((candidate) => candidate.eligible)
      .map((candidate) => candidate.canonicalPair),
  };
}
