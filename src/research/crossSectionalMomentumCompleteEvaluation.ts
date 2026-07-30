import {
  verifyCrossSectionalMomentumResearchRun,
  type CrossSectionalMomentumBacktestPlan,
  type CrossSectionalMomentumResearchRun,
  type RunUniverseBoundBacktest,
} from "../backtest/crossSectionalMomentum.ts";
import type {
  BacktestConfig,
  BacktestResult,
} from "../backtest/types.ts";
import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import {
  CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION,
} from "../strategies/crossSectionalMomentum.ts";
import {
  type CrossSectionalMomentumSensitivityManifest,
  type CrossSectionalMomentumWalkForwardManifest,
} from "./crossSectionalMomentumEvaluation.ts";
import {
  REQUIRED_CROSS_SECTIONAL_CAPACITY_LEVELS_AUD,
  verifyCrossSectionalMomentumExecutionStressManifest,
  type CrossSectionalMomentumExecutionCalibration,
  type CrossSectionalMomentumExecutionStressManifest,
} from "./crossSectionalMomentumExecutionStress.ts";
import {
  prepareResearchReport,
  type ResearchReport,
  type ResearchReportInput,
} from "./researchReport.ts";

export const REQUIRED_CROSS_SECTIONAL_MOMENTUM_EVALUATION_WARNINGS = [
  "authoritative-survivorship-safe-data-remains-required",
  "capacity-and-execution-stress-do-not-prove-live-fillability",
  "complete-loss-of-approved-allocation-is-possible",
  "five-year-objective-is-aspirational-not-a-forecast",
  "strategy-candidate-is-not-selected-or-promoted",
] as const;

export interface CrossSectionalMomentumCompleteEvaluationInput {
  readonly walkForwardManifest:
    CrossSectionalMomentumWalkForwardManifest;
  readonly sensitivityManifest:
    CrossSectionalMomentumSensitivityManifest;
  readonly finalHoldout: {
    readonly plan: CrossSectionalMomentumBacktestPlan;
    readonly run: CrossSectionalMomentumResearchRun<
      BacktestConfig,
      BacktestResult
    >;
  };
  readonly runner:
    RunUniverseBoundBacktest<BacktestConfig, BacktestResult>;
  readonly executionCalibration:
    CrossSectionalMomentumExecutionCalibration;
  readonly executionStressManifest:
    CrossSectionalMomentumExecutionStressManifest;
  readonly report: ResearchReportInput;
}

export interface CrossSectionalMomentumExecutionCapacitySummary {
  readonly finalHoldoutTurnoverMultiple: number;
  readonly finalHoldoutMaximumDrawdownPct: number;
  readonly finalHoldoutTotalCostAud: number;
  readonly finalHoldoutExecutionCount: number;
  readonly finalHoldoutRequestedNotionalAud: number;
  readonly finalHoldoutFilledNotionalAud: number;
  readonly finalHoldoutMissedFillNotionalAud: number;
  readonly stressResultCount: number;
  readonly capacityLevelsAud:
    typeof REQUIRED_CROSS_SECTIONAL_CAPACITY_LEVELS_AUD;
  readonly capacityConstrainedCapitalLevelsAud: readonly number[];
  readonly maximumStressMissedFillRatio: number;
  readonly maximumStressDrawdownPct: number;
  readonly minimumStressReturnPct: number;
}

export interface CrossSectionalMomentumCompleteEvaluation {
  readonly schemaVersion:
    "cross-sectional-momentum-complete-evaluation-v1";
  readonly strategyVersion:
    typeof CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION;
  readonly candidateStatus: "research-only-unselected";
  readonly runtimeScopeChanged: false;
  readonly selectionAuthority: "none";
  readonly activationAuthority: "none";
  readonly executionAuthority: "none";
  readonly walkForwardManifestSha256: string;
  readonly sensitivityManifestSha256: string;
  readonly finalHoldoutPlanSha256: string;
  readonly finalHoldoutRunSha256: string;
  readonly finalHoldoutResultSha256: string;
  readonly executionStressManifestSha256: string;
  readonly benchmarkEvidenceSha256: string;
  readonly objectiveProgressEvidenceSha256: string;
  readonly scenarioRiskEvidenceSha256: string;
  readonly universeEvidenceSha256: string;
  readonly executionCapacitySummary:
    CrossSectionalMomentumExecutionCapacitySummary;
  readonly executionCapacityEvidenceSha256: string;
  readonly report: ResearchReport;
  readonly evaluationSha256: string;
}

function walkForwardEnvelope(
  manifest: CrossSectionalMomentumWalkForwardManifest,
) {
  return {
    schemaVersion: manifest.schemaVersion,
    strategyVersion: manifest.strategyVersion,
    engineContract: manifest.engineContract,
    policySha256: manifest.policySha256,
    configSha256: manifest.configSha256,
    folds: manifest.folds,
    finalHoldout: manifest.finalHoldout,
    candidateStatus: manifest.candidateStatus,
    runtimeScopeChanged: manifest.runtimeScopeChanged,
    selectionAuthority: manifest.selectionAuthority,
    activationAuthority: manifest.activationAuthority,
    executionAuthority: manifest.executionAuthority,
  } as const;
}

function sensitivityEnvelope(
  manifest: CrossSectionalMomentumSensitivityManifest,
) {
  return {
    schemaVersion: manifest.schemaVersion,
    strategyVersion: manifest.strategyVersion,
    engineContract: manifest.engineContract,
    baselinePolicySha256: manifest.baselinePolicySha256,
    configSha256: manifest.configSha256,
    evidenceSha256: manifest.evidenceSha256,
    evaluationStartAtMs: manifest.evaluationStartAtMs,
    evaluationEndAtMs: manifest.evaluationEndAtMs,
    decisionCount: manifest.decisionCount,
    variants: manifest.variants,
    candidateStatus: manifest.candidateStatus,
    runtimeScopeChanged: manifest.runtimeScopeChanged,
    selectionAuthority: manifest.selectionAuthority,
    activationAuthority: manifest.activationAuthority,
    executionAuthority: manifest.executionAuthority,
  } as const;
}

async function verifyManifestIdentities(
  walkForward: CrossSectionalMomentumWalkForwardManifest,
  sensitivity: CrossSectionalMomentumSensitivityManifest,
): Promise<void> {
  if (
    walkForward.schemaVersion !==
      "cross-sectional-momentum-walk-forward-manifest-v1" ||
    sensitivity.schemaVersion !==
      "cross-sectional-momentum-sensitivity-manifest-v1" ||
    walkForward.strategyVersion !==
      CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION ||
    sensitivity.strategyVersion !==
      CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION ||
    walkForward.engineContract !==
      "run-universe-bound-backtest-v1" ||
    sensitivity.engineContract !==
      "run-universe-bound-backtest-v1" ||
    walkForward.folds.length < 1 ||
    sensitivity.variants.length < 2 ||
    walkForward.candidateStatus !== "research-only-unselected" ||
    sensitivity.candidateStatus !== "research-only-unselected" ||
    walkForward.runtimeScopeChanged ||
    sensitivity.runtimeScopeChanged ||
    walkForward.selectionAuthority !== "none" ||
    sensitivity.selectionAuthority !== "none" ||
    walkForward.activationAuthority !== "none" ||
    sensitivity.activationAuthority !== "none" ||
    walkForward.executionAuthority !== "none" ||
    sensitivity.executionAuthority !== "none" ||
    walkForward.manifestSha256 !==
      await sha256CanonicalIntelligence(
        walkForwardEnvelope(walkForward),
      ) ||
    sensitivity.manifestSha256 !==
      await sha256CanonicalIntelligence(
        sensitivityEnvelope(sensitivity),
      )
  ) {
    throw new Error(
      "cross-sectional evaluation manifest identity is invalid",
    );
  }
}

function exactSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right),
  );
}

function walkForwardRunSha256s(
  manifest: CrossSectionalMomentumWalkForwardManifest,
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
    throw new Error(
      `${name} does not bind the complete evaluation evidence`,
    );
  }
}

function assertStrategySeriesBindsRun(
  report: ResearchReportInput,
  plan: CrossSectionalMomentumBacktestPlan,
  run: CrossSectionalMomentumResearchRun<
    BacktestConfig,
    BacktestResult
  >,
): void {
  const expectedPoints = run.result.equityCurve.map((point) => ({
    timestampMs: point.timestampMs,
    equity: point.equityAud,
  }));
  if (
    report.strategy.kind !== "strategy" ||
    report.strategy.currency !== "AUD" ||
    canonicalIntelligenceJson(report.strategy.points) !==
      canonicalIntelligenceJson(expectedPoints)
  ) {
    throw new Error(
      "cross-sectional report strategy series does not bind the final holdout",
    );
  }
  assertExactDigests(
    "strategy sourceDigests",
    report.strategy.sourceDigests,
    [plan.planSha256, run.runSha256, run.resultSha256],
  );
}

function sumExecutions(
  result: BacktestResult,
  field:
    | "requestedNotionalAud"
    | "filledReferenceNotionalAud"
    | "missedNotionalAud",
): number {
  return result.executions.reduce(
    (sum, execution) => sum + execution[field],
    0,
  );
}

function executionCapacitySummary(
  result: BacktestResult,
  stress: CrossSectionalMomentumExecutionStressManifest,
): CrossSectionalMomentumExecutionCapacitySummary {
  const constrainedCapitalLevels = [
    ...new Set(
      stress.results
        .filter((cell) => cell.missedFillNotionalAud > 0)
        .map((cell) => cell.capitalAud),
    ),
  ].sort((left, right) => left - right);
  return {
    finalHoldoutTurnoverMultiple: result.turnoverMultiple,
    finalHoldoutMaximumDrawdownPct: result.maximumDrawdownPct,
    finalHoldoutTotalCostAud: result.costs.totalAud,
    finalHoldoutExecutionCount: result.executions.length,
    finalHoldoutRequestedNotionalAud: sumExecutions(
      result,
      "requestedNotionalAud",
    ),
    finalHoldoutFilledNotionalAud: sumExecutions(
      result,
      "filledReferenceNotionalAud",
    ),
    finalHoldoutMissedFillNotionalAud: sumExecutions(
      result,
      "missedNotionalAud",
    ),
    stressResultCount: stress.results.length,
    capacityLevelsAud:
      REQUIRED_CROSS_SECTIONAL_CAPACITY_LEVELS_AUD,
    capacityConstrainedCapitalLevelsAud:
      constrainedCapitalLevels,
    maximumStressMissedFillRatio: Math.max(
      ...stress.results.map((cell) => cell.missedFillRatio),
    ),
    maximumStressDrawdownPct: Math.max(
      ...stress.results.map((cell) => cell.maximumDrawdownPct),
    ),
    minimumStressReturnPct: Math.min(
      ...stress.results.map((cell) => cell.totalReturnPct),
    ),
  };
}

function closeEnough(left: number, right: number): boolean {
  return (
    Math.abs(left - right) <=
    Math.max(1, Math.abs(left), Math.abs(right)) * 1e-9
  );
}

export async function prepareCrossSectionalMomentumCompleteEvaluation(
  input: CrossSectionalMomentumCompleteEvaluationInput,
): Promise<CrossSectionalMomentumCompleteEvaluation> {
  const {
    walkForwardManifest,
    sensitivityManifest,
    finalHoldout,
  } = input;
  await verifyManifestIdentities(
    walkForwardManifest,
    sensitivityManifest,
  );
  await verifyCrossSectionalMomentumResearchRun(
    finalHoldout.plan,
    finalHoldout.run,
    input.runner,
  );
  await verifyCrossSectionalMomentumExecutionStressManifest(
    finalHoldout.plan,
    finalHoldout.run,
    input.runner,
    input.executionCalibration,
    input.executionStressManifest,
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
      variant.policySha256 ===
      sensitivityManifest.baselinePolicySha256,
  );
  if (
    firstDecisionAtMs === undefined ||
    lastDecisionAtMs === undefined ||
    walkForwardManifest.policySha256 !== policySha256 ||
    sensitivityManifest.baselinePolicySha256 !== policySha256 ||
    walkForwardManifest.configSha256 !==
      finalHoldout.run.configSha256 ||
    sensitivityManifest.configSha256 !==
      finalHoldout.run.configSha256 ||
    walkForwardManifest.finalHoldout.planSha256 !==
      finalHoldout.plan.planSha256 ||
    walkForwardManifest.finalHoldout.runSha256 !==
      finalHoldout.run.runSha256 ||
    walkForwardManifest.finalHoldout.startAtMs !==
      firstDecisionAtMs ||
    walkForwardManifest.finalHoldout.endAtMs !==
      lastDecisionAtMs ||
    sensitivityManifest.evaluationStartAtMs !==
      firstDecisionAtMs ||
    sensitivityManifest.evaluationEndAtMs !==
      lastDecisionAtMs ||
    sensitivityManifest.decisionCount !==
      finalHoldout.plan.boundDecisions.length ||
    baselineVariant?.planSha256 !==
      finalHoldout.plan.planSha256 ||
    baselineVariant?.runSha256 !==
      finalHoldout.run.runSha256 ||
    baselineVariant?.resultSha256 !==
      finalHoldout.run.resultSha256
  ) {
    throw new Error(
      "cross-sectional final holdout is not the shared baseline evidence",
    );
  }

  if (input.report.evaluationSplit !== "final-holdout") {
    throw new Error(
      "cross-sectional complete evaluation requires final-holdout split",
    );
  }
  const generatedAtMs = Date.parse(input.report.generatedAt);
  if (
    !Number.isFinite(generatedAtMs) ||
    generatedAtMs < input.executionStressManifest.evaluatedAtMs
  ) {
    throw new Error(
      "cross-sectional report predates execution stress evidence",
    );
  }
  assertStrategySeriesBindsRun(
    input.report,
    finalHoldout.plan,
    finalHoldout.run,
  );
  const universeEvidenceSha256 =
    await sha256CanonicalIntelligence(
      finalHoldout.plan.steps.map(
        (step) => step.universeMembership,
      ),
    );
  if (
    input.report.provenance.strategyConfigSha256 !== policySha256 ||
    input.report.provenance.executionConfigSha256 !==
      finalHoldout.run.configSha256 ||
    input.report.provenance.dataSha256 !==
      walkForwardManifest.finalHoldout.evidenceSha256 ||
    input.report.provenance.universeSha256 !==
      universeEvidenceSha256
  ) {
    throw new Error(
      "cross-sectional report provenance is inconsistent",
    );
  }
  assertExactDigests(
    "strategyEvaluationManifestSha256s",
    input.report.provenance.strategyEvaluationManifestSha256s,
    [
      walkForwardManifest.manifestSha256,
      sensitivityManifest.manifestSha256,
      input.executionStressManifest.manifestSha256,
    ],
  );
  assertExactDigests(
    "strategyBacktestRunSha256s",
    input.report.provenance.strategyBacktestRunSha256s,
    [
      ...walkForwardRunSha256s(walkForwardManifest),
      ...sensitivityManifest.variants.map(
        (variant) => variant.runSha256,
      ),
    ],
  );
  for (
    const warning of
      REQUIRED_CROSS_SECTIONAL_MOMENTUM_EVALUATION_WARNINGS
  ) {
    if (!input.report.warnings.includes(warning)) {
      throw new Error(
        `cross-sectional complete evaluation requires warning ${warning}`,
      );
    }
  }

  const report = await prepareResearchReport(input.report);
  if (
    report.objectiveProgress.currency !== "AUD" ||
    !closeEnough(
      report.objectiveProgress.currentEquity,
      finalHoldout.run.result.finalEquityAud,
    ) ||
    !closeEnough(
      report.strategySummary.terminalEquity,
      finalHoldout.run.result.finalEquityAud,
    ) ||
    !closeEnough(
      report.strategySummary.totalReturnPct,
      finalHoldout.run.result.totalReturnPct,
    ) ||
    !closeEnough(
      report.strategySummary.maximumDrawdownPct,
      finalHoldout.run.result.maximumDrawdownPct,
    )
  ) {
    throw new Error(
      "cross-sectional report metrics do not reproduce final holdout",
    );
  }

  const summary = executionCapacitySummary(
    finalHoldout.run.result,
    input.executionStressManifest,
  );
  const benchmarkEvidenceSha256 =
    await sha256CanonicalIntelligence(report.benchmarks);
  const objectiveProgressEvidenceSha256 =
    await sha256CanonicalIntelligence(report.objectiveProgress);
  const scenarioRiskEvidenceSha256 =
    await sha256CanonicalIntelligence(report.scenarioRisk);
  const executionCapacityEvidenceSha256 =
    await sha256CanonicalIntelligence({
      executionStressManifestSha256:
        input.executionStressManifest.manifestSha256,
      summary,
    });
  const envelope = {
    schemaVersion:
      "cross-sectional-momentum-complete-evaluation-v1",
    strategyVersion: CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION,
    candidateStatus: "research-only-unselected",
    runtimeScopeChanged: false,
    selectionAuthority: "none",
    activationAuthority: "none",
    executionAuthority: "none",
    walkForwardManifestSha256:
      walkForwardManifest.manifestSha256,
    sensitivityManifestSha256:
      sensitivityManifest.manifestSha256,
    finalHoldoutPlanSha256:
      finalHoldout.plan.planSha256,
    finalHoldoutRunSha256:
      finalHoldout.run.runSha256,
    finalHoldoutResultSha256:
      finalHoldout.run.resultSha256,
    executionStressManifestSha256:
      input.executionStressManifest.manifestSha256,
    benchmarkEvidenceSha256,
    objectiveProgressEvidenceSha256,
    scenarioRiskEvidenceSha256,
    universeEvidenceSha256,
    executionCapacitySummary: summary,
    executionCapacityEvidenceSha256,
    report,
  } as const;
  return {
    ...envelope,
    evaluationSha256:
      await sha256CanonicalIntelligence(envelope),
  };
}
