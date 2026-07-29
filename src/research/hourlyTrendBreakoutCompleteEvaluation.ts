import {
  verifyHourlyTrendBreakoutResearchRun,
  type HourlyTrendBreakoutResearchRun,
} from "../backtest/hourlyTrendBreakout.ts";
import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import {
  HOURLY_TREND_BREAKOUT_STRATEGY_VERSION,
} from "../strategies/hourlyTrendBreakout.ts";
import {
  type HourlyTrendBreakoutEvaluationRunInput,
  type HourlyTrendBreakoutSensitivityManifest,
  type HourlyTrendBreakoutWalkForwardManifest,
} from "./hourlyTrendBreakoutEvaluation.ts";
import {
  prepareResearchReport,
  type ResearchReport,
  type ResearchReportInput,
} from "./researchReport.ts";

export const REQUIRED_HOURLY_TREND_BREAKOUT_EVALUATION_WARNINGS = [
  "complete-loss-of-approved-allocation-is-possible",
  "five-year-objective-is-aspirational-not-a-forecast",
  "strategy-candidate-is-not-selected-or-promoted",
] as const;

export interface HourlyTrendBreakoutCompleteEvaluationInput {
  readonly walkForwardManifest: HourlyTrendBreakoutWalkForwardManifest;
  readonly sensitivityManifest: HourlyTrendBreakoutSensitivityManifest;
  readonly finalHoldout: HourlyTrendBreakoutEvaluationRunInput;
  readonly report: ResearchReportInput;
}

export interface HourlyTrendBreakoutCompleteEvaluation {
  readonly schemaVersion: "hourly-trend-breakout-complete-evaluation-v1";
  readonly strategyVersion: typeof HOURLY_TREND_BREAKOUT_STRATEGY_VERSION;
  readonly walkForwardManifestSha256: string;
  readonly sensitivityManifestSha256: string;
  readonly finalHoldoutPlanSha256: string;
  readonly finalHoldoutRunSha256: string;
  readonly finalHoldoutResultSha256: string;
  readonly report: ResearchReport;
  readonly evaluationSha256: string;
}

function canonicalWalkForwardManifest(
  manifest: HourlyTrendBreakoutWalkForwardManifest,
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
  manifest: HourlyTrendBreakoutSensitivityManifest,
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

async function verifyManifestIdentities(
  walkForward: HourlyTrendBreakoutWalkForwardManifest,
  sensitivity: HourlyTrendBreakoutSensitivityManifest,
): Promise<void> {
  if (
    walkForward.schemaVersion !==
      "hourly-trend-breakout-walk-forward-manifest-v1" ||
    sensitivity.schemaVersion !==
      "hourly-trend-breakout-sensitivity-manifest-v1" ||
    walkForward.strategyVersion !== HOURLY_TREND_BREAKOUT_STRATEGY_VERSION ||
    sensitivity.strategyVersion !== HOURLY_TREND_BREAKOUT_STRATEGY_VERSION ||
    walkForward.folds.length === 0 ||
    sensitivity.variants.length < 2 ||
    walkForward.manifestSha256 !==
      (await sha256CanonicalIntelligence(
        canonicalWalkForwardManifest(walkForward),
      )) ||
    sensitivity.manifestSha256 !==
      (await sha256CanonicalIntelligence(
        canonicalSensitivityManifest(sensitivity),
      ))
  ) {
    throw new Error("hourly trend/breakout evaluation manifest identity is invalid");
  }
}

function exactSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function walkForwardRunSha256s(
  manifest: HourlyTrendBreakoutWalkForwardManifest,
): readonly string[] {
  return [
    ...manifest.folds.flatMap((fold) => [
      fold.trainingRunSha256,
      fold.validationRunSha256,
    ]),
    manifest.finalHoldout.runSha256,
  ];
}

function assertExactDigests(
  name: string,
  actual: readonly string[],
  expected: readonly string[],
): void {
  if (
    actual.length !== new Set(actual).size ||
    canonicalIntelligenceJson(exactSorted(actual)) !==
    canonicalIntelligenceJson(exactSorted(expected))
  ) {
    throw new Error(`${name} does not bind the complete evaluation evidence`);
  }
}

function assertStrategySeriesBindsRun(
  report: ResearchReportInput,
  run: HourlyTrendBreakoutResearchRun,
): void {
  const expectedPoints = run.result.equityCurve.map((point) => ({
    timestampMs: point.timestampMs,
    equity: point.equityAud,
  }));
  if (
    report.strategy.kind !== "strategy" ||
    report.strategy.currency !== "AUD" ||
    canonicalIntelligenceJson(report.strategy.points) !==
      canonicalIntelligenceJson(expectedPoints) ||
    !report.strategy.sourceDigests.includes(run.runSha256) ||
    !report.strategy.sourceDigests.includes(run.resultSha256)
  ) {
    throw new Error(
      "research report strategy series does not bind the final holdout result",
    );
  }
}

export async function prepareHourlyTrendBreakoutCompleteEvaluation(
  input: HourlyTrendBreakoutCompleteEvaluationInput,
): Promise<HourlyTrendBreakoutCompleteEvaluation> {
  const { walkForwardManifest, sensitivityManifest, finalHoldout } = input;
  await verifyManifestIdentities(walkForwardManifest, sensitivityManifest);
  await verifyHourlyTrendBreakoutResearchRun(
    finalHoldout.plan,
    finalHoldout.run,
  );

  const policySha256 = await sha256CanonicalIntelligence(
    finalHoldout.plan.policy,
  );
  const firstDecisionAtMs =
    finalHoldout.plan.boundDecisions[0]?.decisionAtMs;
  const lastDecisionAtMs =
    finalHoldout.plan.boundDecisions.at(-1)?.decisionAtMs;
  const baselineVariant = sensitivityManifest.variants.find(
    (variant) =>
      variant.policySha256 === sensitivityManifest.baselinePolicySha256,
  );
  if (
    firstDecisionAtMs === undefined ||
    lastDecisionAtMs === undefined ||
    walkForwardManifest.policySha256 !== policySha256 ||
    sensitivityManifest.baselinePolicySha256 !== policySha256 ||
    walkForwardManifest.configSha256 !== finalHoldout.run.configSha256 ||
    sensitivityManifest.configSha256 !== finalHoldout.run.configSha256 ||
    walkForwardManifest.finalHoldout.planSha256 !==
      finalHoldout.plan.planSha256 ||
    walkForwardManifest.finalHoldout.runSha256 !==
      finalHoldout.run.runSha256 ||
    walkForwardManifest.finalHoldout.startAtMs !== firstDecisionAtMs ||
    walkForwardManifest.finalHoldout.endAtMs !== lastDecisionAtMs ||
    sensitivityManifest.evaluationStartAtMs !== firstDecisionAtMs ||
    sensitivityManifest.evaluationEndAtMs !== lastDecisionAtMs ||
    sensitivityManifest.decisionCount !==
      finalHoldout.plan.boundDecisions.length ||
    baselineVariant?.planSha256 !== finalHoldout.plan.planSha256 ||
    baselineVariant?.runSha256 !== finalHoldout.run.runSha256 ||
    baselineVariant?.resultSha256 !== finalHoldout.run.resultSha256
  ) {
    throw new Error(
      "final holdout is not the shared baseline evaluation evidence",
    );
  }

  if (input.report.evaluationSplit !== "final-holdout") {
    throw new Error("complete evaluation requires the final-holdout split");
  }
  assertStrategySeriesBindsRun(input.report, finalHoldout.run);
  if (
    input.report.provenance.strategyConfigSha256 !== policySha256 ||
    input.report.provenance.executionConfigSha256 !==
      finalHoldout.run.configSha256
  ) {
    throw new Error("research report configuration provenance is inconsistent");
  }
  assertExactDigests(
    "strategyEvaluationManifestSha256s",
    input.report.provenance.strategyEvaluationManifestSha256s,
    [
      walkForwardManifest.manifestSha256,
      sensitivityManifest.manifestSha256,
    ],
  );
  assertExactDigests(
    "strategyBacktestRunSha256s",
    input.report.provenance.strategyBacktestRunSha256s,
    [
      ...walkForwardRunSha256s(walkForwardManifest),
      ...sensitivityManifest.variants.map((variant) => variant.runSha256),
    ],
  );
  for (const warning of REQUIRED_HOURLY_TREND_BREAKOUT_EVALUATION_WARNINGS) {
    if (!input.report.warnings.includes(warning)) {
      throw new Error(`complete evaluation requires warning ${warning}`);
    }
  }

  const report = await prepareResearchReport(input.report);
  const envelope = {
    schemaVersion: "hourly-trend-breakout-complete-evaluation-v1",
    strategyVersion: HOURLY_TREND_BREAKOUT_STRATEGY_VERSION,
    walkForwardManifestSha256: walkForwardManifest.manifestSha256,
    sensitivityManifestSha256: sensitivityManifest.manifestSha256,
    finalHoldoutPlanSha256: finalHoldout.plan.planSha256,
    finalHoldoutRunSha256: finalHoldout.run.runSha256,
    finalHoldoutResultSha256: finalHoldout.run.resultSha256,
    report,
  } as const;
  return {
    ...envelope,
    evaluationSha256: await sha256CanonicalIntelligence(envelope),
  };
}
