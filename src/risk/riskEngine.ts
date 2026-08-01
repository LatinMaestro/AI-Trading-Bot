import type {
  OrderIntent,
  PortfolioSnapshot,
  StrategyDecision,
} from "../domain/types.ts";
import type { RuntimeConfig } from "../config.ts";

export interface RiskAssessment {
  readonly allowed: boolean;
  readonly severity: "info" | "warning" | "pause" | "kill";
  readonly reasons: readonly string[];
  readonly boundedTargetExposurePct: number;
}

function lossPct(current: number, previous: number): number {
  if (previous <= 0) return 0;
  return Math.max(0, (previous - current) / previous) * 100;
}

export function assessPortfolioRisk(
  portfolio: PortfolioSnapshot,
  decision: StrategyDecision,
  config: RuntimeConfig,
): RiskAssessment {
  const reasons: string[] = [];
  const drawdownPct = lossPct(portfolio.equityAud, portfolio.highWaterMarkAud);
  const dailyLossPct = lossPct(portfolio.equityAud, portfolio.equity24hAgoAud);
  const weeklyLossPct = lossPct(portfolio.equityAud, portfolio.equity7dAgoAud);

  if (drawdownPct >= config.maxDrawdownPct) {
    reasons.push(`Drawdown ${drawdownPct.toFixed(2)}% exceeds kill limit`);
    return {
      allowed: false,
      severity: "kill",
      reasons,
      boundedTargetExposurePct: 0,
    };
  }

  if (
    dailyLossPct >= config.dailyLossLimitPct ||
    weeklyLossPct >= config.weeklyLossLimitPct
  ) {
    reasons.push("Daily or weekly loss limit has been reached");
    return {
      allowed: false,
      severity: "pause",
      reasons,
      boundedTargetExposurePct: 0,
    };
  }

  const boundedTargetExposurePct = Math.min(
    decision.targetExposurePct,
    config.maxGrossExposurePct,
  );
  reasons.push("Portfolio is within hard loss and drawdown limits");
  return {
    allowed: true,
    severity: "info",
    reasons,
    boundedTargetExposurePct,
  };
}

export function validateOrderIntent(
  intent: OrderIntent,
  portfolio: PortfolioSnapshot,
  config: RuntimeConfig,
): void {
  if (!config.approvedPairs.includes(intent.pair)) {
    throw new Error(`Pair ${intent.pair} is not approved`);
  }
  if (!intent.postOnly) {
    throw new Error("Only post-only limit orders are permitted");
  }
  if (intent.priceAud <= 0 || intent.volume <= 0 || intent.notionalAud <= 0) {
    throw new Error("Order values must be positive");
  }
  const maxNotional = portfolio.equityAud * (config.maxGrossExposurePct / 100);
  if (intent.notionalAud > maxNotional + 0.01) {
    throw new Error("Order notional exceeds gross exposure limit");
  }
}
