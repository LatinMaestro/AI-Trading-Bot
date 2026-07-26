import type {
  BlockBootstrapConfig,
  ObjectiveConfig,
  ObjectiveProgress,
  ScenarioRiskSummary,
  WealthPercentiles,
} from "./objectiveRiskTypes.ts";

const MONTHS_PER_YEAR = 12;
const DEFAULT_SUBSTANTIAL_LOSS_PCT = 95;

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function assertPositive(name: string, value: number): void {
  assertFinite(name, value);
  if (value <= 0) throw new Error(`${name} must be positive`);
}

function validateObjective(config: ObjectiveConfig): void {
  assertPositive("initialEquity", config.initialEquity);
  assertPositive("targetEquity", config.targetEquity);
  assertPositive("horizonMonths", config.horizonMonths);
  if (config.targetEquity <= config.initialEquity) {
    throw new Error("targetEquity must exceed initialEquity");
  }
}

function percentile(sortedValues: readonly number[], probability: number): number {
  if (sortedValues.length === 0) throw new Error("Percentile requires values");
  if (probability < 0 || probability > 1) throw new Error("Probability is invalid");
  const position = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedValues[lowerIndex];
  const upper = sortedValues[upperIndex];
  if (lower === undefined || upper === undefined) throw new Error("Percentile index is invalid");
  return lower + (upper - lower) * (position - lowerIndex);
}

function wealthPercentiles(values: readonly number[]): WealthPercentiles {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p05: percentile(sorted, 0.05),
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p95: percentile(sorted, 0.95),
  };
}

function maximumDrawdown(path: readonly number[]): number {
  let peak = path[0];
  if (peak === undefined) throw new Error("Scenario path cannot be empty");
  let maximum = 0;
  for (const equity of path) {
    peak = Math.max(peak, equity);
    if (peak > 0) maximum = Math.max(maximum, 1 - equity / peak);
  }
  return maximum;
}

function validateScenarioPath(path: readonly number[], initialEquity: number): void {
  if (path.length < 2) throw new Error("Scenario path requires at least two equity points");
  const first = path[0];
  if (first === undefined) throw new Error("Scenario path cannot be empty");
  const tolerance = Math.max(1e-9, initialEquity * 1e-9);
  if (Math.abs(first - initialEquity) > tolerance) {
    throw new Error("Scenario path must begin at initialEquity");
  }
  for (const equity of path) {
    assertFinite("scenario equity", equity);
    if (equity < 0) throw new Error("Scenario equity cannot be negative");
  }
}

export function objectiveReferenceEquity(
  config: ObjectiveConfig,
  elapsedMonths: number,
): number {
  validateObjective(config);
  assertFinite("elapsedMonths", elapsedMonths);
  if (elapsedMonths < 0) throw new Error("elapsedMonths cannot be negative");
  const boundedElapsed = Math.min(elapsedMonths, config.horizonMonths);
  return (
    config.initialEquity *
    (config.targetEquity / config.initialEquity) **
      (boundedElapsed / config.horizonMonths)
  );
}

export function evaluateObjectiveProgress(
  config: ObjectiveConfig,
  currentEquity: number,
  elapsedMonths: number,
): ObjectiveProgress {
  validateObjective(config);
  assertFinite("currentEquity", currentEquity);
  assertFinite("elapsedMonths", elapsedMonths);
  if (currentEquity < 0) throw new Error("currentEquity cannot be negative");
  if (elapsedMonths < 0) throw new Error("elapsedMonths cannot be negative");

  const referenceEquity = objectiveReferenceEquity(config, elapsedMonths);
  const remainingMonths = Math.max(0, config.horizonMonths - elapsedMonths);
  const targetReached = currentEquity >= config.targetEquity;
  const horizonExpired = elapsedMonths >= config.horizonMonths;
  const remainingMultiple = currentEquity > 0 ? config.targetEquity / currentEquity : null;
  const requiredMonthlyCompoundReturn = targetReached
    ? 0
    : currentEquity > 0 && remainingMonths > 0
      ? (config.targetEquity / currentEquity) ** (1 / remainingMonths) - 1
      : null;
  const requiredAnnualCompoundReturn =
    requiredMonthlyCompoundReturn === null
      ? null
      : (1 + requiredMonthlyCompoundReturn) ** MONTHS_PER_YEAR - 1;

  return {
    elapsedMonths,
    remainingMonths,
    referenceEquity,
    progressVsReference: currentEquity / referenceEquity,
    remainingMultiple,
    requiredMonthlyCompoundReturn,
    requiredAnnualCompoundReturn,
    targetReached,
    horizonExpired,
    onOrAheadOfReference: currentEquity >= referenceEquity,
  };
}

export function analyseScenarioRisk(
  paths: readonly (readonly number[])[],
  objective: ObjectiveConfig,
  substantialLossPct = DEFAULT_SUBSTANTIAL_LOSS_PCT,
): ScenarioRiskSummary {
  validateObjective(objective);
  if (paths.length === 0) throw new Error("Scenario analysis requires at least one path");
  assertFinite("substantialLossPct", substantialLossPct);
  if (substantialLossPct <= 75 || substantialLossPct >= 100) {
    throw new Error("substantialLossPct must be greater than 75 and less than 100");
  }

  const terminals: number[] = [];
  const drawdowns: number[] = [];
  let targetHits = 0;
  let terminalTargets = 0;
  let loss50Breaches = 0;
  let loss75Breaches = 0;
  let substantialLossBreaches = 0;
  const loss50Floor = objective.initialEquity * 0.5;
  const loss75Floor = objective.initialEquity * 0.25;
  const substantialLossFloor =
    objective.initialEquity * (1 - substantialLossPct / 100);

  for (const path of paths) {
    validateScenarioPath(path, objective.initialEquity);
    const terminal = path.at(-1);
    if (terminal === undefined) throw new Error("Scenario path cannot be empty");
    let minimum = path[0];
    if (minimum === undefined) throw new Error("Scenario path cannot be empty");
    for (const equity of path) minimum = Math.min(minimum, equity);
    terminals.push(terminal);
    drawdowns.push(maximumDrawdown(path));
    if (path.some((equity) => equity >= objective.targetEquity)) targetHits += 1;
    if (terminal >= objective.targetEquity) terminalTargets += 1;
    if (minimum <= loss50Floor) loss50Breaches += 1;
    if (minimum <= loss75Floor) loss75Breaches += 1;
    if (minimum <= substantialLossFloor) substantialLossBreaches += 1;
  }

  const terminalWealth = wealthPercentiles(terminals);
  const sortedDrawdowns = [...drawdowns].sort((a, b) => a - b);
  return {
    scenarioCount: paths.length,
    targetHitProbability: targetHits / paths.length,
    terminalTargetProbability: terminalTargets / paths.length,
    loss50BreachProbability: loss50Breaches / paths.length,
    loss75BreachProbability: loss75Breaches / paths.length,
    substantialLossBreachProbability: substantialLossBreaches / paths.length,
    substantialLossPct,
    terminalWealth,
    maximumDrawdown: {
      p50: percentile(sortedDrawdowns, 0.5),
      p95: percentile(sortedDrawdowns, 0.95),
    },
    medianTerminalMultiple: terminalWealth.p50 / objective.initialEquity,
  };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function generateBlockBootstrapPaths(
  periodReturns: readonly number[],
  config: BlockBootstrapConfig,
): readonly (readonly number[])[] {
  assertPositive("initialEquity", config.initialEquity);
  if (periodReturns.length === 0) throw new Error("periodReturns cannot be empty");
  if (!Number.isInteger(config.scenarioCount) || config.scenarioCount <= 0) {
    throw new Error("scenarioCount must be a positive integer");
  }
  if (!Number.isInteger(config.periodsPerScenario) || config.periodsPerScenario <= 0) {
    throw new Error("periodsPerScenario must be a positive integer");
  }
  if (
    !Number.isInteger(config.blockLength) ||
    config.blockLength <= 0 ||
    config.blockLength > periodReturns.length
  ) {
    throw new Error("blockLength must be between 1 and the return history length");
  }
  if (!Number.isInteger(config.seed)) throw new Error("seed must be an integer");
  for (const periodReturn of periodReturns) {
    assertFinite("period return", periodReturn);
    if (periodReturn <= -1) throw new Error("period return must be greater than -1");
  }

  const random = seededRandom(config.seed);
  const paths: number[][] = [];
  for (let scenario = 0; scenario < config.scenarioCount; scenario += 1) {
    const path = [config.initialEquity];
    let equity = config.initialEquity;
    while (path.length <= config.periodsPerScenario) {
      const blockStart = Math.floor(random() * periodReturns.length);
      for (
        let offset = 0;
        offset < config.blockLength && path.length <= config.periodsPerScenario;
        offset += 1
      ) {
        const sourceIndex = (blockStart + offset) % periodReturns.length;
        const periodReturn = periodReturns[sourceIndex];
        if (periodReturn === undefined) throw new Error("Bootstrap return index is invalid");
        equity *= 1 + periodReturn;
        if (!Number.isFinite(equity) || equity < 0) {
          throw new Error("Bootstrap path produced invalid equity");
        }
        path.push(equity);
      }
    }
    paths.push(path);
  }
  return paths;
}
