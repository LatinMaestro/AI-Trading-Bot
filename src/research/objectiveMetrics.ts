export type ObjectiveCurrency = "USD" | "AUD";
export type ObjectiveProgressStatus =
  | "ahead"
  | "behind"
  | "on-path"
  | "met"
  | "expired"
  | "ruined";

export interface ObjectiveDefinition {
  readonly currency: ObjectiveCurrency;
  readonly initialEquity: number;
  readonly targetEquity: number;
  readonly horizonMonths: number;
}

export interface ObjectiveProgress {
  readonly currency: ObjectiveCurrency;
  readonly elapsedMonths: number;
  readonly remainingMonths: number;
  readonly currentEquity: number;
  readonly referenceEquity: number;
  readonly progressRatioToReference: number;
  readonly remainingMultiple: number | null;
  readonly requiredMonthlyCompoundPct: number | null;
  readonly requiredAnnualCompoundPct: number | null;
  readonly status: ObjectiveProgressStatus;
}

export interface ScenarioEquityPath {
  readonly scenarioId: string;
  readonly periodCadenceMonths: number;
  readonly equity: readonly number[];
}

export interface ScenarioRiskThresholds {
  readonly substantialLossFraction?: number;
}

export interface PercentileSummary {
  readonly p05: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p95: number;
}

export interface ScenarioRiskAnalysis {
  readonly scenarioCount: number;
  readonly periodsPerScenario: number;
  readonly periodCadenceMonths: number;
  readonly horizonMonths: number;
  readonly substantialLossFraction: number;
  readonly targetEverAttainmentProbability: number;
  readonly targetTerminalAttainmentProbability: number;
  readonly terminalLossProbability50: number;
  readonly terminalLossProbability75: number;
  readonly terminalSubstantialLossProbability: number;
  readonly maximumDrawdownProbability50: number;
  readonly maximumDrawdownProbability75: number;
  readonly maximumDrawdownSubstantialProbability: number;
  readonly terminalWealth: PercentileSummary;
  readonly maximumDrawdownFraction: PercentileSummary;
}

export interface MovingBlockBootstrapOptions {
  readonly scenarioCount: number;
  readonly periodsPerScenario: number;
  readonly blockLength: number;
  readonly periodCadenceMonths: number;
  readonly seed: number;
}

const DEFAULT_SUBSTANTIAL_LOSS_FRACTION = 0.95;
const COMPARISON_EPSILON = 1e-9;

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function validateDefinition(definition: ObjectiveDefinition): void {
  if (definition.currency !== "USD" && definition.currency !== "AUD") {
    throw new Error("currency must be USD or AUD");
  }
  assertFinite("initialEquity", definition.initialEquity);
  assertFinite("targetEquity", definition.targetEquity);
  assertFinite("horizonMonths", definition.horizonMonths);
  if (definition.initialEquity <= 0) throw new Error("initialEquity must be positive");
  if (definition.targetEquity <= definition.initialEquity) {
    throw new Error("targetEquity must exceed initialEquity");
  }
  if (definition.horizonMonths <= 0) throw new Error("horizonMonths must be positive");
}

export function objectiveReferenceEquity(
  definition: ObjectiveDefinition,
  elapsedMonths: number,
): number {
  validateDefinition(definition);
  assertFinite("elapsedMonths", elapsedMonths);
  if (elapsedMonths < 0) throw new Error("elapsedMonths cannot be negative");
  const boundedElapsedMonths = Math.min(elapsedMonths, definition.horizonMonths);
  const progress = boundedElapsedMonths / definition.horizonMonths;
  const targetMultiple = definition.targetEquity / definition.initialEquity;
  assertFinite("objective target multiple", targetMultiple);
  const referenceEquity =
    definition.initialEquity * targetMultiple ** progress;
  assertFinite("objective reference equity", referenceEquity);
  return referenceEquity;
}

export function calculateObjectiveProgress(
  definition: ObjectiveDefinition,
  currentEquity: number,
  elapsedMonths: number,
): ObjectiveProgress {
  validateDefinition(definition);
  assertFinite("currentEquity", currentEquity);
  assertFinite("elapsedMonths", elapsedMonths);
  if (currentEquity < 0) throw new Error("currentEquity cannot be negative");
  if (elapsedMonths < 0) throw new Error("elapsedMonths cannot be negative");

  const referenceEquity = objectiveReferenceEquity(definition, elapsedMonths);
  const remainingMonths = Math.max(0, definition.horizonMonths - elapsedMonths);
  const progressRatioToReference = currentEquity / referenceEquity;
  assertFinite("progressRatioToReference", progressRatioToReference);

  let status: ObjectiveProgressStatus;
  if (currentEquity === 0) {
    status = "ruined";
  } else if (currentEquity >= definition.targetEquity) {
    status = "met";
  } else if (remainingMonths === 0) {
    status = "expired";
  } else if (Math.abs(progressRatioToReference - 1) <= COMPARISON_EPSILON) {
    status = "on-path";
  } else {
    status = progressRatioToReference > 1 ? "ahead" : "behind";
  }

  const remainingMultiple = currentEquity > 0
    ? definition.targetEquity / currentEquity
    : null;
  if (remainingMultiple !== null) {
    assertFinite("remainingMultiple", remainingMultiple);
  }
  let requiredMonthlyCompoundPct: number | null = null;
  let requiredAnnualCompoundPct: number | null = null;

  if (status === "met") {
    requiredMonthlyCompoundPct = 0;
    requiredAnnualCompoundPct = 0;
  } else if (currentEquity > 0 && remainingMonths > 0) {
    const requiredMultiple = definition.targetEquity / currentEquity;
    requiredMonthlyCompoundPct =
      (requiredMultiple ** (1 / remainingMonths) - 1) * 100;
    requiredAnnualCompoundPct =
      (requiredMultiple ** (12 / remainingMonths) - 1) * 100;
    assertFinite("requiredMonthlyCompoundPct", requiredMonthlyCompoundPct);
    assertFinite("requiredAnnualCompoundPct", requiredAnnualCompoundPct);
  }

  return {
    currency: definition.currency,
    elapsedMonths,
    remainingMonths,
    currentEquity,
    referenceEquity,
    progressRatioToReference,
    remainingMultiple,
    requiredMonthlyCompoundPct,
    requiredAnnualCompoundPct,
    status,
  };
}

function percentile(sortedValues: readonly number[], probability: number): number {
  if (sortedValues.length === 0) throw new Error("percentile requires values");
  const index = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lower = sortedValues[lowerIndex];
  const upper = sortedValues[upperIndex];
  if (lower === undefined || upper === undefined) throw new Error("percentile index is invalid");
  return lower + (upper - lower) * (index - lowerIndex);
}

function summarisePercentiles(values: readonly number[]): PercentileSummary {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    p05: percentile(sorted, 0.05),
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p95: percentile(sorted, 0.95),
  };
}

function maximumDrawdownFraction(equity: readonly number[]): number {
  let peak = equity[0];
  if (peak === undefined) throw new Error("Scenario equity cannot be empty");
  let maximumDrawdown = 0;
  for (const value of equity) {
    peak = Math.max(peak, value);
    if (peak > 0) maximumDrawdown = Math.max(maximumDrawdown, 1 - value / peak);
  }
  return maximumDrawdown;
}

function validateScenarioPaths(
  definition: ObjectiveDefinition,
  paths: readonly ScenarioEquityPath[],
): void {
  validateDefinition(definition);
  if (paths.length === 0) throw new Error("At least one scenario path is required");
  const ids = new Set<string>();
  const expectedPointCount = paths[0]?.equity.length;
  const expectedCadenceMonths = paths[0]?.periodCadenceMonths;
  if (expectedPointCount === undefined || expectedCadenceMonths === undefined) {
    throw new Error("At least one scenario path is required");
  }
  assertFinite("periodCadenceMonths", expectedCadenceMonths);
  if (expectedCadenceMonths <= 0) {
    throw new Error("periodCadenceMonths must be positive");
  }
  for (const path of paths) {
    if (path.scenarioId.trim() !== path.scenarioId || path.scenarioId.length === 0) {
      throw new Error("scenarioId must be a non-empty canonical string");
    }
    if (ids.has(path.scenarioId)) throw new Error(`Duplicate scenarioId ${path.scenarioId}`);
    ids.add(path.scenarioId);
    assertFinite(`${path.scenarioId} periodCadenceMonths`, path.periodCadenceMonths);
    if (
      path.periodCadenceMonths <= 0 ||
      Math.abs(path.periodCadenceMonths - expectedCadenceMonths) >
        COMPARISON_EPSILON
    ) {
      throw new Error("Scenario paths must use the same horizon and cadence");
    }
    if (path.equity.length < 2) throw new Error(`${path.scenarioId} requires at least two equity points`);
    if (path.equity.length !== expectedPointCount) {
      throw new Error("Scenario paths must use the same horizon and cadence");
    }
    for (const value of path.equity) {
      assertFinite(`${path.scenarioId} equity`, value);
      if (value < 0) throw new Error(`${path.scenarioId} equity cannot be negative`);
    }
    const startingEquity = path.equity[0];
    if (startingEquity === undefined) throw new Error(`${path.scenarioId} starting equity is missing`);
    const tolerance = Math.max(1, definition.initialEquity) * 1e-9;
    if (Math.abs(startingEquity - definition.initialEquity) > tolerance) {
      throw new Error(`${path.scenarioId} must start at initialEquity`);
    }
  }
  const scenarioHorizonMonths =
    (expectedPointCount - 1) * expectedCadenceMonths;
  assertFinite("scenario horizon", scenarioHorizonMonths);
  const horizonTolerance = Math.max(1, definition.horizonMonths) * 1e-9;
  if (
    Math.abs(scenarioHorizonMonths - definition.horizonMonths) >
    horizonTolerance
  ) {
    throw new Error("Scenario horizon must match the objective horizon");
  }
}

function probability(count: number, total: number): number {
  return count / total;
}

export function analyseScenarioRisk(
  definition: ObjectiveDefinition,
  paths: readonly ScenarioEquityPath[],
  thresholds: ScenarioRiskThresholds = {},
): ScenarioRiskAnalysis {
  validateScenarioPaths(definition, paths);
  const substantialLossFraction =
    thresholds.substantialLossFraction ?? DEFAULT_SUBSTANTIAL_LOSS_FRACTION;
  assertFinite("substantialLossFraction", substantialLossFraction);
  if (substantialLossFraction <= 0.75 || substantialLossFraction > 1) {
    throw new Error("substantialLossFraction must be greater than 0.75 and at most 1");
  }

  const terminals: number[] = [];
  const drawdowns: number[] = [];
  let targetEverCount = 0;
  let targetTerminalCount = 0;
  let terminalLoss50Count = 0;
  let terminalLoss75Count = 0;
  let terminalSubstantialLossCount = 0;
  let drawdown50Count = 0;
  let drawdown75Count = 0;
  let drawdownSubstantialCount = 0;

  for (const path of paths) {
    const terminal = path.equity.at(-1);
    if (terminal === undefined) throw new Error(`${path.scenarioId} terminal equity is missing`);
    const drawdown = maximumDrawdownFraction(path.equity);
    terminals.push(terminal);
    drawdowns.push(drawdown);

    if (path.equity.some((value) => value >= definition.targetEquity)) targetEverCount += 1;
    if (terminal >= definition.targetEquity) targetTerminalCount += 1;
    if (terminal <= definition.initialEquity * 0.5) terminalLoss50Count += 1;
    if (terminal <= definition.initialEquity * 0.25) terminalLoss75Count += 1;
    if (terminal <= definition.initialEquity * (1 - substantialLossFraction)) {
      terminalSubstantialLossCount += 1;
    }
    if (drawdown >= 0.5) drawdown50Count += 1;
    if (drawdown >= 0.75) drawdown75Count += 1;
    if (drawdown >= substantialLossFraction) drawdownSubstantialCount += 1;
  }

  const scenarioCount = paths.length;
  return {
    scenarioCount,
    periodsPerScenario: (paths[0]?.equity.length ?? 1) - 1,
    periodCadenceMonths: paths[0]?.periodCadenceMonths ?? 0,
    horizonMonths: definition.horizonMonths,
    substantialLossFraction,
    targetEverAttainmentProbability: probability(targetEverCount, scenarioCount),
    targetTerminalAttainmentProbability: probability(targetTerminalCount, scenarioCount),
    terminalLossProbability50: probability(terminalLoss50Count, scenarioCount),
    terminalLossProbability75: probability(terminalLoss75Count, scenarioCount),
    terminalSubstantialLossProbability: probability(
      terminalSubstantialLossCount,
      scenarioCount,
    ),
    maximumDrawdownProbability50: probability(drawdown50Count, scenarioCount),
    maximumDrawdownProbability75: probability(drawdown75Count, scenarioCount),
    maximumDrawdownSubstantialProbability: probability(
      drawdownSubstantialCount,
      scenarioCount,
    ),
    terminalWealth: summarisePercentiles(terminals),
    maximumDrawdownFraction: summarisePercentiles(drawdowns),
  };
}

function validateBootstrapOptions(
  returns: readonly number[],
  options: MovingBlockBootstrapOptions,
): void {
  if (returns.length === 0) throw new Error("Bootstrap requires period returns");
  for (const value of returns) {
    assertFinite("period return", value);
    if (value < -1) throw new Error("period return cannot be less than -1");
  }
  for (const [name, value] of Object.entries({
    scenarioCount: options.scenarioCount,
    periodsPerScenario: options.periodsPerScenario,
    blockLength: options.blockLength,
    seed: options.seed,
  })) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  }
  assertFinite("periodCadenceMonths", options.periodCadenceMonths);
  if (options.periodCadenceMonths <= 0) {
    throw new Error("periodCadenceMonths must be positive");
  }
  if (options.blockLength > returns.length) {
    throw new Error("blockLength cannot exceed the return history length");
  }
  if (options.seed > 0xffff_ffff) throw new Error("seed must fit in an unsigned 32-bit integer");
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

export function movingBlockBootstrapEquityPaths(
  initialEquity: number,
  returns: readonly number[],
  options: MovingBlockBootstrapOptions,
): readonly ScenarioEquityPath[] {
  assertFinite("initialEquity", initialEquity);
  if (initialEquity <= 0) throw new Error("initialEquity must be positive");
  validateBootstrapOptions(returns, options);
  const random = seededRandom(options.seed);
  const paths: ScenarioEquityPath[] = [];

  for (let scenarioIndex = 0; scenarioIndex < options.scenarioCount; scenarioIndex += 1) {
    const equity = [initialEquity];
    let currentEquity = initialEquity;
    let generatedPeriods = 0;
    while (generatedPeriods < options.periodsPerScenario) {
      const blockStart = Math.floor(random() * returns.length);
      for (
        let offset = 0;
        offset < options.blockLength && generatedPeriods < options.periodsPerScenario;
        offset += 1
      ) {
        const sampledReturn = returns[(blockStart + offset) % returns.length];
        if (sampledReturn === undefined) throw new Error("Bootstrap sampled return is missing");
        currentEquity *= 1 + sampledReturn;
        if (currentEquity < 0 || !Number.isFinite(currentEquity)) {
          throw new Error("Bootstrap produced invalid equity");
        }
        equity.push(currentEquity);
        generatedPeriods += 1;
      }
    }
    paths.push({
      scenarioId: `bootstrap-${String(scenarioIndex + 1).padStart(6, "0")}`,
      periodCadenceMonths: options.periodCadenceMonths,
      equity,
    });
  }

  return paths;
}
