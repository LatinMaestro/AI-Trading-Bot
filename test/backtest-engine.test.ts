import assert from "node:assert/strict";
import test from "node:test";
import { runBacktest } from "../src/backtest/engine.ts";
import type {
  BacktestConfig,
  BacktestMarket,
  BacktestStep,
} from "../src/backtest/types.ts";

const HOUR_MS = 3_600_000;

function config(overrides: Partial<BacktestConfig["assumptions"]> = {}): BacktestConfig {
  return {
    initialCashAud: 200,
    defaultExitStyle: "taker",
    assumptions: {
      makerFeeBps: 10,
      takerFeeBps: 25,
      takerSlippageBps: 20,
      makerAdverseSelectionBps: 10,
      impactCoefficientBps: 25,
      maximumImpactBps: 100,
      maximumParticipationRate: 1,
      makerFillRate: 1,
      minimumOrderAud: 1,
      cashReserveAud: 0,
      ...overrides,
    },
  };
}

function market(
  pair: string,
  midPriceAud: number,
  overrides: Partial<BacktestMarket> = {},
): BacktestMarket {
  return {
    pair,
    midPriceAud,
    spreadBps: 0,
    availableQuoteVolumeAud: 1_000_000,
    ...overrides,
  };
}

function step(
  hour: number,
  markets: readonly BacktestMarket[],
  targets: BacktestStep["targets"],
): BacktestStep {
  const signalTimestampMs = Date.UTC(2026, 0, 1, hour);
  return {
    signalTimestampMs,
    executionTimestampMs: signalTimestampMs + HOUR_MS,
    markets,
    targets,
  };
}

test("costless buy and hold matches the marked portfolio return", () => {
  const result = runBacktest(
    config({
      makerFeeBps: 0,
      takerFeeBps: 0,
      takerSlippageBps: 0,
      makerAdverseSelectionBps: 0,
      impactCoefficientBps: 0,
      maximumImpactBps: 0,
      minimumOrderAud: 0,
    }),
    [
      step(0, [market("BTC/AUD", 100)], [
        { pair: "BTC/AUD", targetWeight: 1, executionStyle: "taker" },
      ]),
      step(2, [market("BTC/AUD", 200)], [
        { pair: "BTC/AUD", targetWeight: 1, executionStyle: "taker" },
      ]),
    ],
  );

  assert.equal(result.executions.length, 1);
  assert.equal(result.finalEquityAud, 400);
  assert.equal(result.totalReturnPct, 100);
  assert.equal(result.costs.totalAud, 0);
});

test("taker fees, spread, slippage and impact are attributed and reduce equity", () => {
  const result = runBacktest(
    config({ impactCoefficientBps: 100, maximumImpactBps: 100 }),
    [
      step(
        0,
        [
          market("BTC/AUD", 100, {
            spreadBps: 40,
            availableQuoteVolumeAud: 400,
          }),
        ],
        [{ pair: "BTC/AUD", targetWeight: 1, executionStyle: "taker" }],
      ),
    ],
  );

  const execution = result.executions[0];
  if (execution === undefined) throw new Error("Expected taker execution");
  assert.ok(execution.feeAud > 0);
  assert.ok(execution.spreadCostAud > 0);
  assert.ok(execution.slippageCostAud > 0);
  assert.ok(execution.impactCostAud > 0);
  assert.ok(result.finalEquityAud < 200);
  assert.ok(Math.abs(result.costs.totalAud - (200 - result.finalEquityAud)) < 0.05);
});

test("maker fill assumptions create explicit missed notional", () => {
  const result = runBacktest(
    config({
      makerFeeBps: 0,
      makerAdverseSelectionBps: 0,
      impactCoefficientBps: 0,
      maximumImpactBps: 0,
      makerFillRate: 0.25,
    }),
    [
      step(0, [market("ETH/AUD", 100)], [
        { pair: "ETH/AUD", targetWeight: 1, executionStyle: "maker" },
      ]),
    ],
  );

  const execution = result.executions[0];
  if (execution === undefined) throw new Error("Expected maker execution");
  assert.equal(execution.filledReferenceNotionalAud, 50);
  assert.equal(execution.missedNotionalAud, 150);
  assert.equal(result.finalPositions[0]?.marketValueAud, 50);
});

test("participation caps constrain thin-market fills and apply square-root impact", () => {
  const result = runBacktest(
    {
      ...config({
        takerFeeBps: 0,
        takerSlippageBps: 0,
        impactCoefficientBps: 100,
        maximumImpactBps: 100,
        maximumParticipationRate: 0.1,
      }),
      initialCashAud: 1_000,
    },
    [
      step(
        0,
        [market("MICRO/AUD", 1, { availableQuoteVolumeAud: 100 })],
        [{ pair: "MICRO/AUD", targetWeight: 1, executionStyle: "taker" }],
      ),
    ],
  );

  const execution = result.executions[0];
  if (execution === undefined) throw new Error("Expected thin-market execution");
  assert.equal(execution.filledReferenceNotionalAud, 10);
  assert.equal(execution.missedNotionalAud, 990);
  assert.ok(Math.abs(execution.impactBps - Math.sqrt(0.1) * 100) < 1e-9);
});

test("rotations sell before buying and never create negative cash or positions", () => {
  const result = runBacktest(
    config({
      makerFeeBps: 0,
      takerFeeBps: 0,
      takerSlippageBps: 0,
      makerAdverseSelectionBps: 0,
      impactCoefficientBps: 0,
      maximumImpactBps: 0,
      minimumOrderAud: 0,
      cashReserveAud: 10,
    }),
    [
      step(0, [market("A/AUD", 10), market("B/AUD", 20)], [
        { pair: "A/AUD", targetWeight: 1, executionStyle: "taker" },
      ]),
      step(2, [market("A/AUD", 10), market("B/AUD", 20)], [
        { pair: "B/AUD", targetWeight: 1, executionStyle: "taker" },
      ]),
    ],
  );

  assert.deepEqual(
    result.executions.map((execution) => `${execution.side}:${execution.pair}`),
    ["buy:A/AUD", "sell:A/AUD", "buy:B/AUD"],
  );
  assert.ok(result.equityCurve.every((point) => point.cashAud >= 10 - 1e-7));
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]?.pair, "B/AUD");
});

test("invalid look-ahead, gross exposure and missing marks fail closed", () => {
  const invalidTimestamp = step(0, [market("BTC/AUD", 100)], []);
  assert.throws(
    () =>
      runBacktest(config(), [
        {
          ...invalidTimestamp,
          executionTimestampMs: invalidTimestamp.signalTimestampMs,
        },
      ]),
    /later than signal/,
  );

  const firstStep = step(0, [market("BTC/AUD", 100)], []);
  assert.throws(
    () =>
      runBacktest(config(), [
        firstStep,
        {
          signalTimestampMs: firstStep.signalTimestampMs + HOUR_MS / 2,
          executionTimestampMs: firstStep.executionTimestampMs + HOUR_MS,
          markets: [market("BTC/AUD", 100)],
          targets: [],
        },
      ]),
    /cannot precede the prior execution/,
  );

  assert.throws(
    () =>
      runBacktest(config(), [
        step(0, [market("BTC/AUD", 100), market("ETH/AUD", 100)], [
          { pair: "BTC/AUD", targetWeight: 0.6, executionStyle: "taker" },
          { pair: "ETH/AUD", targetWeight: 0.5, executionStyle: "taker" },
        ]),
      ]),
    /cannot exceed 100%/,
  );

  assert.throws(
    () =>
      runBacktest(config({ minimumOrderAud: 0 }), [
        step(0, [market("BTC/AUD", 100)], [
          { pair: "BTC/AUD", targetWeight: 1, executionStyle: "taker" },
        ]),
        step(2, [market("ETH/AUD", 100)], []),
      ]),
    /Held position BTC\/AUD has no mark/,
  );
});

test("cash-constrained multi-asset buys are scaled proportionally", () => {
  const result = runBacktest(
    config({
      takerFeeBps: 100,
      takerSlippageBps: 0,
      impactCoefficientBps: 0,
      maximumImpactBps: 0,
      minimumOrderAud: 0,
    }),
    [
      step(0, [market("A/AUD", 10), market("B/AUD", 10)], [
        { pair: "A/AUD", targetWeight: 0.5, executionStyle: "taker" },
        { pair: "B/AUD", targetWeight: 0.5, executionStyle: "taker" },
      ]),
    ],
  );

  const first = result.finalPositions.find((position) => position.pair === "A/AUD");
  const second = result.finalPositions.find((position) => position.pair === "B/AUD");
  if (first === undefined || second === undefined) {
    throw new Error("Expected both target positions");
  }
  assert.ok(Math.abs(first.marketValueAud - second.marketValueAud) < 1e-9);
  assert.ok(result.equityCurve[0]?.cashAud !== undefined);
  assert.ok((result.equityCurve[0]?.cashAud ?? -1) >= -1e-7);
});

test("zero maker fill is retained as a missed execution", () => {
  const result = runBacktest(
    config({ makerFillRate: 0, minimumOrderAud: 0 }),
    [
      step(0, [market("NEW/AUD", 1)], [
        { pair: "NEW/AUD", targetWeight: 1, executionStyle: "maker" },
      ]),
    ],
  );

  const execution = result.executions[0];
  if (execution === undefined) throw new Error("Expected missed execution");
  assert.equal(execution.status, "missed");
  assert.equal(execution.filledReferenceNotionalAud, 0);
  assert.equal(execution.missedNotionalAud, 200);
  assert.equal(result.costs.missedFillNotionalAud, 200);
});

test("a missed exit cannot fund a replacement buy", () => {
  const result = runBacktest(
    {
      ...config({
        makerFeeBps: 0,
        takerFeeBps: 0,
        takerSlippageBps: 0,
        makerAdverseSelectionBps: 0,
        impactCoefficientBps: 0,
        maximumImpactBps: 0,
        makerFillRate: 0,
        minimumOrderAud: 0,
      }),
      defaultExitStyle: "maker",
    },
    [
      step(0, [market("A/AUD", 10), market("B/AUD", 10)], [
        { pair: "A/AUD", targetWeight: 1, executionStyle: "taker" },
      ]),
      step(2, [market("A/AUD", 10), market("B/AUD", 10)], [
        { pair: "B/AUD", targetWeight: 1, executionStyle: "taker" },
      ]),
    ],
  );

  assert.deepEqual(
    result.executions.map(
      (execution) =>
        `${execution.side}:${execution.pair}:${execution.status}`,
    ),
    [
      "buy:A/AUD:filled",
      "sell:A/AUD:missed",
      "buy:B/AUD:missed",
    ],
  );
  assert.equal(result.equityCurve[1]?.cashAud, 0);
  assert.equal(result.finalPositions.length, 1);
  assert.equal(result.finalPositions[0]?.pair, "A/AUD");
  assert.equal(result.finalPositions[0]?.marketValueAud, 200);
});
