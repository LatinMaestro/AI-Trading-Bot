CREATE TABLE hourly_trend_breakout_research_runs (
  run_sha256 TEXT PRIMARY KEY CHECK (
    length(run_sha256) = 64
    AND run_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  plan_sha256 TEXT NOT NULL CHECK (
    length(plan_sha256) = 64
    AND plan_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  config_sha256 TEXT NOT NULL CHECK (
    length(config_sha256) = 64
    AND config_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  result_sha256 TEXT NOT NULL CHECK (
    length(result_sha256) = 64
    AND result_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  strategy_version TEXT NOT NULL CHECK (
    strategy_version = 'hourly-trend-breakout-v0.1.0'
  ),
  first_decision_at_ms INTEGER NOT NULL CHECK (
    first_decision_at_ms >= 0
  ),
  last_decision_at_ms INTEGER NOT NULL CHECK (
    last_decision_at_ms >= first_decision_at_ms
  ),
  decision_count INTEGER NOT NULL CHECK (decision_count > 0),
  initial_equity_aud REAL NOT NULL CHECK (initial_equity_aud > 0),
  final_equity_aud REAL NOT NULL CHECK (final_equity_aud >= 0),
  total_return_pct REAL NOT NULL,
  maximum_drawdown_pct REAL NOT NULL CHECK (
    maximum_drawdown_pct >= 0
    AND maximum_drawdown_pct <= 100
  ),
  turnover_multiple REAL NOT NULL CHECK (turnover_multiple >= 0),
  execution_count INTEGER NOT NULL CHECK (execution_count >= 0),
  membership_count INTEGER NOT NULL CHECK (
    membership_count = decision_count
  ),
  persisted_at_ms INTEGER NOT NULL CHECK (
    persisted_at_ms >= last_decision_at_ms
  )
);

CREATE INDEX idx_hourly_trend_breakout_research_runs_plan
  ON hourly_trend_breakout_research_runs(plan_sha256);
CREATE INDEX idx_hourly_trend_breakout_research_runs_persisted
  ON hourly_trend_breakout_research_runs(persisted_at_ms);

CREATE TRIGGER reject_hourly_trend_breakout_research_run_conflict
BEFORE INSERT ON hourly_trend_breakout_research_runs
WHEN EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_research_runs existing
  WHERE existing.run_sha256 = NEW.run_sha256
    AND (
      existing.plan_sha256 <> NEW.plan_sha256
      OR existing.config_sha256 <> NEW.config_sha256
      OR existing.result_sha256 <> NEW.result_sha256
      OR existing.strategy_version <> NEW.strategy_version
      OR existing.first_decision_at_ms <> NEW.first_decision_at_ms
      OR existing.last_decision_at_ms <> NEW.last_decision_at_ms
      OR existing.decision_count <> NEW.decision_count
      OR existing.initial_equity_aud <> NEW.initial_equity_aud
      OR existing.final_equity_aud <> NEW.final_equity_aud
      OR existing.total_return_pct <> NEW.total_return_pct
      OR existing.maximum_drawdown_pct <> NEW.maximum_drawdown_pct
      OR existing.turnover_multiple <> NEW.turnover_multiple
      OR existing.execution_count <> NEW.execution_count
      OR existing.membership_count <> NEW.membership_count
    )
)
BEGIN
  SELECT RAISE(
    ABORT,
    'Hourly trend breakout research run conflict'
  );
END;

CREATE TRIGGER prevent_hourly_trend_breakout_research_run_update
BEFORE UPDATE ON hourly_trend_breakout_research_runs
BEGIN
  SELECT RAISE(
    ABORT,
    'Hourly trend breakout research runs are immutable'
  );
END;

CREATE TRIGGER prevent_hourly_trend_breakout_research_run_delete
BEFORE DELETE ON hourly_trend_breakout_research_runs
BEGIN
  SELECT RAISE(
    ABORT,
    'Hourly trend breakout research runs are immutable'
  );
END;
