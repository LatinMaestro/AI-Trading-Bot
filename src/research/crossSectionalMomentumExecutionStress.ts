import {
  verifyCrossSectionalMomentumResearchRun,
  type CrossSectionalMomentumBacktestPlan,
  type CrossSectionalMomentumBacktestStep,
  type CrossSectionalMomentumResearchRun,
  type RunUniverseBoundBacktest,
} from "../backtest/crossSectionalMomentum.ts";
import type {
  BacktestConfig,
  BacktestResult,
  ExecutionStyle,
} from "../backtest/types.ts";
import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import {
  CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION,
} from "../strategies/crossSectionalMomentum.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const BASELINE_CAPITAL_AUD = 200;
const MAXIMUM_SOURCE_DIGESTS = 32;

export const REQUIRED_CROSS_SECTIONAL_CAPACITY_LEVELS_AUD = [
  200,
  1_000,
  10_000,
  100_000,
  1_000_000,
] as const;

export const REQUIRED_CROSS_SECTIONAL_EXECUTION_SCENARIOS = [
  {
    id: "baseline",
    spreadMultiplier: 1,
    liquidityMultiplier: 1,
    makerFillRateMultiplier: 1,
    takerSlippageMultiplier: 1,
    impactCoefficientMultiplier: 1,
    executionStyleOverride: null,
  },
  {
    id: "all-maker",
    spreadMultiplier: 1,
    liquidityMultiplier: 1,
    makerFillRateMultiplier: 1,
    takerSlippageMultiplier: 1,
    impactCoefficientMultiplier: 1,
    executionStyleOverride: "maker",
  },
  {
    id: "all-taker",
    spreadMultiplier: 1,
    liquidityMultiplier: 1,
    makerFillRateMultiplier: 1,
    takerSlippageMultiplier: 1,
    impactCoefficientMultiplier: 1,
    executionStyleOverride: "taker",
  },
  {
    id: "double-spread",
    spreadMultiplier: 2,
    liquidityMultiplier: 1,
    makerFillRateMultiplier: 1,
    takerSlippageMultiplier: 1,
    impactCoefficientMultiplier: 1,
    executionStyleOverride: null,
  },
  {
    id: "quarter-liquidity",
    spreadMultiplier: 1,
    liquidityMultiplier: 0.25,
    makerFillRateMultiplier: 1,
    takerSlippageMultiplier: 1,
    impactCoefficientMultiplier: 1,
    executionStyleOverride: null,
  },
  {
    id: "quarter-maker-fill",
    spreadMultiplier: 1,
    liquidityMultiplier: 1,
    makerFillRateMultiplier: 0.25,
    takerSlippageMultiplier: 1,
    impactCoefficientMultiplier: 1,
    executionStyleOverride: "maker",
  },
  {
    id: "double-taker-slippage",
    spreadMultiplier: 1,
    liquidityMultiplier: 1,
    makerFillRateMultiplier: 1,
    takerSlippageMultiplier: 2,
    impactCoefficientMultiplier: 1,
    executionStyleOverride: null,
  },
  {
    id: "severe-combined",
    spreadMultiplier: 2,
    liquidityMultiplier: 0.25,
    makerFillRateMultiplier: 0.25,
    takerSlippageMultiplier: 2,
    impactCoefficientMultiplier: 2,
    executionStyleOverride: null,
  },
] as const;

export interface CrossSectionalMomentumExecutionCalibration {
  readonly schemaVersion:
    "cross-sectional-momentum-execution-calibration-v1";
  readonly strategyVersion:
    typeof CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION;
  readonly baselinePlanSha256: string;
  readonly baselineRunSha256: string;
  readonly calibratedAtMs: number;
  readonly availableAtMs: number;
  readonly validUntilMs: number;
  readonly sourceSha256s: readonly string[];
  readonly capacityLevelsAud:
    typeof REQUIRED_CROSS_SECTIONAL_CAPACITY_LEVELS_AUD;
  readonly scenarios:
    typeof REQUIRED_CROSS_SECTIONAL_EXECUTION_SCENARIOS;
  readonly calibrationSha256: string;
}

export interface CrossSectionalMomentumExecutionCalibrationInput {
  readonly calibratedAtMs: number;
  readonly availableAtMs: number;
  readonly validUntilMs: number;
  readonly sourceSha256s: readonly string[];
}

export interface CrossSectionalMomentumExecutionStressResult {
  readonly capitalAud: number;
  readonly scenarioId:
    (typeof REQUIRED_CROSS_SECTIONAL_EXECUTION_SCENARIOS)[number]["id"];
  readonly configSha256: string;
  readonly stepsSha256: string;
  readonly resultSha256: string;
  readonly finalEquityAud: number;
  readonly totalReturnPct: number;
  readonly maximumDrawdownPct: number;
  readonly turnoverMultiple: number;
  readonly totalCostAud: number;
  readonly requestedNotionalAud: number;
  readonly filledNotionalAud: number;
  readonly missedFillNotionalAud: number;
  readonly missedFillRatio: number;
  readonly capacityConstrainedExecutionCount: number;
}

export interface CrossSectionalMomentumExecutionStressManifest {
  readonly schemaVersion:
    "cross-sectional-momentum-execution-stress-v1";
  readonly strategyVersion:
    typeof CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION;
  readonly candidateStatus: "research-only-unselected";
  readonly runtimeScopeChanged: false;
  readonly selectionAuthority: "none";
  readonly activationAuthority: "none";
  readonly executionAuthority: "none";
  readonly baselinePlanSha256: string;
  readonly baselineRunSha256: string;
  readonly baselineResultSha256: string;
  readonly calibrationSha256: string;
  readonly evaluatedAtMs: number;
  readonly results:
    readonly CrossSectionalMomentumExecutionStressResult[];
  readonly manifestSha256: string;
}

function finiteTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function canonicalCalibration(
  calibration: Omit<
    CrossSectionalMomentumExecutionCalibration,
    "calibrationSha256"
  >,
) {
  return {
    schemaVersion: calibration.schemaVersion,
    strategyVersion: calibration.strategyVersion,
    baselinePlanSha256: calibration.baselinePlanSha256,
    baselineRunSha256: calibration.baselineRunSha256,
    calibratedAtMs: calibration.calibratedAtMs,
    availableAtMs: calibration.availableAtMs,
    validUntilMs: calibration.validUntilMs,
    sourceSha256s: calibration.sourceSha256s,
    capacityLevelsAud: calibration.capacityLevelsAud,
    scenarios: calibration.scenarios,
  } as const;
}

async function verifyCalibration(
  plan: CrossSectionalMomentumBacktestPlan,
  run: CrossSectionalMomentumResearchRun<
    BacktestConfig,
    BacktestResult
  >,
  runner: RunUniverseBoundBacktest<BacktestConfig, BacktestResult>,
  calibration: CrossSectionalMomentumExecutionCalibration,
): Promise<void> {
  await verifyCrossSectionalMomentumResearchRun(plan, run, runner);
  const lastExecutionAtMs =
    plan.steps.at(-1)?.executionTimestampMs;
  if (
    calibration.schemaVersion !==
      "cross-sectional-momentum-execution-calibration-v1" ||
    calibration.strategyVersion !==
      CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION ||
    calibration.baselinePlanSha256 !== plan.planSha256 ||
    calibration.baselineRunSha256 !== run.runSha256 ||
    lastExecutionAtMs === undefined ||
    !finiteTimestamp(calibration.calibratedAtMs) ||
    !finiteTimestamp(calibration.availableAtMs) ||
    !finiteTimestamp(calibration.validUntilMs) ||
    calibration.calibratedAtMs < lastExecutionAtMs ||
    calibration.availableAtMs < calibration.calibratedAtMs ||
    calibration.validUntilMs <= calibration.availableAtMs ||
    calibration.sourceSha256s.length < 1 ||
    calibration.sourceSha256s.length > MAXIMUM_SOURCE_DIGESTS ||
    calibration.sourceSha256s.some(
      (digest) => !SHA256_HEX.test(digest),
    ) ||
    new Set(calibration.sourceSha256s).size !==
      calibration.sourceSha256s.length ||
    canonicalIntelligenceJson(calibration.sourceSha256s) !==
      canonicalIntelligenceJson(
        [...calibration.sourceSha256s].sort(),
      ) ||
    canonicalIntelligenceJson(calibration.capacityLevelsAud) !==
      canonicalIntelligenceJson(
        REQUIRED_CROSS_SECTIONAL_CAPACITY_LEVELS_AUD,
      ) ||
    canonicalIntelligenceJson(calibration.scenarios) !==
      canonicalIntelligenceJson(
        REQUIRED_CROSS_SECTIONAL_EXECUTION_SCENARIOS,
      ) ||
    !SHA256_HEX.test(calibration.calibrationSha256) ||
    calibration.calibrationSha256 !==
      await sha256CanonicalIntelligence(
        canonicalCalibration(calibration),
      )
  ) {
    throw new Error(
      "cross-sectional execution calibration is invalid",
    );
  }
}

export async function prepareCrossSectionalMomentumExecutionCalibration(
  plan: CrossSectionalMomentumBacktestPlan,
  run: CrossSectionalMomentumResearchRun<
    BacktestConfig,
    BacktestResult
  >,
  runner: RunUniverseBoundBacktest<BacktestConfig, BacktestResult>,
  input: CrossSectionalMomentumExecutionCalibrationInput,
): Promise<CrossSectionalMomentumExecutionCalibration> {
  await verifyCrossSectionalMomentumResearchRun(plan, run, runner);
  const envelope = {
    schemaVersion:
      "cross-sectional-momentum-execution-calibration-v1",
    strategyVersion: CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION,
    baselinePlanSha256: plan.planSha256,
    baselineRunSha256: run.runSha256,
    calibratedAtMs: input.calibratedAtMs,
    availableAtMs: input.availableAtMs,
    validUntilMs: input.validUntilMs,
    sourceSha256s: [...input.sourceSha256s].sort(),
    capacityLevelsAud:
      REQUIRED_CROSS_SECTIONAL_CAPACITY_LEVELS_AUD,
    scenarios: REQUIRED_CROSS_SECTIONAL_EXECUTION_SCENARIOS,
  } as const;
  const calibration = {
    ...envelope,
    calibrationSha256:
      await sha256CanonicalIntelligence(
        canonicalCalibration(envelope),
      ),
  };
  await verifyCalibration(plan, run, runner, calibration);
  return calibration;
}

function scaledConfig(
  baseline: BacktestConfig,
  capitalAud: number,
  scenario:
    (typeof REQUIRED_CROSS_SECTIONAL_EXECUTION_SCENARIOS)[number],
): BacktestConfig {
  const scale = capitalAud / baseline.initialCashAud;
  return {
    initialCashAud: capitalAud,
    defaultExitStyle:
      scenario.executionStyleOverride ?? baseline.defaultExitStyle,
    assumptions: {
      ...baseline.assumptions,
      makerFillRate:
        baseline.assumptions.makerFillRate *
        scenario.makerFillRateMultiplier,
      takerSlippageBps:
        baseline.assumptions.takerSlippageBps *
        scenario.takerSlippageMultiplier,
      impactCoefficientBps:
        baseline.assumptions.impactCoefficientBps *
        scenario.impactCoefficientMultiplier,
      cashReserveAud:
        baseline.assumptions.cashReserveAud * scale,
    },
  };
}

function stressedSteps(
  steps: readonly CrossSectionalMomentumBacktestStep[],
  scenario:
    (typeof REQUIRED_CROSS_SECTIONAL_EXECUTION_SCENARIOS)[number],
): readonly CrossSectionalMomentumBacktestStep[] {
  return steps.map((step) => ({
    ...step,
    markets: step.markets.map((market) => ({
      ...market,
      spreadBps: market.spreadBps * scenario.spreadMultiplier,
      availableQuoteVolumeAud:
        market.availableQuoteVolumeAud *
        scenario.liquidityMultiplier,
    })),
    targets: step.targets.map((target) => ({
      ...target,
      executionStyle:
        (scenario.executionStyleOverride as ExecutionStyle | null) ??
        target.executionStyle,
    })),
  }));
}

function resultMetrics(
  capitalAud: number,
  scenarioId:
    (typeof REQUIRED_CROSS_SECTIONAL_EXECUTION_SCENARIOS)[number]["id"],
  result: BacktestResult,
): Omit<
  CrossSectionalMomentumExecutionStressResult,
  "configSha256" | "stepsSha256" | "resultSha256"
> {
  const requestedNotionalAud = result.executions.reduce(
    (sum, execution) =>
      sum + execution.requestedNotionalAud,
    0,
  );
  const filledNotionalAud = result.executions.reduce(
    (sum, execution) =>
      sum + execution.filledReferenceNotionalAud,
    0,
  );
  const missedFillNotionalAud = result.executions.reduce(
    (sum, execution) => sum + execution.missedNotionalAud,
    0,
  );
  return {
    capitalAud,
    scenarioId,
    finalEquityAud: result.finalEquityAud,
    totalReturnPct: result.totalReturnPct,
    maximumDrawdownPct: result.maximumDrawdownPct,
    turnoverMultiple: result.turnoverMultiple,
    totalCostAud: result.costs.totalAud,
    requestedNotionalAud,
    filledNotionalAud,
    missedFillNotionalAud,
    missedFillRatio:
      requestedNotionalAud > 0
        ? missedFillNotionalAud / requestedNotionalAud
        : 0,
    capacityConstrainedExecutionCount:
      result.executions.filter(
        (execution) => execution.missedNotionalAud > 0,
      ).length,
  };
}

export async function prepareCrossSectionalMomentumExecutionStressManifest(
  plan: CrossSectionalMomentumBacktestPlan,
  run: CrossSectionalMomentumResearchRun<
    BacktestConfig,
    BacktestResult
  >,
  runner: RunUniverseBoundBacktest<BacktestConfig, BacktestResult>,
  calibration: CrossSectionalMomentumExecutionCalibration,
  evaluatedAtMs: number,
): Promise<CrossSectionalMomentumExecutionStressManifest> {
  await verifyCalibration(plan, run, runner, calibration);
  if (
    run.config.initialCashAud !== BASELINE_CAPITAL_AUD ||
    !finiteTimestamp(evaluatedAtMs) ||
    evaluatedAtMs < calibration.availableAtMs ||
    evaluatedAtMs > calibration.validUntilMs
  ) {
    throw new Error(
      "cross-sectional execution stress evaluation is invalid",
    );
  }

  const results: CrossSectionalMomentumExecutionStressResult[] = [];
  for (
    const capitalAud of
      REQUIRED_CROSS_SECTIONAL_CAPACITY_LEVELS_AUD
  ) {
    for (
      const scenario of
        REQUIRED_CROSS_SECTIONAL_EXECUTION_SCENARIOS
    ) {
      const config = scaledConfig(run.config, capitalAud, scenario);
      const steps = stressedSteps(plan.steps, scenario);
      const result = await runner(config, steps);
      results.push({
        ...resultMetrics(capitalAud, scenario.id, result),
        configSha256:
          await sha256CanonicalIntelligence(config),
        stepsSha256:
          await sha256CanonicalIntelligence(steps),
        resultSha256:
          await sha256CanonicalIntelligence(result),
      });
    }
  }

  const baseline = results[0];
  if (
    baseline === undefined ||
    baseline.scenarioId !== "baseline" ||
    baseline.capitalAud !== BASELINE_CAPITAL_AUD ||
    baseline.configSha256 !== run.configSha256 ||
    baseline.stepsSha256 !==
      await sha256CanonicalIntelligence(plan.steps) ||
    baseline.resultSha256 !== run.resultSha256
  ) {
    throw new Error(
      "cross-sectional stress baseline does not reproduce final holdout",
    );
  }

  const envelope = {
    schemaVersion:
      "cross-sectional-momentum-execution-stress-v1",
    strategyVersion: CROSS_SECTIONAL_MOMENTUM_STRATEGY_VERSION,
    candidateStatus: "research-only-unselected",
    runtimeScopeChanged: false,
    selectionAuthority: "none",
    activationAuthority: "none",
    executionAuthority: "none",
    baselinePlanSha256: plan.planSha256,
    baselineRunSha256: run.runSha256,
    baselineResultSha256: run.resultSha256,
    calibrationSha256: calibration.calibrationSha256,
    evaluatedAtMs,
    results,
  } as const;
  return {
    ...envelope,
    manifestSha256:
      await sha256CanonicalIntelligence(envelope),
  };
}

export async function verifyCrossSectionalMomentumExecutionStressManifest(
  plan: CrossSectionalMomentumBacktestPlan,
  run: CrossSectionalMomentumResearchRun<
    BacktestConfig,
    BacktestResult
  >,
  runner: RunUniverseBoundBacktest<BacktestConfig, BacktestResult>,
  calibration: CrossSectionalMomentumExecutionCalibration,
  manifest: CrossSectionalMomentumExecutionStressManifest,
): Promise<void> {
  const reproduced =
    await prepareCrossSectionalMomentumExecutionStressManifest(
      plan,
      run,
      runner,
      calibration,
      manifest.evaluatedAtMs,
    );
  if (
    manifest.manifestSha256 !== reproduced.manifestSha256 ||
    canonicalIntelligenceJson(manifest) !==
      canonicalIntelligenceJson(reproduced)
  ) {
    throw new Error(
      "cross-sectional execution stress manifest is not reproducible",
    );
  }
}
