import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAudCashBenchmark,
  buildBtcHoldBenchmark,
  buildEqualWeightHoldBenchmark,
  buildObjectivePathBenchmark,
  compareStrategyToBenchmarks,
  createResearchEquitySeries,
  summariseBenchmark,
  type ResearchEquitySeries,
} from "../src/research/benchmarks.ts";
import {
  analyseScenarioRisk,
  calculateObjectiveProgress,
  type ObjectiveDefinition,
} from "../src/research/objectiveMetrics.ts";
import { prepareResearchReport } from "../src/research/researchReport.ts";

const DIGESTS = {
  code: "a".repeat(64),
  data: "b".repeat(64),
  universe: "c".repeat(64),
  strategy: "d".repeat(64),
  execution: "e".repeat(64),
  objective: "f".repeat(64),
  benchmark: "1".repeat(64),
  fx: "2".repeat(64),
  cash: "3".repeat(64),
  btc: "4".repeat(64),
  equal: "5".repeat(64),
  comparisonOne: "6".repeat(64),
  comparisonTwo: "7".repeat(64),
} as const;
const TIMESTAMPS = [Date.UTC(2026, 0, 1), Date.UTC(2026, 1, 1), Date.UTC(2026, 2, 1)] as const;
const OBJECTIVE: ObjectiveDefinition = {
  currency: "USD",
  initialEquity: 200,
  targetEquity: 1_000_000,
  horizonMonths: 60,
};

function close(actual: number | undefined, expected: number, tolerance = 1e-9): void {
  if (actual === undefined) throw new Error("Expected numeric value");
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

function strategySeries(): ResearchEquitySeries {
  return createResearchEquitySeries({
    seriesId: "strategy-v1",
    kind: "strategy",
    currency: "AUD",
    points: [
      { timestampMs: TIMESTAMPS[0], equity: 200 },
      { timestampMs: TIMESTAMPS[1], equity: 220 },
      { timestampMs: TIMESTAMPS[2], equity: 242 },
    ],
    sourceDigests: [DIGESTS.strategy],
  });
}

function benchmarkSet(): readonly ResearchEquitySeries[] {
  return [
    buildObjectivePathBenchmark({
      seriesId: "objective-usd",
      objective: OBJECTIVE,
      timestampsMs: TIMESTAMPS,
      elapsedMonths: [0, 1, 2],
      sourceDigests: [DIGESTS.objective],
    }),
    buildEqualWeightHoldBenchmark({
      seriesId: "equal-weight-aud",
      currency: "AUD",
      initialEquity: 200,
      timestampsMs: TIMESTAMPS,
      assets: [
        {
          assetId: "BTC/AUD",
          prices: [100, 110, 120],
          sourceDigests: [DIGESTS.equal],
        },
        {
          assetId: "ETH/AUD",
          prices: [50, 45, 55],
          sourceDigests: [DIGESTS.data],
        },
      ],
    }),
    buildBtcHoldBenchmark({
      seriesId: "btc-hold-aud",
      currency: "AUD",
      initialEquity: 200,
      timestampsMs: TIMESTAMPS,
      prices: [100, 110, 120],
      sourceDigests: [DIGESTS.btc],
    }),
    buildAudCashBenchmark({
      seriesId: "aud-cash",
      currency: "AUD",
      initialEquity: 200,
      timestampsMs: TIMESTAMPS,
      periodReturns: [0.01, 0.02],
      sourceDigests: [DIGESTS.cash],
    }),
  ];
}

function reportInput() {
  const objectiveProgress = calculateObjectiveProgress(OBJECTIVE, 250, 2);
  const scenarioRisk = analyseScenarioRisk(OBJECTIVE, [
    { scenarioId: "gain", equity: [200, 400, 800] },
    { scenarioId: "loss", equity: [200, 100, 50] },
  ]);
  return {
    reportId: "research-run-0001",
    generatedAt: "2026-07-26T10:00:00.000Z",
    evaluationSplit: "final-holdout" as const,
    periodStartMs: TIMESTAMPS[0],
    periodEndMs: TIMESTAMPS[2],
    strategy: strategySeries(),
    benchmarks: benchmarkSet(),
    objectiveProgress,
    scenarioRisk,
    provenance: {
      codeSha256: DIGESTS.code,
      dataSha256: DIGESTS.data,
      universeSha256: DIGESTS.universe,
      strategyConfigSha256: DIGESTS.strategy,
      executionConfigSha256: DIGESTS.execution,
      objectiveConfigSha256: DIGESTS.objective,
      benchmarkConfigSha256: DIGESTS.benchmark,
      externalIntelligenceComparisonSha256s: [
        DIGESTS.comparisonTwo,
        DIGESTS.comparisonOne,
      ],
    },
    warnings: ["scenario-frequencies-are-not-forecasts", "synthetic-fixture"],
  };
}

test("cash and BTC benchmarks compound from explicit inputs", () => {
  const cash = benchmarkSet().find((series) => series.kind === "aud-cash");
  const btc = benchmarkSet().find((series) => series.kind === "btc-hold");
  if (cash === undefined || btc === undefined) throw new Error("Missing benchmark");
  close(cash.points[2]?.equity, 206.04);
  close(btc.points[2]?.equity, 240);
  close(summariseBenchmark(btc).totalReturnPct, 20);
});

test("equal-weight hold is unrebalanced and objective path preserves USD", () => {
  const equal = benchmarkSet().find((series) => series.kind === "equal-weight-hold");
  const objective = benchmarkSet().find((series) => series.kind === "objective-path");
  if (equal === undefined || objective === undefined) throw new Error("Missing benchmark");
  close(equal.points[2]?.equity, 230);
  assert.equal(objective.currency, "USD");
  close(objective.points[0]?.equity, 200);
  assert.ok((objective.points[2]?.equity ?? 0) > 200);
});

test("comparisons remain aligned and keep unlike currencies separate", () => {
  const comparisons = compareStrategyToBenchmarks(strategySeries(), benchmarkSet());
  const cash = comparisons.find((comparison) => comparison.benchmarkId === "aud-cash");
  const objective = comparisons.find(
    (comparison) => comparison.benchmarkId === "objective-usd",
  );
  assert.equal(cash?.comparable, true);
  assert.equal(objective?.comparable, false);
  if (objective?.comparable === false) assert.equal(objective.reason, "currency-mismatch");
});

test("research report is deterministic and content-addressed", async () => {
  const first = await prepareResearchReport(reportInput());
  const second = await prepareResearchReport({
    ...reportInput(),
    benchmarks: [...benchmarkSet()].reverse(),
    warnings: [...reportInput().warnings].reverse(),
  });
  assert.equal(first.reportSha256, second.reportSha256);
  const withoutIntelligenceComparison = await prepareResearchReport({
    ...reportInput(),
    provenance: {
      ...reportInput().provenance,
      externalIntelligenceComparisonSha256s: [],
    },
  });
  assert.notEqual(
    first.reportSha256,
    withoutIntelligenceComparison.reportSha256,
  );
  assert.match(first.reportSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    first.provenance.externalIntelligenceComparisonSha256s,
    [DIGESTS.comparisonOne, DIGESTS.comparisonTwo],
  );
  assert.deepEqual(first.benchmarks.map((benchmark) => benchmark.seriesId), [
    "aud-cash",
    "btc-hold-aud",
    "equal-weight-aud",
    "objective-usd",
  ]);
  assert.equal(
    first.comparisons.find((comparison) => comparison.benchmarkId === "objective-usd")
      ?.comparable,
    false,
  );
});

test("report fails closed for incomplete, misaligned or unproven comparisons", async () => {
  const input = reportInput();
  await assert.rejects(
    prepareResearchReport({ ...input, benchmarks: input.benchmarks.slice(1) }),
    /Missing required benchmark/,
  );

  const misaligned = input.benchmarks.map((benchmark) =>
    benchmark.kind === "btc-hold"
      ? {
          ...benchmark,
          points: benchmark.points.map((point, index) =>
            index === 1 ? { ...point, timestampMs: point.timestampMs + 1 } : point,
          ),
        }
      : benchmark,
  );
  await assert.rejects(
    prepareResearchReport({ ...input, benchmarks: misaligned }),
    /does not share the strategy cadence/,
  );

  await assert.rejects(
    prepareResearchReport({
      ...input,
      provenance: {
        ...input.provenance,
        externalIntelligenceComparisonSha256s: [
          DIGESTS.comparisonOne,
          DIGESTS.comparisonOne,
        ],
      },
    }),
    /cannot contain duplicates/u,
  );

  const convertedObjective = input.benchmarks.map((benchmark) =>
    benchmark.kind === "objective-path" ? { ...benchmark, currency: "AUD" as const } : benchmark,
  );
  await assert.rejects(
    prepareResearchReport({ ...input, benchmarks: convertedObjective }),
    /requires fxConversionSha256/,
  );

  const converted = await prepareResearchReport({
    ...input,
    benchmarks: convertedObjective,
    provenance: { ...input.provenance, fxConversionSha256: DIGESTS.fx },
  });
  assert.equal(
    converted.comparisons.find(
      (comparison) => comparison.benchmarkId === "objective-usd",
    )?.comparable,
    true,
  );
});
