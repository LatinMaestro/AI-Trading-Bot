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
  prepareHourlyTrendBreakoutExecutionCalibration,
  prepareHourlyTrendBreakoutExecutionStressManifest,
  REQUIRED_CAPACITY_LEVELS_AUD,
  REQUIRED_EXECUTION_STRESS_SCENARIOS,
} from "../src/research/hourlyTrendBreakoutExecutionStress.ts";
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

function candles(latestClose: number): readonly Candle[] {
  return Array.from({ length: 240 }, (_, index) => {
    const close = index === 239 ? latestClose : 100 + index * 0.01;
    return {
      timestampMs: index * HOUR_MS,
      open: close,
      high: close + 0.2,
      low: close - 0.2,
      close,
      volume: 1_000,
    };
  });
}

async function membership(): Promise<UniverseSignalTimeMembership> {
  const envelope = {
    schemaVersion: "universe-signal-time-membership-v1",
    decisionAtMs: 240 * HOUR_MS,
    snapshotAsOfMs: 239 * HOUR_MS,
    snapshotAvailableAtMs: 240 * HOUR_MS,
    snapshotSha256: "a".repeat(64),
    signedPolicySha256: "b".repeat(64),
    eligiblePairs: ["BTC/AUD", "ETH/AUD"],
  } as const;
  return {
    ...envelope,
    membershipSha256: await sha256CanonicalIntelligence(envelope),
  };
}

async function fixture() {
  const frame: HourlyTrendBreakoutBacktestFrame = {
    membership: await membership(),
    candlesByPair: {
      "BTC/AUD": candles(110),
      "ETH/AUD": candles(105),
    },
    executionTimestampMs: 241 * HOUR_MS,
    markets: [
      {
        pair: "BTC/AUD",
        midPriceAud: 110,
        spreadBps: 10,
        availableQuoteVolumeAud: 2_000,
      },
      {
        pair: "ETH/AUD",
        midPriceAud: 105,
        spreadBps: 10,
        availableQuoteVolumeAud: 2_000,
      },
    ],
    executionStyle: "taker",
  };
  const plan = await prepareHourlyTrendBreakoutBacktestPlan([frame]);
  const run = await runHourlyTrendBreakoutResearch(CONFIG, plan);
  const calibration = await prepareHourlyTrendBreakoutExecutionCalibration(
    plan,
    run,
    {
      calibratedAtMs: 242 * HOUR_MS,
      availableAtMs: 243 * HOUR_MS,
      validUntilMs: 300 * HOUR_MS,
      sourceSha256s: ["d".repeat(64), "c".repeat(64)],
    },
  );
  return { plan, run, calibration };
}

test("reproduces the exact final holdout and fixed stress matrix", async () => {
  const { plan, run, calibration } = await fixture();
  const first = await prepareHourlyTrendBreakoutExecutionStressManifest(
    plan,
    run,
    calibration,
    244 * HOUR_MS,
  );
  const second = await prepareHourlyTrendBreakoutExecutionStressManifest(
    plan,
    run,
    calibration,
    244 * HOUR_MS,
  );
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.equal(first.candidateStatus, "unselected-research-only");
  assert.equal(
    first.results.length,
    REQUIRED_CAPACITY_LEVELS_AUD.length *
      REQUIRED_EXECUTION_STRESS_SCENARIOS.length,
  );
  assert.equal(first.results[0]?.resultSha256, run.resultSha256);
  assert.equal(first.results[0]?.configSha256, run.configSha256);
});

test("surfaces capacity constraints without selecting a scenario", async () => {
  const { plan, run, calibration } = await fixture();
  const manifest = await prepareHourlyTrendBreakoutExecutionStressManifest(
    plan,
    run,
    calibration,
    244 * HOUR_MS,
  );
  const constrained = manifest.results.find(
    (result) =>
      result.capitalAud === 1_000_000 &&
      result.scenarioId === "severe-combined",
  );
  assert.ok(constrained);
  assert.ok(constrained.missedFillNotionalAud > 0);
  assert.ok(constrained.capacityConstrainedExecutionCount > 0);
  assert.equal("selectedScenarioId" in manifest, false);
});

test("rejects stale or tampered calibration evidence", async () => {
  const { plan, run, calibration } = await fixture();
  await assert.rejects(
    prepareHourlyTrendBreakoutExecutionStressManifest(
      plan,
      run,
      calibration,
      301 * HOUR_MS,
    ),
    /evaluation is invalid/u,
  );
  await assert.rejects(
    prepareHourlyTrendBreakoutExecutionStressManifest(
      plan,
      run,
      {
        ...calibration,
        sourceSha256s: ["e".repeat(64)],
      },
      244 * HOUR_MS,
    ),
    /calibration is invalid/u,
  );
});

test("rejects calibration chronology that predates execution evidence", async () => {
  const { plan, run } = await fixture();
  await assert.rejects(
    prepareHourlyTrendBreakoutExecutionCalibration(plan, run, {
      calibratedAtMs: 240 * HOUR_MS,
      availableAtMs: 243 * HOUR_MS,
      validUntilMs: 300 * HOUR_MS,
      sourceSha256s: ["c".repeat(64)],
    }),
    /calibration is invalid/u,
  );
});
