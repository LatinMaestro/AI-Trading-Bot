import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeConfig } from "../src/config.ts";
import type { PortfolioSnapshot, StrategyDecision } from "../src/domain/types.ts";
import { assessPortfolioRisk } from "../src/risk/riskEngine.ts";

const config: RuntimeConfig = {
  appEnv: "test",
  mode: "paper",
  liveTradingEnabled: false,
  approvedPairs: ["XBTAUD"],
  maxGrossExposurePct: 90,
  dailyLossLimitPct: 5,
  weeklyLossLimitPct: 10,
  maxDrawdownPct: 15,
  liveActivationSha256: "",
};

const decision: StrategyDecision = {
  strategyVersion: "test",
  action: "buy",
  targetPair: "XBTAUD",
  targetExposurePct: 100,
  reason: "test",
  signals: [],
};

function portfolio(equityAud: number): PortfolioSnapshot {
  return {
    equityAud,
    cashAud: equityAud,
    grossExposureAud: 0,
    highWaterMarkAud: 200,
    equity24hAgoAud: 200,
    equity7dAgoAud: 200,
  };
}

test("target exposure is bounded", () => {
  const result = assessPortfolioRisk(portfolio(200), decision, config);
  assert.equal(result.allowed, true);
  assert.equal(result.boundedTargetExposurePct, 90);
});

test("daily loss pauses trading", () => {
  const result = assessPortfolioRisk(portfolio(189), decision, config);
  assert.equal(result.allowed, false);
  assert.equal(result.severity, "pause");
});

test("maximum drawdown kills trading", () => {
  const result = assessPortfolioRisk(portfolio(169), decision, config);
  assert.equal(result.allowed, false);
  assert.equal(result.severity, "kill");
});
