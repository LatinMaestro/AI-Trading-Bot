CREATE TABLE hourly_trend_breakout_verified_configurations (
  verification_evidence_sha256 TEXT PRIMARY KEY CHECK (
    length(verification_evidence_sha256) = 64
    AND verification_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (
    schema_version = 'verified-strategy-configuration-at-time-v1'
  ),
  signed_configuration_sha256 TEXT NOT NULL REFERENCES
    hourly_trend_breakout_signed_configurations(
      signed_configuration_sha256
    ),
  decision_at_ms INTEGER NOT NULL CHECK (decision_at_ms >= 0),
  signer_trust_anchor_sha256 TEXT NOT NULL REFERENCES
    strategy_signer_trust_anchors(trust_anchor_sha256),
  signer_trust_revocation_sha256 TEXT REFERENCES
    strategy_signer_trust_revocations(revocation_sha256),
  readiness_assessment_sha256 TEXT NOT NULL REFERENCES
    hourly_trend_breakout_readiness_assessments(assessment_sha256),
  complete_evaluation_sha256 TEXT NOT NULL REFERENCES
    hourly_trend_breakout_complete_evaluations(evaluation_sha256),
  research_report_sha256 TEXT NOT NULL REFERENCES
    research_report_commits(report_sha256),
  execution_calibration_sha256 TEXT NOT NULL REFERENCES
    hourly_trend_breakout_execution_calibrations(calibration_sha256),
  execution_stress_manifest_sha256 TEXT NOT NULL REFERENCES
    hourly_trend_breakout_execution_stress_manifests(manifest_sha256),
  selection_authority TEXT NOT NULL CHECK (selection_authority = 'none'),
  execution_authority TEXT NOT NULL CHECK (execution_authority = 'none'),
  evidence_canonical_json TEXT NOT NULL CHECK (
    json_valid(evidence_canonical_json)
    AND json_extract(
      evidence_canonical_json,
      '$.schemaVersion'
    ) = schema_version
    AND json_extract(
      evidence_canonical_json,
      '$.signedConfigurationSha256'
    ) = signed_configuration_sha256
    AND json_extract(evidence_canonical_json, '$.decisionAtMs')
      = decision_at_ms
    AND json_extract(
      evidence_canonical_json,
      '$.signerTrustAnchorSha256'
    ) = signer_trust_anchor_sha256
    AND json_extract(
      evidence_canonical_json,
      '$.signerTrustRevocationSha256'
    ) IS signer_trust_revocation_sha256
    AND json_extract(
      evidence_canonical_json,
      '$.readinessAssessmentSha256'
    ) = readiness_assessment_sha256
    AND json_extract(
      evidence_canonical_json,
      '$.completeEvaluationSha256'
    ) = complete_evaluation_sha256
    AND json_extract(
      evidence_canonical_json,
      '$.researchReportSha256'
    ) = research_report_sha256
    AND json_extract(
      evidence_canonical_json,
      '$.executionCalibrationSha256'
    ) = execution_calibration_sha256
    AND json_extract(
      evidence_canonical_json,
      '$.executionStressManifestSha256'
    ) = execution_stress_manifest_sha256
    AND json_extract(
      evidence_canonical_json,
      '$.selectionAuthority'
    ) = selection_authority
    AND json_extract(
      evidence_canonical_json,
      '$.executionAuthority'
    ) = execution_authority
  ),
  persisted_at_ms INTEGER NOT NULL CHECK (
    persisted_at_ms >= decision_at_ms
  ),
  UNIQUE (signed_configuration_sha256, decision_at_ms)
);

CREATE TRIGGER validate_verified_strategy_configuration_evidence
BEFORE INSERT ON hourly_trend_breakout_verified_configurations
WHEN NOT EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_signed_configurations configuration
  JOIN strategy_signer_trust_anchors anchor
    ON anchor.trust_anchor_sha256 = NEW.signer_trust_anchor_sha256
  JOIN hourly_trend_breakout_readiness_assessments readiness
    ON readiness.assessment_sha256 = NEW.readiness_assessment_sha256
  JOIN hourly_trend_breakout_readiness_bindings readiness_binding
    ON readiness_binding.assessment_sha256 = readiness.assessment_sha256
  JOIN hourly_trend_breakout_complete_evaluations evaluation
    ON evaluation.evaluation_sha256 = NEW.complete_evaluation_sha256
  JOIN research_report_commits report_commit
    ON report_commit.report_sha256 = NEW.research_report_sha256
  JOIN hourly_trend_breakout_execution_stress_manifests stress
    ON stress.manifest_sha256 = NEW.execution_stress_manifest_sha256
  JOIN hourly_trend_breakout_complete_evaluation_stress_bindings
    stress_binding
    ON stress_binding.evaluation_sha256 = evaluation.evaluation_sha256
  WHERE configuration.signed_configuration_sha256
      = NEW.signed_configuration_sha256
    AND configuration.signer_trust_anchor_sha256
      = NEW.signer_trust_anchor_sha256
    AND configuration.readiness_assessment_sha256
      = NEW.readiness_assessment_sha256
    AND configuration.complete_evaluation_sha256
      = NEW.complete_evaluation_sha256
    AND configuration.persisted_at_ms <= NEW.decision_at_ms
    AND configuration.effective_from_ms <= NEW.decision_at_ms
    AND configuration.expires_at_ms > NEW.decision_at_ms
    AND anchor.signer_role = 'strategy-configuration-signer'
    AND anchor.key_id = configuration.signer_key_id
    AND anchor.verification_key_sha256
      = configuration.verification_key_sha256
    AND anchor.persisted_at_ms <= NEW.decision_at_ms
    AND anchor.valid_from_ms <= configuration.issued_at_ms
    AND anchor.valid_until_ms > NEW.decision_at_ms
    AND readiness.research_status = 'evidence-complete-for-review'
    AND readiness.promotion_status = 'external-review-required'
    AND readiness.gate_count = 12
    AND readiness.persisted_at_ms <= NEW.decision_at_ms
    AND readiness.assessed_at_ms <= NEW.decision_at_ms
    AND readiness_binding.complete_evaluation_sha256
      = NEW.complete_evaluation_sha256
    AND readiness_binding.execution_calibration_sha256
      = NEW.execution_calibration_sha256
    AND readiness_binding.execution_stress_manifest_sha256
      = NEW.execution_stress_manifest_sha256
    AND readiness_binding.persisted_at_ms <= NEW.decision_at_ms
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(
        json_extract(readiness.input_canonical_json, '$.evidence')
      ) evidence
      WHERE json_extract(evidence.value, '$.validUntilMs') IS NOT NULL
        AND json_extract(evidence.value, '$.validUntilMs')
          < NEW.decision_at_ms
    )
    AND evaluation.schema_version
      = 'hourly-trend-breakout-complete-evaluation-v1'
    AND evaluation.strategy_version
      = configuration.strategy_version
    AND evaluation.report_sha256 = NEW.research_report_sha256
    AND evaluation.persisted_at_ms <= NEW.decision_at_ms
    AND report_commit.persisted_at_ms <= NEW.decision_at_ms
    AND report_commit.chunk_count BETWEEN 1 AND 90
    AND report_commit.canonical_byte_length BETWEEN 1 AND 47185920
    AND stress.calibration_sha256 = NEW.execution_calibration_sha256
    AND stress.persisted_at_ms <= NEW.decision_at_ms
    AND stress_binding.report_sha256 = NEW.research_report_sha256
    AND stress_binding.stress_manifest_sha256
      = NEW.execution_stress_manifest_sha256
    AND stress_binding.persisted_at_ms <= NEW.decision_at_ms
    AND (
      (
        NEW.signer_trust_revocation_sha256 IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM strategy_signer_trust_revocations revocation
          WHERE revocation.trust_anchor_sha256
              = NEW.signer_trust_anchor_sha256
            AND revocation.persisted_at_ms <= NEW.decision_at_ms
        )
      )
      OR EXISTS (
        SELECT 1
        FROM strategy_signer_trust_revocations revocation
        WHERE revocation.revocation_sha256
            = NEW.signer_trust_revocation_sha256
          AND revocation.trust_anchor_sha256
            = NEW.signer_trust_anchor_sha256
          AND revocation.persisted_at_ms <= NEW.decision_at_ms
          AND revocation.effective_at_ms > NEW.decision_at_ms
      )
    )
)
BEGIN
  SELECT RAISE(
    ABORT,
    'Verified strategy configuration evidence is invalid'
  );
END;

CREATE TRIGGER reject_verified_strategy_configuration_conflict
BEFORE INSERT ON hourly_trend_breakout_verified_configurations
WHEN EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_verified_configurations existing
  WHERE (
      existing.verification_evidence_sha256
        = NEW.verification_evidence_sha256
      OR (
        existing.signed_configuration_sha256
          = NEW.signed_configuration_sha256
        AND existing.decision_at_ms = NEW.decision_at_ms
      )
    )
    AND (
      existing.verification_evidence_sha256
        <> NEW.verification_evidence_sha256
      OR existing.evidence_canonical_json
        <> NEW.evidence_canonical_json
    )
)
BEGIN
  SELECT RAISE(
    ABORT,
    'Verified strategy configuration conflict'
  );
END;

CREATE TRIGGER prevent_verified_strategy_configuration_update
BEFORE UPDATE ON hourly_trend_breakout_verified_configurations
BEGIN
  SELECT RAISE(
    ABORT,
    'Verified strategy configuration is immutable'
  );
END;

CREATE TRIGGER prevent_verified_strategy_configuration_delete
BEFORE DELETE ON hourly_trend_breakout_verified_configurations
BEGIN
  SELECT RAISE(
    ABORT,
    'Verified strategy configuration is immutable'
  );
END;
