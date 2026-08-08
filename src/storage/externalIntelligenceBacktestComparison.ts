import {
  runExternalIntelligenceBacktestComparison,
  type ExternalIntelligenceBacktestComparison,
} from "../backtest/engine.ts";
import type {
  PrepareExternalIntelligenceReplayInput,
} from "../backtest/externalIntelligenceReplay.ts";
import type {
  BacktestConfig,
  BacktestStep,
} from "../backtest/types.ts";
import {
  canonicalIntelligenceJson,
} from "../intelligence/canonical.ts";

type D1BindValue = string | number | null;

export interface ExternalIntelligenceBacktestComparisonVerificationInput {
  readonly comparison: ExternalIntelligenceBacktestComparison;
  readonly config: BacktestConfig;
  readonly steps: readonly BacktestStep[];
  readonly replayInput: PrepareExternalIntelligenceReplayInput;
  readonly persistedAtMs: number;
}

export interface VerifiedExternalIntelligenceBacktestComparison {
  readonly comparison: ExternalIntelligenceBacktestComparison;
  readonly latestExecutionAtMs: number;
}

export interface ExternalIntelligenceBacktestComparisonStatement {
  readonly sql: string;
  readonly params: readonly D1BindValue[];
}

export const INSERT_EXTERNAL_INTELLIGENCE_BACKTEST_COMPARISON_SQL =
  `INSERT INTO external_intelligence_backtest_comparisons
    (comparison_sha256, replay_sha256, baseline_result_sha256,
     intelligence_gated_result_sha256, baseline_final_equity_aud,
     intelligence_gated_final_equity_aud, baseline_total_return_pct,
     intelligence_gated_total_return_pct, final_equity_delta_aud,
     total_return_delta_pct, suppressed_request_count,
     suppressed_requested_notional_aud, pause_frame_count,
     research_candidate_frame_count, latest_execution_at_ms, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(comparison_sha256) DO NOTHING`;

function assertPersistenceTime(
  persistedAtMs: number,
  latestExecutionAtMs: number,
): void {
  if (
    !Number.isSafeInteger(persistedAtMs) ||
    persistedAtMs < latestExecutionAtMs
  ) {
    throw new Error(
      "persistedAtMs must be a safe integer no earlier than comparison execution",
    );
  }
}

export async function verifyExternalIntelligenceBacktestComparison(
  input: ExternalIntelligenceBacktestComparisonVerificationInput,
): Promise<VerifiedExternalIntelligenceBacktestComparison> {
  const reproduced = await runExternalIntelligenceBacktestComparison(
    input.config,
    input.steps,
    input.replayInput,
  );
  if (
    reproduced.comparisonSha256 !== input.comparison.comparisonSha256 ||
    canonicalIntelligenceJson(reproduced) !==
      canonicalIntelligenceJson(input.comparison)
  ) {
    throw new Error(
      "External-intelligence backtest comparison does not reproduce exactly",
    );
  }

  const baselineExecutionAtMs =
    reproduced.baselineResult.equityCurve.at(-1)?.timestampMs;
  const gatedExecutionAtMs =
    reproduced.intelligenceGatedResult.equityCurve.at(-1)?.timestampMs;
  if (
    baselineExecutionAtMs === undefined ||
    gatedExecutionAtMs === undefined ||
    baselineExecutionAtMs !== gatedExecutionAtMs
  ) {
    throw new Error(
      "Comparison results must end at the same verified execution time",
    );
  }
  assertPersistenceTime(input.persistedAtMs, baselineExecutionAtMs);
  return {
    comparison: reproduced,
    latestExecutionAtMs: baselineExecutionAtMs,
  };
}

export async function prepareExternalIntelligenceBacktestComparisonPersistence(
  input: ExternalIntelligenceBacktestComparisonVerificationInput,
): Promise<ExternalIntelligenceBacktestComparisonStatement> {
  const verified =
    await verifyExternalIntelligenceBacktestComparison(input);
  const comparison = verified.comparison;
  return {
    sql: INSERT_EXTERNAL_INTELLIGENCE_BACKTEST_COMPARISON_SQL,
    params: [
      comparison.comparisonSha256,
      comparison.replaySha256,
      comparison.baselineResultSha256,
      comparison.intelligenceGatedResultSha256,
      comparison.baselineResult.finalEquityAud,
      comparison.intelligenceGatedResult.finalEquityAud,
      comparison.baselineResult.totalReturnPct,
      comparison.intelligenceGatedResult.totalReturnPct,
      comparison.finalEquityDeltaAud,
      comparison.totalReturnDeltaPct,
      comparison.suppressedRequestCount,
      comparison.suppressedRequestedNotionalAud,
      comparison.pauseFrameCount,
      comparison.researchCandidateFrameCount,
      verified.latestExecutionAtMs,
      input.persistedAtMs,
    ],
  };
}

export class ExternalIntelligenceBacktestComparisonRepository {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async persist(
    input: ExternalIntelligenceBacktestComparisonVerificationInput,
  ): Promise<ExternalIntelligenceBacktestComparison> {
    const statement =
      await prepareExternalIntelligenceBacktestComparisonPersistence(input);
    await this.db.prepare(statement.sql).bind(...statement.params).run();
    return input.comparison;
  }
}
