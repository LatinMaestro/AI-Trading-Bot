import type {
  MarketMembershipRecord,
  UniverseCandidate,
  UniverseObservation,
  UniversePolicy,
  UniverseTier,
} from "./types.ts";

const DAY_MS = 86_400_000;

function activeMembership(
  records: readonly MarketMembershipRecord[],
  pair: string,
  timestampMs: number,
): MarketMembershipRecord {
  const active = records.filter(
    (record) =>
      record.canonicalPair === pair &&
      record.effectiveFromMs <= timestampMs &&
      (record.effectiveToMs === undefined || timestampMs < record.effectiveToMs),
  );
  if (active.length !== 1) {
    throw new Error(`${pair} requires exactly one active membership record`);
  }
  const record = active[0];
  if (record === undefined) throw new Error(`${pair} membership missing`);
  return record;
}

function validatePolicy(policy: UniversePolicy): void {
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} is invalid`);
  }
  if (policy.maximumMinimumOrderShareOfEquity > 1) {
    throw new Error("maximumMinimumOrderShareOfEquity cannot exceed 1");
  }
}

function classifyTier(
  observation: UniverseObservation,
  membership: MarketMembershipRecord,
  policy: UniversePolicy,
): UniverseTier | undefined {
  const ageDays = (observation.timestampMs - membership.listingTimestampMs) / DAY_MS;
  if (ageDays < 0) throw new Error(`${observation.canonicalPair} predates listing`);
  if (ageDays <= policy.newListingMaximumAgeDays) return "new-listing";
  if (
    observation.committedDailyCandles < policy.establishedMinimumDailyCandles ||
    observation.committedHourlyCandles < policy.establishedMinimumHourlyCandles
  ) {
    return undefined;
  }
  return observation.annualisedVolatility >= policy.highVolatilityThreshold
    ? "high-volatility"
    : "established";
}

export function evaluateUniverseAt(
  observations: readonly UniverseObservation[],
  memberships: readonly MarketMembershipRecord[],
  policy: UniversePolicy,
  equityAud: number,
): readonly UniverseCandidate[] {
  validatePolicy(policy);
  if (!Number.isFinite(equityAud) || equityAud <= 0) throw new Error("equityAud must be positive");
  const seen = new Set<string>();

  return [...observations]
    .sort((a, b) => a.canonicalPair.localeCompare(b.canonicalPair))
    .map((observation) => {
      if (seen.has(observation.canonicalPair)) {
        throw new Error(`Duplicate observation ${observation.canonicalPair}`);
      }
      seen.add(observation.canonicalPair);
      if (!Number.isFinite(observation.timestampMs)) throw new Error("Observation timestamp is invalid");
      const membership = activeMembership(
        memberships,
        observation.canonicalPair,
        observation.timestampMs,
      );
      const reasons: string[] = [];

      if (!membership.availableInAustralia) reasons.push("not-available-in-australia");
      if (membership.instrumentType !== "spot") reasons.push("non-spot-instrument");
      if (membership.status !== "online") reasons.push(`market-${membership.status}`);
      if (!observation.hasAudValuationPath) reasons.push("missing-aud-valuation-path");
      if (!observation.dataComplete) reasons.push("incomplete-market-data");
      if (observation.spreadBps > policy.maximumSpreadBps) reasons.push("spread-too-wide");
      if (observation.quoteTurnoverAud < policy.minimumQuoteTurnoverAud) reasons.push("turnover-too-low");
      if (observation.availableQuoteVolumeAud < policy.minimumAvailableQuoteVolumeAud) reasons.push("depth-too-low");
      if (observation.estimatedImpactBps > policy.maximumEstimatedImpactBps) reasons.push("impact-too-high");
      if (observation.minimumOrderAud / equityAud > policy.maximumMinimumOrderShareOfEquity) {
        reasons.push("minimum-order-too-large");
      }

      const tier = classifyTier(observation, membership, policy);
      if (tier === undefined) reasons.push("insufficient-history");
      return {
        canonicalPair: observation.canonicalPair,
        eligible: reasons.length === 0,
        ...(tier === undefined ? {} : { tier }),
        reasons,
      };
    });
}
