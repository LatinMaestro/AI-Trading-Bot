CREATE TABLE hourly_trend_breakout_evaluation_manifests (
  manifest_sha256 TEXT PRIMARY KEY CHECK (
    length(manifest_sha256) = 64
    AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  manifest_kind TEXT NOT NULL CHECK (
    manifest_kind IN ('walk-forward', 'sensitivity')
  ),
  schema_version TEXT NOT NULL CHECK (
    (manifest_kind = 'walk-forward'
      AND schema_version = 'hourly-trend-breakout-walk-forward-manifest-v1')
    OR
    (manifest_kind = 'sensitivity'
      AND schema_version = 'hourly-trend-breakout-sensitivity-manifest-v1')
  ),
  strategy_version TEXT NOT NULL CHECK (
    strategy_version = 'hourly-trend-breakout-v0.1.0'
  ),
  primary_policy_sha256 TEXT NOT NULL CHECK (
    length(primary_policy_sha256) = 64
    AND primary_policy_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  config_sha256 TEXT NOT NULL CHECK (
    length(config_sha256) = 64
    AND config_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  evaluation_start_at_ms INTEGER NOT NULL CHECK (
    evaluation_start_at_ms >= 0
  ),
  evaluation_end_at_ms INTEGER NOT NULL CHECK (
    evaluation_end_at_ms >= evaluation_start_at_ms
  ),
  component_run_count INTEGER NOT NULL CHECK (
    component_run_count >= 2
    AND component_run_count <= 101
  ),
  fold_count INTEGER CHECK (
    fold_count IS NULL
    OR (fold_count >= 1 AND fold_count <= 50)
  ),
  variant_count INTEGER CHECK (
    variant_count IS NULL
    OR (variant_count >= 2 AND variant_count <= 100)
  ),
  manifest_json TEXT NOT NULL CHECK (
    json_valid(manifest_json)
    AND json_type(manifest_json) = 'object'
    AND json_extract(manifest_json, '$.manifestSha256') = manifest_sha256
    AND json_extract(manifest_json, '$.schemaVersion') = schema_version
    AND json_extract(manifest_json, '$.strategyVersion') = strategy_version
    AND json_extract(manifest_json, '$.configSha256') = config_sha256
    AND json_type(manifest_json, '$.selectedRunSha256') IS NULL
    AND json_type(manifest_json, '$.winner') IS NULL
    AND json_type(manifest_json, '$.ranking') IS NULL
    AND json_type(manifest_json, '$.promotion') IS NULL
  ),
  persisted_at_ms INTEGER NOT NULL CHECK (
    persisted_at_ms >= evaluation_end_at_ms
  ),
  CHECK (
    (manifest_kind = 'walk-forward'
      AND fold_count IS NOT NULL
      AND variant_count IS NULL
      AND component_run_count = fold_count * 2 + 1
      AND json_extract(manifest_json, '$.policySha256')
        = primary_policy_sha256
      AND json_array_length(manifest_json, '$.folds') = fold_count)
    OR
    (manifest_kind = 'sensitivity'
      AND fold_count IS NULL
      AND variant_count IS NOT NULL
      AND component_run_count = variant_count
      AND json_extract(manifest_json, '$.baselinePolicySha256')
        = primary_policy_sha256
      AND json_array_length(manifest_json, '$.variants') = variant_count)
  )
);

CREATE TABLE hourly_trend_breakout_evaluation_manifest_runs (
  manifest_sha256 TEXT NOT NULL,
  run_sha256 TEXT NOT NULL CHECK (
    length(run_sha256) = 64
    AND run_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  member_kind TEXT NOT NULL CHECK (
    member_kind IN (
      'training',
      'validation',
      'final-holdout',
      'sensitivity-variant'
    )
  ),
  member_index INTEGER NOT NULL CHECK (
    member_index >= 0
    AND member_index <= 100
  ),
  PRIMARY KEY (manifest_sha256, run_sha256),
  UNIQUE (manifest_sha256, member_index),
  FOREIGN KEY (manifest_sha256)
    REFERENCES hourly_trend_breakout_evaluation_manifests(manifest_sha256),
  FOREIGN KEY (run_sha256)
    REFERENCES hourly_trend_breakout_research_runs(run_sha256)
);

CREATE INDEX idx_hourly_trend_breakout_evaluation_manifest_runs_run
  ON hourly_trend_breakout_evaluation_manifest_runs(run_sha256);
CREATE INDEX idx_hourly_trend_breakout_evaluation_manifests_persisted
  ON hourly_trend_breakout_evaluation_manifests(persisted_at_ms);

CREATE TRIGGER reject_hourly_trend_breakout_evaluation_manifest_conflict
BEFORE INSERT ON hourly_trend_breakout_evaluation_manifests
WHEN EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_evaluation_manifests existing
  WHERE existing.manifest_sha256 = NEW.manifest_sha256
    AND (
      existing.manifest_kind <> NEW.manifest_kind
      OR existing.schema_version <> NEW.schema_version
      OR existing.strategy_version <> NEW.strategy_version
      OR existing.primary_policy_sha256 <> NEW.primary_policy_sha256
      OR existing.config_sha256 <> NEW.config_sha256
      OR existing.evaluation_start_at_ms <> NEW.evaluation_start_at_ms
      OR existing.evaluation_end_at_ms <> NEW.evaluation_end_at_ms
      OR existing.component_run_count <> NEW.component_run_count
      OR existing.fold_count IS NOT NEW.fold_count
      OR existing.variant_count IS NOT NEW.variant_count
      OR existing.manifest_json <> NEW.manifest_json
    )
)
BEGIN
  SELECT RAISE(
    ABORT,
    'Hourly trend breakout evaluation manifest conflict'
  );
END;

CREATE TRIGGER reject_hourly_trend_breakout_evaluation_member_conflict
BEFORE INSERT ON hourly_trend_breakout_evaluation_manifest_runs
WHEN EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_evaluation_manifest_runs existing
  WHERE existing.manifest_sha256 = NEW.manifest_sha256
    AND (
      existing.run_sha256 = NEW.run_sha256
      OR existing.member_index = NEW.member_index
    )
    AND (
      existing.run_sha256 <> NEW.run_sha256
      OR existing.member_kind <> NEW.member_kind
      OR existing.member_index <> NEW.member_index
    )
)
BEGIN
  SELECT RAISE(
    ABORT,
    'Hourly trend breakout evaluation member conflict'
  );
END;

CREATE TRIGGER reject_unpersisted_hourly_evaluation_run
BEFORE INSERT ON hourly_trend_breakout_evaluation_manifest_runs
WHEN NOT EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_research_runs run
  WHERE run.run_sha256 = NEW.run_sha256
)
BEGIN
  SELECT RAISE(
    ABORT,
    'Hourly trend breakout evaluation run is not persisted'
  );
END;

CREATE TRIGGER prevent_hourly_trend_breakout_evaluation_manifest_update
BEFORE UPDATE ON hourly_trend_breakout_evaluation_manifests
BEGIN
  SELECT RAISE(
    ABORT,
    'Hourly trend breakout evaluation manifests are immutable'
  );
END;

CREATE TRIGGER prevent_hourly_trend_breakout_evaluation_manifest_delete
BEFORE DELETE ON hourly_trend_breakout_evaluation_manifests
BEGIN
  SELECT RAISE(
    ABORT,
    'Hourly trend breakout evaluation manifests are immutable'
  );
END;

CREATE TRIGGER prevent_hourly_trend_breakout_evaluation_member_update
BEFORE UPDATE ON hourly_trend_breakout_evaluation_manifest_runs
BEGIN
  SELECT RAISE(
    ABORT,
    'Hourly trend breakout evaluation memberships are immutable'
  );
END;

CREATE TRIGGER prevent_hourly_trend_breakout_evaluation_member_delete
BEFORE DELETE ON hourly_trend_breakout_evaluation_manifest_runs
BEGIN
  SELECT RAISE(
    ABORT,
    'Hourly trend breakout evaluation memberships are immutable'
  );
END;
