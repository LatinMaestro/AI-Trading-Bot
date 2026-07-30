CREATE TABLE hourly_trend_breakout_strategy_selection_proposals (
  proposal_sha256 TEXT PRIMARY KEY CHECK (
    length(proposal_sha256) = 64
    AND proposal_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (
    schema_version = 'strategy-selection-proposal-v1'
  ),
  proposal_id TEXT NOT NULL UNIQUE,
  proposed_at_ms INTEGER NOT NULL CHECK (proposed_at_ms >= 0),
  verification_evidence_sha256 TEXT NOT NULL REFERENCES
    hourly_trend_breakout_verified_configurations(
      verification_evidence_sha256
    ),
  signed_configuration_sha256 TEXT NOT NULL REFERENCES
    hourly_trend_breakout_signed_configurations(
      signed_configuration_sha256
    ),
  signed_authorisation_sha256 TEXT NOT NULL REFERENCES
    hourly_trend_breakout_strategy_authorisations(
      signed_authorisation_sha256
    ),
  authorisation_scope TEXT NOT NULL CHECK (
    authorisation_scope IN ('paper', 'shadow', 'canary-live')
  ),
  maximum_capital_aud REAL NOT NULL CHECK (
    maximum_capital_aud > 0
    AND maximum_capital_aud <= 1000000
  ),
  configuration_signer_trust_anchor_sha256 TEXT NOT NULL REFERENCES
    strategy_signer_trust_anchors(trust_anchor_sha256),
  configuration_signer_trust_revocation_sha256 TEXT REFERENCES
    strategy_signer_trust_revocations(revocation_sha256),
  authoriser_trust_anchor_sha256 TEXT NOT NULL REFERENCES
    strategy_signer_trust_anchors(trust_anchor_sha256),
  authoriser_trust_revocation_sha256 TEXT REFERENCES
    strategy_signer_trust_revocations(revocation_sha256),
  warnings_json TEXT NOT NULL CHECK (
    json_valid(warnings_json)
    AND json_array_length(warnings_json) = 4
    AND json_extract(warnings_json, '$[0]')
      = 'five-year-objective-is-aspirational-not-a-forecast'
    AND json_extract(warnings_json, '$[1]')
      = 'complete-approved-capital-loss-is-possible'
    AND json_extract(warnings_json, '$[2]')
      = 'external-authorisation-does-not-select-or-activate'
    AND json_extract(warnings_json, '$[3]')
      = 'separate-owner-activation-and-runtime-gates-remain-required'
  ),
  proposal_status TEXT NOT NULL CHECK (
    proposal_status = 'non-activating-review-proposal'
  ),
  candidate_status TEXT NOT NULL CHECK (candidate_status = 'unselected'),
  selection_decision TEXT NOT NULL CHECK (selection_decision = 'none'),
  activation_authority TEXT NOT NULL CHECK (activation_authority = 'none'),
  execution_authority TEXT NOT NULL CHECK (execution_authority = 'none'),
  proposal_canonical_json TEXT NOT NULL CHECK (
    json_valid(proposal_canonical_json)
    AND json_extract(proposal_canonical_json, '$.schemaVersion')
      = schema_version
    AND json_extract(proposal_canonical_json, '$.proposalId')
      = proposal_id
    AND json_extract(proposal_canonical_json, '$.proposedAtMs')
      = proposed_at_ms
    AND json_extract(
      proposal_canonical_json,
      '$.verificationEvidenceSha256'
    ) = verification_evidence_sha256
    AND json_extract(
      proposal_canonical_json,
      '$.signedConfigurationSha256'
    ) = signed_configuration_sha256
    AND json_extract(
      proposal_canonical_json,
      '$.signedAuthorisationSha256'
    ) = signed_authorisation_sha256
    AND json_extract(proposal_canonical_json, '$.authorisationScope')
      = authorisation_scope
    AND json_extract(proposal_canonical_json, '$.maximumCapitalAud')
      = maximum_capital_aud
    AND json_extract(
      proposal_canonical_json,
      '$.configurationSignerTrustAnchorSha256'
    ) = configuration_signer_trust_anchor_sha256
    AND json_extract(
      proposal_canonical_json,
      '$.configurationSignerTrustRevocationSha256'
    ) IS configuration_signer_trust_revocation_sha256
    AND json_extract(
      proposal_canonical_json,
      '$.authoriserTrustAnchorSha256'
    ) = authoriser_trust_anchor_sha256
    AND json_extract(
      proposal_canonical_json,
      '$.authoriserTrustRevocationSha256'
    ) IS authoriser_trust_revocation_sha256
    AND json_extract(proposal_canonical_json, '$.warnings')
      = json(warnings_json)
    AND json_extract(proposal_canonical_json, '$.proposalStatus')
      = proposal_status
    AND json_extract(proposal_canonical_json, '$.candidateStatus')
      = candidate_status
    AND json_extract(proposal_canonical_json, '$.selectionDecision')
      = selection_decision
    AND json_extract(proposal_canonical_json, '$.activationAuthority')
      = activation_authority
    AND json_extract(proposal_canonical_json, '$.executionAuthority')
      = execution_authority
  ),
  persisted_at_ms INTEGER NOT NULL CHECK (
    persisted_at_ms >= proposed_at_ms
  )
);

CREATE TRIGGER validate_strategy_selection_proposal_evidence
BEFORE INSERT ON hourly_trend_breakout_strategy_selection_proposals
WHEN NOT EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_verified_configurations verification
  JOIN hourly_trend_breakout_signed_configurations configuration
    ON configuration.signed_configuration_sha256
      = NEW.signed_configuration_sha256
  JOIN hourly_trend_breakout_strategy_authorisations authorisation
    ON authorisation.signed_authorisation_sha256
      = NEW.signed_authorisation_sha256
  JOIN strategy_signer_trust_anchors configuration_anchor
    ON configuration_anchor.trust_anchor_sha256
      = NEW.configuration_signer_trust_anchor_sha256
  JOIN strategy_signer_trust_anchors authoriser_anchor
    ON authoriser_anchor.trust_anchor_sha256
      = NEW.authoriser_trust_anchor_sha256
  WHERE verification.verification_evidence_sha256
      = NEW.verification_evidence_sha256
    AND verification.signed_configuration_sha256
      = NEW.signed_configuration_sha256
    AND verification.selection_authority = 'none'
    AND verification.execution_authority = 'none'
    AND verification.decision_at_ms <= NEW.proposed_at_ms
    AND verification.persisted_at_ms <= NEW.proposed_at_ms
    AND configuration.signer_trust_anchor_sha256
      = NEW.configuration_signer_trust_anchor_sha256
    AND configuration.complete_evaluation_sha256
      = verification.complete_evaluation_sha256
    AND configuration.readiness_assessment_sha256
      = verification.readiness_assessment_sha256
    AND configuration.execution_authority = 'none'
    AND configuration.persisted_at_ms <= NEW.proposed_at_ms
    AND configuration.effective_from_ms <= NEW.proposed_at_ms
    AND configuration.expires_at_ms > NEW.proposed_at_ms
    AND authorisation.signed_configuration_sha256
      = NEW.signed_configuration_sha256
    AND authorisation.complete_evaluation_sha256
      = verification.complete_evaluation_sha256
    AND authorisation.readiness_assessment_sha256
      = verification.readiness_assessment_sha256
    AND authorisation.authorisation_scope = NEW.authorisation_scope
    AND authorisation.maximum_capital_aud = NEW.maximum_capital_aud
    AND authorisation.authoriser_trust_anchor_sha256
      = NEW.authoriser_trust_anchor_sha256
    AND authorisation.standalone_execution_authority = 'none'
    AND authorisation.requires_separate_activation_checklist = 1
    AND authorisation.persisted_at_ms <= NEW.proposed_at_ms
    AND authorisation.reviewed_at_ms <= NEW.proposed_at_ms
    AND authorisation.effective_from_ms <= NEW.proposed_at_ms
    AND authorisation.expires_at_ms > NEW.proposed_at_ms
    AND authorisation.maximum_capital_aud <= json_extract(
      configuration.configuration_canonical_json,
      '$.configuration.maximumCapitalAud'
    )
    AND configuration_anchor.signer_role
      = 'strategy-configuration-signer'
    AND configuration_anchor.key_id = configuration.signer_key_id
    AND configuration_anchor.verification_key_sha256
      = configuration.verification_key_sha256
    AND configuration_anchor.persisted_at_ms <= NEW.proposed_at_ms
    AND configuration_anchor.valid_from_ms <= configuration.issued_at_ms
    AND configuration_anchor.valid_until_ms > NEW.proposed_at_ms
    AND authoriser_anchor.signer_role = 'external-strategy-authoriser'
    AND authoriser_anchor.key_id = authorisation.authoriser_key_id
    AND authoriser_anchor.verification_key_sha256
      = authorisation.verification_key_sha256
    AND authoriser_anchor.persisted_at_ms <= NEW.proposed_at_ms
    AND authoriser_anchor.valid_from_ms <= authorisation.reviewed_at_ms
    AND authoriser_anchor.valid_until_ms > NEW.proposed_at_ms
    AND configuration_anchor.key_id <> authoriser_anchor.key_id
    AND configuration_anchor.verification_key_sha256
      <> authoriser_anchor.verification_key_sha256
    AND (
      (
        NEW.configuration_signer_trust_revocation_sha256 IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM strategy_signer_trust_revocations revocation
          WHERE revocation.trust_anchor_sha256
              = NEW.configuration_signer_trust_anchor_sha256
            AND revocation.persisted_at_ms <= NEW.proposed_at_ms
            AND revocation.reviewed_at_ms <= NEW.proposed_at_ms
        )
      )
      OR EXISTS (
        SELECT 1
        FROM strategy_signer_trust_revocations revocation
        WHERE revocation.revocation_sha256
            = NEW.configuration_signer_trust_revocation_sha256
          AND revocation.trust_anchor_sha256
            = NEW.configuration_signer_trust_anchor_sha256
          AND revocation.persisted_at_ms <= NEW.proposed_at_ms
          AND revocation.reviewed_at_ms <= NEW.proposed_at_ms
          AND revocation.effective_at_ms > NEW.proposed_at_ms
      )
    )
    AND (
      (
        NEW.authoriser_trust_revocation_sha256 IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM strategy_signer_trust_revocations revocation
          WHERE revocation.trust_anchor_sha256
              = NEW.authoriser_trust_anchor_sha256
            AND revocation.persisted_at_ms <= NEW.proposed_at_ms
            AND revocation.reviewed_at_ms <= NEW.proposed_at_ms
        )
      )
      OR EXISTS (
        SELECT 1
        FROM strategy_signer_trust_revocations revocation
        WHERE revocation.revocation_sha256
            = NEW.authoriser_trust_revocation_sha256
          AND revocation.trust_anchor_sha256
            = NEW.authoriser_trust_anchor_sha256
          AND revocation.persisted_at_ms <= NEW.proposed_at_ms
          AND revocation.reviewed_at_ms <= NEW.proposed_at_ms
          AND revocation.effective_at_ms > NEW.proposed_at_ms
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Strategy selection proposal evidence is invalid');
END;

CREATE TRIGGER reject_strategy_selection_proposal_conflict
BEFORE INSERT ON hourly_trend_breakout_strategy_selection_proposals
WHEN EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_strategy_selection_proposals existing
  WHERE (
      existing.proposal_sha256 = NEW.proposal_sha256
      OR existing.proposal_id = NEW.proposal_id
    )
    AND (
      existing.proposal_sha256 <> NEW.proposal_sha256
      OR existing.proposal_canonical_json <> NEW.proposal_canonical_json
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Strategy selection proposal conflict');
END;

CREATE TRIGGER prevent_strategy_selection_proposal_update
BEFORE UPDATE ON hourly_trend_breakout_strategy_selection_proposals
BEGIN
  SELECT RAISE(ABORT, 'Strategy selection proposals are immutable');
END;

CREATE TRIGGER prevent_strategy_selection_proposal_delete
BEFORE DELETE ON hourly_trend_breakout_strategy_selection_proposals
BEGIN
  SELECT RAISE(ABORT, 'Strategy selection proposals are immutable');
END;
