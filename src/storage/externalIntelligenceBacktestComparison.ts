import {
  verifyExternalIntelligenceBacktestComparison,
  type ExternalIntelligenceBacktestComparison,
  type ExternalIntelligenceReplay,
} from "../backtest/externalIntelligenceReplay.ts";

type D1BindValue = string | number | null;

export interface ExternalIntelligenceBacktestComparisonPersistenceInput {
  readonly comparison: ExternalIntelligenceBacktestComparison;
  readonly replay: ExternalIntelligenceReplay;
  readonly persistedAtMs: number;
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
     research_candidate_frame_count, persisted_at_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(comparison_sha256) DO NOTHING`;

export async function prepareExternalIntelligenceBacktestComparisonPersistence(
  input: ExternalIntelligenceBacktestComparisonPersistenceInput,
): Promise<ExternalIntelligenceBacktestComparisonStatement> {
  if (
    !Number.isSafeInteger(input.persistedAtMs) ||
    input.persistedAtMs < 0
  ) {
    throw new Error("persistedAtMs must be a non-negative safe integer");
  }
  await verifyExternalIntelligenceBacktestComparison(
    input.comparison,
    input.replay,
  );
  const comparison = input.comparison;
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
    input: ExternalIntelligenceBacktestComparisonPersistenceInput,
  ): Promise<ExternalIntelligenceBacktestComparison> {
    const statement =
      await prepareExternalIntelligenceBacktestComparisonPersistence(input);
    await this.db.prepare(statement.sql).bind(...statement.params).run();
    return input.comparison;
  }
}
