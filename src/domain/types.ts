export type TradingMode = "research" | "paper" | "shadow" | "validate" | "live";
export type TradeAction = "hold" | "buy" | "sell";
export type OrderSide = "buy" | "sell";

export interface Candle {
  readonly timestampMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export interface AssetSignal {
  readonly pair: string;
  readonly eligible: boolean;
  readonly latestPrice: number;
  readonly ema200: number;
  readonly return7d: number;
  readonly return30d: number;
  readonly return90d: number;
  readonly annualisedVolatility: number;
  readonly recentDrawdown: number;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface StrategyDecision {
  readonly strategyVersion: string;
  readonly action: TradeAction;
  readonly targetPair?: string;
  readonly targetExposurePct: number;
  readonly reason: string;
  readonly signals: readonly AssetSignal[];
}

export interface PortfolioSnapshot {
  readonly equityAud: number;
  readonly cashAud: number;
  readonly grossExposureAud: number;
  readonly highWaterMarkAud: number;
  readonly equity24hAgoAud: number;
  readonly equity7dAgoAud: number;
}

export interface OrderIntent {
  readonly pair: string;
  readonly side: OrderSide;
  readonly priceAud: number;
  readonly volume: number;
  readonly notionalAud: number;
  readonly postOnly: true;
}
