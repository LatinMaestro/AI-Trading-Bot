import type {
  UniverseSignalTimeMembership,
} from "../universe/signalTimeMembership.ts";

export type ExecutionStyle = "maker" | "taker";
export type BacktestOrderSide = "buy" | "sell";
export type BacktestExecutionStatus = "filled" | "partially-filled" | "missed";

export interface ExecutionAssumptions {
  readonly makerFeeBps: number;
  readonly takerFeeBps: number;
  readonly takerSlippageBps: number;
  readonly makerAdverseSelectionBps: number;
  readonly impactCoefficientBps: number;
  readonly maximumImpactBps: number;
  readonly maximumParticipationRate: number;
  readonly makerFillRate: number;
  readonly minimumOrderAud: number;
  readonly cashReserveAud: number;
}

export interface BacktestMarket {
  readonly pair: string;
  readonly midPriceAud: number;
  readonly spreadBps: number;
  readonly availableQuoteVolumeAud: number;
}

export interface TargetAllocation {
  readonly pair: string;
  readonly targetWeight: number;
  readonly executionStyle: ExecutionStyle;
}

export interface BacktestExternalIntelligenceGate {
  readonly schemaVersion: "backtest-external-intelligence-gate-v1";
  readonly decisionAtMs: number;
  readonly frameSha256: string;
  readonly pauseNewRiskEvidenceSha256s: readonly string[];
  readonly researchCandidateSha256s: readonly string[];
}

export interface BacktestStep {
  readonly signalTimestampMs: number;
  readonly executionTimestampMs: number;
  readonly markets: readonly BacktestMarket[];
  readonly targets: readonly TargetAllocation[];
  readonly externalIntelligenceGate?: BacktestExternalIntelligenceGate;
  readonly universeMembership?: UniverseSignalTimeMembership;
}

export interface BacktestConfig {
  readonly initialCashAud: number;
  readonly defaultExitStyle: ExecutionStyle;
  readonly assumptions: ExecutionAssumptions;
}

export interface BacktestExecution {
  readonly timestampMs: number;
  readonly pair: string;
  readonly side: BacktestOrderSide;
  readonly executionStyle: ExecutionStyle;
  readonly status: BacktestExecutionStatus;
  readonly requestedNotionalAud: number;
  readonly filledReferenceNotionalAud: number;
  readonly missedNotionalAud: number;
  readonly units: number;
  readonly referenceMidPriceAud: number;
  readonly executionPriceAud: number;
  readonly feeAud: number;
  readonly spreadCostAud: number;
  readonly slippageCostAud: number;
  readonly impactCostAud: number;
  readonly impactBps: number;
}

export interface BacktestEquityPoint {
  readonly timestampMs: number;
  readonly equityAud: number;
  readonly cashAud: number;
  readonly grossExposureAud: number;
  readonly drawdownPct: number;
}

export interface BacktestPosition {
  readonly pair: string;
  readonly units: number;
  readonly marketValueAud: number;
}

export interface BacktestCostSummary {
  readonly feesAud: number;
  readonly spreadAud: number;
  readonly slippageAud: number;
  readonly impactAud: number;
  readonly totalAud: number;
  readonly missedFillNotionalAud: number;
}

export interface BacktestSuppressedExecution {
  readonly signalTimestampMs: number;
  readonly executionTimestampMs: number;
  readonly pair: string;
  readonly side: "buy";
  readonly executionStyle: ExecutionStyle;
  readonly requestedNotionalAud: number;
  readonly frameSha256: string;
  readonly pauseEvidenceSha256s: readonly string[];
}

export interface BacktestResult {
  readonly initialEquityAud: number;
  readonly finalEquityAud: number;
  readonly totalReturnPct: number;
  readonly maximumDrawdownPct: number;
  readonly turnoverMultiple: number;
  readonly executions: readonly BacktestExecution[];
  readonly equityCurve: readonly BacktestEquityPoint[];
  readonly finalPositions: readonly BacktestPosition[];
  readonly costs: BacktestCostSummary;
  readonly executionGateFrameSha256s: readonly string[];
  readonly universeMembershipSha256s: readonly string[];
  readonly suppressedExecutions: readonly BacktestSuppressedExecution[];
}
