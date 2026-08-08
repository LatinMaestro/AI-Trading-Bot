CREATE TABLE external_intelligence_backtest_comparisons (
  comparison_sha256 TEXT PRIMARY KEY CHECK (
    length(comparison_sha256) = 64
    AND comparison_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  replay_sha256 TEXT NOT NULL CHECK (
    length(replay_sha256) = 64
    AND replay_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  baseline_result_sha256 TEXT NOT NULL CHECK (
    length(baseline_result_sha256) = 64
    AND baseline_result_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  intelligence_gated_result_sha256 TEXT NOT NULL CHECK (
    length(intelligence_gated_result_sha256) = 64
    AND intelligence_gated_result_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  baseline_final_equity_aud REAL NOT NULL CHECK (
    baseline_final_equity_aud >= 0
  ),
  intelligence_gated_final_equity_aud REAL NOT NULL CHECK (
    intelligence_gated_final_equity_aud >= 0
  ),
  baseline_total_return_pct REAL NOT NULL,
  intelligence_gated_total_return_pct REAL NOT NULL,
  final_equity_delta_aud REAL NOT NULL CHECK (
    final_equity_delta_aud
      = intelligence_gated_final_equity_aud - baseline_final_equity_aud
  ),
  total_return_delta_pct REAL NOT NULL CHECK (
    total_return_delta_pct
      = intelligence_gated_total_return_pct - baseline_total_return_pct
  ),
  suppressed_request_count INTEGER NOT NULL CHECK (
    typeof(suppressed_request_count) = 'integer'
    AND suppressed_request_count >= 0
  ),
  suppressed_requested_notional_aud REAL NOT NULL CHECK (
    suppressed_requested_notional_aud >= 0
  ),
  pause_frame_count INTEGER NOT NULL CHECK (
    typeof(pause_frame_count) = 'integer'
    AND pause_frame_count >= 0
  ),
  research_candidate_frame_count INTEGER NOT NULL CHECK (
    typeof(research_candidate_frame_count) = 'integer'
    AND research_candidate_frame_count >= 0
  ),
  latest_execution_at_ms INTEGER NOT NULL CHECK (
    typeof(latest_execution_at_ms) = 'integer'
    AND latest_execution_at_ms >= 0
  ),
  persisted_at_ms INTEGER NOT NULL CHECK (
    typeof(persisted_at_ms) = 'integer'
    AND persisted_at_ms >= latest_execution_at_ms
  )
);

CREATE INDEX idx_external_intelligence_backtest_comparisons_replay
  ON external_intelligence_backtest_comparisons(replay_sha256);
CREATE INDEX idx_external_intelligence_backtest_comparisons_persisted
  ON external_intelligence_backtest_comparisons(persisted_at_ms);

CREATE TRIGGER reject_external_intelligence_backtest_comparison_conflict
BEFORE INSERT ON external_intelligence_backtest_comparisons
WHEN EXISTS (
  SELECT 1
  FROM external_intelligence_backtest_comparisons existing
  WHERE existing.comparison_sha256 = NEW.comparison_sha256
    AND (
      existing.replay_sha256 <> NEW.replay_sha256
      OR existing.baseline_result_sha256 <> NEW.baseline_result_sha256
      OR existing.intelligence_gated_result_sha256
        <> NEW.intelligence_gated_result_sha256
      OR existing.baseline_final_equity_aud
        <> NEW.baseline_final_equity_aud
      OR existing.intelligence_gated_final_equity_aud
        <> NEW.intelligence_gated_final_equity_aud
      OR existing.baseline_total_return_pct
        <> NEW.baseline_total_return_pct
      OR existing.intelligence_gated_total_return_pct
        <> NEW.intelligence_gated_total_return_pct
      OR existing.final_equity_delta_aud <> NEW.final_equity_delta_aud
      OR existing.total_return_delta_pct <> NEW.total_return_delta_pct
      OR existing.suppressed_request_count
        <> NEW.suppressed_request_count
      OR existing.suppressed_requested_notional_aud
        <> NEW.suppressed_requested_notional_aud
      OR existing.pause_frame_count <> NEW.pause_frame_count
      OR existing.research_candidate_frame_count
        <> NEW.research_candidate_frame_count
      OR existing.latest_execution_at_ms <> NEW.latest_execution_at_ms
    )
)
BEGIN
  SELECT RAISE(
    ABORT,
    'External intelligence backtest comparison conflict'
  );
END;

CREATE TRIGGER prevent_external_intelligence_backtest_comparison_update
BEFORE UPDATE ON external_intelligence_backtest_comparisons
BEGIN
  SELECT RAISE(
    ABORT,
    'External intelligence backtest comparisons are immutable'
  );
END;

CREATE TRIGGER prevent_external_intelligence_backtest_comparison_delete
BEFORE DELETE ON external_intelligence_backtest_comparisons
BEGIN
  SELECT RAISE(
    ABORT,
    'External intelligence backtest comparisons are immutable'
  );
END;
