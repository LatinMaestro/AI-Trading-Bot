CREATE TABLE hourly_trend_breakout_signed_configurations (
  signed_configuration_sha256 TEXT PRIMARY KEY CHECK (
    length(signed_configuration_sha256) = 64
    AND signed_configuration_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (
    schema_version = 'signed-strategy-configuration-envelope-v1'
  ),
  configuration_version TEXT NOT NULL UNIQUE,
  strategy_version TEXT NOT NULL CHECK (
    strategy_version = 'hourly-trend-breakout-v0.1.0'
  ),
  execution_authority TEXT NOT NULL CHECK (execution_authority = 'none'),
  complete_evaluation_sha256 TEXT NOT NULL,
  readiness_assessment_sha256 TEXT NOT NULL,
  signer_key_id TEXT NOT NULL,
  verification_key_sha256 TEXT NOT NULL CHECK (
    length(verification_key_sha256) = 64
    AND verification_key_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  issued_at_ms INTEGER NOT NULL CHECK (issued_at_ms >= 0),
  effective_from_ms INTEGER NOT NULL CHECK (
    effective_from_ms >= issued_at_ms
  ),
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > effective_from_ms),
  configuration_canonical_json TEXT NOT NULL CHECK (
    json_valid(configuration_canonical_json)
    AND json_extract(
      configuration_canonical_json,
      '$.signedConfigurationSha256'
    ) = signed_configuration_sha256
    AND json_extract(
      configuration_canonical_json,
      '$.configurationVersion'
    ) = configuration_version
    AND json_extract(
      configuration_canonical_json,
      '$.configuration.strategyVersion'
    ) = strategy_version
    AND json_extract(
      configuration_canonical_json,
      '$.executionAuthority'
    ) = execution_authority
    AND json_extract(
      configuration_canonical_json,
      '$.configuration.completeEvaluationSha256'
    ) = complete_evaluation_sha256
    AND json_extract(
      configuration_canonical_json,
      '$.configuration.readinessAssessmentSha256'
    ) = readiness_assessment_sha256
    AND json_extract(
      configuration_canonical_json,
      '$.signerKeyId'
    ) = signer_key_id
    AND json_extract(
      configuration_canonical_json,
      '$.verificationKeySha256'
    ) = verification_key_sha256
    AND json_extract(configuration_canonical_json, '$.issuedAtMs')
      = issued_at_ms
    AND json_extract(configuration_canonical_json, '$.effectiveFromMs')
      = effective_from_ms
    AND json_extract(configuration_canonical_json, '$.expiresAtMs')
      = expires_at_ms
    AND json_extract(
      configuration_canonical_json,
      '$.configuration.configuredPairs[0]'
    ) = 'BTC/AUD'
    AND json_extract(
      configuration_canonical_json,
      '$.configuration.configuredPairs[1]'
    ) = 'ETH/AUD'
    AND json_array_length(
      json_extract(
        configuration_canonical_json,
        '$.configuration.configuredPairs'
      )
    ) = 2
  ),
  persisted_at_ms INTEGER NOT NULL CHECK (persisted_at_ms >= issued_at_ms),
  FOREIGN KEY (complete_evaluation_sha256)
    REFERENCES hourly_trend_breakout_complete_evaluations(
      evaluation_sha256
    ),
  FOREIGN KEY (readiness_assessment_sha256)
    REFERENCES hourly_trend_breakout_readiness_assessments(
      assessment_sha256
    )
);

CREATE TABLE hourly_trend_breakout_strategy_authorisations (
  signed_authorisation_sha256 TEXT PRIMARY KEY CHECK (
    length(signed_authorisation_sha256) = 64
    AND signed_authorisation_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (
    schema_version = 'signed-strategy-authorisation-envelope-v1'
  ),
  authorisation_id TEXT NOT NULL UNIQUE,
  authorisation_scope TEXT NOT NULL CHECK (
    authorisation_scope IN ('paper', 'shadow', 'canary-live')
  ),
  standalone_execution_authority TEXT NOT NULL CHECK (
    standalone_execution_authority = 'none'
  ),
  requires_separate_activation_checklist INTEGER NOT NULL CHECK (
    requires_separate_activation_checklist = 1
  ),
  signed_configuration_sha256 TEXT NOT NULL,
  complete_evaluation_sha256 TEXT NOT NULL,
  readiness_assessment_sha256 TEXT NOT NULL,
  maximum_capital_aud REAL NOT NULL CHECK (
    maximum_capital_aud > 0
    AND maximum_capital_aud <= 1000000
  ),
  authoriser_key_id TEXT NOT NULL,
  verification_key_sha256 TEXT NOT NULL CHECK (
    length(verification_key_sha256) = 64
    AND verification_key_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  reviewed_at_ms INTEGER NOT NULL CHECK (reviewed_at_ms >= 0),
  effective_from_ms INTEGER NOT NULL CHECK (
    effective_from_ms >= reviewed_at_ms
  ),
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > effective_from_ms),
  authorisation_canonical_json TEXT NOT NULL CHECK (
    json_valid(authorisation_canonical_json)
    AND json_extract(
      authorisation_canonical_json,
      '$.signedAuthorisationSha256'
    ) = signed_authorisation_sha256
    AND json_extract(
      authorisation_canonical_json,
      '$.authorisationId'
    ) = authorisation_id
    AND json_extract(
      authorisation_canonical_json,
      '$.authorisationScope'
    ) = authorisation_scope
    AND json_extract(
      authorisation_canonical_json,
      '$.standaloneExecutionAuthority'
    ) = standalone_execution_authority
    AND json_extract(
      authorisation_canonical_json,
      '$.requiresSeparateActivationChecklist'
    ) = requires_separate_activation_checklist
    AND json_extract(
      authorisation_canonical_json,
      '$.signedConfigurationSha256'
    ) = signed_configuration_sha256
    AND json_extract(
      authorisation_canonical_json,
      '$.completeEvaluationSha256'
    ) = complete_evaluation_sha256
    AND json_extract(
      authorisation_canonical_json,
      '$.readinessAssessmentSha256'
    ) = readiness_assessment_sha256
    AND json_extract(
      authorisation_canonical_json,
      '$.maximumCapitalAud'
    ) = maximum_capital_aud
    AND json_extract(
      authorisation_canonical_json,
      '$.authoriserKeyId'
    ) = authoriser_key_id
    AND json_extract(
      authorisation_canonical_json,
      '$.verificationKeySha256'
    ) = verification_key_sha256
    AND json_extract(authorisation_canonical_json, '$.reviewedAtMs')
      = reviewed_at_ms
    AND json_extract(authorisation_canonical_json, '$.effectiveFromMs')
      = effective_from_ms
    AND json_extract(authorisation_canonical_json, '$.expiresAtMs')
      = expires_at_ms
  ),
  persisted_at_ms INTEGER NOT NULL CHECK (persisted_at_ms >= reviewed_at_ms),
  FOREIGN KEY (signed_configuration_sha256)
    REFERENCES hourly_trend_breakout_signed_configurations(
      signed_configuration_sha256
    ),
  FOREIGN KEY (complete_evaluation_sha256)
    REFERENCES hourly_trend_breakout_complete_evaluations(
      evaluation_sha256
    ),
  FOREIGN KEY (readiness_assessment_sha256)
    REFERENCES hourly_trend_breakout_readiness_assessments(
      assessment_sha256
    )
);

CREATE TRIGGER validate_signed_strategy_configuration_evidence
BEFORE INSERT ON hourly_trend_breakout_signed_configurations
WHEN NOT EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_readiness_assessments assessment
  JOIN hourly_trend_breakout_readiness_bindings readiness_binding
    ON readiness_binding.assessment_sha256 = assessment.assessment_sha256
  JOIN hourly_trend_breakout_complete_evaluations evaluation
    ON evaluation.evaluation_sha256 = NEW.complete_evaluation_sha256
  WHERE assessment.assessment_sha256 = NEW.readiness_assessment_sha256
    AND assessment.research_status = 'evidence-complete-for-review'
    AND assessment.promotion_status = 'external-review-required'
    AND assessment.assessed_at_ms <= NEW.issued_at_ms
    AND assessment.persisted_at_ms <= NEW.persisted_at_ms
    AND readiness_binding.persisted_at_ms <= NEW.persisted_at_ms
    AND readiness_binding.complete_evaluation_sha256
      = NEW.complete_evaluation_sha256
    AND evaluation.persisted_at_ms <= NEW.persisted_at_ms
)
BEGIN
  SELECT RAISE(
    ABORT,
    'Signed strategy configuration evidence is invalid'
  );
END;

CREATE TRIGGER validate_signed_strategy_authorisation_evidence
BEFORE INSERT ON hourly_trend_breakout_strategy_authorisations
WHEN NOT EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_signed_configurations configuration
  WHERE configuration.signed_configuration_sha256
      = NEW.signed_configuration_sha256
    AND configuration.complete_evaluation_sha256
      = NEW.complete_evaluation_sha256
    AND configuration.readiness_assessment_sha256
      = NEW.readiness_assessment_sha256
    AND configuration.persisted_at_ms <= NEW.persisted_at_ms
    AND configuration.issued_at_ms <= NEW.reviewed_at_ms
    AND configuration.effective_from_ms <= NEW.effective_from_ms
    AND configuration.expires_at_ms >= NEW.expires_at_ms
    AND NEW.maximum_capital_aud <= json_extract(
      configuration.configuration_canonical_json,
      '$.configuration.maximumCapitalAud'
    )
)
BEGIN
  SELECT RAISE(
    ABORT,
    'Signed strategy authorisation evidence is invalid'
  );
END;

CREATE TRIGGER reject_signed_strategy_configuration_conflict
BEFORE INSERT ON hourly_trend_breakout_signed_configurations
WHEN EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_signed_configurations existing
  WHERE existing.signed_configuration_sha256
      = NEW.signed_configuration_sha256
    AND existing.configuration_canonical_json
      <> NEW.configuration_canonical_json
)
BEGIN
  SELECT RAISE(ABORT, 'Signed strategy configuration conflict');
END;

CREATE TRIGGER reject_signed_strategy_configuration_version_reuse
BEFORE INSERT ON hourly_trend_breakout_signed_configurations
WHEN EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_signed_configurations existing
  WHERE existing.configuration_version = NEW.configuration_version
    AND existing.signed_configuration_sha256
      <> NEW.signed_configuration_sha256
)
BEGIN
  SELECT RAISE(ABORT, 'Signed strategy configuration version conflict');
END;

CREATE TRIGGER reject_strategy_authorisation_identity_reuse
BEFORE INSERT ON hourly_trend_breakout_strategy_authorisations
WHEN EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_strategy_authorisations existing
  WHERE existing.authorisation_id = NEW.authorisation_id
    AND existing.signed_authorisation_sha256
      <> NEW.signed_authorisation_sha256
)
BEGIN
  SELECT RAISE(ABORT, 'Strategy authorisation identity conflict');
END;

CREATE TRIGGER reject_strategy_authorisation_conflict
BEFORE INSERT ON hourly_trend_breakout_strategy_authorisations
WHEN EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_strategy_authorisations existing
  WHERE existing.signed_authorisation_sha256
      = NEW.signed_authorisation_sha256
    AND existing.authorisation_canonical_json
      <> NEW.authorisation_canonical_json
)
BEGIN
  SELECT RAISE(ABORT, 'Signed strategy authorisation conflict');
END;

CREATE TRIGGER prevent_signed_strategy_configuration_update
BEFORE UPDATE ON hourly_trend_breakout_signed_configurations
BEGIN
  SELECT RAISE(ABORT, 'Signed strategy configurations are immutable');
END;

CREATE TRIGGER prevent_signed_strategy_configuration_delete
BEFORE DELETE ON hourly_trend_breakout_signed_configurations
BEGIN
  SELECT RAISE(ABORT, 'Signed strategy configurations are immutable');
END;

CREATE TRIGGER prevent_strategy_authorisation_update
BEFORE UPDATE ON hourly_trend_breakout_strategy_authorisations
BEGIN
  SELECT RAISE(ABORT, 'Strategy authorisations are immutable');
END;

CREATE TRIGGER prevent_strategy_authorisation_delete
BEFORE DELETE ON hourly_trend_breakout_strategy_authorisations
BEGIN
  SELECT RAISE(ABORT, 'Strategy authorisations are immutable');
END;
