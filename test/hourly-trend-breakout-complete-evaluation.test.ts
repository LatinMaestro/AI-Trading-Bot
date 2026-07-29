import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareHourlyTrendBreakoutBacktestPlan,
  runHourlyTrendBreakoutResearch,
  type HourlyTrendBreakoutBacktestFrame,
} from "../src/backtest/hourlyTrendBreakout.ts";
import type { BacktestConfig } from "../src/backtest/types.ts";
import type { Candle } from "../src/domain/types.ts";
import { sha256CanonicalIntelligence } from "../src/intelligence/canonical.ts";
import { HOUR_MS } from "../src/marketData/candleQuality.ts";
import {
  buildAudCashBenchmark,
  buildBtcHoldBenchmark,
  buildEqualWeightHoldBenchmark,
  buildObjectivePathBenchmark,
  createResearchEquitySeries,
} from "../src/research/benchmarks.ts";
import {
  REQUIRED_HOURLY_TREND_BREAKOUT_EVALUATION_WARNINGS,
  prepareHourlyTrendBreakoutCompleteEvaluation,
} from "../src/research/hourlyTrendBreakoutCompleteEvaluation.ts";
import {
  prepareHourlyTrendBreakoutSensitivityManifest,
  prepareHourlyTrendBreakoutWalkForwardManifest,
  type HourlyTrendBreakoutEvaluationRunInput,
} from "../src/research/hourlyTrendBreakoutEvaluation.ts";
import {
  analyseScenarioRisk,
  calculateObjectiveProgress,
  type ObjectiveDefinition,
} from "../src/research/objectiveMetrics.ts";
import type { ResearchReportInput } from "../src/research/researchReport.ts";
import {
  HOURLY_TREND_BREAKOUT_BASELINE_POLICY,
  type HourlyTrendBreakoutPolicy,
} from "../src/strategies/hourlyTrendBreakout.ts";
import type {
  UniverseSignalTimeMembership,
} from "../src/universe/signalTimeMembership.ts";

const CONFIG: BacktestConfig = {
  initialCashAud: 200,
  defaultExitStyle: "taker",
  assumptions: {
    makerFeeBps: 10,
    takerFeeBps: 20,
    takerSlippageBps: 5,
    makerAdverseSelectionBps: 2,
    impactCoefficientBps: 3,
    maximumImpactBps: 20,
    maximumParticipationRate: 0.5,
    makerFillRate: 0.8,
    minimumOrderAud: 10,
    cashReserveAud: 10,
  },
};
const OBJECTIVE: ObjectiveDefinition = {
  currency: "AUD",
  initialEquity: 200,
  targetEquity: 1_000_000,
  horizonMonths: 60,
};

function candles(decisionHour: number, latestClose: number): readonly Candle[] {
  const firstHour = decisionHour - 240;
  return Array.from({ length: 240 }, (_, index) => {
    const close = index === 239 ? latestClose : 100 + index * 0.01;
    return {
      timestampMs: (firstHour + index) * HOUR_MS,
      open: close,
      high: close + 0.2,
      low: close - 0.2,
      close,
      volume: 1_000,
    };
  });
}

async function membership(
  decisionHour: number,
): Promise<UniverseSignalTimeMembership> {
  const envelope = {
    schemaVersion: "universe-signal-time-membership-v1",
    decisionAtMs: decisionHour * HOUR_MS,
    snapshotAsOfMs: (decisionHour - 1) * HOUR_MS,
    snapshotAvailableAtMs: decisionHour * HOUR_MS,
    snapshotSha256: decisionHour.toString(16).padStart(64, "a").slice(-64),
    signedPolicySha256: "b".repeat(64),
    eligiblePairs: ["BTC/AUD", "ETH/AUD"],
  } as const;
  return {
    ...envelope,
    membershipSha256: await sha256CanonicalIntelligence(envelope),
  };
}

async function evaluationRun(
  startHour: number,
  count: number,
  policy: HourlyTrendBreakoutPolicy =
    HOURLY_TREND_BREAKOUT_BASELINE_POLICY,
): Promise<HourlyTrendBreakoutEvaluationRunInput> {
  const frames: HourlyTrendBreakoutBacktestFrame[] = [];
  for (let index = 0; index < count; index += 1) {
    const decisionHour = startHour + index;
    frames.push({
      membership: await membership(decisionHour),
      candlesByPair: {
        "BTC/AUD": candles(decisionHour, 110 + index),
        "ETH/AUD": candles(decisionHour, 105 + index),
      },
      executionTimestampMs: (decisionHour + 1) * HOUR_MS,
      markets: [
        {
          pair: "BTC/AUD",
          midPriceAud: 110 + index,
          spreadBps: 10,
          availableQuoteVolumeAud: 1_000_000,
        },
        {
          pair: "ETH/AUD",
          midPriceAud: 105 + index,
          spreadBps: 10,
          availableQuoteVolumeAud: 1_000_000,
        },
      ],
      executionStyle: "taker",
    });
  }
  const plan = await prepareHourlyTrendBreakoutBacktestPlan(frames, policy);
  return { plan, run: await runHourlyTrendBreakoutResearch(CONFIG, plan) };
}

async function fixture(): Promise<{
  readonly input: Parameters<
    typeof prepareHourlyTrendBreakoutCompleteEvaluation
  >[0];
  readonly report: ResearchReportInput;
}> {
  const finalHoldout = await evaluationRun(248, 3);
  const walkForwardManifest =
    await prepareHourlyTrendBreakoutWalkForwardManifest(
      [
        {
          foldIndex: 0,
          training: await evaluationRun(240, 2),
          validation: await evaluationRun(242, 2),
        },
        {
          foldIndex: 1,
          training: await evaluationRun(244, 1),
          validation: await evaluationRun(246, 2),
        },
      ],
      finalHoldout,
    );
  const sensitivityManifest =
    await prepareHourlyTrendBreakoutSensitivityManifest([
      finalHoldout,
      await evaluationRun(248, 3, {
        ...HOURLY_TREND_BREAKOUT_BASELINE_POLICY,
        entryLookbackHours: 192,
      }),
    ]);
  const timestamps = finalHoldout.run.result.equityCurve.map(
    (point) => point.timestampMs,
  );
  const strategy = createResearchEquitySeries({
    seriesId: "hourly-trend-breakout-final-holdout",
    kind: "strategy",
    currency: "AUD",
    points: finalHoldout.run.result.equityCurve.map((point) => ({
      timestampMs: point.timestampMs,
      equity: point.equityAud,
    })),
    sourceDigests: [
      finalHoldout.run.resultSha256,
      finalHoldout.run.runSha256,
    ],
  });
  const objectiveProgress = calculateObjectiveProgress(
    OBJECTIVE,
    finalHoldout.run.result.finalEquityAud,
    1,
  );
  const digests = {
    cash: "1".repeat(64),
    btc: "2".repeat(64),
    equal: "3".repeat(64),
    data: "4".repeat(64),
    code: "5".repeat(64),
    objective: "6".repeat(64),
    benchmark: "7".repeat(64),
    universe: "8".repeat(64),
  };
  const benchmarks = [
    buildAudCashBenchmark({
      seriesId: "aud-cash",
      currency: "AUD",
      initialEquity: 200,
      timestampsMs: timestamps,
      periodReturns: [0, 0],
      sourceDigests: [digests.cash],
    }),
    buildBtcHoldBenchmark({
      seriesId: "btc-hold",
      currency: "AUD",
      initialEquity: 200,
      timestampsMs: timestamps,
      prices: [110, 111, 112],
      sourceDigests: [digests.btc],
    }),
    buildEqualWeightHoldBenchmark({
      seriesId: "equal-weight-hold",
      currency: "AUD",
      initialEquity: 200,
      timestampsMs: timestamps,
      assets: [
        {
          assetId: "BTC/AUD",
          prices: [110, 111, 112],
          sourceDigests: [digests.btc],
        },
        {
          assetId: "ETH/AUD",
          prices: [105, 106, 107],
          sourceDigests: [digests.equal],
        },
      ],
    }),
    buildObjectivePathBenchmark({
      seriesId: "objective-path",
      objective: OBJECTIVE,
      timestampsMs: timestamps,
      elapsedMonths: [0, 0.5, 1],
      sourceDigests: [digests.objective],
    }),
  ];
  const strategyBacktestRunSha256s = [
    ...walkForwardManifest.folds.flatMap((fold) => [
      fold.trainingRunSha256,
      fold.validationRunSha256,
    ]),
    walkForwardManifest.finalHoldout.runSha256,
    ...sensitivityManifest.variants.map((variant) => variant.runSha256),
  ].filter((value, index, values) => values.indexOf(value) === index);
  const report: ResearchReportInput = {
    reportId: "hourly-trend-breakout-final-holdout-0001",
    generatedAt: new Date((251 * HOUR_MS) + 1).toISOString(),
    evaluationSplit: "final-holdout",
    periodStartMs: timestamps[0]!,
    periodEndMs: timestamps.at(-1)!,
    strategy,
    benchmarks,
    objectiveProgress,
    scenarioRisk: analyseScenarioRisk(OBJECTIVE, [
      { scenarioId: "gain", equity: [200, 300, 500] },
      { scenarioId: "loss", equity: [200, 50, 0] },
    ]),
    provenance: {
      codeSha256: digests.code,
      dataSha256: digests.data,
      universeSha256: digests.universe,
      strategyConfigSha256: walkForwardManifest.policySha256,
      executionConfigSha256: finalHoldout.run.configSha256,
      objectiveConfigSha256: digests.objective,
      benchmarkConfigSha256: digests.benchmark,
      externalIntelligenceComparisonSha256s: [],
      strategyBacktestRunSha256s,
      strategyEvaluationManifestSha256s: [
        sensitivityManifest.manifestSha256,
        walkForwardManifest.manifestSha256,
      ],
    },
    warnings: [...REQUIRED_HOURLY_TREND_BREAKOUT_EVALUATION_WARNINGS],
  };
  return {
    input: {
      walkForwardManifest,
      sensitivityManifest,
      finalHoldout,
      report,
    },
    report,
  };
}

test("binds complete final-holdout evidence without selecting a strategy", async () => {
  const { input } = await fixture();
  const first = await prepareHourlyTrendBreakoutCompleteEvaluation(input);
  const second = await prepareHourlyTrendBreakoutCompleteEvaluation({
    ...input,
    report: {
      ...input.report,
      benchmarks: [...input.report.benchmarks].reverse(),
      warnings: [...input.report.warnings].reverse(),
    },
  });
  assert.equal(first.evaluationSha256, second.evaluationSha256);
  assert.equal(first.report.benchmarks.length, 4);
  assert.equal(first.report.scenarioRisk.terminalSubstantialLossProbability, 0.5);
  assert.equal("selectedRunSha256" in first, false);
  assert.equal("promoted" in first, false);
  assert.match(first.evaluationSha256, /^[0-9a-f]{64}$/u);
});

test("fails closed for incomplete or inconsistent evaluation evidence", async () => {
  const { input, report } = await fixture();
  await assert.rejects(
    prepareHourlyTrendBreakoutCompleteEvaluation({
      ...input,
      report: {
        ...report,
        benchmarks: report.benchmarks.slice(1),
      },
    }),
    /Missing required benchmark/u,
  );
  await assert.rejects(
    prepareHourlyTrendBreakoutCompleteEvaluation({
      ...input,
      report: {
        ...report,
        provenance: {
          ...report.provenance,
          strategyEvaluationManifestSha256s: [
            input.walkForwardManifest.manifestSha256,
          ],
        },
      },
    }),
    /does not bind the complete evaluation evidence/u,
  );
  await assert.rejects(
    prepareHourlyTrendBreakoutCompleteEvaluation({
      ...input,
      report: {
        ...report,
        strategy: {
          ...report.strategy,
          points: report.strategy.points.map((point, index) =>
            index === 1 ? { ...point, equity: point.equity + 1 } : point,
          ),
        },
      },
    }),
    /does not bind the final holdout result/u,
  );
  await assert.rejects(
    prepareHourlyTrendBreakoutCompleteEvaluation({
      ...input,
      report: {
        ...report,
        warnings: report.warnings.slice(1),
      },
    }),
    /requires warning/u,
  );
});
