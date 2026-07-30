import {
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";

const HOUR_MS = 3_600_000;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const CANONICAL_AUD_PAIR = /^[A-Z0-9]{2,20}\/AUD$/u;
const MAX_PAIRS = 500;
const MAX_HISTORY_HOURS = 24 * 366;

export const CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION =
  "cross-sectional-momentum-v0.1.0";

export interface CrossSectionalMomentumPolicy {
  readonly shortLookbackHours: number;
  readonly mediumLookbackHours: number;
  readonly longLookbackHours: number;
  readonly shortWeight: number;
  readonly mediumWeight: number;
  readonly longWeight: number;
  readonly minimumWeightedMomentum: number;
  readonly minimumHoldHours: number;
  readonly rotationScoreLead: number;
  readonly targetExposurePct: number;
}

export const CROSS_SECTIONAL_MOMENTUM_BASELINE_POLICY:
  CrossSectionalMomentumPolicy = Object.freeze({
    shortLookbackHours: 24,
    mediumLookbackHours: 168,
    longLookbackHours: 720,
    shortWeight: 0.2,
    mediumWeight: 0.3,
    longWeight: 0.5,
    minimumWeightedMomentum: 0,
    minimumHoldHours: 24,
    rotationScoreLead: 0.05,
    targetExposurePct: 95,
  });

export interface HourlyClose {
  readonly timestampMs: number;
  readonly close: number;
}

export interface CrossSectionalMomentumPosition {
  readonly pair: string;
  readonly enteredAtMs: number;
}

export interface CrossSectionalMomentumInput {
  readonly universeSnapshotSha256: string;
  readonly eligiblePairs: readonly string[];
  readonly hourlyClosesByPair:
    Readonly<Record<string, readonly HourlyClose[]>>;
  readonly currentPosition: CrossSectionalMomentumPosition | null;
}

export interface CrossSectionalMomentumSignal {
  readonly pair: string;
  readonly signalTimestampMs: number;
  readonly latestClose: number;
  readonly shortReturn: number;
  readonly mediumReturn: number;
  readonly longReturn: number;
  readonly weightedMomentum: number;
  readonly longWindowDrawdown: number;
  readonly shortAnnualisedVolatility: number;
  readonly longAnnualisedVolatility: number;
  readonly volatilityExpansion: number;
  readonly entryEligible: boolean;
  readonly rank: number;
}

export interface CrossSectionalMomentumDecision {
  readonly schemaVersion: "cross-sectional-momentum-decision-v1";
  readonly strategyVersion:
    typeof CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION;
  readonly policy: CrossSectionalMomentumPolicy;
  readonly universeSnapshotSha256: string;
  readonly eligiblePairs: readonly string[];
  readonly signalTimestampMs: number;
  readonly targetPair: string | null;
  readonly targetExposurePct: number;
  readonly reason:
    | "enter-strongest-positive-momentum"
    | "rotate-to-materially-stronger-leader"
    | "retain-current-leader"
    | "retain-during-minimum-hold"
    | "exit-ineligible-position-to-aud"
    | "exit-non-positive-position-to-aud"
    | "no-positive-momentum-hold-aud";
  readonly signals: readonly CrossSectionalMomentumSignal[];
  readonly candidateStatus: "research-only-unselected";
  readonly runtimeScopeChanged: false;
  readonly selectionAuthority: "none";
  readonly activationAuthority: "none";
  readonly executionAuthority: "none";
  readonly decisionSha256: string;
}

function assertPolicy(policy: CrossSectionalMomentumPolicy): void {
  const lookbacks = [
    policy.shortLookbackHours,
    policy.mediumLookbackHours,
    policy.longLookbackHours,
  ];
  const weights = [
    policy.shortWeight,
    policy.mediumWeight,
    policy.longWeight,
  ];
  if (
    lookbacks.some(
      (value) =>
        !Number.isSafeInteger(value) ||
        value < 2 ||
        value > MAX_HISTORY_HOURS,
    ) ||
    !(
      policy.shortLookbackHours < policy.mediumLookbackHours &&
      policy.mediumLookbackHours < policy.longLookbackHours
    ) ||
    weights.some((value) => !Number.isFinite(value) || value <= 0) ||
    Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) >
      Number.EPSILON * 8 ||
    !Number.isFinite(policy.minimumWeightedMomentum) ||
    policy.minimumWeightedMomentum < 0 ||
    policy.minimumWeightedMomentum > 1 ||
    !Number.isSafeInteger(policy.minimumHoldHours) ||
    policy.minimumHoldHours < 0 ||
    policy.minimumHoldHours > policy.longLookbackHours ||
    !Number.isFinite(policy.rotationScoreLead) ||
    policy.rotationScoreLead < 0 ||
    policy.rotationScoreLead > 1 ||
    !Number.isFinite(policy.targetExposurePct) ||
    policy.targetExposurePct <= 0 ||
    policy.targetExposurePct > 100
  ) {
    throw new Error("Cross-sectional momentum policy is invalid");
  }
}

function assertEligiblePairs(pairs: readonly string[]): void {
  if (pairs.length === 0 || pairs.length > MAX_PAIRS) {
    throw new Error("Cross-sectional momentum universe is empty or unbounded");
  }
  const sorted = [...pairs].sort();
  if (
    pairs.some((pair) => !CANONICAL_AUD_PAIR.test(pair)) ||
    new Set(pairs).size !== pairs.length ||
    pairs.some((pair, index) => pair !== sorted[index])
  ) {
    throw new Error(
      "Cross-sectional momentum eligible pairs are not canonical and sorted",
    );
  }
}

function assertHistory(
  pair: string,
  history: readonly HourlyClose[],
  requiredHours: number,
): void {
  if (
    history.length < requiredHours + 1 ||
    history.length > MAX_HISTORY_HOURS + 1
  ) {
    throw new Error(`${pair} momentum history is insufficient or unbounded`);
  }
  let previousTimestampMs: number | undefined;
  for (const observation of history) {
    if (
      !Number.isSafeInteger(observation.timestampMs) ||
      observation.timestampMs < 0 ||
      observation.timestampMs % HOUR_MS !== 0 ||
      (previousTimestampMs !== undefined &&
        observation.timestampMs - previousTimestampMs !== HOUR_MS) ||
      !Number.isFinite(observation.close) ||
      observation.close <= 0
    ) {
      throw new Error(`${pair} momentum history is invalid or non-contiguous`);
    }
    previousTimestampMs = observation.timestampMs;
  }
}

function returnOver(
  closes: readonly number[],
  lookbackHours: number,
): number {
  const reference = closes.at(-(lookbackHours + 1));
  const latest = closes.at(-1);
  if (reference === undefined || latest === undefined) {
    throw new Error("Momentum return history is insufficient");
  }
  return latest / reference - 1;
}

function annualisedVolatility(
  closes: readonly number[],
  lookbackHours: number,
): number {
  const window = closes.slice(-(lookbackHours + 1));
  const returns = window.slice(1).map(
    (close, index) => Math.log(close / window[index]!),
  );
  const mean =
    returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce(
    (sum, value) => sum + (value - mean) ** 2,
    0,
  ) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(24 * 365);
}

function buildUnrankedSignal(
  pair: string,
  history: readonly HourlyClose[],
  policy: CrossSectionalMomentumPolicy,
): Omit<CrossSectionalMomentumSignal, "rank"> {
  assertHistory(pair, history, policy.longLookbackHours);
  const closes = history.map((observation) => observation.close);
  const latest = history.at(-1)!;
  const shortReturn = returnOver(closes, policy.shortLookbackHours);
  const mediumReturn = returnOver(closes, policy.mediumLookbackHours);
  const longReturn = returnOver(closes, policy.longLookbackHours);
  const weightedMomentum =
    shortReturn * policy.shortWeight +
    mediumReturn * policy.mediumWeight +
    longReturn * policy.longWeight;
  const longWindow = closes.slice(-(policy.longLookbackHours + 1));
  const longWindowDrawdown =
    latest.close / Math.max(...longWindow) - 1;
  const shortAnnualisedVolatility = annualisedVolatility(
    closes,
    policy.shortLookbackHours,
  );
  const longAnnualisedVolatility = annualisedVolatility(
    closes,
    policy.longLookbackHours,
  );
  const volatilityExpansion =
    longAnnualisedVolatility === 0
      ? 0
      : shortAnnualisedVolatility / longAnnualisedVolatility - 1;
  const signalTimestampMs = latest.timestampMs + HOUR_MS;
  if (
    !Number.isSafeInteger(signalTimestampMs) ||
    ![
      shortReturn,
      mediumReturn,
      longReturn,
      weightedMomentum,
      longWindowDrawdown,
      shortAnnualisedVolatility,
      longAnnualisedVolatility,
      volatilityExpansion,
    ].every(Number.isFinite)
  ) {
    throw new Error(`${pair} produced invalid momentum metrics`);
  }
  return {
    pair,
    signalTimestampMs,
    latestClose: latest.close,
    shortReturn,
    mediumReturn,
    longReturn,
    weightedMomentum,
    longWindowDrawdown,
    shortAnnualisedVolatility,
    longAnnualisedVolatility,
    volatilityExpansion,
    entryEligible:
      shortReturn > 0 &&
      mediumReturn > 0 &&
      longReturn > 0 &&
      weightedMomentum > policy.minimumWeightedMomentum,
  };
}

function decisionContent(
  policy: CrossSectionalMomentumPolicy,
  input: CrossSectionalMomentumInput,
  signals: readonly CrossSectionalMomentumSignal[],
  targetPair: string | null,
  targetExposurePct: number,
  reason: CrossSectionalMomentumDecision["reason"],
) {
  return {
    schemaVersion: "cross-sectional-momentum-decision-v1",
    strategyVersion: CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION,
    policy: Object.freeze({ ...policy }),
    universeSnapshotSha256: input.universeSnapshotSha256,
    eligiblePairs: Object.freeze([...input.eligiblePairs]),
    signalTimestampMs: signals[0]!.signalTimestampMs,
    targetPair,
    targetExposurePct,
    reason,
    signals,
    candidateStatus: "research-only-unselected",
    runtimeScopeChanged: false,
    selectionAuthority: "none",
    activationAuthority: "none",
    executionAuthority: "none",
  } as const;
}

export async function decideCrossSectionalMomentum(
  input: CrossSectionalMomentumInput,
  policy: CrossSectionalMomentumPolicy =
    CROSS_SECTIONAL_MOMENTUM_BASELINE_POLICY,
): Promise<CrossSectionalMomentumDecision> {
  assertPolicy(policy);
  if (!SHA256_HEX.test(input.universeSnapshotSha256)) {
    throw new Error("Cross-sectional momentum snapshot identity is invalid");
  }
  assertEligiblePairs(input.eligiblePairs);
  const historyPairs = Object.keys(input.hourlyClosesByPair).sort();
  if (
    historyPairs.length !== input.eligiblePairs.length ||
    historyPairs.some((pair, index) => pair !== input.eligiblePairs[index])
  ) {
    throw new Error(
      "Cross-sectional momentum histories do not match eligible membership",
    );
  }
  if (
    input.currentPosition !== null &&
    (!CANONICAL_AUD_PAIR.test(input.currentPosition.pair) ||
      !Number.isSafeInteger(input.currentPosition.enteredAtMs) ||
      input.currentPosition.enteredAtMs < 0)
  ) {
    throw new Error("Cross-sectional momentum current position is invalid");
  }

  const unranked = input.eligiblePairs.map((pair) =>
    buildUnrankedSignal(
      pair,
      input.hourlyClosesByPair[pair]!,
      policy,
    ),
  );
  const signalTimestampMs = unranked[0]!.signalTimestampMs;
  if (
    unranked.some(
      (signal) => signal.signalTimestampMs !== signalTimestampMs,
    )
  ) {
    throw new Error(
      "Cross-sectional momentum evidence has mismatched signal times",
    );
  }
  const ranked = [...unranked].sort(
    (left, right) =>
      right.weightedMomentum - left.weightedMomentum ||
      left.pair.localeCompare(right.pair),
  );
  const rankByPair = new Map(
    ranked.map((signal, index) => [signal.pair, index + 1]),
  );
  const signals = Object.freeze(
    unranked.map((signal) => ({
      ...signal,
      rank: rankByPair.get(signal.pair)!,
    })),
  );
  const winner = [...signals]
    .filter((signal) => signal.entryEligible)
    .sort(
      (left, right) =>
        left.rank - right.rank || left.pair.localeCompare(right.pair),
    )[0];
  const heldHours = input.currentPosition === null
    ? null
    : (signalTimestampMs - input.currentPosition.enteredAtMs) / HOUR_MS;
  if (
    heldHours !== null &&
    (!Number.isSafeInteger(heldHours) || heldHours < 0)
  ) {
    throw new Error(
      "Cross-sectional momentum position chronology is invalid",
    );
  }

  let targetPair: string | null;
  let targetExposurePct: number;
  let reason: CrossSectionalMomentumDecision["reason"];
  if (input.currentPosition === null) {
    targetPair = winner?.pair ?? null;
    targetExposurePct = winner === undefined ? 0 : policy.targetExposurePct;
    reason = winner === undefined
      ? "no-positive-momentum-hold-aud"
      : "enter-strongest-positive-momentum";
  } else if (!input.eligiblePairs.includes(input.currentPosition.pair)) {
    targetPair = null;
    targetExposurePct = 0;
    reason = "exit-ineligible-position-to-aud";
  } else {
    const current = signals.find(
      (signal) => signal.pair === input.currentPosition!.pair,
    )!;
    if (!current.entryEligible) {
      targetPair = null;
      targetExposurePct = 0;
      reason = "exit-non-positive-position-to-aud";
    } else {
      const materiallyStronger =
        winner !== undefined &&
        winner.pair !== current.pair &&
        winner.weightedMomentum - current.weightedMomentum >=
          policy.rotationScoreLead;
      if (heldHours! < policy.minimumHoldHours) {
        targetPair = current.pair;
        targetExposurePct = policy.targetExposurePct;
        reason = "retain-during-minimum-hold";
      } else if (materiallyStronger) {
        targetPair = winner.pair;
        targetExposurePct = policy.targetExposurePct;
        reason = "rotate-to-materially-stronger-leader";
      } else {
        targetPair = current.pair;
        targetExposurePct = policy.targetExposurePct;
        reason = "retain-current-leader";
      }
    }
  }

  const content = decisionContent(
    policy,
    input,
    signals,
    targetPair,
    targetExposurePct,
    reason,
  );
  return {
    ...content,
    decisionSha256: await sha256CanonicalIntelligence(content),
  };
}
