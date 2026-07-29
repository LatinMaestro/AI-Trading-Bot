import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  prepareHourlyTrendBreakoutBacktestPlan,
  runHourlyTrendBreakoutResearch,
  verifyHourlyTrendBreakoutResearchRun,
  type HourlyTrendBreakoutBacktestFrame,
} from "../src/backtest/hourlyTrendBreakout.ts";
import type { BacktestConfig } from "../src/backtest/types.ts";
import type { Candle } from "../src/domain/types.ts";
import { sha256CanonicalIntelligence } from "../src/intelligence/canonical.ts";
import { HOUR_MS } from "../src/marketData/candleQuality.ts";
import {
  prepareHourlyTrendBreakoutResearchRunPersistence,
} from "../src/storage/hourlyTrendBreakoutResearchRun.ts";
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

async function frame(): Promise<HourlyTrendBreakoutBacktestFrame> {
  return {
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
}

test("reproduces and content-addresses the complete hourly research run", async () => {
  const plan = await prepareHourlyTrendBreakoutBacktestPlan([await frame()]);
  const first = await runHourlyTrendBreakoutResearch(CONFIG, plan);
  const second = await runHourlyTrendBreakoutResearch(
    { ...CONFIG, assumptions: { ...CONFIG.assumptions } },
    plan,
  );
  await verifyHourlyTrendBreakoutResearchRun(plan, first);
  assert.equal(first.runSha256, second.runSha256);
  assert.equal(first.resultSha256, second.resultSha256);
  assert.equal(first.planSha256, plan.planSha256);
  assert.equal(first.result.universeMembershipSha256s.length, 1);
  assert.match(first.runSha256, /^[0-9a-f]{64}$/u);
});

test("rejects a changed result even when its outer run hash is retained", async () => {
  const plan = await prepareHourlyTrendBreakoutBacktestPlan([await frame()]);
  const run = await runHourlyTrendBreakoutResearch(CONFIG, plan);
  await assert.rejects(
    verifyHourlyTrendBreakoutResearchRun(plan, {
      ...run,
      result: {
        ...run.result,
        finalEquityAud: run.result.finalEquityAud + 1,
      },
    }),
    /not reproducible/u,
  );
});

test("persists one immutable compact run manifest with exact retries", async () => {
  const plan = await prepareHourlyTrendBreakoutBacktestPlan([await frame()]);
  const run = await runHourlyTrendBreakoutResearch(CONFIG, plan);
  const first = await prepareHourlyTrendBreakoutResearchRunPersistence({
    plan,
    run,
    persistedAtMs: 242 * HOUR_MS,
  });
  const retry = await prepareHourlyTrendBreakoutResearchRunPersistence({
    plan,
    run,
    persistedAtMs: 243 * HOUR_MS,
  });
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(
      new URL(
        "../migrations/0020_hourly_trend_breakout_research_runs.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  db.prepare(first.sql).run(...first.params);
  db.prepare(retry.sql).run(...retry.params);
  const row = db
    .prepare(
      `SELECT run_sha256, plan_sha256, result_sha256, decision_count,
              membership_count, persisted_at_ms
       FROM hourly_trend_breakout_research_runs`,
    )
    .get() as Record<string, string | number>;
  assert.deepEqual({ ...row }, {
    run_sha256: run.runSha256,
    plan_sha256: plan.planSha256,
    result_sha256: run.resultSha256,
    decision_count: 1,
    membership_count: 1,
    persisted_at_ms: 242 * HOUR_MS,
  });

  const conflicting = [...first.params];
  conflicting[13] = 2;
  assert.throws(
    () => db.prepare(first.sql).run(...conflicting),
    /research run conflict/u,
  );
  assert.throws(
    () =>
      db
        .prepare(
          `UPDATE hourly_trend_breakout_research_runs
           SET persisted_at_ms = persisted_at_ms + 1`,
        )
        .run(),
    /immutable/u,
  );
  assert.throws(
    () =>
      db
        .prepare("DELETE FROM hourly_trend_breakout_research_runs")
        .run(),
    /immutable/u,
  );
});

test("rejects persistence before the final decision", async () => {
  const plan = await prepareHourlyTrendBreakoutBacktestPlan([await frame()]);
  const run = await runHourlyTrendBreakoutResearch(CONFIG, plan);
  await assert.rejects(
    prepareHourlyTrendBreakoutResearchRunPersistence({
      plan,
      run,
      persistedAtMs: 240 * HOUR_MS - 1,
    }),
    /persistence chronology is invalid/u,
  );
});
