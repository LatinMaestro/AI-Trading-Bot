CREATE TABLE cross_sectional_momentum_execution_calibrations (
  calibration_sha256 TEXT PRIMARY KEY CHECK (
    length(calibration_sha256) = 64
    AND calibration_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (
    schema_version =
      'cross-sectional-momentum-execution-calibration-v1'
  ),
  strategy_version TEXT NOT NULL CHECK (
    strategy_version = 'cross-sectional-momentum-v0.1.0'
  ),
  baseline_plan_sha256 TEXT NOT NULL CHECK (
    length(baseline_plan_sha256) = 64
    AND baseline_plan_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  baseline_run_sha256 TEXT NOT NULL,
  calibrated_at_ms INTEGER NOT NULL CHECK (calibrated_at_ms >= 0),
  available_at_ms INTEGER NOT NULL CHECK (
    available_at_ms >= calibrated_at_ms
  ),
  valid_until_ms INTEGER NOT NULL CHECK (
    valid_until_ms > available_at_ms
  ),
  source_count INTEGER NOT NULL CHECK (
    source_count BETWEEN 1 AND 32
  ),
  calibration_canonical_json TEXT NOT NULL CHECK (
    json_valid(calibration_canonical_json)
    AND json_extract(
      calibration_canonical_json,
      '$.calibrationSha256'
    ) = calibration_sha256
    AND json_extract(
      calibration_canonical_json,
      '$.schemaVersion'
    ) = schema_version
    AND json_extract(
      calibration_canonical_json,
      '$.strategyVersion'
    ) = strategy_version
    AND json_extract(
      calibration_canonical_json,
      '$.baselinePlanSha256'
    ) = baseline_plan_sha256
    AND json_extract(
      calibration_canonical_json,
      '$.baselineRunSha256'
    ) = baseline_run_sha256
    AND json_extract(
      calibration_canonical_json,
      '$.calibratedAtMs'
    ) = calibrated_at_ms
    AND json_extract(
      calibration_canonical_json,
      '$.availableAtMs'
    ) = available_at_ms
    AND json_extract(
      calibration_canonical_json,
      '$.validUntilMs'
    ) = valid_until_ms
    AND json_array_length(
      calibration_canonical_json,
      '$.sourceSha256s'
    ) = source_count
    AND json_array_length(
      calibration_canonical_json,
      '$.capacityLevelsAud'
    ) = 5
    AND json_array_length(
      calibration_canonical_json,
      '$.scenarios'
    ) = 8
  ),
  persisted_at_ms INTEGER NOT NULL CHECK (
    persisted_at_ms >= available_at_ms
  ),
  FOREIGN KEY (baseline_run_sha256)
    REFERENCES cross_sectional_momentum_research_runs(run_sha256)
);

CREATE TABLE cross_sectional_momentum_execution_stress_manifests (
  manifest_sha256 TEXT PRIMARY KEY CHECK (
    length(manifest_sha256) = 64
    AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (
    schema_version = 'cross-sectional-momentum-execution-stress-v1'
  ),
  strategy_version TEXT NOT NULL CHECK (
    strategy_version = 'cross-sectional-momentum-v0.1.0'
  ),
  baseline_plan_sha256 TEXT NOT NULL,
  baseline_run_sha256 TEXT NOT NULL,
  baseline_result_sha256 TEXT NOT NULL,
  calibration_sha256 TEXT NOT NULL,
  evaluated_at_ms INTEGER NOT NULL CHECK (evaluated_at_ms >= 0),
  result_count INTEGER NOT NULL CHECK (result_count = 40),
  manifest_canonical_json TEXT NOT NULL CHECK (
    json_valid(manifest_canonical_json)
    AND json_extract(
      manifest_canonical_json,
      '$.manifestSha256'
    ) = manifest_sha256
    AND json_extract(
      manifest_canonical_json,
      '$.schemaVersion'
    ) = schema_version
    AND json_extract(
      manifest_canonical_json,
      '$.strategyVersion'
    ) = strategy_version
    AND json_extract(
      manifest_canonical_json,
      '$.candidateStatus'
    ) = 'research-only-unselected'
    AND json_extract(
      manifest_canonical_json,
      '$.runtimeScopeChanged'
    ) = 0
    AND json_extract(
      manifest_canonical_json,
      '$.selectionAuthority'
    ) = 'none'
    AND json_extract(
      manifest_canonical_json,
      '$.activationAuthority'
    ) = 'none'
    AND json_extract(
      manifest_canonical_json,
      '$.executionAuthority'
    ) = 'none'
    AND json_extract(
      manifest_canonical_json,
      '$.baselinePlanSha256'
    ) = baseline_plan_sha256
    AND json_extract(
      manifest_canonical_json,
      '$.baselineRunSha256'
    ) = baseline_run_sha256
    AND json_extract(
      manifest_canonical_json,
      '$.baselineResultSha256'
    ) = baseline_result_sha256
    AND json_extract(
      manifest_canonical_json,
      '$.calibrationSha256'
    ) = calibration_sha256
    AND json_extract(
      manifest_canonical_json,
      '$.evaluatedAtMs'
    ) = evaluated_at_ms
    AND json_array_length(
      manifest_canonical_json,
      '$.results'
    ) = result_count
  ),
  persisted_at_ms INTEGER NOT NULL CHECK (
    persisted_at_ms >= evaluated_at_ms
  ),
  FOREIGN KEY (baseline_run_sha256)
    REFERENCES cross_sectional_momentum_research_runs(run_sha256),
  FOREIGN KEY (calibration_sha256)
    REFERENCES cross_sectional_momentum_execution_calibrations(
      calibration_sha256
    )
);

CREATE TABLE cross_sectional_momentum_execution_stress_results (
  manifest_sha256 TEXT NOT NULL,
  result_index INTEGER NOT NULL CHECK (
    result_index BETWEEN 0 AND 39
  ),
  capital_aud INTEGER NOT NULL CHECK (
    capital_aud IN (200, 1000, 10000, 100000, 1000000)
  ),
  scenario_id TEXT NOT NULL CHECK (
    scenario_id IN (
      'baseline',
      'all-maker',
      'all-taker',
      'double-spread',
      'quarter-liquidity',
      'quarter-maker-fill',
      'double-taker-slippage',
      'severe-combined'
    )
  ),
  config_sha256 TEXT NOT NULL CHECK (
    length(config_sha256) = 64
    AND config_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  steps_sha256 TEXT NOT NULL CHECK (
    length(steps_sha256) = 64
    AND steps_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  result_sha256 TEXT NOT NULL CHECK (
    length(result_sha256) = 64
    AND result_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  final_equity_aud REAL NOT NULL CHECK (final_equity_aud >= 0),
  total_return_pct REAL NOT NULL,
  maximum_drawdown_pct REAL NOT NULL CHECK (
    maximum_drawdown_pct BETWEEN 0 AND 100
  ),
  turnover_multiple REAL NOT NULL CHECK (turnover_multiple >= 0),
  total_cost_aud REAL NOT NULL CHECK (total_cost_aud >= 0),
  requested_notional_aud REAL NOT NULL CHECK (
    requested_notional_aud >= 0
  ),
  filled_notional_aud REAL NOT NULL CHECK (
    filled_notional_aud >= 0
  ),
  missed_fill_notional_aud REAL NOT NULL CHECK (
    missed_fill_notional_aud >= 0
  ),
  missed_fill_ratio REAL NOT NULL CHECK (
    missed_fill_ratio BETWEEN 0 AND 1
  ),
  capacity_constrained_execution_count INTEGER NOT NULL CHECK (
    capacity_constrained_execution_count >= 0
  ),
  PRIMARY KEY (manifest_sha256, result_index),
  UNIQUE (manifest_sha256, capital_aud, scenario_id),
  FOREIGN KEY (manifest_sha256)
    REFERENCES cross_sectional_momentum_execution_stress_manifests(
      manifest_sha256
    )
);

CREATE TABLE cross_sectional_momentum_execution_stress_commits (
  manifest_sha256 TEXT PRIMARY KEY,
  result_count INTEGER NOT NULL CHECK (result_count = 40),
  committed_at_ms INTEGER NOT NULL CHECK (committed_at_ms >= 0),
  FOREIGN KEY (manifest_sha256)
    REFERENCES cross_sectional_momentum_execution_stress_manifests(
      manifest_sha256
    )
);

CREATE TABLE cross_sectional_momentum_complete_evaluations (
  evaluation_sha256 TEXT PRIMARY KEY CHECK (
    length(evaluation_sha256) = 64
    AND evaluation_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (
    schema_version =
      'cross-sectional-momentum-complete-evaluation-v1'
  ),
  strategy_version TEXT NOT NULL CHECK (
    strategy_version = 'cross-sectional-momentum-v0.1.0'
  ),
  walk_forward_manifest_sha256 TEXT NOT NULL,
  sensitivity_manifest_sha256 TEXT NOT NULL,
  final_holdout_plan_sha256 TEXT NOT NULL,
  final_holdout_run_sha256 TEXT NOT NULL,
  final_holdout_result_sha256 TEXT NOT NULL,
  execution_stress_manifest_sha256 TEXT NOT NULL,
  benchmark_evidence_sha256 TEXT NOT NULL,
  objective_progress_evidence_sha256 TEXT NOT NULL,
  scenario_risk_evidence_sha256 TEXT NOT NULL,
  universe_evidence_sha256 TEXT NOT NULL,
  execution_capacity_evidence_sha256 TEXT NOT NULL,
  execution_capacity_summary_json TEXT NOT NULL CHECK (
    json_valid(execution_capacity_summary_json)
    AND json_extract(
      execution_capacity_summary_json,
      '$.stressResultCount'
    ) = 40
    AND json_array_length(
      execution_capacity_summary_json,
      '$.capacityLevelsAud'
    ) = 5
  ),
  report_sha256 TEXT NOT NULL,
  persisted_at_ms INTEGER NOT NULL CHECK (persisted_at_ms >= 0),
  FOREIGN KEY (walk_forward_manifest_sha256)
    REFERENCES cross_sectional_momentum_evaluation_manifest_commits(
      manifest_sha256
    ),
  FOREIGN KEY (sensitivity_manifest_sha256)
    REFERENCES cross_sectional_momentum_evaluation_manifest_commits(
      manifest_sha256
    ),
  FOREIGN KEY (final_holdout_run_sha256)
    REFERENCES cross_sectional_momentum_research_runs(run_sha256),
  FOREIGN KEY (execution_stress_manifest_sha256)
    REFERENCES cross_sectional_momentum_execution_stress_commits(
      manifest_sha256
    ),
  FOREIGN KEY (report_sha256)
    REFERENCES research_report_commits(report_sha256)
);

CREATE INDEX idx_cross_sectional_stress_run
  ON cross_sectional_momentum_execution_stress_manifests(
    baseline_run_sha256
  );
CREATE INDEX idx_cross_sectional_stress_results
  ON cross_sectional_momentum_execution_stress_results(
    manifest_sha256,
    capital_aud,
    scenario_id
  );
CREATE INDEX idx_cross_sectional_complete_report
  ON cross_sectional_momentum_complete_evaluations(report_sha256);

CREATE TRIGGER validate_cross_sectional_execution_calibration
BEFORE INSERT ON cross_sectional_momentum_execution_calibrations
WHEN NOT EXISTS (
  SELECT 1
  FROM cross_sectional_momentum_research_runs run
  WHERE run.run_sha256 = NEW.baseline_run_sha256
    AND run.plan_sha256 = NEW.baseline_plan_sha256
)
BEGIN
  SELECT RAISE(
    ABORT,
    'Cross-sectional execution calibration run is invalid'
  );
END;

CREATE TRIGGER reject_cross_sectional_execution_calibration_conflict
BEFORE INSERT ON cross_sectional_momentum_execution_calibrations
WHEN EXISTS (
  SELECT 1
  FROM cross_sectional_momentum_execution_calibrations existing
  WHERE existing.calibration_sha256 = NEW.calibration_sha256
    AND (
      existing.schema_version <> NEW.schema_version
      OR existing.strategy_version <> NEW.strategy_version
      OR existing.baseline_plan_sha256 <> NEW.baseline_plan_sha256
      OR existing.baseline_run_sha256 <> NEW.baseline_run_sha256
      OR existing.calibrated_at_ms <> NEW.calibrated_at_ms
      OR existing.available_at_ms <> NEW.available_at_ms
      OR existing.valid_until_ms <> NEW.valid_until_ms
      OR existing.source_count <> NEW.source_count
      OR existing.calibration_canonical_json
        <> NEW.calibration_canonical_json
    )
)
BEGIN
  SELECT RAISE(
    ABORT,
    'Cross-sectional execution calibration conflict'
  );
END;

CREATE TRIGGER validate_cross_sectional_execution_stress
BEFORE INSERT ON cross_sectional_momentum_execution_stress_manifests
WHEN NOT EXISTS (
  SELECT 1
  FROM cross_sectional_momentum_execution_calibrations calibration
  JOIN cross_sectional_momentum_research_runs run
    ON run.run_sha256 = NEW.baseline_run_sha256
  WHERE calibration.calibration_sha256 = NEW.calibration_sha256
    AND calibration.baseline_plan_sha256 = NEW.baseline_plan_sha256
    AND calibration.baseline_run_sha256 = NEW.baseline_run_sha256
    AND NEW.evaluated_at_ms BETWEEN
      calibration.available_at_ms AND calibration.valid_until_ms
    AND run.plan_sha256 = NEW.baseline_plan_sha256
    AND run.result_sha256 = NEW.baseline_result_sha256
)
BEGIN
  SELECT RAISE(
    ABORT,
    'Cross-sectional execution stress evidence is invalid'
  );
END;

CREATE TRIGGER reject_cross_sectional_execution_stress_conflict
BEFORE INSERT ON cross_sectional_momentum_execution_stress_manifests
WHEN EXISTS (
  SELECT 1
  FROM cross_sectional_momentum_execution_stress_manifests existing
  WHERE existing.manifest_sha256 = NEW.manifest_sha256
    AND (
      existing.schema_version <> NEW.schema_version
      OR existing.strategy_version <> NEW.strategy_version
      OR existing.baseline_plan_sha256 <> NEW.baseline_plan_sha256
      OR existing.baseline_run_sha256 <> NEW.baseline_run_sha256
      OR existing.baseline_result_sha256 <> NEW.baseline_result_sha256
      OR existing.calibration_sha256 <> NEW.calibration_sha256
      OR existing.evaluated_at_ms <> NEW.evaluated_at_ms
      OR existing.result_count <> NEW.result_count
      OR existing.manifest_canonical_json <> NEW.manifest_canonical_json
    )
)
BEGIN
  SELECT RAISE(
    ABORT,
    'Cross-sectional execution stress conflict'
  );
END;

CREATE TRIGGER validate_cross_sectional_execution_stress_result
BEFORE INSERT ON cross_sectional_momentum_execution_stress_results
WHEN NOT EXISTS (
  SELECT 1
  FROM cross_sectional_momentum_execution_stress_manifests manifest
  WHERE manifest.manifest_sha256 = NEW.manifest_sha256
    AND json_extract(
      manifest.manifest_canonical_json,
      '$.results[' || NEW.result_index || '].capitalAud'
    ) = NEW.capital_aud
    AND json_extract(
      manifest.manifest_canonical_json,
      '$.results[' || NEW.result_index || '].scenarioId'
    ) = NEW.scenario_id
    AND json_extract(
      manifest.manifest_canonical_json,
      '$.results[' || NEW.result_index || '].configSha256'
    ) = NEW.config_sha256
    AND json_extract(
      manifest.manifest_canonical_json,
      '$.results[' || NEW.result_index || '].stepsSha256'
    ) = NEW.steps_sha256
    AND json_extract(
      manifest.manifest_canonical_json,
      '$.results[' || NEW.result_index || '].resultSha256'
    ) = NEW.result_sha256
    AND json_extract(
      manifest.manifest_canonical_json,
      '$.results[' || NEW.result_index || '].finalEquityAud'
    ) = NEW.final_equity_aud
    AND json_extract(
      manifest.manifest_canonical_json,
      '$.results[' || NEW.result_index || '].totalReturnPct'
    ) = NEW.total_return_pct
    AND json_extract(
      manifest.manifest_canonical_json,
      '$.results[' || NEW.result_index || '].maximumDrawdownPct'
    ) = NEW.maximum_drawdown_pct
    AND json_extract(
      manifest.manifest_canonical_json,
      '$.results[' || NEW.result_index || '].turnoverMultiple'
    ) = NEW.turnover_multiple
    AND json_extract(
      manifest.manifest_canonical_json,
      '$.results[' || NEW.result_index || '].totalCostAud'
    ) = NEW.total_cost_aud
    AND json_extract(
      manifest.manifest_canonical_json,
      '$.results[' || NEW.result_index || '].requestedNotionalAud'
    ) = NEW.requested_notional_aud
    AND json_extract(
      manifest.manifest_canonical_json,
      '$.results[' || NEW.result_index || '].filledNotionalAud'
    ) = NEW.filled_notional_aud
    AND json_extract(
      manifest.manifest_canonical_json,
      '$.results[' || NEW.result_index || '].missedFillNotionalAud'
    ) = NEW.missed_fill_notional_aud
    AND json_extract(
      manifest.manifest_canonical_json,
      '$.results[' || NEW.result_index || '].missedFillRatio'
    ) = NEW.missed_fill_ratio
    AND json_extract(
      manifest.manifest_canonical_json,
      '$.results[' || NEW.result_index
        || '].capacityConstrainedExecutionCount'
    ) = NEW.capacity_constrained_execution_count
)
BEGIN
  SELECT RAISE(
    ABORT,
    'Cross-sectional execution stress result is invalid'
  );
END;

CREATE TRIGGER reject_cross_sectional_execution_stress_result_conflict
BEFORE INSERT ON cross_sectional_momentum_execution_stress_results
WHEN EXISTS (
  SELECT 1
  FROM cross_sectional_momentum_execution_stress_results existing
  WHERE existing.manifest_sha256 = NEW.manifest_sha256
    AND existing.result_index = NEW.result_index
    AND (
      existing.capital_aud <> NEW.capital_aud
      OR existing.scenario_id <> NEW.scenario_id
      OR existing.config_sha256 <> NEW.config_sha256
      OR existing.steps_sha256 <> NEW.steps_sha256
      OR existing.result_sha256 <> NEW.result_sha256
      OR existing.final_equity_aud <> NEW.final_equity_aud
      OR existing.total_return_pct <> NEW.total_return_pct
      OR existing.maximum_drawdown_pct <> NEW.maximum_drawdown_pct
      OR existing.turnover_multiple <> NEW.turnover_multiple
      OR existing.total_cost_aud <> NEW.total_cost_aud
      OR existing.requested_notional_aud <> NEW.requested_notional_aud
      OR existing.filled_notional_aud <> NEW.filled_notional_aud
      OR existing.missed_fill_notional_aud
        <> NEW.missed_fill_notional_aud
      OR existing.missed_fill_ratio <> NEW.missed_fill_ratio
      OR existing.capacity_constrained_execution_count
        <> NEW.capacity_constrained_execution_count
    )
)
BEGIN
  SELECT RAISE(
    ABORT,
    'Cross-sectional execution stress result conflict'
  );
END;

CREATE TRIGGER validate_cross_sectional_execution_stress_commit
BEFORE INSERT ON cross_sectional_momentum_execution_stress_commits
WHEN NOT EXISTS (
  SELECT 1
  FROM cross_sectional_momentum_execution_stress_manifests manifest
  WHERE manifest.manifest_sha256 = NEW.manifest_sha256
    AND manifest.result_count = NEW.result_count
    AND manifest.persisted_at_ms <= NEW.committed_at_ms
    AND (
      SELECT COUNT(*)
      FROM cross_sectional_momentum_execution_stress_results result
      WHERE result.manifest_sha256 = NEW.manifest_sha256
    ) = NEW.result_count
    AND (
      SELECT MIN(result.result_index)
      FROM cross_sectional_momentum_execution_stress_results result
      WHERE result.manifest_sha256 = NEW.manifest_sha256
    ) = 0
    AND (
      SELECT MAX(result.result_index)
      FROM cross_sectional_momentum_execution_stress_results result
      WHERE result.manifest_sha256 = NEW.manifest_sha256
    ) = NEW.result_count - 1
)
BEGIN
  SELECT RAISE(
    ABORT,
    'Cross-sectional execution stress membership is incomplete'
  );
END;

CREATE TRIGGER validate_cross_sectional_complete_evaluation
BEFORE INSERT ON cross_sectional_momentum_complete_evaluations
WHEN
  NOT EXISTS (
    SELECT 1
    FROM cross_sectional_momentum_evaluation_manifests manifest
    JOIN cross_sectional_momentum_evaluation_manifest_commits committed
      ON committed.manifest_sha256 = manifest.manifest_sha256
    WHERE manifest.manifest_sha256 =
      NEW.walk_forward_manifest_sha256
      AND manifest.manifest_kind = 'walk-forward'
      AND committed.committed_at_ms <= NEW.persisted_at_ms
  )
  OR NOT EXISTS (
    SELECT 1
    FROM cross_sectional_momentum_evaluation_manifests manifest
    JOIN cross_sectional_momentum_evaluation_manifest_commits committed
      ON committed.manifest_sha256 = manifest.manifest_sha256
    WHERE manifest.manifest_sha256 =
      NEW.sensitivity_manifest_sha256
      AND manifest.manifest_kind = 'sensitivity'
      AND committed.committed_at_ms <= NEW.persisted_at_ms
  )
  OR NOT EXISTS (
    SELECT 1
    FROM cross_sectional_momentum_evaluation_manifest_runs member
    WHERE member.manifest_sha256 =
      NEW.walk_forward_manifest_sha256
      AND member.member_kind = 'final-holdout'
      AND member.run_sha256 = NEW.final_holdout_run_sha256
      AND member.plan_sha256 = NEW.final_holdout_plan_sha256
      AND member.result_sha256 = NEW.final_holdout_result_sha256
  )
  OR NOT EXISTS (
    SELECT 1
    FROM cross_sectional_momentum_evaluation_manifest_runs member
    WHERE member.manifest_sha256 =
      NEW.sensitivity_manifest_sha256
      AND member.member_kind = 'sensitivity-variant'
      AND member.run_sha256 = NEW.final_holdout_run_sha256
      AND member.plan_sha256 = NEW.final_holdout_plan_sha256
      AND member.result_sha256 = NEW.final_holdout_result_sha256
  )
  OR NOT EXISTS (
    SELECT 1
    FROM cross_sectional_momentum_execution_stress_manifests stress
    JOIN cross_sectional_momentum_execution_stress_commits committed
      ON committed.manifest_sha256 = stress.manifest_sha256
    WHERE stress.manifest_sha256 =
      NEW.execution_stress_manifest_sha256
      AND stress.baseline_run_sha256 =
        NEW.final_holdout_run_sha256
      AND stress.baseline_plan_sha256 =
        NEW.final_holdout_plan_sha256
      AND stress.baseline_result_sha256 =
        NEW.final_holdout_result_sha256
      AND committed.committed_at_ms <= NEW.persisted_at_ms
  )
  OR NOT EXISTS (
    SELECT 1
    FROM research_reports report
    JOIN research_report_commits committed
      ON committed.report_sha256 = report.report_sha256
    WHERE report.report_sha256 = NEW.report_sha256
      AND report.evaluation_split = 'final-holdout'
      AND report.persisted_at_ms <= NEW.persisted_at_ms
      AND committed.persisted_at_ms <= NEW.persisted_at_ms
  )
BEGIN
  SELECT RAISE(
    ABORT,
    'Cross-sectional complete evaluation evidence is not committed'
  );
END;

CREATE TRIGGER reject_cross_sectional_complete_evaluation_conflict
BEFORE INSERT ON cross_sectional_momentum_complete_evaluations
WHEN EXISTS (
  SELECT 1
  FROM cross_sectional_momentum_complete_evaluations existing
  WHERE existing.evaluation_sha256 = NEW.evaluation_sha256
    AND (
      existing.schema_version <> NEW.schema_version
      OR existing.strategy_version <> NEW.strategy_version
      OR existing.walk_forward_manifest_sha256
        <> NEW.walk_forward_manifest_sha256
      OR existing.sensitivity_manifest_sha256
        <> NEW.sensitivity_manifest_sha256
      OR existing.final_holdout_plan_sha256
        <> NEW.final_holdout_plan_sha256
      OR existing.final_holdout_run_sha256
        <> NEW.final_holdout_run_sha256
      OR existing.final_holdout_result_sha256
        <> NEW.final_holdout_result_sha256
      OR existing.execution_stress_manifest_sha256
        <> NEW.execution_stress_manifest_sha256
      OR existing.benchmark_evidence_sha256
        <> NEW.benchmark_evidence_sha256
      OR existing.objective_progress_evidence_sha256
        <> NEW.objective_progress_evidence_sha256
      OR existing.scenario_risk_evidence_sha256
        <> NEW.scenario_risk_evidence_sha256
      OR existing.universe_evidence_sha256
        <> NEW.universe_evidence_sha256
      OR existing.execution_capacity_evidence_sha256
        <> NEW.execution_capacity_evidence_sha256
      OR existing.execution_capacity_summary_json
        <> NEW.execution_capacity_summary_json
      OR existing.report_sha256 <> NEW.report_sha256
    )
)
BEGIN
  SELECT RAISE(
    ABORT,
    'Cross-sectional complete evaluation conflict'
  );
END;

CREATE TRIGGER prevent_cross_sectional_execution_calibration_update
BEFORE UPDATE ON cross_sectional_momentum_execution_calibrations
BEGIN
  SELECT RAISE(ABORT, 'Cross-sectional execution calibrations are immutable');
END;
CREATE TRIGGER prevent_cross_sectional_execution_calibration_delete
BEFORE DELETE ON cross_sectional_momentum_execution_calibrations
BEGIN
  SELECT RAISE(ABORT, 'Cross-sectional execution calibrations are immutable');
END;
CREATE TRIGGER prevent_cross_sectional_execution_stress_update
BEFORE UPDATE ON cross_sectional_momentum_execution_stress_manifests
BEGIN
  SELECT RAISE(ABORT, 'Cross-sectional execution stress is immutable');
END;
CREATE TRIGGER prevent_cross_sectional_execution_stress_delete
BEFORE DELETE ON cross_sectional_momentum_execution_stress_manifests
BEGIN
  SELECT RAISE(ABORT, 'Cross-sectional execution stress is immutable');
END;
CREATE TRIGGER prevent_cross_sectional_execution_stress_result_update
BEFORE UPDATE ON cross_sectional_momentum_execution_stress_results
BEGIN
  SELECT RAISE(ABORT, 'Cross-sectional execution stress results are immutable');
END;
CREATE TRIGGER prevent_cross_sectional_execution_stress_result_delete
BEFORE DELETE ON cross_sectional_momentum_execution_stress_results
BEGIN
  SELECT RAISE(ABORT, 'Cross-sectional execution stress results are immutable');
END;
CREATE TRIGGER prevent_cross_sectional_execution_stress_commit_update
BEFORE UPDATE ON cross_sectional_momentum_execution_stress_commits
BEGIN
  SELECT RAISE(ABORT, 'Cross-sectional execution stress commits are immutable');
END;
CREATE TRIGGER prevent_cross_sectional_execution_stress_commit_delete
BEFORE DELETE ON cross_sectional_momentum_execution_stress_commits
BEGIN
  SELECT RAISE(ABORT, 'Cross-sectional execution stress commits are immutable');
END;
CREATE TRIGGER prevent_cross_sectional_complete_evaluation_update
BEFORE UPDATE ON cross_sectional_momentum_complete_evaluations
BEGIN
  SELECT RAISE(ABORT, 'Cross-sectional complete evaluations are immutable');
END;
CREATE TRIGGER prevent_cross_sectional_complete_evaluation_delete
BEFORE DELETE ON cross_sectional_momentum_complete_evaluations
BEGIN
  SELECT RAISE(ABORT, 'Cross-sectional complete evaluations are immutable');
END;
