import {
  verifyHourlyTrendBreakoutResearchRun,
  type HourlyTrendBreakoutBacktestPlan,
  type HourlyTrendBreakoutResearchRun,
} from "../backtest/hourlyTrendBreakout.ts";
import { runUniverseBoundBacktest } from "../backtest/universeMembership.ts";
import type {
  BacktestConfig,
  BacktestResult,
  BacktestStep,
  ExecutionStyle,
} from "../backtest/types.ts";
import {
  canonicalIntelligenceJson,
  sha256CanonicalIntelligence,
} from "../intelligence/canonical.ts";
import {
  HOURLY_TREND_BREAKOUT_STRATEGY_VERSION,
} from "../strategies/hourlyTrendBreakout.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const BASELINE_CAPITAL_AUD = 200;
const MAXIMUM_SOURCE_DIGESTS = 32;

export const REQUIRED_CAPACITY_LEVELS_AUD = [
  200,
  1_000,
  10_000,
  100_000,
  1_000_000,
] as const;

export const REQUIRED_EXECUTION_STRESS_SCENARIOS = [
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

export interface HourlyTrendBreakoutExecutionCalibration {
  readonly schemaVersion: "hourly-trend-breakout-execution-calibration-v1";
  readonly strategyVersion: typeof HOURLY_TREND_BREAKOUT_STRATEGY_VERSION;
  readonly baselinePlanSha256: string;
  readonly baselineRunSha256: string;
  readonly calibratedAtMs: number;
  readonly availableAtMs: number;
  readonly validUntilMs: number;
  readonly sourceSha256s: readonly string[];
  readonly capacityLevelsAud: typeof REQUIRED_CAPACITY_LEVELS_AUD;
  readonly scenarios: typeof REQUIRED_EXECUTION_STRESS_SCENARIOS;
  readonly calibrationSha256: string;
}

export interface HourlyTrendBreakoutExecutionCalibrationInput {
  readonly calibratedAtMs: number;
  readonly availableAtMs: number;
  readonly validUntilMs: number;
  readonly sourceSha256s: readonly string[];
}

export interface HourlyTrendBreakoutExecutionStressResult {
  readonly capitalAud: number;
  readonly scenarioId:
    (typeof REQUIRED_EXECUTION_STRESS_SCENARIOS)[number]["id"];
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

export interface HourlyTrendBreakoutExecutionStressManifest {
  readonly schemaVersion: "hourly-trend-breakout-execution-stress-v1";
  readonly strategyVersion: typeof HOURLY_TREND_BREAKOUT_STRATEGY_VERSION;
  readonly candidateStatus: "unselected-research-only";
  readonly baselinePlanSha256: string;
  readonly baselineRunSha256: string;
  readonly baselineResultSha256: string;
  readonly calibrationSha256: string;
  readonly evaluatedAtMs: number;
  readonly results: readonly HourlyTrendBreakoutExecutionStressResult[];
  readonly manifestSha256: string;
}

function finiteTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function canonicalCalibration(
  calibration: Omit<
    HourlyTrendBreakoutExecutionCalibration,
    "calibrationSha256"
  >,
): Readonly<Record<string, unknown>> {
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
  };
}

async function verifyCalibration(
  plan: HourlyTrendBreakoutBacktestPlan,
  run: HourlyTrendBreakoutResearchRun,
  calibration: HourlyTrendBreakoutExecutionCalibration,
): Promise<void> {
  const lastExecutionAtMs = plan.steps.at(-1)?.executionTimestampMs;
  if (
    calibration.schemaVersion !==
      "hourly-trend-breakout-execution-calibration-v1" ||
    calibration.strategyVersion !== HOURLY_TREND_BREAKOUT_STRATEGY_VERSION ||
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
    calibration.sourceSha256s.some((digest) => !SHA256_HEX.test(digest)) ||
    new Set(calibration.sourceSha256s).size !==
      calibration.sourceSha256s.length ||
    canonicalIntelligenceJson(calibration.sourceSha256s) !==
      canonicalIntelligenceJson([...calibration.sourceSha256s].sort()) ||
    canonicalIntelligenceJson(calibration.capacityLevelsAud) !==
      canonicalIntelligenceJson(REQUIRED_CAPACITY_LEVELS_AUD) ||
    canonicalIntelligenceJson(calibration.scenarios) !==
      canonicalIntelligenceJson(REQUIRED_EXECUTION_STRESS_SCENARIOS) ||
    !SHA256_HEX.test(calibration.calibrationSha256) ||
    calibration.calibrationSha256 !==
      (await sha256CanonicalIntelligence(
        canonicalCalibration(calibration),
      ))
  ) {
    throw new Error(
      "hourly trend/breakout execution calibration is invalid",
    );
  }
}

export async function verifyHourlyTrendBreakoutExecutionCalibration(
  plan: HourlyTrendBreakoutBacktestPlan,
  run: HourlyTrendBreakoutResearchRun,
  calibration: HourlyTrendBreakoutExecutionCalibration,
): Promise<void> {
  await verifyHourlyTrendBreakoutResearchRun(plan, run);
  await verifyCalibration(plan, run, calibration);
}

export async function prepareHourlyTrendBreakoutExecutionCalibration(
  plan: HourlyTrendBreakoutBacktestPlan,
  run: HourlyTrendBreakoutResearchRun,
  input: HourlyTrendBreakoutExecutionCalibrationInput,
): Promise<HourlyTrendBreakoutExecutionCalibration> {
  await verifyHourlyTrendBreakoutResearchRun(plan, run);
  const envelope = {
    schemaVersion: "hourly-trend-breakout-execution-calibration-v1",
    strategyVersion: HOURLY_TREND_BREAKOUT_STRATEGY_VERSION,
    baselinePlanSha256: plan.planSha256,
    baselineRunSha256: run.runSha256,
    calibratedAtMs: input.calibratedAtMs,
    availableAtMs: input.availableAtMs,
    validUntilMs: input.validUntilMs,
    sourceSha256s: [...input.sourceSha256s].sort(),
    capacityLevelsAud: REQUIRED_CAPACITY_LEVELS_AUD,
    scenarios: REQUIRED_EXECUTION_STRESS_SCENARIOS,
  } as const;
  const calibration = {
    ...envelope,
    calibrationSha256: await sha256CanonicalIntelligence(
      canonicalCalibration(envelope),
    ),
  };
  await verifyCalibration(plan, run, calibration);
  return calibration;
}

function scaledConfig(
  baseline: BacktestConfig,
  capitalAud: number,
  scenario: (typeof REQUIRED_EXECUTION_STRESS_SCENARIOS)[number],
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
      cashReserveAud: baseline.assumptions.cashReserveAud * scale,
    },
  };
}

function stressedSteps(
  steps: readonly BacktestStep[],
  scenario: (typeof REQUIRED_EXECUTION_STRESS_SCENARIOS)[number],
): readonly BacktestStep[] {
  return steps.map((step) => ({
    ...step,
    markets: step.markets.map((market) => ({
      ...market,
      spreadBps: market.spreadBps * scenario.spreadMultiplier,
      availableQuoteVolumeAud:
        market.availableQuoteVolumeAud * scenario.liquidityMultiplier,
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
    (typeof REQUIRED_EXECUTION_STRESS_SCENARIOS)[number]["id"],
  result: BacktestResult,
): Omit<
  HourlyTrendBreakoutExecutionStressResult,
  "configSha256" | "stepsSha256" | "resultSha256"
> {
  const requestedNotionalAud = result.executions.reduce(
    (sum, execution) => sum + execution.requestedNotionalAud,
    0,
  );
  const filledNotionalAud = result.executions.reduce(
    (sum, execution) => sum + execution.filledReferenceNotionalAud,
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
    capacityConstrainedExecutionCount: result.executions.filter(
      (execution) => execution.missedNotionalAud > 0,
    ).length,
  };
}

export async function prepareHourlyTrendBreakoutExecutionStressManifest(
  plan: HourlyTrendBreakoutBacktestPlan,
  run: HourlyTrendBreakoutResearchRun,
  calibration: HourlyTrendBreakoutExecutionCalibration,
  evaluatedAtMs: number,
): Promise<HourlyTrendBreakoutExecutionStressManifest> {
  await verifyHourlyTrendBreakoutResearchRun(plan, run);
  await verifyCalibration(plan, run, calibration);
  if (
    run.config.initialCashAud !== BASELINE_CAPITAL_AUD ||
    !finiteTimestamp(evaluatedAtMs) ||
    evaluatedAtMs < calibration.availableAtMs ||
    evaluatedAtMs > calibration.validUntilMs
  ) {
    throw new Error(
      "hourly trend/breakout execution stress evaluation is invalid",
    );
  }

  const results: HourlyTrendBreakoutExecutionStressResult[] = [];
  for (const capitalAud of REQUIRED_CAPACITY_LEVELS_AUD) {
    for (const scenario of REQUIRED_EXECUTION_STRESS_SCENARIOS) {
      const config = scaledConfig(run.config, capitalAud, scenario);
      const steps = stressedSteps(plan.steps, scenario);
      const result = runUniverseBoundBacktest(config, steps);
      results.push({
        ...resultMetrics(capitalAud, scenario.id, result),
        configSha256: await sha256CanonicalIntelligence(config),
        stepsSha256: await sha256CanonicalIntelligence(steps),
        resultSha256: await sha256CanonicalIntelligence(result),
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
      (await sha256CanonicalIntelligence(plan.steps)) ||
    baseline.resultSha256 !== run.resultSha256
  ) {
    throw new Error("execution stress baseline does not reproduce final holdout");
  }

  const envelope = {
    schemaVersion: "hourly-trend-breakout-execution-stress-v1",
    strategyVersion: HOURLY_TREND_BREAKOUT_STRATEGY_VERSION,
    candidateStatus: "unselected-research-only",
    baselinePlanSha256: plan.planSha256,
    baselineRunSha256: run.runSha256,
    baselineResultSha256: run.resultSha256,
    calibrationSha256: calibration.calibrationSha256,
    evaluatedAtMs,
    results,
  } as const;
  return {
    ...envelope,
    manifestSha256: await sha256CanonicalIntelligence(envelope),
  };
}

export async function verifyHourlyTrendBreakoutExecutionStressManifest(
  plan: HourlyTrendBreakoutBacktestPlan,
  run: HourlyTrendBreakoutResearchRun,
  calibration: HourlyTrendBreakoutExecutionCalibration,
  manifest: HourlyTrendBreakoutExecutionStressManifest,
): Promise<void> {
  const reproduced =
    await prepareHourlyTrendBreakoutExecutionStressManifest(
      plan,
      run,
      calibration,
      manifest.evaluatedAtMs,
    );
  if (
    manifest.manifestSha256 !== reproduced.manifestSha256 ||
    canonicalIntelligenceJson(manifest) !==
      canonicalIntelligenceJson(reproduced)
  ) {
    throw new Error(
      "hourly trend/breakout execution stress manifest is not reproducible",
    );
  }
}
