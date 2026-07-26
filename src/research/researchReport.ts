import {
  compareStrategyToBenchmarks,
  createResearchEquitySeries,
  summariseBenchmark,
  type BenchmarkComparison,
  type BenchmarkSummary,
  type ResearchEquitySeries,
  type ResearchSeriesKind,
} from "./benchmarks.ts";
import type {
  ObjectiveProgress,
  ScenarioRiskAnalysis,
} from "./objectiveMetrics.ts";
import { sha256Hex } from "../utils/crypto.ts";

export type ResearchEvaluationSplit =
  | "walk-forward"
  | "final-holdout"
  | "sensitivity";

export interface ResearchProvenance {
  readonly codeSha256: string;
  readonly dataSha256: string;
  readonly universeSha256: string;
  readonly strategyConfigSha256: string;
  readonly executionConfigSha256: string;
  readonly objectiveConfigSha256: string;
  readonly benchmarkConfigSha256: string;
  readonly fxConversionSha256?: string;
}

export interface ResearchReportInput {
  readonly reportId: string;
  readonly generatedAt: string;
  readonly evaluationSplit: ResearchEvaluationSplit;
  readonly periodStartMs: number;
  readonly periodEndMs: number;
  readonly strategy: ResearchEquitySeries;
  readonly benchmarks: readonly ResearchEquitySeries[];
  readonly objectiveProgress: ObjectiveProgress;
  readonly scenarioRisk: ScenarioRiskAnalysis;
  readonly provenance: ResearchProvenance;
  readonly warnings: readonly string[];
}

export interface ResearchReport {
  readonly schemaVersion: "research-report-v1";
  readonly reportId: string;
  readonly generatedAt: string;
  readonly evaluationSplit: ResearchEvaluationSplit;
  readonly periodStartMs: number;
  readonly periodEndMs: number;
  readonly strategy: ResearchEquitySeries;
  readonly benchmarks: readonly ResearchEquitySeries[];
  readonly strategySummary: BenchmarkSummary;
  readonly benchmarkSummaries: readonly BenchmarkSummary[];
  readonly comparisons: readonly BenchmarkComparison[];
  readonly objectiveProgress: ObjectiveProgress;
  readonly scenarioRisk: ScenarioRiskAnalysis;
  readonly provenance: ResearchProvenance;
  readonly warnings: readonly string[];
  readonly reportSha256: string;
}

const REQUIRED_BENCHMARK_KINDS: readonly ResearchSeriesKind[] = [
  "aud-cash",
  "btc-hold",
  "equal-weight-hold",
  "objective-path",
];
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

function assertCanonicalString(name: string, value: string): void {
  if (value.trim() !== value || value.length === 0) {
    throw new Error(`${name} must be a non-empty canonical string`);
  }
}

function assertCanonicalIso(name: string, value: string): void {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${name} must be a canonical ISO-8601 timestamp`);
  }
}

function assertDigest(name: string, value: string): void {
  if (!SHA256_HEX_PATTERN.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256 value`);
  }
}

function validateProvenance(provenance: ResearchProvenance): ResearchProvenance {
  assertDigest("codeSha256", provenance.codeSha256);
  assertDigest("dataSha256", provenance.dataSha256);
  assertDigest("universeSha256", provenance.universeSha256);
  assertDigest("strategyConfigSha256", provenance.strategyConfigSha256);
  assertDigest("executionConfigSha256", provenance.executionConfigSha256);
  assertDigest("objectiveConfigSha256", provenance.objectiveConfigSha256);
  assertDigest("benchmarkConfigSha256", provenance.benchmarkConfigSha256);
  if (provenance.fxConversionSha256 !== undefined) {
    assertDigest("fxConversionSha256", provenance.fxConversionSha256);
  }
  return {
    codeSha256: provenance.codeSha256,
    dataSha256: provenance.dataSha256,
    universeSha256: provenance.universeSha256,
    strategyConfigSha256: provenance.strategyConfigSha256,
    executionConfigSha256: provenance.executionConfigSha256,
    objectiveConfigSha256: provenance.objectiveConfigSha256,
    benchmarkConfigSha256: provenance.benchmarkConfigSha256,
    ...(provenance.fxConversionSha256 === undefined
      ? {}
      : { fxConversionSha256: provenance.fxConversionSha256 }),
  };
}

function validateWarnings(warnings: readonly string[]): readonly string[] {
  const sorted = [...warnings].sort();
  for (const warning of sorted) assertCanonicalString("warning", warning);
  if (new Set(sorted).size !== sorted.length) {
    throw new Error("warnings cannot contain duplicates");
  }
  return sorted;
}

function validateProbability(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1`);
  }
}

function validateObjectiveProgress(progress: ObjectiveProgress): void {
  if (progress.currency !== "AUD" && progress.currency !== "USD") {
    throw new Error("objectiveProgress currency must be AUD or USD");
  }
  const numbers = [
    progress.elapsedMonths,
    progress.remainingMonths,
    progress.currentEquity,
    progress.referenceEquity,
    progress.progressRatioToReference,
  ];
  if (!numbers.every(Number.isFinite)) {
    throw new Error("objectiveProgress contains non-finite values");
  }
  if (
    progress.elapsedMonths < 0 ||
    progress.remainingMonths < 0 ||
    progress.currentEquity < 0 ||
    progress.referenceEquity <= 0 ||
    progress.progressRatioToReference < 0
  ) {
    throw new Error("objectiveProgress contains invalid values");
  }
  for (const value of [
    progress.remainingMultiple,
    progress.requiredMonthlyCompoundPct,
    progress.requiredAnnualCompoundPct,
  ]) {
    if (value !== null && !Number.isFinite(value)) {
      throw new Error("objectiveProgress contains a non-finite optional value");
    }
  }
}

function validateScenarioRisk(risk: ScenarioRiskAnalysis): void {
  if (!Number.isInteger(risk.scenarioCount) || risk.scenarioCount <= 0) {
    throw new Error("scenarioCount must be a positive integer");
  }
  if (!Number.isInteger(risk.periodsPerScenario) || risk.periodsPerScenario <= 0) {
    throw new Error("periodsPerScenario must be a positive integer");
  }
  validateProbability("substantialLossFraction", risk.substantialLossFraction);
  for (const [name, value] of Object.entries({
    targetEverAttainmentProbability: risk.targetEverAttainmentProbability,
    targetTerminalAttainmentProbability: risk.targetTerminalAttainmentProbability,
    terminalLossProbability50: risk.terminalLossProbability50,
    terminalLossProbability75: risk.terminalLossProbability75,
    terminalSubstantialLossProbability: risk.terminalSubstantialLossProbability,
    maximumDrawdownProbability50: risk.maximumDrawdownProbability50,
    maximumDrawdownProbability75: risk.maximumDrawdownProbability75,
    maximumDrawdownSubstantialProbability:
      risk.maximumDrawdownSubstantialProbability,
  })) {
    validateProbability(name, value);
  }
  for (const value of Object.values(risk.terminalWealth)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("terminalWealth contains invalid values");
    }
  }
  for (const value of Object.values(risk.maximumDrawdownFraction)) {
    validateProbability("maximumDrawdownFraction", value);
  }
}

function validateBenchmarkSet(
  strategy: ResearchEquitySeries,
  benchmarks: readonly ResearchEquitySeries[],
  objectiveProgress: ObjectiveProgress,
  provenance: ResearchProvenance,
): readonly ResearchEquitySeries[] {
  const validatedStrategy = createResearchEquitySeries(strategy);
  if (validatedStrategy.kind !== "strategy") {
    throw new Error("Research report strategy must use kind strategy");
  }
  const validated = benchmarks
    .map(createResearchEquitySeries)
    .sort((left, right) => left.seriesId.localeCompare(right.seriesId));
  const kinds = new Map<ResearchSeriesKind, ResearchEquitySeries>();
  for (const benchmark of validated) {
    if (benchmark.kind === "strategy") {
      throw new Error("Research report benchmarks cannot contain strategy kind");
    }
    if (kinds.has(benchmark.kind)) {
      throw new Error(`Duplicate benchmark kind ${benchmark.kind}`);
    }
    kinds.set(benchmark.kind, benchmark);
  }
  for (const kind of REQUIRED_BENCHMARK_KINDS) {
    if (!kinds.has(kind)) throw new Error(`Missing required benchmark ${kind}`);
  }
  if (validated.length !== REQUIRED_BENCHMARK_KINDS.length) {
    throw new Error("Research report contains an unsupported benchmark kind");
  }

  const nonObjective = validated.filter(
    (benchmark) => benchmark.kind !== "objective-path",
  );
  if (nonObjective.some((benchmark) => benchmark.currency !== strategy.currency)) {
    throw new Error("Tradable benchmarks must use the strategy currency");
  }
  const objectivePath = kinds.get("objective-path");
  if (objectivePath === undefined) throw new Error("Missing objective-path benchmark");
  if (objectivePath.currency === objectiveProgress.currency) {
    if (provenance.fxConversionSha256 !== undefined) {
      throw new Error("fxConversionSha256 is unnecessary for an unconverted objective path");
    }
  } else {
    if (objectivePath.currency !== strategy.currency) {
      throw new Error("Converted objective path must use the strategy currency");
    }
    if (provenance.fxConversionSha256 === undefined) {
      throw new Error("Converted objective path requires fxConversionSha256");
    }
  }

  compareStrategyToBenchmarks(validatedStrategy, validated);
  return validated;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Report contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`)
      .join(",")}}`;
  }
  throw new Error("Report contains an unsupported value");
}

export async function prepareResearchReport(
  input: ResearchReportInput,
): Promise<ResearchReport> {
  assertCanonicalString("reportId", input.reportId);
  assertCanonicalIso("generatedAt", input.generatedAt);
  if (
    input.evaluationSplit !== "walk-forward" &&
    input.evaluationSplit !== "final-holdout" &&
    input.evaluationSplit !== "sensitivity"
  ) {
    throw new Error("evaluationSplit is invalid");
  }
  if (
    !Number.isSafeInteger(input.periodStartMs) ||
    !Number.isSafeInteger(input.periodEndMs) ||
    input.periodStartMs < 0 ||
    input.periodEndMs <= input.periodStartMs
  ) {
    throw new Error("Report period is invalid");
  }

  const strategy = createResearchEquitySeries(input.strategy);
  const provenance = validateProvenance(input.provenance);
  validateObjectiveProgress(input.objectiveProgress);
  validateScenarioRisk(input.scenarioRisk);
  const benchmarks = validateBenchmarkSet(
    strategy,
    input.benchmarks,
    input.objectiveProgress,
    provenance,
  );
  const firstTimestamp = strategy.points[0]?.timestampMs;
  const lastTimestamp = strategy.points.at(-1)?.timestampMs;
  if (
    firstTimestamp !== input.periodStartMs ||
    lastTimestamp !== input.periodEndMs
  ) {
    throw new Error("Report period must match the strategy series boundaries");
  }

  const warnings = validateWarnings(input.warnings);
  const reportContent = {
    schemaVersion: "research-report-v1" as const,
    reportId: input.reportId,
    generatedAt: input.generatedAt,
    evaluationSplit: input.evaluationSplit,
    periodStartMs: input.periodStartMs,
    periodEndMs: input.periodEndMs,
    strategy,
    benchmarks,
    strategySummary: summariseBenchmark(strategy),
    benchmarkSummaries: benchmarks.map(summariseBenchmark),
    comparisons: compareStrategyToBenchmarks(strategy, benchmarks),
    objectiveProgress: input.objectiveProgress,
    scenarioRisk: input.scenarioRisk,
    provenance,
    warnings,
  };
  const reportSha256 = await sha256Hex(canonicalJson(reportContent));
  return { ...reportContent, reportSha256 };
}
