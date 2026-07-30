import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import {
  CROSS_SECTIONAL_MOMENTUM_BASELINE_POLICY,
  CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION,
  decideCrossSectionalMomentum,
  type CrossSectionalMomentumDecision,
  type CrossSectionalMomentumPolicy,
  type CrossSectionalMomentumPosition,
  type HourlyClose,
} from "../strategies/crossSectionalMomentum.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const CANONICAL_AUD_PAIR = /^[A-Z0-9]{2,20}\/AUD$/u;
const MAXIMUM_BACKTEST_STEPS = 100_000;
const DECISION_REASONS:
  readonly CrossSectionalMomentumDecision["reason"][] = [
    "enter-strongest-positive-momentum",
    "rotate-to-materially-stronger-leader",
    "retain-current-leader",
    "retain-during-minimum-hold",
    "exit-ineligible-position-to-aud",
    "exit-non-positive-position-to-aud",
    "no-positive-momentum-hold-aud",
  ];

export type CrossSectionalMomentumExecutionStyle = "maker" | "taker";

export interface CrossSectionalMomentumUniverseMembership {
  readonly schemaVersion: "universe-signal-time-membership-v1";
  readonly decisionAtMs: number;
  readonly snapshotAsOfMs: number;
  readonly snapshotAvailableAtMs: number;
  readonly snapshotSha256: string;
  readonly signedPolicySha256: string;
  readonly eligiblePairs: readonly string[];
  readonly membershipSha256: string;
}

export interface CrossSectionalMomentumBacktestMarket {
  readonly pair: string;
  readonly midPriceAud: number;
  readonly spreadBps: number;
  readonly availableQuoteVolumeAud: number;
}

export interface CrossSectionalMomentumBacktestTarget {
  readonly pair: string;
  readonly targetWeight: number;
  readonly executionStyle: CrossSectionalMomentumExecutionStyle;
}

export interface CrossSectionalMomentumBacktestStep {
  readonly signalTimestampMs: number;
  readonly executionTimestampMs: number;
  readonly markets: readonly CrossSectionalMomentumBacktestMarket[];
  readonly targets: readonly CrossSectionalMomentumBacktestTarget[];
  readonly universeMembership:
    CrossSectionalMomentumUniverseMembership;
}

export interface CrossSectionalMomentumBacktestFrame {
  readonly membership: CrossSectionalMomentumUniverseMembership;
  readonly hourlyClosesByPair:
    Readonly<Record<string, readonly HourlyClose[]>>;
  readonly executionTimestampMs: number;
  readonly markets: readonly CrossSectionalMomentumBacktestMarket[];
  readonly executionStyle: CrossSectionalMomentumExecutionStyle;
}

export interface BoundCrossSectionalMomentumDecision {
  readonly schemaVersion:
    "bound-cross-sectional-momentum-decision-v1";
  readonly decisionAtMs: number;
  readonly membershipSha256: string;
  readonly snapshotSha256: string;
  readonly signedPolicySha256: string;
  readonly positionBefore: CrossSectionalMomentumPosition | null;
  readonly positionAfter: CrossSectionalMomentumPosition | null;
  readonly decision: CrossSectionalMomentumDecision;
  readonly boundDecisionSha256: string;
}

export interface CrossSectionalMomentumBacktestPlan {
  readonly schemaVersion:
    "cross-sectional-momentum-backtest-plan-v1";
  readonly strategyVersion:
    typeof CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION;
  readonly policy: CrossSectionalMomentumPolicy;
  readonly boundDecisions:
    readonly BoundCrossSectionalMomentumDecision[];
  readonly steps: readonly CrossSectionalMomentumBacktestStep[];
  readonly candidateStatus: "research-only-unselected";
  readonly runtimeScopeChanged: false;
  readonly selectionAuthority: "none";
  readonly activationAuthority: "none";
  readonly executionAuthority: "none";
  readonly planSha256: string;
}

export interface CrossSectionalMomentumResearchRun<Result> {
  readonly schemaVersion:
    "cross-sectional-momentum-research-run-v1";
  readonly strategyVersion:
    typeof CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION;
  readonly engineContract: "run-universe-bound-backtest-v1";
  readonly planSha256: string;
  readonly configSha256: string;
  readonly result: Result;
  readonly resultSha256: string;
  readonly candidateStatus: "research-only-unselected";
  readonly runtimeScopeChanged: false;
  readonly selectionAuthority: "none";
  readonly activationAuthority: "none";
  readonly executionAuthority: "none";
  readonly runSha256: string;
}

export type RunUniverseBoundBacktest<Config, Result> = (
  config: Config,
  steps: readonly CrossSectionalMomentumBacktestStep[],
) => Result | Promise<Result>;

function assertTime(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function assertDigest(name: string, value: string): void {
  if (!SHA256_HEX.test(value)) {
    throw new Error(`${name} must be lowercase SHA-256`);
  }
}

function assertSortedPairs(name: string, values: readonly string[]): void {
  if (values.length > 500) {
    throw new Error(`${name} exceeds the bounded universe`);
  }
  values.forEach((pair, index) => {
    if (
      !CANONICAL_AUD_PAIR.test(pair) ||
      (index > 0 && values[index - 1]!.localeCompare(pair) >= 0)
    ) {
      throw new Error(`${name} must be canonical, sorted and unique`);
    }
  });
}

function membershipEnvelope(
  membership: CrossSectionalMomentumUniverseMembership,
) {
  return {
    schemaVersion: membership.schemaVersion,
    decisionAtMs: membership.decisionAtMs,
    snapshotAsOfMs: membership.snapshotAsOfMs,
    snapshotAvailableAtMs: membership.snapshotAvailableAtMs,
    snapshotSha256: membership.snapshotSha256,
    signedPolicySha256: membership.signedPolicySha256,
    eligiblePairs: membership.eligiblePairs,
  } as const;
}

async function verifyMembership(
  membership: CrossSectionalMomentumUniverseMembership,
): Promise<void> {
  const envelope = membershipEnvelope(membership);
  if (envelope.schemaVersion !== "universe-signal-time-membership-v1") {
    throw new Error("cross-sectional membership schema is invalid");
  }
  assertTime("membership decisionAtMs", envelope.decisionAtMs);
  assertTime("membership snapshotAsOfMs", envelope.snapshotAsOfMs);
  assertTime(
    "membership snapshotAvailableAtMs",
    envelope.snapshotAvailableAtMs,
  );
  assertDigest("membership snapshotSha256", envelope.snapshotSha256);
  assertDigest(
    "membership signedPolicySha256",
    envelope.signedPolicySha256,
  );
  assertDigest("membership membershipSha256", membership.membershipSha256);
  assertSortedPairs("membership eligiblePairs", envelope.eligiblePairs);
  if (
    envelope.snapshotAsOfMs > envelope.snapshotAvailableAtMs ||
    envelope.snapshotAvailableAtMs > envelope.decisionAtMs ||
    membership.membershipSha256 !==
      await sha256CanonicalIntelligence(envelope) ||
    canonicalIntelligenceJson(membership) !==
      canonicalIntelligenceJson({
        ...envelope,
        membershipSha256: membership.membershipSha256,
      })
  ) {
    throw new Error(
      "cross-sectional signal-time membership identity is invalid",
    );
  }
}

function assertExecutionStyle(
  value: string,
): asserts value is CrossSectionalMomentumExecutionStyle {
  if (value !== "maker" && value !== "taker") {
    throw new Error("cross-sectional execution style is invalid");
  }
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
        value > 24 * 366,
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
    throw new Error("cross-sectional backtest policy is invalid");
  }
}

function assertMarkets(
  markets: readonly CrossSectionalMomentumBacktestMarket[],
  eligiblePairs: readonly string[],
  positionBefore: CrossSectionalMomentumPosition | null,
): void {
  const marketPairs = markets.map((market) => market.pair);
  assertSortedPairs("cross-sectional market pairs", marketPairs);
  const requiredPairs = [
    ...new Set([
      ...eligiblePairs,
      ...(positionBefore === null ? [] : [positionBefore.pair]),
    ]),
  ].sort((left, right) => left.localeCompare(right));
  if (
    marketPairs.length !== requiredPairs.length ||
    marketPairs.some((pair, index) => pair !== requiredPairs[index])
  ) {
    throw new Error(
      "cross-sectional markets do not match membership and held-position evidence",
    );
  }
  for (const market of markets) {
    if (
      !Number.isFinite(market.midPriceAud) ||
      market.midPriceAud <= 0 ||
      !Number.isFinite(market.spreadBps) ||
      market.spreadBps < 0 ||
      !Number.isFinite(market.availableQuoteVolumeAud) ||
      market.availableQuoteVolumeAud < 0
    ) {
      throw new Error("cross-sectional market evidence is invalid");
    }
  }
}

function decisionEnvelope(
  decision: CrossSectionalMomentumDecision,
) {
  return {
    schemaVersion: decision.schemaVersion,
    strategyVersion: decision.strategyVersion,
    policy: decision.policy,
    universeSnapshotSha256: decision.universeSnapshotSha256,
    eligiblePairs: decision.eligiblePairs,
    signalTimestampMs: decision.signalTimestampMs,
    targetPair: decision.targetPair,
    targetExposurePct: decision.targetExposurePct,
    reason: decision.reason,
    signals: decision.signals,
    candidateStatus: decision.candidateStatus,
    runtimeScopeChanged: decision.runtimeScopeChanged,
    selectionAuthority: decision.selectionAuthority,
    activationAuthority: decision.activationAuthority,
    executionAuthority: decision.executionAuthority,
  } as const;
}

async function verifyDecision(
  decision: CrossSectionalMomentumDecision,
): Promise<void> {
  assertDigest("cross-sectional decisionSha256", decision.decisionSha256);
  assertPolicy(decision.policy);
  assertTime(
    "cross-sectional decision signalTimestampMs",
    decision.signalTimestampMs,
  );
  assertSortedPairs(
    "cross-sectional decision eligiblePairs",
    decision.eligiblePairs,
  );
  const envelope = decisionEnvelope(decision);
  if (
    decision.schemaVersion !== "cross-sectional-momentum-decision-v1" ||
    decision.strategyVersion !==
      CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION ||
    decision.candidateStatus !== "research-only-unselected" ||
    decision.runtimeScopeChanged !== false ||
    decision.selectionAuthority !== "none" ||
    decision.activationAuthority !== "none" ||
    decision.executionAuthority !== "none" ||
    !DECISION_REASONS.includes(decision.reason) ||
    decision.signals.length !== decision.eligiblePairs.length ||
    decision.signals.length < 1 ||
    decision.signals.some(
      (signal, index) =>
        signal.pair !== decision.eligiblePairs[index] ||
        signal.signalTimestampMs !== decision.signalTimestampMs ||
        ![
          signal.latestClose,
          signal.shortReturn,
          signal.mediumReturn,
          signal.longReturn,
          signal.weightedMomentum,
          signal.longWindowDrawdown,
          signal.shortAnnualisedVolatility,
          signal.longAnnualisedVolatility,
          signal.volatilityExpansion,
        ].every(Number.isFinite) ||
        signal.latestClose <= 0 ||
        !Number.isSafeInteger(signal.rank) ||
        signal.rank < 1 ||
        signal.rank > decision.signals.length,
    ) ||
    new Set(decision.signals.map((signal) => signal.rank)).size !==
      decision.signals.length ||
    (decision.targetPair === null) !==
      (decision.targetExposurePct === 0) ||
    (decision.targetPair !== null &&
      (!decision.eligiblePairs.includes(decision.targetPair) ||
        decision.targetExposurePct !==
          decision.policy.targetExposurePct)) ||
    decision.decisionSha256 !==
      await sha256CanonicalIntelligence(envelope) ||
    canonicalIntelligenceJson(decision) !==
      canonicalIntelligenceJson({
        ...envelope,
        decisionSha256: decision.decisionSha256,
      })
  ) {
    throw new Error("cross-sectional decision identity is invalid");
  }
}

function assertDecisionSemantics(
  decision: CrossSectionalMomentumDecision,
  positionBefore: CrossSectionalMomentumPosition | null,
): void {
  for (const signal of decision.signals) {
    const expectedWeightedMomentum =
      signal.shortReturn * decision.policy.shortWeight +
      signal.mediumReturn * decision.policy.mediumWeight +
      signal.longReturn * decision.policy.longWeight;
    const tolerance =
      Number.EPSILON * 16 *
      Math.max(1, Math.abs(expectedWeightedMomentum));
    if (
      Math.abs(signal.weightedMomentum - expectedWeightedMomentum) >
        tolerance ||
      signal.entryEligible !==
        (signal.shortReturn > 0 &&
          signal.mediumReturn > 0 &&
          signal.longReturn > 0 &&
          signal.weightedMomentum >
            decision.policy.minimumWeightedMomentum)
    ) {
      throw new Error(
        "cross-sectional decision signal semantics are invalid",
      );
    }
  }
  const ranked = [...decision.signals].sort(
    (left, right) =>
      right.weightedMomentum - left.weightedMomentum ||
      left.pair.localeCompare(right.pair),
  );
  if (ranked.some((signal, index) => signal.rank !== index + 1)) {
    throw new Error("cross-sectional decision ranking is invalid");
  }
  const winner = ranked.find((signal) => signal.entryEligible);
  const current =
    positionBefore === null
      ? undefined
      : decision.signals.find(
          (signal) => signal.pair === positionBefore.pair,
        );
  const heldHours =
    positionBefore === null
      ? null
      : (decision.signalTimestampMs - positionBefore.enteredAtMs) /
        3_600_000;
  if (
    heldHours !== null &&
    (!Number.isSafeInteger(heldHours) || heldHours < 0)
  ) {
    throw new Error(
      "cross-sectional decision position chronology is invalid",
    );
  }

  let expectedPair: string | null;
  let expectedExposurePct: number;
  let expectedReason: CrossSectionalMomentumDecision["reason"];
  if (positionBefore === null) {
    expectedPair = winner?.pair ?? null;
    expectedExposurePct =
      winner === undefined ? 0 : decision.policy.targetExposurePct;
    expectedReason =
      winner === undefined
        ? "no-positive-momentum-hold-aud"
        : "enter-strongest-positive-momentum";
  } else if (current === undefined) {
    expectedPair = null;
    expectedExposurePct = 0;
    expectedReason = "exit-ineligible-position-to-aud";
  } else if (!current.entryEligible) {
    expectedPair = null;
    expectedExposurePct = 0;
    expectedReason = "exit-non-positive-position-to-aud";
  } else if (heldHours! < decision.policy.minimumHoldHours) {
    expectedPair = current.pair;
    expectedExposurePct = decision.policy.targetExposurePct;
    expectedReason = "retain-during-minimum-hold";
  } else if (
    winner !== undefined &&
    winner.pair !== current.pair &&
    winner.weightedMomentum - current.weightedMomentum >=
      decision.policy.rotationScoreLead
  ) {
    expectedPair = winner.pair;
    expectedExposurePct = decision.policy.targetExposurePct;
    expectedReason = "rotate-to-materially-stronger-leader";
  } else {
    expectedPair = current.pair;
    expectedExposurePct = decision.policy.targetExposurePct;
    expectedReason = "retain-current-leader";
  }
  if (
    decision.targetPair !== expectedPair ||
    decision.targetExposurePct !== expectedExposurePct ||
    decision.reason !== expectedReason
  ) {
    throw new Error(
      "cross-sectional decision target semantics are invalid",
    );
  }
}

function nextPosition(
  before: CrossSectionalMomentumPosition | null,
  decision: CrossSectionalMomentumDecision,
): CrossSectionalMomentumPosition | null {
  if (decision.targetPair === null) {
    return null;
  }
  return before?.pair === decision.targetPair
    ? before
    : {
        pair: decision.targetPair,
        enteredAtMs: decision.signalTimestampMs,
      };
}

function boundDecisionEnvelope(
  bound: Omit<
    BoundCrossSectionalMomentumDecision,
    "boundDecisionSha256"
  >,
) {
  return {
    schemaVersion: bound.schemaVersion,
    decisionAtMs: bound.decisionAtMs,
    membershipSha256: bound.membershipSha256,
    snapshotSha256: bound.snapshotSha256,
    signedPolicySha256: bound.signedPolicySha256,
    positionBefore: bound.positionBefore,
    positionAfter: bound.positionAfter,
    decision: bound.decision,
  } as const;
}

function planEnvelope(
  plan: Omit<CrossSectionalMomentumBacktestPlan, "planSha256">,
) {
  return {
    schemaVersion: plan.schemaVersion,
    strategyVersion: plan.strategyVersion,
    policy: plan.policy,
    boundDecisions: plan.boundDecisions,
    steps: plan.steps,
    candidateStatus: plan.candidateStatus,
    runtimeScopeChanged: plan.runtimeScopeChanged,
    selectionAuthority: plan.selectionAuthority,
    activationAuthority: plan.activationAuthority,
    executionAuthority: plan.executionAuthority,
  } as const;
}

export async function prepareCrossSectionalMomentumBacktestPlan(
  frames: readonly CrossSectionalMomentumBacktestFrame[],
  policy: CrossSectionalMomentumPolicy =
    CROSS_SECTIONAL_MOMENTUM_BASELINE_POLICY,
): Promise<CrossSectionalMomentumBacktestPlan> {
  if (frames.length < 1 || frames.length > MAXIMUM_BACKTEST_STEPS) {
    throw new Error("cross-sectional frames are empty or unbounded");
  }
  assertPolicy(policy);
  const policyCopy = Object.freeze({ ...policy });
  const boundDecisions: BoundCrossSectionalMomentumDecision[] = [];
  const steps: CrossSectionalMomentumBacktestStep[] = [];
  let currentPosition: CrossSectionalMomentumPosition | null = null;
  let previousDecisionAtMs: number | undefined;
  let previousExecutionTimestampMs: number | undefined;

  for (const frame of frames) {
    await verifyMembership(frame.membership);
    assertExecutionStyle(frame.executionStyle);
    assertMarkets(
      frame.markets,
      frame.membership.eligiblePairs,
      currentPosition,
    );
    assertTime(
      "cross-sectional executionTimestampMs",
      frame.executionTimestampMs,
    );
    if (
      frame.executionTimestampMs <= frame.membership.decisionAtMs ||
      (previousDecisionAtMs !== undefined &&
        frame.membership.decisionAtMs <= previousDecisionAtMs) ||
      (previousExecutionTimestampMs !== undefined &&
        frame.executionTimestampMs <= previousExecutionTimestampMs)
    ) {
      throw new Error(
        "cross-sectional signal and execution chronology is invalid",
      );
    }

    const decision = await decideCrossSectionalMomentum(
      {
        universeSnapshotSha256: frame.membership.snapshotSha256,
        eligiblePairs: frame.membership.eligiblePairs,
        hourlyClosesByPair: frame.hourlyClosesByPair,
        currentPosition,
      },
      policyCopy,
    );
    if (decision.signalTimestampMs !== frame.membership.decisionAtMs) {
      throw new Error(
        "cross-sectional closed-candle time does not match universe decision time",
      );
    }
    const positionAfter = nextPosition(currentPosition, decision);
    const boundEnvelope = {
      schemaVersion:
        "bound-cross-sectional-momentum-decision-v1",
      decisionAtMs: frame.membership.decisionAtMs,
      membershipSha256: frame.membership.membershipSha256,
      snapshotSha256: frame.membership.snapshotSha256,
      signedPolicySha256: frame.membership.signedPolicySha256,
      positionBefore: currentPosition,
      positionAfter,
      decision,
    } as const;
    boundDecisions.push({
      ...boundEnvelope,
      boundDecisionSha256: await sha256CanonicalIntelligence(
        boundDecisionEnvelope(boundEnvelope),
      ),
    });
    steps.push({
      signalTimestampMs: frame.membership.decisionAtMs,
      executionTimestampMs: frame.executionTimestampMs,
      markets: frame.markets,
      targets:
        decision.targetPair === null
          ? []
          : [
              {
                pair: decision.targetPair,
                targetWeight: decision.targetExposurePct / 100,
                executionStyle: frame.executionStyle,
              },
            ],
      universeMembership: frame.membership,
    });
    currentPosition = positionAfter;
    previousDecisionAtMs = frame.membership.decisionAtMs;
    previousExecutionTimestampMs = frame.executionTimestampMs;
  }

  const envelope = {
    schemaVersion: "cross-sectional-momentum-backtest-plan-v1",
    strategyVersion: CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION,
    policy: policyCopy,
    boundDecisions,
    steps,
    candidateStatus: "research-only-unselected",
    runtimeScopeChanged: false,
    selectionAuthority: "none",
    activationAuthority: "none",
    executionAuthority: "none",
  } as const;
  return {
    ...envelope,
    planSha256: await sha256CanonicalIntelligence(
      planEnvelope(envelope),
    ),
  };
}

export async function verifyCrossSectionalMomentumBacktestPlan(
  plan: CrossSectionalMomentumBacktestPlan,
): Promise<void> {
  if (
    plan.schemaVersion !==
      "cross-sectional-momentum-backtest-plan-v1" ||
    plan.strategyVersion !==
      CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION ||
    plan.boundDecisions.length < 1 ||
    plan.boundDecisions.length > MAXIMUM_BACKTEST_STEPS ||
    plan.boundDecisions.length !== plan.steps.length ||
    plan.candidateStatus !== "research-only-unselected" ||
    plan.runtimeScopeChanged !== false ||
    plan.selectionAuthority !== "none" ||
    plan.activationAuthority !== "none" ||
    plan.executionAuthority !== "none"
  ) {
    throw new Error("cross-sectional backtest plan envelope is invalid");
  }
  assertDigest("cross-sectional planSha256", plan.planSha256);
  assertPolicy(plan.policy);
  let expectedPosition: CrossSectionalMomentumPosition | null = null;
  let previousDecisionAtMs: number | undefined;
  let previousExecutionTimestampMs: number | undefined;

  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index]!;
    const bound = plan.boundDecisions[index]!;
    await verifyMembership(step.universeMembership);
    await verifyDecision(bound.decision);
    assertDecisionSemantics(bound.decision, expectedPosition);
    assertMarkets(
      step.markets,
      step.universeMembership.eligiblePairs,
      expectedPosition,
    );
    assertDigest(
      "cross-sectional boundDecisionSha256",
      bound.boundDecisionSha256,
    );
    if (step.targets[0] !== undefined) {
      assertExecutionStyle(step.targets[0].executionStyle);
    }
    assertTime(
      "cross-sectional executionTimestampMs",
      step.executionTimestampMs,
    );
    const expectedAfter = nextPosition(
      expectedPosition,
      bound.decision,
    );
    const expectedTargets =
      bound.decision.targetPair === null
        ? []
        : [
            {
              pair: bound.decision.targetPair,
              targetWeight:
                bound.decision.targetExposurePct / 100,
              executionStyle: step.targets[0]?.executionStyle,
            },
          ];
    const envelope = {
      schemaVersion: bound.schemaVersion,
      decisionAtMs: bound.decisionAtMs,
      membershipSha256: bound.membershipSha256,
      snapshotSha256: bound.snapshotSha256,
      signedPolicySha256: bound.signedPolicySha256,
      positionBefore: bound.positionBefore,
      positionAfter: bound.positionAfter,
      decision: bound.decision,
    } as const;
    if (
      bound.schemaVersion !==
        "bound-cross-sectional-momentum-decision-v1" ||
      bound.decisionAtMs !== step.signalTimestampMs ||
      bound.decisionAtMs !== step.universeMembership.decisionAtMs ||
      bound.decision.signalTimestampMs !== bound.decisionAtMs ||
      bound.membershipSha256 !==
        step.universeMembership.membershipSha256 ||
      bound.snapshotSha256 !==
        step.universeMembership.snapshotSha256 ||
      bound.signedPolicySha256 !==
        step.universeMembership.signedPolicySha256 ||
      canonicalIntelligenceJson(bound.positionBefore) !==
        canonicalIntelligenceJson(expectedPosition) ||
      canonicalIntelligenceJson(bound.positionAfter) !==
        canonicalIntelligenceJson(expectedAfter) ||
      canonicalIntelligenceJson(bound.decision.policy) !==
        canonicalIntelligenceJson(plan.policy) ||
      bound.decision.universeSnapshotSha256 !== bound.snapshotSha256 ||
      canonicalIntelligenceJson(bound.decision.eligiblePairs) !==
        canonicalIntelligenceJson(
          step.universeMembership.eligiblePairs,
        ) ||
      (bound.decision.targetPair !== null &&
        !step.universeMembership.eligiblePairs.includes(
          bound.decision.targetPair,
        )) ||
      canonicalIntelligenceJson(step.targets) !==
        canonicalIntelligenceJson(expectedTargets) ||
      bound.boundDecisionSha256 !==
        await sha256CanonicalIntelligence(
          boundDecisionEnvelope(envelope),
        ) ||
      (previousDecisionAtMs !== undefined &&
        step.signalTimestampMs <= previousDecisionAtMs) ||
      step.executionTimestampMs <= step.signalTimestampMs ||
      (previousExecutionTimestampMs !== undefined &&
        step.executionTimestampMs <= previousExecutionTimestampMs)
    ) {
      throw new Error(
        "cross-sectional backtest evidence binding is invalid",
      );
    }
    expectedPosition = expectedAfter;
    previousDecisionAtMs = step.signalTimestampMs;
    previousExecutionTimestampMs = step.executionTimestampMs;
  }

  const envelope = {
    schemaVersion: plan.schemaVersion,
    strategyVersion: plan.strategyVersion,
    policy: plan.policy,
    boundDecisions: plan.boundDecisions,
    steps: plan.steps,
    candidateStatus: plan.candidateStatus,
    runtimeScopeChanged: plan.runtimeScopeChanged,
    selectionAuthority: plan.selectionAuthority,
    activationAuthority: plan.activationAuthority,
    executionAuthority: plan.executionAuthority,
  } as const;
  if (
    plan.planSha256 !==
      await sha256CanonicalIntelligence(planEnvelope(envelope)) ||
    canonicalIntelligenceJson(plan) !==
      canonicalIntelligenceJson({
        ...envelope,
        planSha256: plan.planSha256,
      })
  ) {
    throw new Error("cross-sectional backtest plan identity is invalid");
  }
}

export async function runCrossSectionalMomentumResearch<Config, Result>(
  config: Config,
  plan: CrossSectionalMomentumBacktestPlan,
  runUniverseBoundBacktest: RunUniverseBoundBacktest<Config, Result>,
): Promise<CrossSectionalMomentumResearchRun<Result>> {
  await verifyCrossSectionalMomentumBacktestPlan(plan);
  const result = await runUniverseBoundBacktest(config, plan.steps);
  const configSha256 = await sha256CanonicalIntelligence(config);
  const resultSha256 = await sha256CanonicalIntelligence(result);
  const envelope = {
    schemaVersion: "cross-sectional-momentum-research-run-v1",
    strategyVersion: CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION,
    engineContract: "run-universe-bound-backtest-v1",
    planSha256: plan.planSha256,
    configSha256,
    result,
    resultSha256,
    candidateStatus: "research-only-unselected",
    runtimeScopeChanged: false,
    selectionAuthority: "none",
    activationAuthority: "none",
    executionAuthority: "none",
  } as const;
  return {
    ...envelope,
    runSha256: await sha256CanonicalIntelligence(envelope),
  };
}
