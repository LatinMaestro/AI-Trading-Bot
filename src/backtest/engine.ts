import { sha256CanonicalIntelligence } from "../intelligence/canonical.ts";
import {
  prepareExternalIntelligenceBacktestReplay,
  type ExternalIntelligenceReplay,
  type ExternalIntelligenceReplayFrame,
  type PrepareExternalIntelligenceReplayInput,
} from "./externalIntelligenceReplay.ts";
import type {
  BacktestConfig,
  BacktestEquityPoint,
  BacktestExecution,
  BacktestMarket,
  BacktestOrderSide,
  BacktestPosition,
  BacktestResult,
  BacktestStep,
  BacktestSuppressedExecution,
  ExecutionAssumptions,
  ExecutionStyle,
  TargetAllocation,
} from "./types.ts";

const BPS_DENOMINATOR = 10_000;
const EPSILON = 1e-9;

interface MutablePortfolio {
  cashAud: number;
  readonly unitsByPair: Map<string, number>;
}

interface OrderRequest {
  readonly pair: string;
  readonly side: BacktestOrderSide;
  readonly requestedNotionalAud: number;
  readonly executionStyle: ExecutionStyle;
  readonly market: BacktestMarket;
}

export interface ExternalIntelligenceBacktestComparison {
  readonly schemaVersion: "external-intelligence-backtest-comparison-v1";
  readonly replaySha256: string;
  readonly baselineResult: BacktestResult;
  readonly intelligenceGatedResult: BacktestResult;
  readonly finalEquityDeltaAud: number;
  readonly totalReturnDeltaPct: number;
  readonly suppressedRequestCount: number;
  readonly suppressedRequestedNotionalAud: number;
  readonly pauseFrameCount: number;
  readonly researchCandidateFrameCount: number;
  readonly comparisonSha256: string;
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}

function assertNonNegative(name: string, value: number): void {
  assertFinite(name, value);
  if (value < 0) {
    throw new Error(`${name} cannot be negative`);
  }
}

function assertExecutionStyle(name: string, value: string): void {
  if (value !== "maker" && value !== "taker") {
    throw new Error(`${name} must be maker or taker`);
  }
}

function validateAssumptions(config: BacktestConfig): void {
  assertFinite("initialCashAud", config.initialCashAud);
  if (config.initialCashAud <= 0) {
    throw new Error("initialCashAud must be positive");
  }
  assertExecutionStyle("defaultExitStyle", config.defaultExitStyle);

  const assumptions = config.assumptions;
  assertNonNegative("makerFeeBps", assumptions.makerFeeBps);
  assertNonNegative("takerFeeBps", assumptions.takerFeeBps);
  assertNonNegative("takerSlippageBps", assumptions.takerSlippageBps);
  assertNonNegative(
    "makerAdverseSelectionBps",
    assumptions.makerAdverseSelectionBps,
  );
  assertNonNegative("impactCoefficientBps", assumptions.impactCoefficientBps);
  assertNonNegative("maximumImpactBps", assumptions.maximumImpactBps);
  assertNonNegative("minimumOrderAud", assumptions.minimumOrderAud);
  assertNonNegative("cashReserveAud", assumptions.cashReserveAud);
  assertFinite(
    "maximumParticipationRate",
    assumptions.maximumParticipationRate,
  );
  assertFinite("makerFillRate", assumptions.makerFillRate);

  if (
    assumptions.maximumParticipationRate <= 0 ||
    assumptions.maximumParticipationRate > 1
  ) {
    throw new Error("maximumParticipationRate must be greater than 0 and at most 1");
  }
  if (assumptions.makerFillRate < 0 || assumptions.makerFillRate > 1) {
    throw new Error("makerFillRate must be between 0 and 1");
  }
  if (assumptions.cashReserveAud >= config.initialCashAud) {
    throw new Error("cashReserveAud must be less than initialCashAud");
  }
}

function validateMarket(market: BacktestMarket): void {
  if (market.pair.trim() !== market.pair || market.pair.length === 0) {
    throw new Error("Market pair must be a non-empty canonical string");
  }
  assertFinite(`${market.pair} midPriceAud`, market.midPriceAud);
  if (market.midPriceAud <= 0) {
    throw new Error(`${market.pair} midPriceAud must be positive`);
  }
  assertNonNegative(`${market.pair} spreadBps`, market.spreadBps);
  assertNonNegative(
    `${market.pair} availableQuoteVolumeAud`,
    market.availableQuoteVolumeAud,
  );
}

function validateTarget(target: TargetAllocation): void {
  if (target.pair.trim() !== target.pair || target.pair.length === 0) {
    throw new Error("Target pair must be a non-empty canonical string");
  }
  assertExecutionStyle(
    `${target.pair} executionStyle`,
    target.executionStyle,
  );
  assertFinite(`${target.pair} targetWeight`, target.targetWeight);
  if (target.targetWeight < 0 || target.targetWeight > 1) {
    throw new Error(`${target.pair} targetWeight must be between 0 and 1`);
  }
}

function indexStep(
  step: BacktestStep,
  previousExecutionTimestampMs: number | undefined,
  heldPairs: Iterable<string>,
): {
  readonly markets: ReadonlyMap<string, BacktestMarket>;
  readonly targets: ReadonlyMap<string, TargetAllocation>;
} {
  assertFinite("signalTimestampMs", step.signalTimestampMs);
  assertFinite("executionTimestampMs", step.executionTimestampMs);
  if (step.executionTimestampMs <= step.signalTimestampMs) {
    throw new Error("Execution timestamp must be later than signal timestamp");
  }
  if (
    previousExecutionTimestampMs !== undefined &&
    step.signalTimestampMs < previousExecutionTimestampMs
  ) {
    throw new Error("Signal timestamp cannot precede the prior execution timestamp");
  }
  if (
    previousExecutionTimestampMs !== undefined &&
    step.executionTimestampMs <= previousExecutionTimestampMs
  ) {
    throw new Error("Backtest execution timestamps must be strictly increasing");
  }

  const markets = new Map<string, BacktestMarket>();
  for (const market of step.markets) {
    validateMarket(market);
    if (markets.has(market.pair)) {
      throw new Error(`Duplicate market ${market.pair}`);
    }
    markets.set(market.pair, market);
  }

  const targets = new Map<string, TargetAllocation>();
  let targetWeightTotal = 0;
  for (const target of step.targets) {
    validateTarget(target);
    if (targets.has(target.pair)) {
      throw new Error(`Duplicate target ${target.pair}`);
    }
    if (!markets.has(target.pair)) {
      throw new Error(`Target ${target.pair} has no execution market`);
    }
    targets.set(target.pair, target);
    targetWeightTotal += target.targetWeight;
  }
  if (targetWeightTotal > 1 + EPSILON) {
    throw new Error("Target weights cannot exceed 100% gross spot exposure");
  }

  for (const pair of heldPairs) {
    if (!markets.has(pair)) {
      throw new Error(`Held position ${pair} has no mark or execution market`);
    }
  }

  return { markets, targets };
}

function portfolioMarketValue(
  portfolio: MutablePortfolio,
  markets: ReadonlyMap<string, BacktestMarket>,
): { readonly equityAud: number; readonly grossExposureAud: number } {
  let grossExposureAud = 0;
  for (const [pair, units] of portfolio.unitsByPair) {
    const market = markets.get(pair);
    if (market === undefined) {
      throw new Error(`Held position ${pair} has no market`);
    }
    grossExposureAud += units * market.midPriceAud;
  }
  return {
    equityAud: portfolio.cashAud + grossExposureAud,
    grossExposureAud,
  };
}

function executionComponents(
  style: ExecutionStyle,
  market: BacktestMarket,
  filledReferenceNotionalAud: number,
  assumptions: ExecutionAssumptions,
): {
  readonly feeBps: number;
  readonly spreadBps: number;
  readonly slippageBps: number;
  readonly impactBps: number;
} {
  const participation =
    market.availableQuoteVolumeAud > 0
      ? filledReferenceNotionalAud / market.availableQuoteVolumeAud
      : 0;
  const impactBps = Math.min(
    assumptions.maximumImpactBps,
    assumptions.impactCoefficientBps * Math.sqrt(Math.max(0, participation)),
  );
  return style === "taker"
    ? {
        feeBps: assumptions.takerFeeBps,
        spreadBps: market.spreadBps / 2,
        slippageBps: assumptions.takerSlippageBps,
        impactBps,
      }
    : {
        feeBps: assumptions.makerFeeBps,
        spreadBps: 0,
        slippageBps: assumptions.makerAdverseSelectionBps,
        impactBps,
      };
}

function fillCapacityAud(
  request: OrderRequest,
  assumptions: ExecutionAssumptions,
): number {
  const participationCapacity =
    request.market.availableQuoteVolumeAud * assumptions.maximumParticipationRate;
  const styleFillCapacity =
    request.executionStyle === "maker"
      ? request.requestedNotionalAud * assumptions.makerFillRate
      : request.requestedNotionalAud;
  return Math.max(0, Math.min(participationCapacity, styleFillCapacity));
}

function conservativeCashMultiplier(
  request: OrderRequest,
  assumptions: ExecutionAssumptions,
): number {
  const spreadBps =
    request.executionStyle === "taker" ? request.market.spreadBps / 2 : 0;
  const slippageBps =
    request.executionStyle === "taker"
      ? assumptions.takerSlippageBps
      : assumptions.makerAdverseSelectionBps;
  const feeBps =
    request.executionStyle === "taker"
      ? assumptions.takerFeeBps
      : assumptions.makerFeeBps;
  return (
    (1 +
      (spreadBps + slippageBps + assumptions.maximumImpactBps) /
        BPS_DENOMINATOR) *
    (1 + feeBps / BPS_DENOMINATOR)
  );
}

function missedExecution(
  request: OrderRequest,
  timestampMs: number,
): BacktestExecution {
  return {
    timestampMs,
    pair: request.pair,
    side: request.side,
    executionStyle: request.executionStyle,
    status: "missed",
    requestedNotionalAud: request.requestedNotionalAud,
    filledReferenceNotionalAud: 0,
    missedNotionalAud: request.requestedNotionalAud,
    units: 0,
    referenceMidPriceAud: request.market.midPriceAud,
    executionPriceAud: request.market.midPriceAud,
    feeAud: 0,
    spreadCostAud: 0,
    slippageCostAud: 0,
    impactCostAud: 0,
    impactBps: 0,
  };
}

function executeOrder(
  request: OrderRequest,
  portfolio: MutablePortfolio,
  assumptions: ExecutionAssumptions,
  timestampMs: number,
  maximumFillReferenceNotionalAud = Number.POSITIVE_INFINITY,
): BacktestExecution {
  const requestedNotionalAud = Math.max(0, request.requestedNotionalAud);
  if (requestedNotionalAud < assumptions.minimumOrderAud - EPSILON) {
    return missedExecution(request, timestampMs);
  }

  let fillReferenceNotionalAud = Math.min(
    requestedNotionalAud,
    fillCapacityAud(request, assumptions),
    maximumFillReferenceNotionalAud,
  );

  if (request.side === "sell") {
    const heldUnits = portfolio.unitsByPair.get(request.pair) ?? 0;
    fillReferenceNotionalAud = Math.min(
      fillReferenceNotionalAud,
      heldUnits * request.market.midPriceAud,
    );
  } else {
    const availableCashAud = Math.max(
      0,
      portfolio.cashAud - assumptions.cashReserveAud,
    );
    fillReferenceNotionalAud = Math.min(
      fillReferenceNotionalAud,
      availableCashAud / conservativeCashMultiplier(request, assumptions),
    );
  }

  if (
    fillReferenceNotionalAud <= EPSILON ||
    fillReferenceNotionalAud < assumptions.minimumOrderAud - EPSILON
  ) {
    return missedExecution(request, timestampMs);
  }

  const components = executionComponents(
    request.executionStyle,
    request.market,
    fillReferenceNotionalAud,
    assumptions,
  );
  const totalPriceCostBps =
    components.spreadBps + components.slippageBps + components.impactBps;
  const priceDirection = request.side === "buy" ? 1 : -1;
  const executionPriceAud =
    request.market.midPriceAud *
    (1 + priceDirection * totalPriceCostBps / BPS_DENOMINATOR);
  if (executionPriceAud <= 0) {
    throw new Error("Execution assumptions produce a non-positive price");
  }

  const units = fillReferenceNotionalAud / request.market.midPriceAud;
  const executionNotionalAud = units * executionPriceAud;
  const feeAud = executionNotionalAud * (components.feeBps / BPS_DENOMINATOR);

  if (request.side === "buy") {
    const totalCashDebitAud = executionNotionalAud + feeAud;
    if (
      totalCashDebitAud >
      portfolio.cashAud - assumptions.cashReserveAud + 1e-7
    ) {
      throw new Error("Buy execution would breach the cash reserve");
    }
    portfolio.cashAud -= totalCashDebitAud;
    portfolio.unitsByPair.set(
      request.pair,
      (portfolio.unitsByPair.get(request.pair) ?? 0) + units,
    );
  } else {
    const heldUnits = portfolio.unitsByPair.get(request.pair) ?? 0;
    if (units > heldUnits + 1e-7) {
      throw new Error("Sell execution would create a negative position");
    }
    portfolio.cashAud += executionNotionalAud - feeAud;
    const remainingUnits = Math.max(0, heldUnits - units);
    if (remainingUnits <= EPSILON) {
      portfolio.unitsByPair.delete(request.pair);
    } else {
      portfolio.unitsByPair.set(request.pair, remainingUnits);
    }
  }

  if (portfolio.cashAud < -1e-7) {
    throw new Error("Execution created a negative cash balance");
  }
  portfolio.cashAud = Math.max(0, portfolio.cashAud);

  const filledNotionalAud = units * request.market.midPriceAud;
  const missedNotionalAud = Math.max(
    0,
    requestedNotionalAud - filledNotionalAud,
  );
  return {
    timestampMs,
    pair: request.pair,
    side: request.side,
    executionStyle: request.executionStyle,
    status: missedNotionalAud > EPSILON ? "partially-filled" : "filled",
    requestedNotionalAud,
    filledReferenceNotionalAud: filledNotionalAud,
    missedNotionalAud,
    units,
    referenceMidPriceAud: request.market.midPriceAud,
    executionPriceAud,
    feeAud,
    spreadCostAud:
      filledNotionalAud * (components.spreadBps / BPS_DENOMINATOR),
    slippageCostAud:
      filledNotionalAud * (components.slippageBps / BPS_DENOMINATOR),
    impactCostAud:
      filledNotionalAud * (components.impactBps / BPS_DENOMINATOR),
    impactBps: components.impactBps,
  };
}

function buildOrderRequests(
  portfolio: MutablePortfolio,
  equityAud: number,
  markets: ReadonlyMap<string, BacktestMarket>,
  targets: ReadonlyMap<string, TargetAllocation>,
  defaultExitStyle: ExecutionStyle,
): { readonly sells: OrderRequest[]; readonly buys: OrderRequest[] } {
  const pairs = new Set<string>([
    ...portfolio.unitsByPair.keys(),
    ...targets.keys(),
  ]);
  const sells: OrderRequest[] = [];
  const buys: OrderRequest[] = [];

  for (const pair of [...pairs].sort()) {
    const market = markets.get(pair);
    if (market === undefined) {
      throw new Error(`Pair ${pair} has no execution market`);
    }
    const currentNotionalAud =
      (portfolio.unitsByPair.get(pair) ?? 0) * market.midPriceAud;
    const target = targets.get(pair);
    const targetNotionalAud = equityAud * (target?.targetWeight ?? 0);
    const differenceAud = targetNotionalAud - currentNotionalAud;
    if (Math.abs(differenceAud) <= EPSILON) continue;

    const request: OrderRequest = {
      pair,
      side: differenceAud > 0 ? "buy" : "sell",
      requestedNotionalAud: Math.abs(differenceAud),
      executionStyle: target?.executionStyle ?? defaultExitStyle,
      market,
    };
    (request.side === "sell" ? sells : buys).push(request);
  }
  return { sells, buys };
}

function proportionalBuyFillLimits(
  requests: readonly OrderRequest[],
  availableCashAud: number,
  assumptions: ExecutionAssumptions,
): readonly number[] {
  const capacities = requests.map((request) =>
    Math.min(request.requestedNotionalAud, fillCapacityAud(request, assumptions)),
  );
  const requiredCashAud = requests.reduce(
    (sum, request, index) =>
      sum +
      (capacities[index] ?? 0) *
        conservativeCashMultiplier(request, assumptions),
    0,
  );
  const scale =
    requiredCashAud > 0 ? Math.min(1, availableCashAud / requiredCashAud) : 0;
  return capacities.map((capacity) => capacity * scale);
}

function equityPoint(
  timestampMs: number,
  portfolio: MutablePortfolio,
  markets: ReadonlyMap<string, BacktestMarket>,
  highWaterMarkAud: number,
): BacktestEquityPoint {
  const mark = portfolioMarketValue(portfolio, markets);
  const drawdownPct =
    highWaterMarkAud > 0
      ? Math.max(0, 1 - mark.equityAud / highWaterMarkAud) * 100
      : 0;
  return {
    timestampMs,
    equityAud: mark.equityAud,
    cashAud: portfolio.cashAud,
    grossExposureAud: mark.grossExposureAud,
    drawdownPct,
  };
}

function runBacktestInternal(
  config: BacktestConfig,
  steps: readonly BacktestStep[],
  verifiedReplay: ExternalIntelligenceReplay | null,
): BacktestResult {
  validateAssumptions(config);
  if (steps.length === 0) {
    throw new Error("Backtest requires at least one step");
  }

  const portfolio: MutablePortfolio = {
    cashAud: config.initialCashAud,
    unitsByPair: new Map<string, number>(),
  };
  const executions: BacktestExecution[] = [];
  const equityCurve: BacktestEquityPoint[] = [];
  const suppressedExecutions: BacktestSuppressedExecution[] = [];
  let previousExecutionTimestampMs: number | undefined;
  let highWaterMarkAud = config.initialCashAud;

  for (const [stepIndex, step] of steps.entries()) {
    const frame: ExternalIntelligenceReplayFrame | null =
      verifiedReplay?.frames[stepIndex] ?? null;
    const indexed = indexStep(
      step,
      previousExecutionTimestampMs,
      portfolio.unitsByPair.keys(),
    );
    const preTradeMark = portfolioMarketValue(portfolio, indexed.markets);
    const requests = buildOrderRequests(
      portfolio,
      preTradeMark.equityAud,
      indexed.markets,
      indexed.targets,
      config.defaultExitStyle,
    );
    const pausesNewRisk =
      (frame?.activePauseNewRiskSha256s.length ?? 0) > 0;
    const executableBuys = pausesNewRisk ? [] : requests.buys;
    if (pausesNewRisk) {
      if (frame === null) {
        throw new Error("Suppressed requests require a verified replay frame");
      }
      for (const request of requests.buys) {
        suppressedExecutions.push({
          signalTimestampMs: step.signalTimestampMs,
          executionTimestampMs: step.executionTimestampMs,
          pair: request.pair,
          side: "buy",
          executionStyle: request.executionStyle,
          requestedNotionalAud: request.requestedNotionalAud,
          frameSha256: frame.frameSha256,
          pauseEvidenceSha256s: frame.activePauseNewRiskSha256s,
        });
      }
    }

    for (const request of requests.sells) {
      executions.push(
        executeOrder(
          request,
          portfolio,
          config.assumptions,
          step.executionTimestampMs,
        ),
      );
    }

    const availableCashAud = Math.max(
      0,
      portfolio.cashAud - config.assumptions.cashReserveAud,
    );
    const buyFillLimits = proportionalBuyFillLimits(
      executableBuys,
      availableCashAud,
      config.assumptions,
    );
    for (const [index, request] of executableBuys.entries()) {
      executions.push(
        executeOrder(
          request,
          portfolio,
          config.assumptions,
          step.executionTimestampMs,
          buyFillLimits[index] ?? 0,
        ),
      );
    }

    const marked = portfolioMarketValue(portfolio, indexed.markets);
    highWaterMarkAud = Math.max(highWaterMarkAud, marked.equityAud);
    equityCurve.push(
      equityPoint(
        step.executionTimestampMs,
        portfolio,
        indexed.markets,
        highWaterMarkAud,
      ),
    );
    previousExecutionTimestampMs = step.executionTimestampMs;
  }

  const finalStep = steps.at(-1);
  if (finalStep === undefined) {
    throw new Error("Backtest requires at least one step");
  }
  const finalMarkets = new Map(
    finalStep.markets.map((market) => [market.pair, market]),
  );
  const finalMark = portfolioMarketValue(portfolio, finalMarkets);
  const averageEquityAud =
    equityCurve.reduce((sum, point) => sum + point.equityAud, 0) /
    equityCurve.length;
  const filledNotionalAud = executions.reduce(
    (sum, execution) => sum + execution.filledReferenceNotionalAud,
    0,
  );
  const costs = executions.reduce(
    (summary, execution) => ({
      feesAud: summary.feesAud + execution.feeAud,
      spreadAud: summary.spreadAud + execution.spreadCostAud,
      slippageAud: summary.slippageAud + execution.slippageCostAud,
      impactAud: summary.impactAud + execution.impactCostAud,
      totalAud:
        summary.totalAud +
        execution.feeAud +
        execution.spreadCostAud +
        execution.slippageCostAud +
        execution.impactCostAud,
      missedFillNotionalAud:
        summary.missedFillNotionalAud + execution.missedNotionalAud,
    }),
    {
      feesAud: 0,
      spreadAud: 0,
      slippageAud: 0,
      impactAud: 0,
      totalAud: 0,
      missedFillNotionalAud: 0,
    },
  );
  const finalPositions: BacktestPosition[] = [...portfolio.unitsByPair]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([pair, units]) => {
      const market = finalMarkets.get(pair);
      if (market === undefined) {
        throw new Error(`Final position ${pair} has no market`);
      }
      return { pair, units, marketValueAud: units * market.midPriceAud };
    });

  return {
    initialEquityAud: config.initialCashAud,
    finalEquityAud: finalMark.equityAud,
    totalReturnPct:
      (finalMark.equityAud / config.initialCashAud - 1) * 100,
    maximumDrawdownPct: Math.max(
      0,
      ...equityCurve.map((point) => point.drawdownPct),
    ),
    turnoverMultiple:
      averageEquityAud > 0 ? filledNotionalAud / averageEquityAud : 0,
    executions,
    equityCurve,
    finalPositions,
    costs,
    externalIntelligence:
      verifiedReplay === null
        ? null
        : {
            replaySha256: verifiedReplay.replaySha256,
            executionGateFrameSha256s: verifiedReplay.frames.map(
              (frame) => frame.frameSha256,
            ),
            suppressedExecutions,
          },
  };
}

export function runBacktest(
  config: BacktestConfig,
  steps: readonly BacktestStep[],
): BacktestResult {
  return runBacktestInternal(config, steps, null);
}

export async function runExternalIntelligenceBacktestComparison(
  config: BacktestConfig,
  steps: readonly BacktestStep[],
  replayInput: PrepareExternalIntelligenceReplayInput,
): Promise<ExternalIntelligenceBacktestComparison> {
  const replay =
    await prepareExternalIntelligenceBacktestReplay(replayInput);
  if (steps.length !== replay.frames.length) {
    throw new Error(
      "Replay must contain exactly one verified frame per backtest step",
    );
  }
  const frameSha256s = new Set<string>();
  for (const [index, step] of steps.entries()) {
    const frame = replay.frames[index];
    if (
      frame === undefined ||
      frame.decisionAtMs !== step.signalTimestampMs
    ) {
      throw new Error("Replay frame does not match backtest signal time");
    }
    if (frameSha256s.has(frame.frameSha256)) {
      throw new Error("Replay frame cannot gate multiple backtest steps");
    }
    frameSha256s.add(frame.frameSha256);
  }

  const baselineResult = runBacktestInternal(config, steps, null);
  const intelligenceGatedResult = runBacktestInternal(
    config,
    steps,
    replay,
  );
  const suppressedExecutions =
    intelligenceGatedResult.externalIntelligence?.suppressedExecutions ?? [];
  const canonical = {
    schemaVersion: "external-intelligence-backtest-comparison-v1",
    replaySha256: replay.replaySha256,
    baselineResult,
    intelligenceGatedResult,
    finalEquityDeltaAud:
      intelligenceGatedResult.finalEquityAud -
      baselineResult.finalEquityAud,
    totalReturnDeltaPct:
      intelligenceGatedResult.totalReturnPct -
      baselineResult.totalReturnPct,
    suppressedRequestCount: suppressedExecutions.length,
    suppressedRequestedNotionalAud: suppressedExecutions.reduce(
      (sum, execution) => sum + execution.requestedNotionalAud,
      0,
    ),
    pauseFrameCount: replay.frames.filter(
      (frame) => frame.activePauseNewRiskSha256s.length > 0,
    ).length,
    researchCandidateFrameCount: replay.frames.filter(
      (frame) => frame.activeResearchCandidateSha256s.length > 0,
    ).length,
  } as const;
  return {
    ...canonical,
    comparisonSha256: await sha256CanonicalIntelligence(canonical),
  };
}
