import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareCrossSectionalMomentumBacktestPlan,
  runCrossSectionalMomentumResearch,
  type CrossSectionalMomentumBacktestFrame,
  type CrossSectionalMomentumBacktestStep,
  type CrossSectionalMomentumUniverseMembership,
} from "../src/backtest/crossSectionalMomentum.ts";
import type {
  BacktestConfig,
  BacktestExecution,
  BacktestResult,
} from "../src/backtest/types.ts";
import { sha256CanonicalIntelligence } from "../src/intelligence/canonical.ts";
import {
  REQUIRED_CROSS_SECTIONAL_CAPACITY_LEVELS_AUD,
  REQUIRED_CROSS_SECTIONAL_EXECUTION_SCENARIOS,
  prepareCrossSectionalMomentumExecutionCalibration,
  prepareCrossSectionalMomentumExecutionStressManifest,
  verifyCrossSectionalMomentumExecutionStressManifest,
} from "../src/research/crossSectionalMomentumExecutionStress.ts";
import type {
  HourlyClose,
} from "../src/strategies/crossSectionalMomentum.ts";

const HOUR_MS = 3_600_000;
const HISTORY_LENGTH = 721;
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

function history(
  hourlyReturn: number,
): readonly HourlyClose[] {
  return Array.from({ length: HISTORY_LENGTH }, (_, index) => ({
    timestampMs: index * HOUR_MS,
    close: 100 * (1 + hourlyReturn) ** index,
  }));
}

async function membership(): Promise<
  CrossSectionalMomentumUniverseMembership
> {
  const envelope = {
    schemaVersion: "universe-signal-time-membership-v1",
    decisionAtMs: HISTORY_LENGTH * HOUR_MS,
    snapshotAsOfMs: (HISTORY_LENGTH - 1) * HOUR_MS,
    snapshotAvailableAtMs: HISTORY_LENGTH * HOUR_MS,
    snapshotSha256: "a".repeat(64),
    signedPolicySha256: "b".repeat(64),
    eligiblePairs: ["BTC/AUD", "ETH/AUD"],
  } as const;
  return {
    ...envelope,
    membershipSha256:
      await sha256CanonicalIntelligence(envelope),
  };
}

async function frame(): Promise<
  CrossSectionalMomentumBacktestFrame
> {
  const closes = {
    "BTC/AUD": history(0.0005),
    "ETH/AUD": history(0.001),
  } as const;
  return {
    membership: await membership(),
    hourlyClosesByPair: closes,
    executionTimestampMs: (HISTORY_LENGTH + 1) * HOUR_MS,
    markets: ["BTC/AUD", "ETH/AUD"].map((pair) => ({
      pair,
      midPriceAud:
        closes[pair as keyof typeof closes].at(-1)!.close,
      spreadBps: 5,
      availableQuoteVolumeAud: 10_000,
    })),
    executionStyle: "taker",
  };
}

function runner(
  config: BacktestConfig,
  steps: readonly CrossSectionalMomentumBacktestStep[],
): BacktestResult {
  const executions: BacktestExecution[] = [];
  for (const step of steps) {
    for (const target of step.targets) {
      const market = step.markets.find(
        (candidate) => candidate.pair === target.pair,
      )!;
      const requestedNotionalAud = Math.max(
        0,
        (config.initialCashAud -
          config.assumptions.cashReserveAud) *
          target.targetWeight,
      );
      const liquidityLimit =
        market.availableQuoteVolumeAud *
        config.assumptions.maximumParticipationRate;
      const fillRate =
        target.executionStyle === "maker"
          ? config.assumptions.makerFillRate
          : 1;
      const filledReferenceNotionalAud =
        Math.min(requestedNotionalAud, liquidityLimit) * fillRate;
      const missedNotionalAud =
        requestedNotionalAud - filledReferenceNotionalAud;
      const feeBps =
        target.executionStyle === "maker"
          ? config.assumptions.makerFeeBps
          : config.assumptions.takerFeeBps;
      const slippageBps =
        target.executionStyle === "taker"
          ? config.assumptions.takerSlippageBps
          : config.assumptions.makerAdverseSelectionBps;
      const impactBps = Math.min(
        config.assumptions.maximumImpactBps,
        config.assumptions.impactCoefficientBps *
          Math.sqrt(
            filledReferenceNotionalAud /
              Math.max(1, market.availableQuoteVolumeAud),
          ),
      );
      const feeAud =
        filledReferenceNotionalAud * feeBps / 10_000;
      const spreadCostAud =
        filledReferenceNotionalAud * market.spreadBps / 20_000;
      const slippageCostAud =
        filledReferenceNotionalAud * slippageBps / 10_000;
      const impactCostAud =
        filledReferenceNotionalAud * impactBps / 10_000;
      executions.push({
        timestampMs: step.executionTimestampMs,
        pair: target.pair,
        side: "buy",
        executionStyle: target.executionStyle,
        status:
          filledReferenceNotionalAud === 0
            ? "missed"
            : missedNotionalAud > 0
              ? "partially-filled"
              : "filled",
        requestedNotionalAud,
        filledReferenceNotionalAud,
        missedNotionalAud,
        units:
          filledReferenceNotionalAud / market.midPriceAud,
        referenceMidPriceAud: market.midPriceAud,
        executionPriceAud: market.midPriceAud,
        feeAud,
        spreadCostAud,
        slippageCostAud,
        impactCostAud,
        impactBps,
      });
    }
  }
  const feesAud = executions.reduce(
    (sum, execution) => sum + execution.feeAud,
    0,
  );
  const spreadAud = executions.reduce(
    (sum, execution) => sum + execution.spreadCostAud,
    0,
  );
  const slippageAud = executions.reduce(
    (sum, execution) => sum + execution.slippageCostAud,
    0,
  );
  const impactAud = executions.reduce(
    (sum, execution) => sum + execution.impactCostAud,
    0,
  );
  const missedFillNotionalAud = executions.reduce(
    (sum, execution) => sum + execution.missedNotionalAud,
    0,
  );
  const totalAud = feesAud + spreadAud + slippageAud + impactAud;
  const finalEquityAud = Math.max(
    0,
    config.initialCashAud * 1.1 -
      totalAud -
      missedFillNotionalAud * 0.001,
  );
  const requested = executions.reduce(
    (sum, execution) => sum + execution.requestedNotionalAud,
    0,
  );
  return {
    initialEquityAud: config.initialCashAud,
    finalEquityAud,
    totalReturnPct:
      (finalEquityAud / config.initialCashAud - 1) * 100,
    maximumDrawdownPct:
      Math.max(0, 100 - finalEquityAud / config.initialCashAud * 100),
    turnoverMultiple: requested / config.initialCashAud,
    executions,
    equityCurve: [
      {
        timestampMs: steps[0]!.signalTimestampMs,
        equityAud: config.initialCashAud,
        cashAud: config.initialCashAud,
        grossExposureAud: 0,
        drawdownPct: 0,
      },
      {
        timestampMs: steps.at(-1)!.executionTimestampMs,
        equityAud: finalEquityAud,
        cashAud:
          Math.max(0, config.initialCashAud - requested),
        grossExposureAud: Math.min(
          requested,
          executions.reduce(
            (sum, execution) =>
              sum + execution.filledReferenceNotionalAud,
            0,
          ),
        ),
        drawdownPct:
          Math.max(
            0,
            100 -
              finalEquityAud / config.initialCashAud * 100,
          ),
      },
    ],
    finalPositions: [],
    costs: {
      feesAud,
      spreadAud,
      slippageAud,
      impactAud,
      totalAud,
      missedFillNotionalAud,
    },
    executionGateFrameSha256s: [],
    universeMembershipSha256s: steps.map(
      (step) => step.universeMembership.membershipSha256,
    ),
    suppressedExecutions: [],
  };
}

async function fixture() {
  const plan =
    await prepareCrossSectionalMomentumBacktestPlan([await frame()]);
  const run = await runCrossSectionalMomentumResearch(
    CONFIG,
    plan,
    runner,
  );
  const calibration =
    await prepareCrossSectionalMomentumExecutionCalibration(
      plan,
      run,
      runner,
      {
        calibratedAtMs: (HISTORY_LENGTH + 2) * HOUR_MS,
        availableAtMs: (HISTORY_LENGTH + 3) * HOUR_MS,
        validUntilMs: (HISTORY_LENGTH + 100) * HOUR_MS,
        sourceSha256s: ["c".repeat(64), "d".repeat(64)],
      },
    );
  return { plan, run, calibration };
}

test("evaluates the complete fixed capacity and execution matrix", async () => {
  const { plan, run, calibration } = await fixture();
  const manifest =
    await prepareCrossSectionalMomentumExecutionStressManifest(
      plan,
      run,
      runner,
      calibration,
      (HISTORY_LENGTH + 4) * HOUR_MS,
    );
  assert.equal(
    manifest.results.length,
    REQUIRED_CROSS_SECTIONAL_CAPACITY_LEVELS_AUD.length *
      REQUIRED_CROSS_SECTIONAL_EXECUTION_SCENARIOS.length,
  );
  assert.deepEqual(
    [...new Set(manifest.results.map((result) => result.capitalAud))],
    REQUIRED_CROSS_SECTIONAL_CAPACITY_LEVELS_AUD,
  );
  assert.equal(manifest.results[0]!.resultSha256, run.resultSha256);
  assert.equal(
    manifest.results.some(
      (result) =>
        result.capitalAud === 1_000_000 &&
        result.scenarioId === "severe-combined" &&
        result.missedFillRatio > 0 &&
        result.capacityConstrainedExecutionCount > 0,
    ),
    true,
  );
  assert.equal(manifest.candidateStatus, "research-only-unselected");
  assert.equal(manifest.runtimeScopeChanged, false);
  assert.equal(manifest.executionAuthority, "none");
  assert.equal("selectedResultSha256" in manifest, false);
});

test("reproduces every transformed configuration, step and result", async () => {
  const { plan, run, calibration } = await fixture();
  const manifest =
    await prepareCrossSectionalMomentumExecutionStressManifest(
      plan,
      run,
      runner,
      calibration,
      (HISTORY_LENGTH + 4) * HOUR_MS,
    );
  await verifyCrossSectionalMomentumExecutionStressManifest(
    plan,
    run,
    runner,
    calibration,
    manifest,
  );
  await assert.rejects(
    verifyCrossSectionalMomentumExecutionStressManifest(
      plan,
      run,
      runner,
      calibration,
      {
        ...manifest,
        results: manifest.results.map((result, index) =>
          index === 0
            ? {
                ...result,
                finalEquityAud: result.finalEquityAud + 1,
              }
            : result
        ),
      },
    ),
    /not reproducible/u,
  );
});

test("calibration identity is finite, ordered and exact", async () => {
  const { plan, run } = await fixture();
  const calibration =
    await prepareCrossSectionalMomentumExecutionCalibration(
      plan,
      run,
      runner,
      {
        calibratedAtMs: (HISTORY_LENGTH + 2) * HOUR_MS,
        availableAtMs: (HISTORY_LENGTH + 3) * HOUR_MS,
        validUntilMs: (HISTORY_LENGTH + 100) * HOUR_MS,
        sourceSha256s: ["d".repeat(64), "c".repeat(64)],
      },
    );
  assert.deepEqual(calibration.sourceSha256s, [
    "c".repeat(64),
    "d".repeat(64),
  ]);
  await assert.rejects(
    prepareCrossSectionalMomentumExecutionCalibration(
      plan,
      run,
      runner,
      {
        calibratedAtMs: (HISTORY_LENGTH + 2) * HOUR_MS,
        availableAtMs: (HISTORY_LENGTH + 3) * HOUR_MS,
        validUntilMs: (HISTORY_LENGTH + 100) * HOUR_MS,
        sourceSha256s: ["c".repeat(64), "c".repeat(64)],
      },
    ),
    /calibration is invalid/u,
  );
  await assert.rejects(
    prepareCrossSectionalMomentumExecutionCalibration(
      plan,
      run,
      runner,
      {
        calibratedAtMs: HISTORY_LENGTH * HOUR_MS,
        availableAtMs: (HISTORY_LENGTH + 3) * HOUR_MS,
        validUntilMs: (HISTORY_LENGTH + 100) * HOUR_MS,
        sourceSha256s: ["c".repeat(64)],
      },
    ),
    /calibration is invalid/u,
  );
});

test("rejects stress evaluation outside calibration availability", async () => {
  const { plan, run, calibration } = await fixture();
  await assert.rejects(
    prepareCrossSectionalMomentumExecutionStressManifest(
      plan,
      run,
      runner,
      calibration,
      calibration.availableAtMs - 1,
    ),
    /stress evaluation is invalid/u,
  );
  await assert.rejects(
    prepareCrossSectionalMomentumExecutionStressManifest(
      plan,
      run,
      runner,
      calibration,
      calibration.validUntilMs + 1,
    ),
    /stress evaluation is invalid/u,
  );
});
