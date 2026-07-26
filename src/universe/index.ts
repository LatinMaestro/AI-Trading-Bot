import { reconstructUniverseAt as reconstructRawUniverseAt } from "./reconstruct.ts";
import type {
  MarketDefinition,
  MarketLifecycleEvent,
  MarketQualityObservation,
  UniverseCandidate,
  UniversePolicy,
  UniverseSnapshot,
} from "./types.ts";

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function validateIntegerTimeContract(
  asOfMs: number,
  definitions: readonly MarketDefinition[],
  lifecycleEvents: readonly MarketLifecycleEvent[],
  observations: readonly MarketQualityObservation[],
  policy: UniversePolicy,
): void {
  assertNonNegativeInteger("asOfMs", asOfMs);
  assertNonNegativeInteger(
    "policy.maximumObservationAgeMs",
    policy.maximumObservationAgeMs,
  );
  assertNonNegativeInteger(
    "policy.newListingMaximumAgeMs",
    policy.newListingMaximumAgeMs,
  );
  assertNonNegativeInteger(
    "policy.newListingMinimumHourlyCandles",
    policy.newListingMinimumHourlyCandles,
  );
  assertNonNegativeInteger(
    "policy.establishedMinimumAgeMs",
    policy.establishedMinimumAgeMs,
  );
  assertNonNegativeInteger(
    "policy.establishedMinimumDailyCandles",
    policy.establishedMinimumDailyCandles,
  );
  assertNonNegativeInteger(
    "policy.establishedMinimumHourlyCandles",
    policy.establishedMinimumHourlyCandles,
  );

  for (const definition of definitions) {
    assertNonNegativeInteger(
      `definition ${definition.definitionId} availableAtMs`,
      definition.availableAtMs,
    );
  }
  for (const event of lifecycleEvents) {
    assertNonNegativeInteger(
      `event ${event.eventId} effectiveAtMs`,
      event.effectiveAtMs,
    );
    assertNonNegativeInteger(
      `event ${event.eventId} publishedAtMs`,
      event.publishedAtMs,
    );
    assertNonNegativeInteger(
      `event ${event.eventId} recordedAtMs`,
      event.recordedAtMs,
    );
  }
  for (const observation of observations) {
    assertNonNegativeInteger(
      `observation ${observation.observationId} observedAtMs`,
      observation.observedAtMs,
    );
    assertNonNegativeInteger(
      `observation ${observation.observationId} availableAtMs`,
      observation.availableAtMs,
    );
    assertNonNegativeInteger(
      `observation ${observation.observationId} dailyCommittedCandles`,
      observation.dailyCommittedCandles,
    );
    assertNonNegativeInteger(
      `observation ${observation.observationId} hourlyCommittedCandles`,
      observation.hourlyCommittedCandles,
    );
  }
}

function applyObservationTimeFreshness(
  snapshot: UniverseSnapshot,
  observations: readonly MarketQualityObservation[],
  maximumObservationAgeMs: number,
): UniverseSnapshot {
  const byId = new Map(
    observations.map((observation) => [observation.observationId, observation]),
  );
  const candidates: UniverseCandidate[] = snapshot.candidates.map((candidate) => {
    if (candidate.observationId === undefined) return candidate;
    const observation = byId.get(candidate.observationId);
    if (observation === undefined) {
      throw new Error(
        `Universe candidate ${candidate.canonicalPair} references a missing observation`,
      );
    }
    if (
      snapshot.asOfMs - observation.observedAtMs <=
        maximumObservationAgeMs ||
      candidate.reasons.includes("stale-quality-observation")
    ) {
      return candidate;
    }
    return {
      ...candidate,
      eligible: false,
      reasons: [...candidate.reasons, "stale-quality-observation"],
    };
  });
  return {
    ...snapshot,
    candidates,
    eligiblePairs: candidates
      .filter((candidate) => candidate.eligible)
      .map((candidate) => candidate.canonicalPair),
  };
}

/**
 * Authoritative public universe reconstruction entrypoint.
 *
 * The lower-level module performs deterministic lifecycle and tier evaluation.
 * This facade adds integer time/count validation and measures observation
 * freshness from the market observation time, not its later ingestion time.
 */
export function reconstructUniverseAt(
  asOfMs: number,
  definitions: readonly MarketDefinition[],
  lifecycleEvents: readonly MarketLifecycleEvent[],
  observations: readonly MarketQualityObservation[],
  policy: UniversePolicy,
): UniverseSnapshot {
  validateIntegerTimeContract(
    asOfMs,
    definitions,
    lifecycleEvents,
    observations,
    policy,
  );
  return applyObservationTimeFreshness(
    reconstructRawUniverseAt(
      asOfMs,
      definitions,
      lifecycleEvents,
      observations,
      policy,
    ),
    observations,
    policy.maximumObservationAgeMs,
  );
}

export type {
  InstrumentKind,
  MarketDataQualityState,
  MarketDefinition,
  MarketLifecycleEvent,
  MarketLifecycleEventType,
  MarketQualityObservation,
  UniverseCandidate,
  UniverseLifecycleState,
  UniversePolicy,
  UniverseSnapshot,
  UniverseTier,
  UniverseTierLimits,
} from "./types.ts";
