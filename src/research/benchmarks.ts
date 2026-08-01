import {
  objectiveReferenceEquity,
  type ObjectiveCurrency,
  type ObjectiveDefinition,
} from "./objectiveMetrics.ts";

export type ResearchSeriesKind =
  | "strategy"
  | "aud-cash"
  | "btc-hold"
  | "equal-weight-hold"
  | "objective-path";

export interface EquityPoint {
  readonly timestampMs: number;
  readonly equity: number;
}

export interface ResearchEquitySeries {
  readonly seriesId: string;
  readonly kind: ResearchSeriesKind;
  readonly currency: ObjectiveCurrency;
  readonly points: readonly EquityPoint[];
  readonly sourceDigests: readonly string[];
}

export interface BenchmarkSummary {
  readonly seriesId: string;
  readonly kind: ResearchSeriesKind;
  readonly currency: ObjectiveCurrency;
  readonly periods: number;
  readonly initialEquity: number;
  readonly terminalEquity: number;
  readonly totalReturnPct: number;
  readonly maximumDrawdownPct: number;
}

export type BenchmarkComparison =
  | {
      readonly benchmarkId: string;
      readonly comparable: true;
      readonly terminalExcess: number;
      readonly totalReturnDifferencePct: number;
      readonly maximumDrawdownDifferencePct: number;
    }
  | {
      readonly benchmarkId: string;
      readonly comparable: false;
      readonly reason: "currency-mismatch";
    };

export interface PeriodReturnBenchmarkInput {
  readonly seriesId: string;
  readonly currency: ObjectiveCurrency;
  readonly initialEquity: number;
  readonly timestampsMs: readonly number[];
  readonly periodReturns: readonly number[];
  readonly sourceDigests: readonly string[];
}

export interface PriceBenchmarkInput {
  readonly seriesId: string;
  readonly currency: ObjectiveCurrency;
  readonly initialEquity: number;
  readonly timestampsMs: readonly number[];
  readonly prices: readonly number[];
  readonly sourceDigests: readonly string[];
}

export interface EqualWeightAssetInput {
  readonly assetId: string;
  readonly prices: readonly number[];
  readonly sourceDigests: readonly string[];
}

export interface EqualWeightBenchmarkInput {
  readonly seriesId: string;
  readonly currency: ObjectiveCurrency;
  readonly initialEquity: number;
  readonly timestampsMs: readonly number[];
  readonly assets: readonly EqualWeightAssetInput[];
}

export interface ObjectivePathBenchmarkInput {
  readonly seriesId: string;
  readonly objective: ObjectiveDefinition;
  readonly timestampsMs: readonly number[];
  readonly elapsedMonths: readonly number[];
  readonly sourceDigests: readonly string[];
  readonly reportingCurrency?: ObjectiveCurrency;
  readonly fxRates?: readonly number[];
  readonly fxSourceDigests?: readonly string[];
}

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

function assertCanonicalId(name: string, value: string): void {
  if (value.trim() !== value || value.length === 0) {
    throw new Error(`${name} must be a non-empty canonical string`);
  }
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function assertPositive(name: string, value: number): void {
  assertFinite(name, value);
  if (value <= 0) throw new Error(`${name} must be positive`);
}

function canonicalDigests(digests: readonly string[]): readonly string[] {
  if (digests.length === 0) throw new Error("sourceDigests cannot be empty");
  const sorted = [...new Set(digests)].sort();
  for (const digest of sorted) {
    if (!SHA256_HEX_PATTERN.test(digest)) {
      throw new Error("sourceDigests must contain lowercase SHA-256 values");
    }
  }
  return sorted;
}

function validateTimestamps(timestampsMs: readonly number[]): void {
  if (timestampsMs.length < 2) {
    throw new Error("A research series requires at least two timestamps");
  }
  let previous: number | undefined;
  for (const timestamp of timestampsMs) {
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new Error("timestampsMs must contain non-negative safe integers");
    }
    if (previous !== undefined && timestamp <= previous) {
      throw new Error("timestampsMs must be strictly increasing");
    }
    previous = timestamp;
  }
}

function buildSeries(
  seriesId: string,
  kind: ResearchSeriesKind,
  currency: ObjectiveCurrency,
  timestampsMs: readonly number[],
  equity: readonly number[],
  sourceDigests: readonly string[],
): ResearchEquitySeries {
  assertCanonicalId("seriesId", seriesId);
  if (currency !== "AUD" && currency !== "USD") {
    throw new Error("currency must be AUD or USD");
  }
  validateTimestamps(timestampsMs);
  if (equity.length !== timestampsMs.length) {
    throw new Error("Equity and timestamp lengths must match");
  }
  const points = equity.map((value, index) => {
    assertFinite(`${seriesId} equity`, value);
    if (value < 0) throw new Error(`${seriesId} equity cannot be negative`);
    const timestampMs = timestampsMs[index];
    if (timestampMs === undefined) throw new Error("Timestamp index is invalid");
    return { timestampMs, equity: value };
  });
  if ((points[0]?.equity ?? 0) <= 0) throw new Error("Initial equity must be positive");
  return {
    seriesId,
    kind,
    currency,
    points,
    sourceDigests: canonicalDigests(sourceDigests),
  };
}

export function createResearchEquitySeries(
  series: ResearchEquitySeries,
): ResearchEquitySeries {
  return buildSeries(
    series.seriesId,
    series.kind,
    series.currency,
    series.points.map((point) => point.timestampMs),
    series.points.map((point) => point.equity),
    series.sourceDigests,
  );
}

export function buildAudCashBenchmark(
  input: PeriodReturnBenchmarkInput,
): ResearchEquitySeries {
  if (input.currency !== "AUD") {
    throw new Error("AUD cash benchmark must use AUD");
  }
  assertPositive("initialEquity", input.initialEquity);
  validateTimestamps(input.timestampsMs);
  if (input.periodReturns.length !== input.timestampsMs.length - 1) {
    throw new Error("periodReturns must contain one value per timestamp interval");
  }
  const equity = [input.initialEquity];
  let current = input.initialEquity;
  for (const periodReturn of input.periodReturns) {
    assertFinite("period return", periodReturn);
    if (periodReturn <= -1) throw new Error("period return must be greater than -1");
    current *= 1 + periodReturn;
    if (!Number.isFinite(current) || current < 0) {
      throw new Error("Cash benchmark produced invalid equity");
    }
    equity.push(current);
  }
  return buildSeries(
    input.seriesId,
    "aud-cash",
    input.currency,
    input.timestampsMs,
    equity,
    input.sourceDigests,
  );
}

export function buildBtcHoldBenchmark(
  input: PriceBenchmarkInput,
): ResearchEquitySeries {
  assertPositive("initialEquity", input.initialEquity);
  validateTimestamps(input.timestampsMs);
  if (input.prices.length !== input.timestampsMs.length) {
    throw new Error("prices and timestampsMs lengths must match");
  }
  const initialPrice = input.prices[0];
  if (initialPrice === undefined) throw new Error("BTC benchmark requires prices");
  assertPositive("initial BTC price", initialPrice);
  const equity = input.prices.map((price) => {
    assertPositive("BTC price", price);
    return input.initialEquity * (price / initialPrice);
  });
  return buildSeries(
    input.seriesId,
    "btc-hold",
    input.currency,
    input.timestampsMs,
    equity,
    input.sourceDigests,
  );
}

export function buildEqualWeightHoldBenchmark(
  input: EqualWeightBenchmarkInput,
): ResearchEquitySeries {
  assertPositive("initialEquity", input.initialEquity);
  validateTimestamps(input.timestampsMs);
  if (input.assets.length === 0) throw new Error("Equal-weight benchmark requires assets");
  const ids = new Set<string>();
  const sourceDigests: string[] = [];
  for (const asset of input.assets) {
    assertCanonicalId("assetId", asset.assetId);
    if (ids.has(asset.assetId)) throw new Error(`Duplicate assetId ${asset.assetId}`);
    ids.add(asset.assetId);
    if (asset.prices.length !== input.timestampsMs.length) {
      throw new Error(`${asset.assetId} prices and timestampsMs lengths must match`);
    }
    for (const price of asset.prices) assertPositive(`${asset.assetId} price`, price);
    sourceDigests.push(...canonicalDigests(asset.sourceDigests));
  }

  const allocation = input.initialEquity / input.assets.length;
  const equity = input.timestampsMs.map((_, index) =>
    input.assets.reduce((total, asset) => {
      const initialPrice = asset.prices[0];
      const price = asset.prices[index];
      if (initialPrice === undefined || price === undefined) {
        throw new Error(`${asset.assetId} price index is invalid`);
      }
      return total + allocation * (price / initialPrice);
    }, 0),
  );
  return buildSeries(
    input.seriesId,
    "equal-weight-hold",
    input.currency,
    input.timestampsMs,
    equity,
    sourceDigests,
  );
}

export function buildObjectivePathBenchmark(
  input: ObjectivePathBenchmarkInput,
): ResearchEquitySeries {
  validateTimestamps(input.timestampsMs);
  if (input.elapsedMonths.length !== input.timestampsMs.length) {
    throw new Error("elapsedMonths and timestampsMs lengths must match");
  }
  const reportingCurrency =
    input.reportingCurrency ?? input.objective.currency;
  const isConverted = reportingCurrency !== input.objective.currency;
  if (isConverted) {
    if (
      input.fxRates === undefined ||
      input.fxRates.length !== input.timestampsMs.length
    ) {
      throw new Error("Converted objective path requires one FX rate per timestamp");
    }
    if (input.fxSourceDigests === undefined) {
      throw new Error("Converted objective path requires FX source digests");
    }
  } else if (
    input.fxRates !== undefined ||
    input.fxSourceDigests !== undefined
  ) {
    throw new Error("Unconverted objective path cannot include FX inputs");
  }

  let previous: number | undefined;
  const equity = input.elapsedMonths.map((elapsedMonths, index) => {
    assertFinite("elapsedMonths", elapsedMonths);
    if (elapsedMonths < 0) throw new Error("elapsedMonths cannot be negative");
    if (previous !== undefined && elapsedMonths < previous) {
      throw new Error("elapsedMonths must be non-decreasing");
    }
    previous = elapsedMonths;
    const reference = objectiveReferenceEquity(input.objective, elapsedMonths);
    if (!isConverted) return reference;
    const fxRate = input.fxRates?.[index];
    if (fxRate === undefined) throw new Error("FX rate index is invalid");
    assertPositive("FX rate", fxRate);
    const converted = reference * fxRate;
    assertFinite("converted objective equity", converted);
    return converted;
  });
  if ((input.elapsedMonths[0] ?? -1) !== 0) {
    throw new Error("Objective-path benchmark must begin at zero elapsed months");
  }
  return buildSeries(
    input.seriesId,
    "objective-path",
    reportingCurrency,
    input.timestampsMs,
    equity,
    isConverted
      ? [...input.sourceDigests, ...canonicalDigests(input.fxSourceDigests ?? [])]
      : input.sourceDigests,
  );
}

function maximumDrawdownPct(points: readonly EquityPoint[]): number {
  let peak = points[0]?.equity;
  if (peak === undefined) throw new Error("Series cannot be empty");
  let maximum = 0;
  for (const point of points) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maximum = Math.max(maximum, 1 - point.equity / peak);
  }
  return maximum * 100;
}

export function summariseBenchmark(series: ResearchEquitySeries): BenchmarkSummary {
  const validated = createResearchEquitySeries(series);
  const initialEquity = validated.points[0]?.equity;
  const terminalEquity = validated.points.at(-1)?.equity;
  if (initialEquity === undefined || terminalEquity === undefined) {
    throw new Error("Series cannot be empty");
  }
  return {
    seriesId: validated.seriesId,
    kind: validated.kind,
    currency: validated.currency,
    periods: validated.points.length - 1,
    initialEquity,
    terminalEquity,
    totalReturnPct: (terminalEquity / initialEquity - 1) * 100,
    maximumDrawdownPct: maximumDrawdownPct(validated.points),
  };
}

function assertAlignedTimestamps(
  strategy: ResearchEquitySeries,
  benchmark: ResearchEquitySeries,
): void {
  if (strategy.points.length !== benchmark.points.length) {
    throw new Error(`${benchmark.seriesId} does not share the strategy horizon`);
  }
  for (let index = 0; index < strategy.points.length; index += 1) {
    if (strategy.points[index]?.timestampMs !== benchmark.points[index]?.timestampMs) {
      throw new Error(`${benchmark.seriesId} does not share the strategy cadence`);
    }
  }
}

export function compareStrategyToBenchmarks(
  strategy: ResearchEquitySeries,
  benchmarks: readonly ResearchEquitySeries[],
): readonly BenchmarkComparison[] {
  const validatedStrategy = createResearchEquitySeries(strategy);
  if (validatedStrategy.kind !== "strategy") {
    throw new Error("Strategy series must use kind strategy");
  }
  const ids = new Set<string>();
  const strategySummary = summariseBenchmark(validatedStrategy);
  return [...benchmarks]
    .sort((left, right) => left.seriesId.localeCompare(right.seriesId))
    .map((benchmark) => {
      const validated = createResearchEquitySeries(benchmark);
      if (validated.kind === "strategy") {
        throw new Error("Benchmark list cannot contain a strategy series");
      }
      if (ids.has(validated.seriesId)) {
        throw new Error(`Duplicate benchmark ${validated.seriesId}`);
      }
      ids.add(validated.seriesId);
      assertAlignedTimestamps(validatedStrategy, validated);
      if (validated.currency !== validatedStrategy.currency) {
        return {
          benchmarkId: validated.seriesId,
          comparable: false,
          reason: "currency-mismatch",
        };
      }
      const summary = summariseBenchmark(validated);
      return {
        benchmarkId: validated.seriesId,
        comparable: true,
        terminalExcess: strategySummary.terminalEquity - summary.terminalEquity,
        totalReturnDifferencePct:
          strategySummary.totalReturnPct - summary.totalReturnPct,
        maximumDrawdownDifferencePct:
          strategySummary.maximumDrawdownPct - summary.maximumDrawdownPct,
      };
    });
}
