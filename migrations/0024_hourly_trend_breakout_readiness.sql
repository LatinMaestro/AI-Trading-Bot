CREATE TABLE hourly_trend_breakout_readiness_assessments (
  assessment_sha256 TEXT PRIMARY KEY CHECK (
    length(assessment_sha256) = 64
    AND assessment_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (
    schema_version = 'hourly-trend-breakout-readiness-v1'
  ),
  strategy_version TEXT NOT NULL CHECK (
    strategy_version = 'hourly-trend-breakout-v0.1.0'
  ),
  candidate_status TEXT NOT NULL CHECK (
    candidate_status = 'unselected-research-only'
  ),
  decision_authority TEXT NOT NULL CHECK (decision_authority = 'none'),
  assessed_at_ms INTEGER NOT NULL CHECK (assessed_at_ms >= 0),
  evidence_input_sha256 TEXT NOT NULL CHECK (
    length(evidence_input_sha256) = 64
    AND evidence_input_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  research_status TEXT NOT NULL CHECK (
    research_status IN ('blocked', 'evidence-complete-for-review')
  ),
  promotion_status TEXT NOT NULL CHECK (
    promotion_status IN ('blocked', 'external-review-required')
  ),
  gate_count INTEGER NOT NULL CHECK (gate_count = 12),
  input_canonical_json TEXT NOT NULL CHECK (
    json_valid(input_canonical_json)
    AND json_extract(input_canonical_json, '$.assessedAtMs') = assessed_at_ms
    AND json_array_length(json_extract(input_canonical_json, '$.evidence'))
      BETWEEN 0 AND 12
  ),
  assessment_canonical_json TEXT NOT NULL CHECK (
    json_valid(assessment_canonical_json)
    AND json_extract(assessment_canonical_json, '$.assessmentSha256')
      = assessment_sha256
    AND json_extract(assessment_canonical_json, '$.evidenceInputSha256')
      = evidence_input_sha256
    AND json_extract(assessment_canonical_json, '$.candidateStatus')
      = candidate_status
    AND json_extract(assessment_canonical_json, '$.decisionAuthority')
      = decision_authority
    AND json_extract(assessment_canonical_json, '$.assessedAtMs')
      = assessed_at_ms
    AND json_extract(assessment_canonical_json, '$.researchStatus')
      = research_status
    AND json_extract(assessment_canonical_json, '$.promotionStatus')
      = promotion_status
    AND json_array_length(
      json_extract(assessment_canonical_json, '$.gates')
    ) = gate_count
  ),
  persisted_at_ms INTEGER NOT NULL CHECK (persisted_at_ms >= assessed_at_ms)
);

CREATE TABLE hourly_trend_breakout_readiness_gates (
  assessment_sha256 TEXT NOT NULL,
  gate_index INTEGER NOT NULL CHECK (gate_index BETWEEN 0 AND 11),
  gate_id TEXT NOT NULL CHECK (
    gate_id IN (
      'authoritative-historical-hourly-candles',
      'survivorship-safe-signal-time-universe',
      'complete-after-cost-evaluation',
      'live-like-execution-calibration',
      'capacity-path-stress',
      'tax-and-audit-export',
      'signed-versioned-strategy-configuration',
      'paper-accounting-observation',
      'shadow-permission-and-reconciliation',
      'independent-security-review',
      'high-severity-issue-clearance',
      'owner-canary-approval'
    )
  ),
  stage TEXT NOT NULL CHECK (stage IN ('research', 'promotion')),
  review_gate TEXT NOT NULL CHECK (review_gate IN ('B', 'B/E', 'C', 'D', 'E')),
  status TEXT NOT NULL CHECK (
    status IN (
      'missing',
      'partial',
      'non-authoritative',
      'stale',
      'evidence-present',
      'external-review-required'
    )
  ),
  artifact_sha256s_json TEXT NOT NULL CHECK (
    json_valid(artifact_sha256s_json)
    AND json_type(artifact_sha256s_json) = 'array'
    AND json_array_length(artifact_sha256s_json) BETWEEN 0 AND 32
  ),
  PRIMARY KEY (assessment_sha256, gate_index),
  UNIQUE (assessment_sha256, gate_id),
  FOREIGN KEY (assessment_sha256)
    REFERENCES hourly_trend_breakout_readiness_assessments(
      assessment_sha256
    )
);

CREATE TABLE hourly_trend_breakout_readiness_bindings (
  assessment_sha256 TEXT PRIMARY KEY,
  complete_evaluation_sha256 TEXT,
  execution_calibration_sha256 TEXT,
  execution_stress_manifest_sha256 TEXT,
  persisted_at_ms INTEGER NOT NULL,
  FOREIGN KEY (assessment_sha256)
    REFERENCES hourly_trend_breakout_readiness_assessments(
      assessment_sha256
    ),
  FOREIGN KEY (complete_evaluation_sha256)
    REFERENCES hourly_trend_breakout_complete_evaluations(
      evaluation_sha256
    ),
  FOREIGN KEY (execution_calibration_sha256)
    REFERENCES hourly_trend_breakout_execution_calibrations(
      calibration_sha256
    ),
  FOREIGN KEY (execution_stress_manifest_sha256)
    REFERENCES hourly_trend_breakout_execution_stress_manifests(
      manifest_sha256
    )
);

CREATE TRIGGER validate_readiness_gate_membership
BEFORE INSERT ON hourly_trend_breakout_readiness_gates
WHEN NOT EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_readiness_assessments assessment
  WHERE assessment.assessment_sha256 = NEW.assessment_sha256
    AND json_extract(
      assessment.assessment_canonical_json,
      '$.gates[' || NEW.gate_index || '].gateId'
    ) = NEW.gate_id
    AND json_extract(
      assessment.assessment_canonical_json,
      '$.gates[' || NEW.gate_index || '].stage'
    ) = NEW.stage
    AND json_extract(
      assessment.assessment_canonical_json,
      '$.gates[' || NEW.gate_index || '].reviewGate'
    ) = NEW.review_gate
    AND json_extract(
      assessment.assessment_canonical_json,
      '$.gates[' || NEW.gate_index || '].status'
    ) = NEW.status
    AND json(
      json_extract(
        assessment.assessment_canonical_json,
        '$.gates[' || NEW.gate_index || '].artifactSha256s'
      )
    ) = json(NEW.artifact_sha256s_json)
)
BEGIN
  SELECT RAISE(ABORT, 'Readiness gate does not match assessment');
END;

CREATE TRIGGER reject_readiness_assessment_conflict
BEFORE INSERT ON hourly_trend_breakout_readiness_assessments
WHEN EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_readiness_assessments existing
  WHERE existing.assessment_sha256 = NEW.assessment_sha256
    AND (
      existing.evidence_input_sha256 <> NEW.evidence_input_sha256
      OR existing.input_canonical_json <> NEW.input_canonical_json
      OR existing.assessment_canonical_json <> NEW.assessment_canonical_json
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Readiness assessment conflict');
END;

CREATE TRIGGER reject_readiness_gate_conflict
BEFORE INSERT ON hourly_trend_breakout_readiness_gates
WHEN EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_readiness_gates existing
  WHERE existing.assessment_sha256 = NEW.assessment_sha256
    AND existing.gate_index = NEW.gate_index
    AND (
      existing.gate_id <> NEW.gate_id
      OR existing.stage <> NEW.stage
      OR existing.review_gate <> NEW.review_gate
      OR existing.status <> NEW.status
      OR existing.artifact_sha256s_json <> NEW.artifact_sha256s_json
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Readiness gate conflict');
END;

CREATE TRIGGER validate_readiness_binding
BEFORE INSERT ON hourly_trend_breakout_readiness_bindings
WHEN NOT EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_readiness_assessments assessment
  JOIN hourly_trend_breakout_readiness_gates evaluation_gate
    ON evaluation_gate.assessment_sha256 = assessment.assessment_sha256
   AND evaluation_gate.gate_id = 'complete-after-cost-evaluation'
  JOIN hourly_trend_breakout_readiness_gates calibration_gate
    ON calibration_gate.assessment_sha256 = assessment.assessment_sha256
   AND calibration_gate.gate_id = 'live-like-execution-calibration'
  JOIN hourly_trend_breakout_readiness_gates stress_gate
    ON stress_gate.assessment_sha256 = assessment.assessment_sha256
   AND stress_gate.gate_id = 'capacity-path-stress'
  WHERE assessment.assessment_sha256 = NEW.assessment_sha256
    AND assessment.persisted_at_ms <= NEW.persisted_at_ms
    AND (
      SELECT COUNT(*)
      FROM hourly_trend_breakout_readiness_gates complete_gate_set
      WHERE complete_gate_set.assessment_sha256 = NEW.assessment_sha256
    ) = assessment.gate_count
    AND (
      (
        evaluation_gate.status = 'evidence-present'
        AND json_array_length(evaluation_gate.artifact_sha256s_json) = 1
        AND json_extract(evaluation_gate.artifact_sha256s_json, '$[0]')
          = NEW.complete_evaluation_sha256
      )
      OR (
        evaluation_gate.status <> 'evidence-present'
        AND NEW.complete_evaluation_sha256 IS NULL
      )
    )
    AND (
      (
        calibration_gate.status = 'evidence-present'
        AND json_array_length(calibration_gate.artifact_sha256s_json) = 1
        AND json_extract(calibration_gate.artifact_sha256s_json, '$[0]')
          = NEW.execution_calibration_sha256
      )
      OR (
        calibration_gate.status <> 'evidence-present'
        AND NEW.execution_calibration_sha256 IS NULL
      )
    )
    AND (
      (
        stress_gate.status = 'evidence-present'
        AND json_array_length(stress_gate.artifact_sha256s_json) = 1
        AND json_extract(stress_gate.artifact_sha256s_json, '$[0]')
          = NEW.execution_stress_manifest_sha256
      )
      OR (
        stress_gate.status <> 'evidence-present'
        AND NEW.execution_stress_manifest_sha256 IS NULL
      )
    )
    AND (
      NEW.complete_evaluation_sha256 IS NULL
      OR EXISTS (
        SELECT 1
        FROM hourly_trend_breakout_complete_evaluations evaluation
        WHERE evaluation.evaluation_sha256
          = NEW.complete_evaluation_sha256
          AND evaluation.persisted_at_ms <= NEW.persisted_at_ms
      )
    )
    AND (
      NEW.execution_calibration_sha256 IS NULL
      OR EXISTS (
        SELECT 1
        FROM hourly_trend_breakout_execution_calibrations calibration
        WHERE calibration.calibration_sha256
          = NEW.execution_calibration_sha256
          AND calibration.persisted_at_ms <= NEW.persisted_at_ms
      )
    )
    AND (
      NEW.execution_stress_manifest_sha256 IS NULL
      OR EXISTS (
        SELECT 1
        FROM hourly_trend_breakout_execution_stress_manifests stress
        WHERE stress.manifest_sha256
          = NEW.execution_stress_manifest_sha256
          AND stress.persisted_at_ms <= NEW.persisted_at_ms
      )
    )
    AND (
      NEW.complete_evaluation_sha256 IS NULL
      OR NEW.execution_calibration_sha256 IS NULL
      OR NEW.execution_stress_manifest_sha256 IS NULL
      OR EXISTS (
        SELECT 1
        FROM hourly_trend_breakout_complete_evaluation_stress_bindings binding
        JOIN hourly_trend_breakout_execution_stress_manifests stress
          ON stress.manifest_sha256 = binding.stress_manifest_sha256
        WHERE binding.evaluation_sha256
          = NEW.complete_evaluation_sha256
          AND binding.stress_manifest_sha256
            = NEW.execution_stress_manifest_sha256
          AND stress.calibration_sha256
            = NEW.execution_calibration_sha256
          AND binding.persisted_at_ms <= NEW.persisted_at_ms
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Readiness evidence binding is invalid');
END;

CREATE TRIGGER reject_readiness_binding_conflict
BEFORE INSERT ON hourly_trend_breakout_readiness_bindings
WHEN EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_readiness_bindings existing
  WHERE existing.assessment_sha256 = NEW.assessment_sha256
    AND (
      existing.complete_evaluation_sha256
        IS NOT NEW.complete_evaluation_sha256
      OR existing.execution_calibration_sha256
        IS NOT NEW.execution_calibration_sha256
      OR existing.execution_stress_manifest_sha256
        IS NOT NEW.execution_stress_manifest_sha256
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Readiness binding conflict');
END;

CREATE TRIGGER prevent_readiness_assessment_update
BEFORE UPDATE ON hourly_trend_breakout_readiness_assessments
BEGIN
  SELECT RAISE(ABORT, 'Readiness assessments are immutable');
END;

CREATE TRIGGER prevent_readiness_assessment_delete
BEFORE DELETE ON hourly_trend_breakout_readiness_assessments
BEGIN
  SELECT RAISE(ABORT, 'Readiness assessments are immutable');
END;

CREATE TRIGGER prevent_readiness_gate_update
BEFORE UPDATE ON hourly_trend_breakout_readiness_gates
BEGIN
  SELECT RAISE(ABORT, 'Readiness gates are immutable');
END;

CREATE TRIGGER prevent_readiness_gate_delete
BEFORE DELETE ON hourly_trend_breakout_readiness_gates
BEGIN
  SELECT RAISE(ABORT, 'Readiness gates are immutable');
END;

CREATE TRIGGER prevent_readiness_binding_update
BEFORE UPDATE ON hourly_trend_breakout_readiness_bindings
BEGIN
  SELECT RAISE(ABORT, 'Readiness bindings are immutable');
END;

CREATE TRIGGER prevent_readiness_binding_delete
BEFORE DELETE ON hourly_trend_breakout_readiness_bindings
BEGIN
  SELECT RAISE(ABORT, 'Readiness bindings are immutable');
END;
