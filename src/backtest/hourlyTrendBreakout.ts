import type { Candle } from "../domain/types.ts";
import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import {
  decideHourlyTrendBreakout,
  HOURLY_TREND_BREAKOUT_BASELINE_POLICY,
  HOURLY_TREND_BREAKOUT_STRATEGY_VERSION,
  type HourlyTrendBreakoutDecision,
  type HourlyTrendBreakoutPolicy,
} from "../strategies/hourlyTrendBreakout.ts";
import {
  verifyUniverseSignalTimeMembership,
  type UniverseSignalTimeMembership,
} from "../universe/signalTimeMembership.ts";
import { runUniverseBoundBacktest } from "./universeMembership.ts";
import type {
  BacktestConfig,
  BacktestMarket,
  BacktestResult,
  BacktestStep,
  ExecutionStyle,
} from "./types.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const MAXIMUM_BACKTEST_STEPS = 100_000;
const RESEARCH_PAIRS = ["BTC/AUD", "ETH/AUD"] as const;
const DECISION_KINDS: readonly HourlyTrendBreakoutDecisionKind[] = [
  "candidate",
  "no-eligible-pair",
  "universe-exit",
];

export type HourlyTrendBreakoutDecisionKind =
  | "candidate"
  | "no-eligible-pair"
  | "universe-exit";

export interface HourlyTrendBreakoutBacktestFrame {
  readonly membership: UniverseSignalTimeMembership;
  readonly candlesByPair: Readonly<Record<string, readonly Candle[]>>;
  readonly executionTimestampMs: number;
  readonly markets: readonly BacktestMarket[];
  readonly executionStyle: ExecutionStyle;
}

export interface BoundHourlyTrendBreakoutDecision {
  readonly schemaVersion: "bound-hourly-trend-breakout-decision-v1";
  readonly decisionAtMs: number;
  readonly membershipSha256: string;
  readonly snapshotSha256: string;
  readonly signedPolicySha256: string;
  readonly previousTargetPair: string | null;
  readonly kind: HourlyTrendBreakoutDecisionKind;
  readonly decision: HourlyTrendBreakoutDecision;
  readonly decisionSha256: string;
}

export interface HourlyTrendBreakoutBacktestPlan {
  readonly schemaVersion: "hourly-trend-breakout-backtest-plan-v1";
  readonly strategyVersion: typeof HOURLY_TREND_BREAKOUT_STRATEGY_VERSION;
  readonly policy: HourlyTrendBreakoutPolicy;
  readonly boundDecisions: readonly BoundHourlyTrendBreakoutDecision[];
  readonly steps: readonly BacktestStep[];
  readonly planSha256: string;
}

function exactResearchCandles(
  candlesByPair: Readonly<Record<string, readonly Candle[]>>,
): Readonly<Record<string, readonly Candle[]>> {
  const keys = Object.keys(candlesByPair).sort((left, right) =>
    left.localeCompare(right),
  );
  if (
    keys.length !== RESEARCH_PAIRS.length ||
    keys.some((pair, index) => pair !== RESEARCH_PAIRS[index])
  ) {
    throw new Error(
      "hourly trend/breakout research requires exact BTC/AUD and ETH/AUD histories",
    );
  }
  return Object.fromEntries(
    RESEARCH_PAIRS.map((pair) => [pair, candlesByPair[pair]!]),
  );
}

function assertExecutionStyle(value: string): asserts value is ExecutionStyle {
  if (value !== "maker" && value !== "taker") {
    throw new Error("hourly trend/breakout execution style is invalid");
  }
}

function assertPlanPolicy(policy: HourlyTrendBreakoutPolicy): void {
  const windows = [
    policy.entryLookbackHours,
    policy.exitLookbackHours,
    policy.emaPeriodHours,
    policy.momentumLookbackHours,
  ];
  if (
    windows.some(
      (value) =>
        !Number.isSafeInteger(value) || value < 2 || value > 24 * 365,
    ) ||
    policy.exitLookbackHours >= policy.entryLookbackHours ||
    !Number.isFinite(policy.targetExposurePct) ||
    policy.targetExposurePct <= 0 ||
    policy.targetExposurePct > 100
  ) {
    throw new Error("hourly trend/breakout backtest policy is invalid");
  }
}

function assertDecisionShape(
  decision: HourlyTrendBreakoutDecision,
): void {
  if (
    decision.strategyVersion !== HOURLY_TREND_BREAKOUT_STRATEGY_VERSION ||
    !Number.isSafeInteger(decision.signalTimestampMs) ||
    decision.signalTimestampMs < 0 ||
    !Number.isFinite(decision.targetExposurePct) ||
    decision.targetExposurePct < 0 ||
    decision.targetExposurePct > 100 ||
    (decision.targetPair === null) !== (decision.targetExposurePct === 0) ||
    (decision.targetPair !== null &&
      !RESEARCH_PAIRS.includes(
        decision.targetPair as (typeof RESEARCH_PAIRS)[number],
      )) ||
    decision.reason.trim() !== decision.reason ||
    decision.reason.length === 0 ||
    decision.reason.length > 500 ||
    decision.signals.length > RESEARCH_PAIRS.length
  ) {
    throw new Error("hourly trend/breakout backtest decision is invalid");
  }
  decision.signals.forEach((signal, index) => {
    if (
      !RESEARCH_PAIRS.includes(
        signal.pair as (typeof RESEARCH_PAIRS)[number],
      ) ||
      signal.signalTimestampMs !== decision.signalTimestampMs ||
      (index > 0 &&
        decision.signals[index - 1]!.pair.localeCompare(signal.pair) >= 0) ||
      ![
        signal.latestClose,
        signal.priorEntryHigh,
        signal.priorExitLow,
        signal.ema,
        signal.momentumReturn,
        signal.breakoutStrength,
        signal.trendStrength,
        signal.score,
      ].every(Number.isFinite) ||
      signal.latestClose <= 0 ||
      signal.priorEntryHigh <= 0 ||
      signal.priorExitLow <= 0 ||
      signal.ema <= 0 ||
      signal.reasons.length !== 4 ||
      signal.reasons.some(
        (reason) =>
          reason.trim() !== reason ||
          reason.length === 0 ||
          reason.length > 100,
      )
    ) {
      throw new Error("hourly trend/breakout backtest signal is invalid");
    }
  });
}

function canonicalDecision(
  decision: Omit<BoundHourlyTrendBreakoutDecision, "decisionSha256">,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: decision.schemaVersion,
    decisionAtMs: decision.decisionAtMs,
    membershipSha256: decision.membershipSha256,
    snapshotSha256: decision.snapshotSha256,
    signedPolicySha256: decision.signedPolicySha256,
    previousTargetPair: decision.previousTargetPair,
    kind: decision.kind,
    decision: decision.decision,
  };
}

function canonicalPlan(
  plan: Omit<HourlyTrendBreakoutBacktestPlan, "planSha256">,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: plan.schemaVersion,
    strategyVersion: plan.strategyVersion,
    policy: plan.policy,
    boundDecisions: plan.boundDecisions,
    steps: plan.steps,
  };
}

function cashDecision(
  policy: HourlyTrendBreakoutPolicy,
  signalTimestampMs: number,
  reason: string,
  signals: HourlyTrendBreakoutDecision["signals"],
): HourlyTrendBreakoutDecision {
  return {
    strategyVersion: HOURLY_TREND_BREAKOUT_STRATEGY_VERSION,
    policy: Object.freeze({ ...policy }),
    signalTimestampMs,
    targetPair: null,
    targetExposurePct: 0,
    reason,
    signals,
  };
}

async function bindDecision(
  membership: UniverseSignalTimeMembership,
  previousTargetPair: string | null,
  kind: HourlyTrendBreakoutDecisionKind,
  decision: HourlyTrendBreakoutDecision,
): Promise<BoundHourlyTrendBreakoutDecision> {
  const envelope = {
    schemaVersion: "bound-hourly-trend-breakout-decision-v1",
    decisionAtMs: membership.decisionAtMs,
    membershipSha256: membership.membershipSha256,
    snapshotSha256: membership.snapshotSha256,
    signedPolicySha256: membership.signedPolicySha256,
    previousTargetPair,
    kind,
    decision,
  } as const;
  return {
    ...envelope,
    decisionSha256: await sha256CanonicalIntelligence(
      canonicalDecision(envelope),
    ),
  };
}

export async function prepareHourlyTrendBreakoutBacktestPlan(
  frames: readonly HourlyTrendBreakoutBacktestFrame[],
  policy: HourlyTrendBreakoutPolicy =
    HOURLY_TREND_BREAKOUT_BASELINE_POLICY,
): Promise<HourlyTrendBreakoutBacktestPlan> {
  if (frames.length < 1 || frames.length > MAXIMUM_BACKTEST_STEPS) {
    throw new Error("hourly trend/breakout frames are empty or unbounded");
  }

  assertPlanPolicy(policy);
  const policyCopy = Object.freeze({ ...policy });
  const boundDecisions: BoundHourlyTrendBreakoutDecision[] = [];
  const steps: BacktestStep[] = [];
  let previousTargetPair: string | null = null;
  let previousDecisionAtMs: number | undefined;

  for (const frame of frames) {
    await verifyUniverseSignalTimeMembership(frame.membership);
    assertExecutionStyle(frame.executionStyle);
    if (
      previousDecisionAtMs !== undefined &&
      frame.membership.decisionAtMs <= previousDecisionAtMs
    ) {
      throw new Error(
        "hourly trend/breakout membership decision times must increase",
      );
    }
    const allCandles = exactResearchCandles(frame.candlesByPair);
    const completeEvidenceDecision = decideHourlyTrendBreakout(
      allCandles,
      null,
      policyCopy,
    );
    const supportedEligiblePairs = RESEARCH_PAIRS.filter((pair) =>
      frame.membership.eligiblePairs.includes(pair),
    );
    const previousIsEligible =
      previousTargetPair !== null &&
      supportedEligiblePairs.includes(
        previousTargetPair as (typeof RESEARCH_PAIRS)[number],
      );

    let kind: HourlyTrendBreakoutDecisionKind;
    let decision: HourlyTrendBreakoutDecision;
    if (previousTargetPair !== null && !previousIsEligible) {
      const heldDecision = decideHourlyTrendBreakout(
        { [previousTargetPair]: allCandles[previousTargetPair]! },
        previousTargetPair,
        policyCopy,
      );
      kind = "universe-exit";
      decision = cashDecision(
        policyCopy,
        heldDecision.signalTimestampMs,
        `${previousTargetPair} left verified universe membership; exit to AUD cash`,
        heldDecision.signals,
      );
    } else if (supportedEligiblePairs.length === 0) {
      kind = "no-eligible-pair";
      decision = cashDecision(
        policyCopy,
        completeEvidenceDecision.signalTimestampMs,
        "No configured pair is in verified signal-time universe membership",
        [],
      );
    } else {
      const eligibleCandles = Object.fromEntries(
        supportedEligiblePairs.map((pair) => [pair, allCandles[pair]!]),
      );
      kind = "candidate";
      decision = decideHourlyTrendBreakout(
        eligibleCandles,
        previousTargetPair,
        policyCopy,
      );
    }

    if (decision.signalTimestampMs !== frame.membership.decisionAtMs) {
      throw new Error(
        "hourly trend/breakout closed-candle time does not match universe decision time",
      );
    }
    const bound = await bindDecision(
      frame.membership,
      previousTargetPair,
      kind,
      decision,
    );
    const targets =
      decision.targetPair === null
        ? []
        : [
            {
              pair: decision.targetPair,
              targetWeight: decision.targetExposurePct / 100,
              executionStyle: frame.executionStyle,
            },
          ];
    boundDecisions.push(bound);
    steps.push({
      signalTimestampMs: frame.membership.decisionAtMs,
      executionTimestampMs: frame.executionTimestampMs,
      markets: frame.markets,
      targets,
      universeMembership: frame.membership,
    });
    previousTargetPair = decision.targetPair;
    previousDecisionAtMs = frame.membership.decisionAtMs;
  }

  const envelope = {
    schemaVersion: "hourly-trend-breakout-backtest-plan-v1",
    strategyVersion: HOURLY_TREND_BREAKOUT_STRATEGY_VERSION,
    policy: policyCopy,
    boundDecisions,
    steps,
  } as const;
  return {
    ...envelope,
    planSha256: await sha256CanonicalIntelligence(canonicalPlan(envelope)),
  };
}

export async function verifyHourlyTrendBreakoutBacktestPlan(
  plan: HourlyTrendBreakoutBacktestPlan,
): Promise<void> {
  if (
    plan.schemaVersion !== "hourly-trend-breakout-backtest-plan-v1" ||
    plan.strategyVersion !== HOURLY_TREND_BREAKOUT_STRATEGY_VERSION ||
    plan.steps.length < 1 ||
    plan.steps.length > MAXIMUM_BACKTEST_STEPS ||
    plan.steps.length !== plan.boundDecisions.length ||
    !SHA256_HEX.test(plan.planSha256)
  ) {
    throw new Error("hourly trend/breakout backtest plan envelope is invalid");
  }
  assertPlanPolicy(plan.policy);
  let expectedPreviousTargetPair: string | null = null;
  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index]!;
    const bound = plan.boundDecisions[index]!;
    const membership = step.universeMembership;
    if (membership === undefined) {
      throw new Error("hourly trend/breakout step lacks universe membership");
    }
    await verifyUniverseSignalTimeMembership(membership);
    assertDecisionShape(bound.decision);
    if (!DECISION_KINDS.includes(bound.kind)) {
      throw new Error("hourly trend/breakout decision kind is invalid");
    }
    if (step.targets[0] !== undefined) {
      assertExecutionStyle(step.targets[0].executionStyle);
    }
    const eligible = new Set(membership.eligiblePairs);
    const expectedCandidatePairs = RESEARCH_PAIRS.filter((pair) =>
      eligible.has(pair),
    );
    const expectedTargets =
      bound.decision.targetPair === null
        ? []
        : [
            {
              pair: bound.decision.targetPair,
              targetWeight: bound.decision.targetExposurePct / 100,
              executionStyle: step.targets[0]?.executionStyle,
            },
          ];
    if (
      bound.schemaVersion !== "bound-hourly-trend-breakout-decision-v1" ||
      bound.decisionAtMs !== step.signalTimestampMs ||
      bound.decisionAtMs !== membership.decisionAtMs ||
      bound.decision.signalTimestampMs !== bound.decisionAtMs ||
      bound.membershipSha256 !== membership.membershipSha256 ||
      bound.snapshotSha256 !== membership.snapshotSha256 ||
      bound.signedPolicySha256 !== membership.signedPolicySha256 ||
      bound.previousTargetPair !== expectedPreviousTargetPair ||
      bound.decision.strategyVersion !== plan.strategyVersion ||
      canonicalIntelligenceJson(bound.decision.policy) !==
        canonicalIntelligenceJson(plan.policy) ||
      !SHA256_HEX.test(bound.decisionSha256) ||
      bound.decisionSha256 !==
        (await sha256CanonicalIntelligence(
          canonicalDecision({
            schemaVersion: bound.schemaVersion,
            decisionAtMs: bound.decisionAtMs,
            membershipSha256: bound.membershipSha256,
            snapshotSha256: bound.snapshotSha256,
            signedPolicySha256: bound.signedPolicySha256,
            previousTargetPair: bound.previousTargetPair,
            kind: bound.kind,
            decision: bound.decision,
          }),
        )) ||
      canonicalIntelligenceJson(step.targets) !==
        canonicalIntelligenceJson(expectedTargets)
    ) {
      throw new Error(
        "hourly trend/breakout bound decision identity is invalid",
      );
    }
    if (
      bound.kind === "universe-exit" &&
      (bound.previousTargetPair === null ||
        eligible.has(bound.previousTargetPair) ||
        bound.decision.targetPair !== null ||
        bound.decision.signals.length !== 1 ||
        bound.decision.signals[0]!.pair !== bound.previousTargetPair)
    ) {
      throw new Error("hourly trend/breakout universe exit is invalid");
    }
    if (
      bound.kind === "no-eligible-pair" &&
      (bound.previousTargetPair !== null ||
        RESEARCH_PAIRS.some((pair) => eligible.has(pair)) ||
        bound.decision.targetPair !== null ||
        bound.decision.signals.length !== 0)
    ) {
      throw new Error("hourly trend/breakout cash decision is invalid");
    }
    if (
      bound.kind === "candidate" &&
      (bound.decision.signals.length === 0 ||
        (bound.previousTargetPair !== null &&
          !eligible.has(bound.previousTargetPair)) ||
        bound.decision.signals.some((signal) => !eligible.has(signal.pair)) ||
        canonicalIntelligenceJson(
          bound.decision.signals.map((signal) => signal.pair),
        ) !== canonicalIntelligenceJson(expectedCandidatePairs) ||
        (bound.decision.targetPair !== null &&
          !eligible.has(bound.decision.targetPair)))
    ) {
      throw new Error(
        "hourly trend/breakout target is outside verified universe membership",
      );
    }
    expectedPreviousTargetPair = bound.decision.targetPair;
  }
  const envelope = {
    schemaVersion: plan.schemaVersion,
    strategyVersion: plan.strategyVersion,
    policy: plan.policy,
    boundDecisions: plan.boundDecisions,
    steps: plan.steps,
  } as const;
  if (
    plan.planSha256 !==
      (await sha256CanonicalIntelligence(canonicalPlan(envelope))) ||
    canonicalIntelligenceJson(plan) !==
      canonicalIntelligenceJson({
        ...envelope,
        planSha256: plan.planSha256,
      })
  ) {
    throw new Error("hourly trend/breakout backtest plan identity is invalid");
  }
}

export async function runHourlyTrendBreakoutBacktest(
  config: BacktestConfig,
  plan: HourlyTrendBreakoutBacktestPlan,
): Promise<BacktestResult> {
  await verifyHourlyTrendBreakoutBacktestPlan(plan);
  return runUniverseBoundBacktest(config, plan.steps);
}
