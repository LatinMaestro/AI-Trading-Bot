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
  prepareHourlyTrendBreakoutSensitivityManifest,
  prepareHourlyTrendBreakoutWalkForwardManifest,
  type HourlyTrendBreakoutEvaluationRunInput,
} from "../src/research/hourlyTrendBreakoutEvaluation.ts";
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
  decisionHour: number,
  policy: HourlyTrendBreakoutPolicy =
    HOURLY_TREND_BREAKOUT_BASELINE_POLICY,
): Promise<HourlyTrendBreakoutEvaluationRunInput> {
  const frame: HourlyTrendBreakoutBacktestFrame = {
    membership: await membership(decisionHour),
    candlesByPair: {
      "BTC/AUD": candles(decisionHour, 110),
      "ETH/AUD": candles(decisionHour, 105),
    },
    executionTimestampMs: (decisionHour + 1) * HOUR_MS,
    markets: [
      {
        pair: "BTC/AUD",
        midPriceAud: 110,
        spreadBps: 10,
        availableQuoteVolumeAud: 1_000_000,
      },
      {
        pair: "ETH/AUD",
        midPriceAud: 105,
        spreadBps: 10,
        availableQuoteVolumeAud: 1_000_000,
      },
    ],
    executionStyle: "taker",
  };
  const plan = await prepareHourlyTrendBreakoutBacktestPlan([frame], policy);
  return {
    plan,
    run: await runHourlyTrendBreakoutResearch(CONFIG, plan),
  };
}

test("binds ordered walk-forward folds and a later untouched holdout", async () => {
  const manifest = await prepareHourlyTrendBreakoutWalkForwardManifest(
    [
      {
        foldIndex: 0,
        training: await evaluationRun(240),
        validation: await evaluationRun(241),
      },
      {
        foldIndex: 1,
        training: await evaluationRun(242),
        validation: await evaluationRun(243),
      },
    ],
    await evaluationRun(244),
  );
  assert.equal(manifest.folds.length, 2);
  assert.equal(manifest.finalHoldout.startAtMs, 244 * HOUR_MS);
  assert.match(manifest.manifestSha256, /^[0-9a-f]{64}$/u);
});

test("walk-forward manifest is deterministic across equivalent evidence", async () => {
  const fold = {
    foldIndex: 0,
    training: await evaluationRun(240),
    validation: await evaluationRun(241),
  };
  const holdout = await evaluationRun(242);
  const first = await prepareHourlyTrendBreakoutWalkForwardManifest(
    [fold],
    holdout,
  );
  const second = await prepareHourlyTrendBreakoutWalkForwardManifest(
    [{ ...fold }],
    holdout,
  );
  assert.equal(first.manifestSha256, second.manifestSha256);
});

test("rejects reused, overlapping or noncontiguous walk-forward evidence", async () => {
  const shared = await evaluationRun(240);
  await assert.rejects(
    prepareHourlyTrendBreakoutWalkForwardManifest(
      [{ foldIndex: 1, training: shared, validation: shared }],
      await evaluationRun(241),
    ),
    /fold indexes must be contiguous/u,
  );
  await assert.rejects(
    prepareHourlyTrendBreakoutWalkForwardManifest(
      [
        {
          foldIndex: 0,
          training: await evaluationRun(241),
          validation: await evaluationRun(240),
        },
      ],
      await evaluationRun(242),
    ),
    /fold chronology or identity is invalid/u,
  );
  await assert.rejects(
    prepareHourlyTrendBreakoutWalkForwardManifest(
      [{ foldIndex: 0, training: shared, validation: await evaluationRun(241) }],
      shared,
    ),
    /final holdout chronology or identity is invalid/u,
  );
});

test("content-addresses same-period parameter sensitivity without ranking", async () => {
  const variantPolicy: HourlyTrendBreakoutPolicy = {
    ...HOURLY_TREND_BREAKOUT_BASELINE_POLICY,
    entryLookbackHours: 192,
  };
  const manifest = await prepareHourlyTrendBreakoutSensitivityManifest([
    await evaluationRun(240, variantPolicy),
    await evaluationRun(240),
  ]);
  assert.equal(manifest.variants.length, 2);
  assert.equal(
    manifest.variants.some(
      (variant) =>
        variant.policySha256 === manifest.baselinePolicySha256,
    ),
    true,
  );
  assert.equal("selectedRunSha256" in manifest, false);
  assert.match(manifest.manifestSha256, /^[0-9a-f]{64}$/u);
});

test("sensitivity manifest is invariant to variant input order", async () => {
  const variant = await evaluationRun(240, {
    ...HOURLY_TREND_BREAKOUT_BASELINE_POLICY,
    momentumLookbackHours: 120,
  });
  const baseline = await evaluationRun(240);
  const first = await prepareHourlyTrendBreakoutSensitivityManifest([
    variant,
    baseline,
  ]);
  const second = await prepareHourlyTrendBreakoutSensitivityManifest([
    baseline,
    variant,
  ]);
  assert.equal(first.manifestSha256, second.manifestSha256);
});

test("rejects sensitivity without one baseline or on mismatched periods", async () => {
  const variantPolicy = {
    ...HOURLY_TREND_BREAKOUT_BASELINE_POLICY,
    exitLookbackHours: 48,
  };
  await assert.rejects(
    prepareHourlyTrendBreakoutSensitivityManifest([
      await evaluationRun(240, variantPolicy),
      await evaluationRun(241, {
        ...variantPolicy,
        exitLookbackHours: 60,
      }),
    ]),
    /share one configuration and period/u,
  );
  await assert.rejects(
    prepareHourlyTrendBreakoutSensitivityManifest([
      await evaluationRun(240, variantPolicy),
      await evaluationRun(240, {
        ...variantPolicy,
        exitLookbackHours: 60,
      }),
    ]),
    /include one baseline/u,
  );
});
