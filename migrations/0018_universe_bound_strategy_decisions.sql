CREATE TABLE universe_bound_strategy_decision_artifacts (
  binding_sha256 TEXT PRIMARY KEY
    CHECK (
      length(binding_sha256) = 64
      AND binding_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
  decision_at_ms INTEGER NOT NULL
    CHECK (decision_at_ms >= 0 AND typeof(decision_at_ms) = 'integer'),
  membership_sha256 TEXT NOT NULL
    CHECK (
      length(membership_sha256) = 64
      AND membership_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
  snapshot_sha256 TEXT NOT NULL
    CHECK (
      length(snapshot_sha256) = 64
      AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
  signed_policy_sha256 TEXT NOT NULL
    CHECK (
      length(signed_policy_sha256) = 64
      AND signed_policy_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
  strategy_version TEXT NOT NULL
    CHECK (
      length(strategy_version) BETWEEN 1 AND 100
      AND strategy_version = trim(strategy_version)
    ),
  action TEXT NOT NULL CHECK (action IN ('hold', 'buy', 'sell')),
  target_pair TEXT,
  target_exposure_pct REAL NOT NULL
    CHECK (
      target_exposure_pct >= 0
      AND target_exposure_pct <= 100
    ),
  artifact_json TEXT NOT NULL CHECK (length(artifact_json) BETWEEN 2 AND 1048576),
  CHECK (
    (action = 'hold' AND target_pair IS NULL AND target_exposure_pct = 0)
    OR
    (
      action = 'buy'
      AND target_pair IS NOT NULL
      AND target_exposure_pct > 0
    )
    OR
    (action = 'sell' AND target_pair IS NOT NULL)
  )
);

CREATE TABLE universe_bound_strategy_decision_cycles (
  cycle_id TEXT PRIMARY KEY
    CHECK (
      length(cycle_id) = 36
      AND cycle_id = lower(cycle_id)
      AND substr(cycle_id, 9, 1) = '-'
      AND substr(cycle_id, 14, 1) = '-'
      AND substr(cycle_id, 19, 1) = '-'
      AND substr(cycle_id, 24, 1) = '-'
      AND replace(cycle_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    ),
  binding_sha256 TEXT NOT NULL,
  persisted_at_ms INTEGER NOT NULL
    CHECK (persisted_at_ms >= 0 AND typeof(persisted_at_ms) = 'integer'),
  FOREIGN KEY (binding_sha256)
    REFERENCES universe_bound_strategy_decision_artifacts(binding_sha256)
);

CREATE INDEX idx_universe_bound_strategy_decision_cycles_binding
  ON universe_bound_strategy_decision_cycles(binding_sha256, persisted_at_ms);

CREATE TRIGGER universe_bound_strategy_decision_artifact_conflict
BEFORE INSERT ON universe_bound_strategy_decision_artifacts
WHEN EXISTS (
  SELECT 1
  FROM universe_bound_strategy_decision_artifacts existing
  WHERE existing.binding_sha256 = NEW.binding_sha256
    AND (
      existing.decision_at_ms != NEW.decision_at_ms
      OR existing.membership_sha256 != NEW.membership_sha256
      OR existing.snapshot_sha256 != NEW.snapshot_sha256
      OR existing.signed_policy_sha256 != NEW.signed_policy_sha256
      OR existing.strategy_version != NEW.strategy_version
      OR existing.action != NEW.action
      OR existing.target_pair IS NOT NEW.target_pair
      OR existing.target_exposure_pct != NEW.target_exposure_pct
      OR existing.artifact_json != NEW.artifact_json
    )
)
BEGIN
  SELECT RAISE(ABORT, 'universe-bound strategy decision artifact conflict');
END;

CREATE TRIGGER universe_bound_strategy_decision_cycle_conflict
BEFORE INSERT ON universe_bound_strategy_decision_cycles
WHEN EXISTS (
  SELECT 1
  FROM universe_bound_strategy_decision_cycles existing
  WHERE existing.cycle_id = NEW.cycle_id
    AND existing.binding_sha256 != NEW.binding_sha256
)
BEGIN
  SELECT RAISE(ABORT, 'universe-bound strategy decision cycle conflict');
END;

CREATE TRIGGER universe_bound_strategy_decision_artifacts_no_update
BEFORE UPDATE ON universe_bound_strategy_decision_artifacts
BEGIN
  SELECT RAISE(ABORT, 'universe-bound strategy decision artifacts are immutable');
END;

CREATE TRIGGER universe_bound_strategy_decision_artifacts_no_delete
BEFORE DELETE ON universe_bound_strategy_decision_artifacts
BEGIN
  SELECT RAISE(ABORT, 'universe-bound strategy decision artifacts are immutable');
END;

CREATE TRIGGER universe_bound_strategy_decision_cycles_no_update
BEFORE UPDATE ON universe_bound_strategy_decision_cycles
BEGIN
  SELECT RAISE(ABORT, 'universe-bound strategy decision cycles are immutable');
END;

CREATE TRIGGER universe_bound_strategy_decision_cycles_no_delete
BEFORE DELETE ON universe_bound_strategy_decision_cycles
BEGIN
  SELECT RAISE(ABORT, 'universe-bound strategy decision cycles are immutable');
END;
