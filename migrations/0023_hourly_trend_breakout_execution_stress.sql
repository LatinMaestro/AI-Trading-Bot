CREATE TABLE hourly_trend_breakout_execution_calibrations (
  calibration_sha256 TEXT PRIMARY KEY CHECK (
    length(calibration_sha256) = 64
    AND calibration_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (
    schema_version = 'hourly-trend-breakout-execution-calibration-v1'
  ),
  strategy_version TEXT NOT NULL CHECK (
    strategy_version = 'hourly-trend-breakout-v0.1.0'
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
  source_count INTEGER NOT NULL CHECK (source_count BETWEEN 1 AND 32),
  canonical_json TEXT NOT NULL CHECK (
    json_valid(canonical_json)
    AND json_extract(canonical_json, '$.calibrationSha256')
      = calibration_sha256
    AND json_extract(canonical_json, '$.baselinePlanSha256')
      = baseline_plan_sha256
    AND json_extract(canonical_json, '$.baselineRunSha256')
      = baseline_run_sha256
    AND json_extract(canonical_json, '$.calibratedAtMs')
      = calibrated_at_ms
    AND json_extract(canonical_json, '$.availableAtMs')
      = available_at_ms
    AND json_extract(canonical_json, '$.validUntilMs')
      = valid_until_ms
    AND json_array_length(
      json_extract(canonical_json, '$.sourceSha256s')
    ) = source_count
    AND json_array_length(
      json_extract(canonical_json, '$.capacityLevelsAud')
    ) = 5
    AND json_array_length(
      json_extract(canonical_json, '$.scenarios')
    ) = 8
  ),
  persisted_at_ms INTEGER NOT NULL CHECK (
    persisted_at_ms >= available_at_ms
  ),
  FOREIGN KEY (baseline_run_sha256)
    REFERENCES hourly_trend_breakout_research_runs(run_sha256)
);

CREATE TABLE hourly_trend_breakout_execution_stress_manifests (
  manifest_sha256 TEXT PRIMARY KEY CHECK (
    length(manifest_sha256) = 64
    AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (
    schema_version = 'hourly-trend-breakout-execution-stress-v1'
  ),
  strategy_version TEXT NOT NULL CHECK (
    strategy_version = 'hourly-trend-breakout-v0.1.0'
  ),
  candidate_status TEXT NOT NULL CHECK (
    candidate_status = 'unselected-research-only'
  ),
  baseline_plan_sha256 TEXT NOT NULL,
  baseline_run_sha256 TEXT NOT NULL,
  baseline_result_sha256 TEXT NOT NULL CHECK (
    length(baseline_result_sha256) = 64
    AND baseline_result_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  calibration_sha256 TEXT NOT NULL,
  evaluated_at_ms INTEGER NOT NULL CHECK (evaluated_at_ms >= 0),
  result_count INTEGER NOT NULL CHECK (result_count = 40),
  canonical_json TEXT NOT NULL CHECK (
    json_valid(canonical_json)
    AND json_extract(canonical_json, '$.manifestSha256') = manifest_sha256
    AND json_extract(canonical_json, '$.candidateStatus')
      = candidate_status
    AND json_extract(canonical_json, '$.baselinePlanSha256')
      = baseline_plan_sha256
    AND json_extract(canonical_json, '$.baselineRunSha256')
      = baseline_run_sha256
    AND json_extract(canonical_json, '$.baselineResultSha256')
      = baseline_result_sha256
    AND json_extract(canonical_json, '$.calibrationSha256')
      = calibration_sha256
    AND json_extract(canonical_json, '$.evaluatedAtMs')
      = evaluated_at_ms
    AND json_array_length(
      json_extract(canonical_json, '$.results')
    ) = result_count
  ),
  persisted_at_ms INTEGER NOT NULL CHECK (
    persisted_at_ms >= evaluated_at_ms
  ),
  FOREIGN KEY (baseline_run_sha256)
    REFERENCES hourly_trend_breakout_research_runs(run_sha256),
  FOREIGN KEY (calibration_sha256)
    REFERENCES hourly_trend_breakout_execution_calibrations(
      calibration_sha256
    )
);

CREATE TABLE hourly_trend_breakout_complete_evaluation_stress_bindings (
  evaluation_sha256 TEXT PRIMARY KEY,
  report_sha256 TEXT NOT NULL,
  stress_manifest_sha256 TEXT NOT NULL,
  persisted_at_ms INTEGER NOT NULL,
  FOREIGN KEY (evaluation_sha256)
    REFERENCES hourly_trend_breakout_complete_evaluations(
      evaluation_sha256
    ),
  FOREIGN KEY (report_sha256)
    REFERENCES research_report_commits(report_sha256),
  FOREIGN KEY (stress_manifest_sha256)
    REFERENCES hourly_trend_breakout_execution_stress_manifests(
      manifest_sha256
    )
);

CREATE TRIGGER validate_execution_calibration_run
BEFORE INSERT ON hourly_trend_breakout_execution_calibrations
WHEN NOT EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_research_runs run
  WHERE run.run_sha256 = NEW.baseline_run_sha256
    AND run.plan_sha256 = NEW.baseline_plan_sha256
)
BEGIN
  SELECT RAISE(ABORT, 'Execution calibration baseline is not persisted');
END;

CREATE TRIGGER validate_execution_stress_baseline
BEFORE INSERT ON hourly_trend_breakout_execution_stress_manifests
WHEN NOT EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_research_runs run
  WHERE run.run_sha256 = NEW.baseline_run_sha256
    AND run.plan_sha256 = NEW.baseline_plan_sha256
    AND run.result_sha256 = NEW.baseline_result_sha256
)
OR NOT EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_execution_calibrations calibration
  WHERE calibration.calibration_sha256 = NEW.calibration_sha256
    AND calibration.baseline_plan_sha256 = NEW.baseline_plan_sha256
    AND calibration.baseline_run_sha256 = NEW.baseline_run_sha256
    AND calibration.available_at_ms <= NEW.evaluated_at_ms
    AND calibration.valid_until_ms >= NEW.evaluated_at_ms
)
BEGIN
  SELECT RAISE(ABORT, 'Execution stress baseline is not persisted');
END;

CREATE TRIGGER reject_execution_calibration_conflict
BEFORE INSERT ON hourly_trend_breakout_execution_calibrations
WHEN EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_execution_calibrations existing
  WHERE existing.calibration_sha256 = NEW.calibration_sha256
    AND existing.canonical_json <> NEW.canonical_json
)
BEGIN
  SELECT RAISE(ABORT, 'Execution calibration conflict');
END;

CREATE TRIGGER reject_execution_stress_conflict
BEFORE INSERT ON hourly_trend_breakout_execution_stress_manifests
WHEN EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_execution_stress_manifests existing
  WHERE existing.manifest_sha256 = NEW.manifest_sha256
    AND existing.canonical_json <> NEW.canonical_json
)
BEGIN
  SELECT RAISE(ABORT, 'Execution stress manifest conflict');
END;

CREATE TRIGGER validate_complete_evaluation_stress_binding
BEFORE INSERT ON hourly_trend_breakout_complete_evaluation_stress_bindings
WHEN NOT EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_complete_evaluations evaluation
  JOIN hourly_trend_breakout_execution_stress_manifests stress
    ON stress.manifest_sha256 = NEW.stress_manifest_sha256
  WHERE evaluation.evaluation_sha256 = NEW.evaluation_sha256
    AND evaluation.report_sha256 = NEW.report_sha256
    AND evaluation.final_holdout_plan_sha256
      = stress.baseline_plan_sha256
    AND evaluation.final_holdout_run_sha256
      = stress.baseline_run_sha256
    AND evaluation.final_holdout_result_sha256
      = stress.baseline_result_sha256
    AND evaluation.persisted_at_ms <= NEW.persisted_at_ms
    AND stress.persisted_at_ms <= NEW.persisted_at_ms
)
BEGIN
  SELECT RAISE(ABORT, 'Complete evaluation stress evidence is invalid');
END;

CREATE TRIGGER reject_complete_evaluation_stress_binding_conflict
BEFORE INSERT ON hourly_trend_breakout_complete_evaluation_stress_bindings
WHEN EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_complete_evaluation_stress_bindings existing
  WHERE existing.evaluation_sha256 = NEW.evaluation_sha256
    AND (
      existing.report_sha256 <> NEW.report_sha256
      OR existing.stress_manifest_sha256 <> NEW.stress_manifest_sha256
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Complete evaluation stress binding conflict');
END;

CREATE TRIGGER prevent_execution_calibration_update
BEFORE UPDATE ON hourly_trend_breakout_execution_calibrations
BEGIN
  SELECT RAISE(ABORT, 'Execution calibrations are immutable');
END;

CREATE TRIGGER prevent_execution_calibration_delete
BEFORE DELETE ON hourly_trend_breakout_execution_calibrations
BEGIN
  SELECT RAISE(ABORT, 'Execution calibrations are immutable');
END;

CREATE TRIGGER prevent_execution_stress_update
BEFORE UPDATE ON hourly_trend_breakout_execution_stress_manifests
BEGIN
  SELECT RAISE(ABORT, 'Execution stress manifests are immutable');
END;

CREATE TRIGGER prevent_execution_stress_delete
BEFORE DELETE ON hourly_trend_breakout_execution_stress_manifests
BEGIN
  SELECT RAISE(ABORT, 'Execution stress manifests are immutable');
END;

CREATE TRIGGER prevent_complete_evaluation_stress_binding_update
BEFORE UPDATE ON hourly_trend_breakout_complete_evaluation_stress_bindings
BEGIN
  SELECT RAISE(ABORT, 'Complete evaluation stress bindings are immutable');
END;

CREATE TRIGGER prevent_complete_evaluation_stress_binding_delete
BEFORE DELETE ON hourly_trend_breakout_complete_evaluation_stress_bindings
BEGIN
  SELECT RAISE(ABORT, 'Complete evaluation stress bindings are immutable');
END;
