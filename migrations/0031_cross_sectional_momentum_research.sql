CREATE TABLE cross_sectional_momentum_research_runs (
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
  policy_sha256 TEXT NOT NULL CHECK (
    length(policy_sha256) = 64
    AND policy_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  evidence_sha256 TEXT NOT NULL CHECK (
    length(evidence_sha256) = 64
    AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (
    schema_version = 'cross-sectional-momentum-research-run-v1'
  ),
  strategy_version TEXT NOT NULL CHECK (
    strategy_version = 'cross-sectional-momentum-v0.1.0'
  ),
  engine_contract TEXT NOT NULL CHECK (
    engine_contract = 'run-universe-bound-backtest-v1'
  ),
  first_decision_at_ms INTEGER NOT NULL CHECK (
    first_decision_at_ms >= 0
  ),
  last_decision_at_ms INTEGER NOT NULL CHECK (
    last_decision_at_ms >= first_decision_at_ms
  ),
  decision_count INTEGER NOT NULL CHECK (decision_count > 0),
  membership_count INTEGER NOT NULL CHECK (
    membership_count = decision_count
  ),
  run_canonical_json TEXT NOT NULL CHECK (
    json_valid(run_canonical_json)
    AND json_extract(run_canonical_json, '$.runSha256') = run_sha256
    AND json_extract(run_canonical_json, '$.planSha256') = plan_sha256
    AND json_extract(run_canonical_json, '$.configSha256') = config_sha256
    AND json_extract(run_canonical_json, '$.resultSha256') = result_sha256
    AND json_extract(run_canonical_json, '$.schemaVersion') = schema_version
    AND json_extract(run_canonical_json, '$.strategyVersion') = strategy_version
    AND json_extract(run_canonical_json, '$.engineContract') = engine_contract
    AND json_extract(run_canonical_json, '$.candidateStatus')
      = 'research-only-unselected'
    AND json_extract(run_canonical_json, '$.runtimeScopeChanged') = 0
    AND json_extract(run_canonical_json, '$.selectionAuthority') = 'none'
    AND json_extract(run_canonical_json, '$.activationAuthority') = 'none'
    AND json_extract(run_canonical_json, '$.executionAuthority') = 'none'
  ),
  persisted_at_ms INTEGER NOT NULL CHECK (
    persisted_at_ms >= last_decision_at_ms
  )
);

CREATE INDEX idx_cross_sectional_momentum_runs_plan
  ON cross_sectional_momentum_research_runs(plan_sha256);
CREATE INDEX idx_cross_sectional_momentum_runs_persisted
  ON cross_sectional_momentum_research_runs(persisted_at_ms);

CREATE TRIGGER reject_cross_sectional_momentum_run_conflict
BEFORE INSERT ON cross_sectional_momentum_research_runs
WHEN EXISTS (
  SELECT 1
  FROM cross_sectional_momentum_research_runs existing
  WHERE existing.run_sha256 = NEW.run_sha256
    AND (
      existing.plan_sha256 <> NEW.plan_sha256
      OR existing.config_sha256 <> NEW.config_sha256
      OR existing.result_sha256 <> NEW.result_sha256
      OR existing.policy_sha256 <> NEW.policy_sha256
      OR existing.evidence_sha256 <> NEW.evidence_sha256
      OR existing.schema_version <> NEW.schema_version
      OR existing.strategy_version <> NEW.strategy_version
      OR existing.engine_contract <> NEW.engine_contract
      OR existing.first_decision_at_ms <> NEW.first_decision_at_ms
      OR existing.last_decision_at_ms <> NEW.last_decision_at_ms
      OR existing.decision_count <> NEW.decision_count
      OR existing.membership_count <> NEW.membership_count
      OR existing.run_canonical_json <> NEW.run_canonical_json
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Cross-sectional research run conflict');
END;

CREATE TABLE cross_sectional_momentum_evaluation_manifests (
  manifest_sha256 TEXT PRIMARY KEY CHECK (
    length(manifest_sha256) = 64
    AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  manifest_kind TEXT NOT NULL CHECK (
    manifest_kind IN ('walk-forward', 'sensitivity')
  ),
  schema_version TEXT NOT NULL CHECK (
    (manifest_kind = 'walk-forward'
      AND schema_version
        = 'cross-sectional-momentum-walk-forward-manifest-v1')
    OR
    (manifest_kind = 'sensitivity'
      AND schema_version
        = 'cross-sectional-momentum-sensitivity-manifest-v1')
  ),
  strategy_version TEXT NOT NULL CHECK (
    strategy_version = 'cross-sectional-momentum-v0.1.0'
  ),
  engine_contract TEXT NOT NULL CHECK (
    engine_contract = 'run-universe-bound-backtest-v1'
  ),
  primary_policy_sha256 TEXT NOT NULL CHECK (
    length(primary_policy_sha256) = 64
    AND primary_policy_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  config_sha256 TEXT NOT NULL CHECK (
    length(config_sha256) = 64
    AND config_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  evidence_sha256 TEXT CHECK (
    (manifest_kind = 'walk-forward' AND evidence_sha256 IS NULL)
    OR
    (manifest_kind = 'sensitivity'
      AND length(evidence_sha256) = 64
      AND evidence_sha256 NOT GLOB '*[^0-9a-f]*')
  ),
  evaluation_start_at_ms INTEGER NOT NULL CHECK (
    evaluation_start_at_ms >= 0
  ),
  evaluation_end_at_ms INTEGER NOT NULL CHECK (
    evaluation_end_at_ms >= evaluation_start_at_ms
  ),
  component_run_count INTEGER NOT NULL CHECK (
    component_run_count > 0
  ),
  fold_count INTEGER CHECK (
    (manifest_kind = 'walk-forward'
      AND fold_count > 0
      AND component_run_count = fold_count * 2 + 1)
    OR
    (manifest_kind = 'sensitivity' AND fold_count IS NULL)
  ),
  variant_count INTEGER CHECK (
    (manifest_kind = 'sensitivity'
      AND variant_count >= 2
      AND component_run_count = variant_count)
    OR
    (manifest_kind = 'walk-forward' AND variant_count IS NULL)
  ),
  manifest_canonical_json TEXT NOT NULL CHECK (
    json_valid(manifest_canonical_json)
    AND json_extract(manifest_canonical_json, '$.manifestSha256')
      = manifest_sha256
    AND json_extract(manifest_canonical_json, '$.schemaVersion')
      = schema_version
    AND json_extract(manifest_canonical_json, '$.strategyVersion')
      = strategy_version
    AND json_extract(manifest_canonical_json, '$.engineContract')
      = engine_contract
    AND json_extract(manifest_canonical_json, '$.configSha256')
      = config_sha256
    AND json_extract(manifest_canonical_json, '$.candidateStatus')
      = 'research-only-unselected'
    AND json_extract(manifest_canonical_json, '$.runtimeScopeChanged') = 0
    AND json_extract(manifest_canonical_json, '$.selectionAuthority')
      = 'none'
    AND json_extract(manifest_canonical_json, '$.activationAuthority')
      = 'none'
    AND json_extract(manifest_canonical_json, '$.executionAuthority')
      = 'none'
    AND (
      (manifest_kind = 'walk-forward'
        AND json_extract(manifest_canonical_json, '$.policySha256')
          = primary_policy_sha256
        AND json_array_length(
          manifest_canonical_json,
          '$.folds'
        ) = fold_count)
      OR
      (manifest_kind = 'sensitivity'
        AND json_extract(
          manifest_canonical_json,
          '$.baselinePolicySha256'
        ) = primary_policy_sha256
        AND json_extract(manifest_canonical_json, '$.evidenceSha256')
          = evidence_sha256
        AND json_array_length(
          manifest_canonical_json,
          '$.variants'
        ) = variant_count)
    )
  ),
  persisted_at_ms INTEGER NOT NULL CHECK (
    persisted_at_ms >= evaluation_end_at_ms
  )
);

CREATE TABLE cross_sectional_momentum_evaluation_manifest_runs (
  manifest_sha256 TEXT NOT NULL,
  member_index INTEGER NOT NULL CHECK (member_index >= 0),
  member_kind TEXT NOT NULL CHECK (
    member_kind IN (
      'training',
      'validation',
      'final-holdout',
      'sensitivity-variant'
    )
  ),
  run_sha256 TEXT NOT NULL,
  plan_sha256 TEXT NOT NULL,
  result_sha256 TEXT NOT NULL,
  policy_sha256 TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL,
  PRIMARY KEY (manifest_sha256, member_index),
  UNIQUE (manifest_sha256, run_sha256),
  FOREIGN KEY (manifest_sha256)
    REFERENCES cross_sectional_momentum_evaluation_manifests(
      manifest_sha256
    ),
  FOREIGN KEY (run_sha256)
    REFERENCES cross_sectional_momentum_research_runs(run_sha256)
);

CREATE TRIGGER enforce_cross_sectional_momentum_evaluation_member
BEFORE INSERT ON cross_sectional_momentum_evaluation_manifest_runs
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM cross_sectional_momentum_evaluation_manifest_commits committed
    WHERE committed.manifest_sha256 = NEW.manifest_sha256
  ) AND NOT EXISTS (
    SELECT 1
    FROM cross_sectional_momentum_evaluation_manifest_runs existing
    WHERE existing.manifest_sha256 = NEW.manifest_sha256
      AND existing.member_index = NEW.member_index
      AND existing.member_kind = NEW.member_kind
      AND existing.run_sha256 = NEW.run_sha256
      AND existing.plan_sha256 = NEW.plan_sha256
      AND existing.result_sha256 = NEW.result_sha256
      AND existing.policy_sha256 = NEW.policy_sha256
      AND existing.evidence_sha256 = NEW.evidence_sha256
  ) THEN RAISE(
    ABORT,
    'Committed cross-sectional evaluation membership is immutable'
  ) END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM cross_sectional_momentum_evaluation_manifests manifest
    JOIN cross_sectional_momentum_research_runs run
      ON run.run_sha256 = NEW.run_sha256
    WHERE manifest.manifest_sha256 = NEW.manifest_sha256
      AND run.plan_sha256 = NEW.plan_sha256
      AND run.result_sha256 = NEW.result_sha256
      AND run.policy_sha256 = NEW.policy_sha256
      AND run.evidence_sha256 = NEW.evidence_sha256
      AND run.config_sha256 = manifest.config_sha256
      AND (
        (manifest.manifest_kind = 'walk-forward'
          AND NEW.policy_sha256 = manifest.primary_policy_sha256
          AND (
            (NEW.member_index < manifest.component_run_count - 1
              AND NEW.member_index % 2 = 0
              AND NEW.member_kind = 'training'
              AND json_extract(
                manifest.manifest_canonical_json,
                '$.folds[' || CAST(NEW.member_index / 2 AS INTEGER)
                  || '].trainingRunSha256'
              ) = NEW.run_sha256
              AND json_extract(
                manifest.manifest_canonical_json,
                '$.folds[' || CAST(NEW.member_index / 2 AS INTEGER)
                  || '].trainingPlanSha256'
              ) = NEW.plan_sha256
              AND json_extract(
                manifest.manifest_canonical_json,
                '$.folds[' || CAST(NEW.member_index / 2 AS INTEGER)
                  || '].trainingEvidenceSha256'
              ) = NEW.evidence_sha256)
            OR
            (NEW.member_index < manifest.component_run_count - 1
              AND NEW.member_index % 2 = 1
              AND NEW.member_kind = 'validation'
              AND json_extract(
                manifest.manifest_canonical_json,
                '$.folds[' || CAST(NEW.member_index / 2 AS INTEGER)
                  || '].validationRunSha256'
              ) = NEW.run_sha256
              AND json_extract(
                manifest.manifest_canonical_json,
                '$.folds[' || CAST(NEW.member_index / 2 AS INTEGER)
                  || '].validationPlanSha256'
              ) = NEW.plan_sha256
              AND json_extract(
                manifest.manifest_canonical_json,
                '$.folds[' || CAST(NEW.member_index / 2 AS INTEGER)
                  || '].validationEvidenceSha256'
              ) = NEW.evidence_sha256)
            OR
            (NEW.member_index = manifest.component_run_count - 1
              AND NEW.member_kind = 'final-holdout'
              AND json_extract(
                manifest.manifest_canonical_json,
                '$.finalHoldout.runSha256'
              ) = NEW.run_sha256
              AND json_extract(
                manifest.manifest_canonical_json,
                '$.finalHoldout.planSha256'
              ) = NEW.plan_sha256
              AND json_extract(
                manifest.manifest_canonical_json,
                '$.finalHoldout.evidenceSha256'
              ) = NEW.evidence_sha256)
          ))
        OR
        (manifest.manifest_kind = 'sensitivity'
          AND NEW.member_index < manifest.component_run_count
          AND NEW.member_kind = 'sensitivity-variant'
          AND NEW.evidence_sha256 = manifest.evidence_sha256
          AND json_extract(
            manifest.manifest_canonical_json,
            '$.variants[' || NEW.member_index || '].runSha256'
          ) = NEW.run_sha256
          AND json_extract(
            manifest.manifest_canonical_json,
            '$.variants[' || NEW.member_index || '].planSha256'
          ) = NEW.plan_sha256
          AND json_extract(
            manifest.manifest_canonical_json,
            '$.variants[' || NEW.member_index || '].resultSha256'
          ) = NEW.result_sha256
          AND json_extract(
            manifest.manifest_canonical_json,
            '$.variants[' || NEW.member_index || '].policySha256'
          ) = NEW.policy_sha256)
      )
  ) THEN RAISE(
    ABORT,
    'Cross-sectional evaluation member evidence is invalid'
  ) END;
END;

CREATE TRIGGER reject_cross_sectional_momentum_member_conflict
BEFORE INSERT ON cross_sectional_momentum_evaluation_manifest_runs
WHEN EXISTS (
  SELECT 1
  FROM cross_sectional_momentum_evaluation_manifest_runs existing
  WHERE existing.manifest_sha256 = NEW.manifest_sha256
    AND existing.member_index = NEW.member_index
    AND (
      existing.member_kind <> NEW.member_kind
      OR existing.run_sha256 <> NEW.run_sha256
      OR existing.plan_sha256 <> NEW.plan_sha256
      OR existing.result_sha256 <> NEW.result_sha256
      OR existing.policy_sha256 <> NEW.policy_sha256
      OR existing.evidence_sha256 <> NEW.evidence_sha256
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Cross-sectional evaluation member conflict');
END;

CREATE TABLE cross_sectional_momentum_evaluation_manifest_commits (
  manifest_sha256 TEXT PRIMARY KEY,
  committed_at_ms INTEGER NOT NULL CHECK (committed_at_ms >= 0),
  FOREIGN KEY (manifest_sha256)
    REFERENCES cross_sectional_momentum_evaluation_manifests(
      manifest_sha256
    )
);

CREATE TRIGGER enforce_cross_sectional_momentum_evaluation_commit
BEFORE INSERT ON cross_sectional_momentum_evaluation_manifest_commits
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM cross_sectional_momentum_evaluation_manifests manifest
    WHERE manifest.manifest_sha256 = NEW.manifest_sha256
      AND NEW.committed_at_ms >= manifest.persisted_at_ms
      AND (
        SELECT COUNT(*)
        FROM cross_sectional_momentum_evaluation_manifest_runs member
        WHERE member.manifest_sha256 = NEW.manifest_sha256
      ) = manifest.component_run_count
      AND (
        SELECT MIN(member.member_index)
        FROM cross_sectional_momentum_evaluation_manifest_runs member
        WHERE member.manifest_sha256 = NEW.manifest_sha256
      ) = 0
      AND (
        SELECT MAX(member.member_index)
        FROM cross_sectional_momentum_evaluation_manifest_runs member
        WHERE member.manifest_sha256 = NEW.manifest_sha256
      ) = manifest.component_run_count - 1
  ) THEN RAISE(
    ABORT,
    'Cross-sectional evaluation manifest is incomplete'
  ) END;
END;

CREATE TRIGGER reject_cross_sectional_momentum_manifest_conflict
BEFORE INSERT ON cross_sectional_momentum_evaluation_manifests
WHEN EXISTS (
  SELECT 1
  FROM cross_sectional_momentum_evaluation_manifests existing
  WHERE existing.manifest_sha256 = NEW.manifest_sha256
    AND (
      existing.manifest_kind <> NEW.manifest_kind
      OR existing.schema_version <> NEW.schema_version
      OR existing.strategy_version <> NEW.strategy_version
      OR existing.engine_contract <> NEW.engine_contract
      OR existing.primary_policy_sha256 <> NEW.primary_policy_sha256
      OR existing.config_sha256 <> NEW.config_sha256
      OR existing.evidence_sha256 IS NOT NEW.evidence_sha256
      OR existing.evaluation_start_at_ms <> NEW.evaluation_start_at_ms
      OR existing.evaluation_end_at_ms <> NEW.evaluation_end_at_ms
      OR existing.component_run_count <> NEW.component_run_count
      OR existing.fold_count IS NOT NEW.fold_count
      OR existing.variant_count IS NOT NEW.variant_count
      OR existing.manifest_canonical_json <> NEW.manifest_canonical_json
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Cross-sectional evaluation manifest conflict');
END;

CREATE TRIGGER reject_cross_sectional_momentum_commit_conflict
BEFORE INSERT ON cross_sectional_momentum_evaluation_manifest_commits
WHEN EXISTS (
  SELECT 1
  FROM cross_sectional_momentum_evaluation_manifest_commits existing
  WHERE existing.manifest_sha256 = NEW.manifest_sha256
)
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM cross_sectional_momentum_evaluation_manifests manifest
    WHERE manifest.manifest_sha256 = NEW.manifest_sha256
      AND existing.committed_at_ms = manifest.persisted_at_ms
  ) THEN RAISE(
    ABORT,
    'Cross-sectional evaluation commit conflict'
  ) END
  FROM cross_sectional_momentum_evaluation_manifest_commits existing
  WHERE existing.manifest_sha256 = NEW.manifest_sha256;
END;

CREATE TRIGGER prevent_cross_sectional_momentum_run_update
BEFORE UPDATE ON cross_sectional_momentum_research_runs
BEGIN
  SELECT RAISE(ABORT, 'Cross-sectional research runs are immutable');
END;
CREATE TRIGGER prevent_cross_sectional_momentum_run_delete
BEFORE DELETE ON cross_sectional_momentum_research_runs
BEGIN
  SELECT RAISE(ABORT, 'Cross-sectional research runs are immutable');
END;
CREATE TRIGGER prevent_cross_sectional_momentum_manifest_update
BEFORE UPDATE ON cross_sectional_momentum_evaluation_manifests
BEGIN
  SELECT RAISE(ABORT, 'Cross-sectional evaluation manifests are immutable');
END;
CREATE TRIGGER prevent_cross_sectional_momentum_manifest_delete
BEFORE DELETE ON cross_sectional_momentum_evaluation_manifests
BEGIN
  SELECT RAISE(ABORT, 'Cross-sectional evaluation manifests are immutable');
END;
CREATE TRIGGER prevent_cross_sectional_momentum_member_update
BEFORE UPDATE ON cross_sectional_momentum_evaluation_manifest_runs
BEGIN
  SELECT RAISE(ABORT, 'Cross-sectional evaluation members are immutable');
END;
CREATE TRIGGER prevent_cross_sectional_momentum_member_delete
BEFORE DELETE ON cross_sectional_momentum_evaluation_manifest_runs
BEGIN
  SELECT RAISE(ABORT, 'Cross-sectional evaluation members are immutable');
END;
CREATE TRIGGER prevent_cross_sectional_momentum_commit_update
BEFORE UPDATE ON cross_sectional_momentum_evaluation_manifest_commits
BEGIN
  SELECT RAISE(ABORT, 'Cross-sectional evaluation commits are immutable');
END;
CREATE TRIGGER prevent_cross_sectional_momentum_commit_delete
BEFORE DELETE ON cross_sectional_momentum_evaluation_manifest_commits
BEGIN
  SELECT RAISE(ABORT, 'Cross-sectional evaluation commits are immutable');
END;
