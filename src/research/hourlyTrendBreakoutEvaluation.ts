import {
  verifyHourlyTrendBreakoutResearchRun,
  type HourlyTrendBreakoutBacktestPlan,
  type HourlyTrendBreakoutResearchRun,
} from "../backtest/hourlyTrendBreakout.ts";
import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import {
  HOURLY_TREND_BREAKOUT_BASELINE_POLICY,
  HOURLY_TREND_BREAKOUT_STRATEGY_VERSION,
  type HourlyTrendBreakoutPolicy,
} from "../strategies/hourlyTrendBreakout.ts";

const MAXIMUM_WALK_FORWARD_FOLDS = 50;
const MAXIMUM_SENSITIVITY_VARIANTS = 100;

export interface HourlyTrendBreakoutEvaluationRunInput {
  readonly plan: HourlyTrendBreakoutBacktestPlan;
  readonly run: HourlyTrendBreakoutResearchRun;
}

export interface HourlyTrendBreakoutWalkForwardFoldInput {
  readonly foldIndex: number;
  readonly training: HourlyTrendBreakoutEvaluationRunInput;
  readonly validation: HourlyTrendBreakoutEvaluationRunInput;
}

export interface HourlyTrendBreakoutWalkForwardFold {
  readonly foldIndex: number;
  readonly trainingPlanSha256: string;
  readonly trainingRunSha256: string;
  readonly trainingStartAtMs: number;
  readonly trainingEndAtMs: number;
  readonly validationPlanSha256: string;
  readonly validationRunSha256: string;
  readonly validationStartAtMs: number;
  readonly validationEndAtMs: number;
}

export interface HourlyTrendBreakoutHoldoutEvidence {
  readonly planSha256: string;
  readonly runSha256: string;
  readonly startAtMs: number;
  readonly endAtMs: number;
}

export interface HourlyTrendBreakoutWalkForwardManifest {
  readonly schemaVersion: "hourly-trend-breakout-walk-forward-manifest-v1";
  readonly strategyVersion: typeof HOURLY_TREND_BREAKOUT_STRATEGY_VERSION;
  readonly policySha256: string;
  readonly configSha256: string;
  readonly folds: readonly HourlyTrendBreakoutWalkForwardFold[];
  readonly finalHoldout: HourlyTrendBreakoutHoldoutEvidence;
  readonly manifestSha256: string;
}

export interface HourlyTrendBreakoutSensitivityVariantInput {
  readonly plan: HourlyTrendBreakoutBacktestPlan;
  readonly run: HourlyTrendBreakoutResearchRun;
}

export interface HourlyTrendBreakoutSensitivityVariant {
  readonly policy: HourlyTrendBreakoutPolicy;
  readonly policySha256: string;
  readonly planSha256: string;
  readonly runSha256: string;
  readonly resultSha256: string;
  readonly totalReturnPct: number;
  readonly maximumDrawdownPct: number;
  readonly turnoverMultiple: number;
}

export interface HourlyTrendBreakoutSensitivityManifest {
  readonly schemaVersion: "hourly-trend-breakout-sensitivity-manifest-v1";
  readonly strategyVersion: typeof HOURLY_TREND_BREAKOUT_STRATEGY_VERSION;
  readonly baselinePolicySha256: string;
  readonly configSha256: string;
  readonly evaluationStartAtMs: number;
  readonly evaluationEndAtMs: number;
  readonly decisionCount: number;
  readonly variants: readonly HourlyTrendBreakoutSensitivityVariant[];
  readonly manifestSha256: string;
}

interface DecisionRange {
  readonly startAtMs: number;
  readonly endAtMs: number;
  readonly count: number;
}

function decisionRange(plan: HourlyTrendBreakoutBacktestPlan): DecisionRange {
  const startAtMs = plan.boundDecisions[0]?.decisionAtMs;
  const endAtMs = plan.boundDecisions.at(-1)?.decisionAtMs;
  if (startAtMs === undefined || endAtMs === undefined) {
    throw new Error("hourly trend/breakout evaluation plan is empty");
  }
  return { startAtMs, endAtMs, count: plan.boundDecisions.length };
}

async function verifyEvaluationRun(
  input: HourlyTrendBreakoutEvaluationRunInput,
): Promise<DecisionRange> {
  await verifyHourlyTrendBreakoutResearchRun(input.plan, input.run);
  return decisionRange(input.plan);
}

function canonicalWalkForwardManifest(
  manifest: Omit<HourlyTrendBreakoutWalkForwardManifest, "manifestSha256">,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: manifest.schemaVersion,
    strategyVersion: manifest.strategyVersion,
    policySha256: manifest.policySha256,
    configSha256: manifest.configSha256,
    folds: manifest.folds,
    finalHoldout: manifest.finalHoldout,
  };
}

function canonicalSensitivityManifest(
  manifest: Omit<HourlyTrendBreakoutSensitivityManifest, "manifestSha256">,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: manifest.schemaVersion,
    strategyVersion: manifest.strategyVersion,
    baselinePolicySha256: manifest.baselinePolicySha256,
    configSha256: manifest.configSha256,
    evaluationStartAtMs: manifest.evaluationStartAtMs,
    evaluationEndAtMs: manifest.evaluationEndAtMs,
    decisionCount: manifest.decisionCount,
    variants: manifest.variants,
  };
}

export async function prepareHourlyTrendBreakoutWalkForwardManifest(
  folds: readonly HourlyTrendBreakoutWalkForwardFoldInput[],
  finalHoldout: HourlyTrendBreakoutEvaluationRunInput,
): Promise<HourlyTrendBreakoutWalkForwardManifest> {
  if (folds.length < 1 || folds.length > MAXIMUM_WALK_FORWARD_FOLDS) {
    throw new Error("walk-forward folds are empty or unbounded");
  }
  const compactFolds: HourlyTrendBreakoutWalkForwardFold[] = [];
  let expectedPolicyJson: string | undefined;
  let expectedConfigSha256: string | undefined;
  let previousTrainingStartAtMs: number | undefined;
  let previousTrainingEndAtMs: number | undefined;
  let previousValidationEndAtMs: number | undefined;
  const runSha256s = new Set<string>();

  for (let index = 0; index < folds.length; index += 1) {
    const fold = folds[index]!;
    if (fold.foldIndex !== index) {
      throw new Error("walk-forward fold indexes must be contiguous");
    }
    const trainingRange = await verifyEvaluationRun(fold.training);
    const validationRange = await verifyEvaluationRun(fold.validation);
    const policyJson = canonicalIntelligenceJson(fold.training.plan.policy);
    if (
      policyJson !== canonicalIntelligenceJson(fold.validation.plan.policy) ||
      (expectedPolicyJson !== undefined && policyJson !== expectedPolicyJson) ||
      fold.training.run.configSha256 !== fold.validation.run.configSha256 ||
      (expectedConfigSha256 !== undefined &&
        fold.training.run.configSha256 !== expectedConfigSha256) ||
      trainingRange.endAtMs >= validationRange.startAtMs ||
      (previousTrainingStartAtMs !== undefined &&
        trainingRange.startAtMs < previousTrainingStartAtMs) ||
      (previousTrainingEndAtMs !== undefined &&
        trainingRange.endAtMs <= previousTrainingEndAtMs) ||
      (previousValidationEndAtMs !== undefined &&
        validationRange.startAtMs <= previousValidationEndAtMs)
    ) {
      throw new Error("walk-forward fold chronology or identity is invalid");
    }
    for (const runSha256 of [
      fold.training.run.runSha256,
      fold.validation.run.runSha256,
    ]) {
      if (runSha256s.has(runSha256)) {
        throw new Error("walk-forward runs cannot be reused");
      }
      runSha256s.add(runSha256);
    }
    expectedPolicyJson = policyJson;
    expectedConfigSha256 = fold.training.run.configSha256;
    previousTrainingStartAtMs = trainingRange.startAtMs;
    previousTrainingEndAtMs = trainingRange.endAtMs;
    previousValidationEndAtMs = validationRange.endAtMs;
    compactFolds.push({
      foldIndex: fold.foldIndex,
      trainingPlanSha256: fold.training.plan.planSha256,
      trainingRunSha256: fold.training.run.runSha256,
      trainingStartAtMs: trainingRange.startAtMs,
      trainingEndAtMs: trainingRange.endAtMs,
      validationPlanSha256: fold.validation.plan.planSha256,
      validationRunSha256: fold.validation.run.runSha256,
      validationStartAtMs: validationRange.startAtMs,
      validationEndAtMs: validationRange.endAtMs,
    });
  }

  const holdoutRange = await verifyEvaluationRun(finalHoldout);
  if (
    expectedPolicyJson === undefined ||
    expectedConfigSha256 === undefined ||
    canonicalIntelligenceJson(finalHoldout.plan.policy) !== expectedPolicyJson ||
    finalHoldout.run.configSha256 !== expectedConfigSha256 ||
    previousValidationEndAtMs === undefined ||
    holdoutRange.startAtMs <= previousValidationEndAtMs ||
    runSha256s.has(finalHoldout.run.runSha256)
  ) {
    throw new Error("final holdout chronology or identity is invalid");
  }
  const envelope = {
    schemaVersion: "hourly-trend-breakout-walk-forward-manifest-v1",
    strategyVersion: HOURLY_TREND_BREAKOUT_STRATEGY_VERSION,
    policySha256: await sha256CanonicalIntelligence(
      finalHoldout.plan.policy,
    ),
    configSha256: expectedConfigSha256,
    folds: compactFolds,
    finalHoldout: {
      planSha256: finalHoldout.plan.planSha256,
      runSha256: finalHoldout.run.runSha256,
      startAtMs: holdoutRange.startAtMs,
      endAtMs: holdoutRange.endAtMs,
    },
  } as const;
  return {
    ...envelope,
    manifestSha256: await sha256CanonicalIntelligence(
      canonicalWalkForwardManifest(envelope),
    ),
  };
}

export async function prepareHourlyTrendBreakoutSensitivityManifest(
  variants: readonly HourlyTrendBreakoutSensitivityVariantInput[],
): Promise<HourlyTrendBreakoutSensitivityManifest> {
  if (
    variants.length < 2 ||
    variants.length > MAXIMUM_SENSITIVITY_VARIANTS
  ) {
    throw new Error("sensitivity variants are insufficient or unbounded");
  }
  const baselinePolicySha256 = await sha256CanonicalIntelligence(
    HOURLY_TREND_BREAKOUT_BASELINE_POLICY,
  );
  let expectedConfigSha256: string | undefined;
  let expectedRange: DecisionRange | undefined;
  const compactVariants: HourlyTrendBreakoutSensitivityVariant[] = [];

  for (const variant of variants) {
    const range = await verifyEvaluationRun(variant);
    if (
      (expectedConfigSha256 !== undefined &&
        variant.run.configSha256 !== expectedConfigSha256) ||
      (expectedRange !== undefined &&
        (range.startAtMs !== expectedRange.startAtMs ||
          range.endAtMs !== expectedRange.endAtMs ||
          range.count !== expectedRange.count))
    ) {
      throw new Error(
        "sensitivity variants must share one configuration and period",
      );
    }
    const policySha256 = await sha256CanonicalIntelligence(
      variant.plan.policy,
    );
    compactVariants.push({
      policy: variant.plan.policy,
      policySha256,
      planSha256: variant.plan.planSha256,
      runSha256: variant.run.runSha256,
      resultSha256: variant.run.resultSha256,
      totalReturnPct: variant.run.result.totalReturnPct,
      maximumDrawdownPct: variant.run.result.maximumDrawdownPct,
      turnoverMultiple: variant.run.result.turnoverMultiple,
    });
    expectedConfigSha256 = variant.run.configSha256;
    expectedRange = range;
  }

  compactVariants.sort((left, right) =>
    left.policySha256.localeCompare(right.policySha256),
  );
  const policySha256s = compactVariants.map(
    (variant) => variant.policySha256,
  );
  if (
    new Set(policySha256s).size !== policySha256s.length ||
    compactVariants.filter(
      (variant) => variant.policySha256 === baselinePolicySha256,
    ).length !== 1
  ) {
    throw new Error(
      "sensitivity policies must be unique and include one baseline",
    );
  }
  const runSha256s = compactVariants.map((variant) => variant.runSha256);
  if (new Set(runSha256s).size !== runSha256s.length) {
    throw new Error("sensitivity runs cannot be reused");
  }
  if (expectedConfigSha256 === undefined || expectedRange === undefined) {
    throw new Error("sensitivity evidence is incomplete");
  }
  const envelope = {
    schemaVersion: "hourly-trend-breakout-sensitivity-manifest-v1",
    strategyVersion: HOURLY_TREND_BREAKOUT_STRATEGY_VERSION,
    baselinePolicySha256,
    configSha256: expectedConfigSha256,
    evaluationStartAtMs: expectedRange.startAtMs,
    evaluationEndAtMs: expectedRange.endAtMs,
    decisionCount: expectedRange.count,
    variants: compactVariants,
  } as const;
  return {
    ...envelope,
    manifestSha256: await sha256CanonicalIntelligence(
      canonicalSensitivityManifest(envelope),
    ),
  };
}
