import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareHourlyTrendBreakoutBacktestPlan,
  runHourlyTrendBreakoutBacktest,
  verifyHourlyTrendBreakoutBacktestPlan,
  type HourlyTrendBreakoutBacktestFrame,
} from "../src/backtest/hourlyTrendBreakout.ts";
import type { BacktestConfig } from "../src/backtest/types.ts";
import type { Candle } from "../src/domain/types.ts";
import { sha256CanonicalIntelligence } from "../src/intelligence/canonical.ts";
import { HOUR_MS } from "../src/marketData/candleQuality.ts";
import type { UniverseSignalTimeMembership } from "../src/universe/signalTimeMembership.ts";

const CONFIG: BacktestConfig = {
  initialCashAud: 200,
  defaultExitStyle: "taker",
  assumptions: {
    makerFeeBps: 0,
    takerFeeBps: 0,
    takerSlippageBps: 0,
    makerAdverseSelectionBps: 0,
    impactCoefficientBps: 0,
    maximumImpactBps: 0,
    maximumParticipationRate: 1,
    makerFillRate: 1,
    minimumOrderAud: 0,
    cashReserveAud: 0,
  },
};

function candles(
  startHour: number,
  latestClose: number,
): readonly Candle[] {
  return Array.from({ length: 240 }, (_, index) => {
    const close = index === 239 ? latestClose : 100 + index * 0.01;
    return {
      timestampMs: (startHour + index) * HOUR_MS,
      open: close,
      high: close + 0.2,
      low: close - 0.2,
      close,
      volume: 1_000,
    };
  });
}

async function membership(
  decisionAtMs: number,
  eligiblePairs: readonly string[],
): Promise<UniverseSignalTimeMembership> {
  const envelope = {
    schemaVersion: "universe-signal-time-membership-v1",
    decisionAtMs,
    snapshotAsOfMs: decisionAtMs - HOUR_MS,
    snapshotAvailableAtMs: decisionAtMs,
    snapshotSha256: "a".repeat(64),
    signedPolicySha256: "b".repeat(64),
    eligiblePairs: [...eligiblePairs],
  } as const;
  return {
    ...envelope,
    membershipSha256: await sha256CanonicalIntelligence(envelope),
  };
}

async function frame(
  startHour: number,
  eligiblePairs: readonly string[],
  latestBtcClose = 110,
  latestEthClose = 105,
): Promise<HourlyTrendBreakoutBacktestFrame> {
  const decisionAtMs = (startHour + 240) * HOUR_MS;
  return {
    membership: await membership(decisionAtMs, eligiblePairs),
    candlesByPair: {
      "BTC/AUD": candles(startHour, latestBtcClose),
      "ETH/AUD": candles(startHour, latestEthClose),
    },
    executionTimestampMs: decisionAtMs + HOUR_MS,
    markets: [
      {
        pair: "BTC/AUD",
        midPriceAud: latestBtcClose,
        spreadBps: 0,
        availableQuoteVolumeAud: 1_000_000,
      },
      {
        pair: "ETH/AUD",
        midPriceAud: latestEthClose,
        spreadBps: 0,
        availableQuoteVolumeAud: 1_000_000,
      },
    ],
    executionStyle: "taker",
  };
}

test("binds the hourly candidate to exact membership and execution", async () => {
  const plan = await prepareHourlyTrendBreakoutBacktestPlan([
    await frame(0, ["BTC/AUD", "ETH/AUD"]),
  ]);
  await verifyHourlyTrendBreakoutBacktestPlan(plan);
  assert.equal(plan.boundDecisions[0]?.decision.targetPair, "BTC/AUD");
  assert.equal(plan.steps[0]?.targets[0]?.targetWeight, 0.9);
  assert.equal(plan.boundDecisions[0]?.kind, "candidate");
  const result = await runHourlyTrendBreakoutBacktest(CONFIG, plan);
  assert.equal(result.executions[0]?.side, "buy");
  assert.equal(result.executions[0]?.pair, "BTC/AUD");
  assert.deepEqual(result.universeMembershipSha256s, [
    plan.steps[0]!.universeMembership!.membershipSha256,
  ]);
});

test("forces an auditable exit after held-pair eligibility loss", async () => {
  const plan = await prepareHourlyTrendBreakoutBacktestPlan([
    await frame(0, ["BTC/AUD"]),
    await frame(2, ["ETH/AUD"], 111, 106),
  ]);
  assert.equal(plan.boundDecisions[1]?.kind, "universe-exit");
  assert.equal(plan.boundDecisions[1]?.previousTargetPair, "BTC/AUD");
  assert.equal(plan.boundDecisions[1]?.decision.targetPair, null);
  const result = await runHourlyTrendBreakoutBacktest(CONFIG, plan);
  assert.deepEqual(
    result.executions.map((execution) => execution.side),
    ["buy", "sell"],
  );
  assert.equal(result.finalPositions.length, 0);
});

test("targets cash when no configured pair is eligible", async () => {
  const plan = await prepareHourlyTrendBreakoutBacktestPlan([
    await frame(0, ["MICRO/AUD"]),
  ]);
  assert.equal(plan.boundDecisions[0]?.kind, "no-eligible-pair");
  assert.equal(plan.steps[0]?.targets.length, 0);
  const result = await runHourlyTrendBreakoutBacktest(CONFIG, plan);
  assert.equal(result.executions.length, 0);
  assert.equal(result.finalEquityAud, 200);
});

test("rejects time drift, incomplete inputs and provenance tampering", async () => {
  const valid = await frame(0, ["BTC/AUD", "ETH/AUD"]);
  await assert.rejects(
    prepareHourlyTrendBreakoutBacktestPlan([
      {
        ...valid,
        membership: await membership(
          valid.membership.decisionAtMs + HOUR_MS,
          ["BTC/AUD", "ETH/AUD"],
        ),
      },
    ]),
    /closed-candle time does not match/u,
  );
  const { ["ETH/AUD"]: _removed, ...incomplete } = valid.candlesByPair;
  await assert.rejects(
    prepareHourlyTrendBreakoutBacktestPlan([
      { ...valid, candlesByPair: incomplete },
    ]),
    /requires exact BTC\/AUD and ETH\/AUD histories/u,
  );
  const malformedIneligible = {
    ...valid,
    membership: await membership(valid.membership.decisionAtMs, ["BTC/AUD"]),
    candlesByPair: {
      ...valid.candlesByPair,
      "ETH/AUD": valid.candlesByPair["ETH/AUD"]!.slice(0, -1),
    },
  };
  await assert.rejects(
    prepareHourlyTrendBreakoutBacktestPlan([malformedIneligible]),
    /mismatched signal times/u,
  );
  const plan = await prepareHourlyTrendBreakoutBacktestPlan([valid]);
  await assert.rejects(
    verifyHourlyTrendBreakoutBacktestPlan({
      ...plan,
      steps: [
        {
          ...plan.steps[0]!,
          targets: [
            {
              pair: "ETH/AUD",
              targetWeight: 0.9,
              executionStyle: "taker",
            },
          ],
        },
      ],
    }),
    /bound decision identity is invalid|plan identity is invalid/u,
  );
  const unknownKind = {
    ...plan.boundDecisions[0]!,
    kind: "unknown",
  } as unknown as (typeof plan.boundDecisions)[number];
  await assert.rejects(
    verifyHourlyTrendBreakoutBacktestPlan({
      ...plan,
      boundDecisions: [unknownKind],
    }),
    /decision kind is invalid/u,
  );
});
