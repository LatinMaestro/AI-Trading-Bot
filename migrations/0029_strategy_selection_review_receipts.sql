CREATE TABLE hourly_trend_breakout_strategy_selection_proposal_verifications (
  proposal_verification_sha256 TEXT PRIMARY KEY CHECK (
    length(proposal_verification_sha256) = 64
    AND proposal_verification_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (
    schema_version = 'verified-strategy-selection-proposal-at-time-v1'
  ),
  proposal_sha256 TEXT NOT NULL REFERENCES
    hourly_trend_breakout_strategy_selection_proposals(proposal_sha256),
  reviewed_at_ms INTEGER NOT NULL CHECK (reviewed_at_ms >= 0),
  configuration_signer_trust_anchor_sha256 TEXT NOT NULL REFERENCES
    strategy_signer_trust_anchors(trust_anchor_sha256),
  configuration_signer_trust_revocation_sha256 TEXT REFERENCES
    strategy_signer_trust_revocations(revocation_sha256),
  authoriser_trust_anchor_sha256 TEXT NOT NULL REFERENCES
    strategy_signer_trust_anchors(trust_anchor_sha256),
  authoriser_trust_revocation_sha256 TEXT REFERENCES
    strategy_signer_trust_revocations(revocation_sha256),
  candidate_status TEXT NOT NULL CHECK (candidate_status = 'unselected'),
  selection_decision TEXT NOT NULL CHECK (selection_decision = 'none'),
  authorisation_consumed INTEGER NOT NULL CHECK (
    authorisation_consumed = 0
  ),
  activation_authority TEXT NOT NULL CHECK (activation_authority = 'none'),
  execution_authority TEXT NOT NULL CHECK (execution_authority = 'none'),
  verification_canonical_json TEXT NOT NULL CHECK (
    json_valid(verification_canonical_json)
    AND json_extract(verification_canonical_json, '$.schemaVersion')
      = schema_version
    AND json_extract(
      verification_canonical_json,
      '$.proposal.proposalSha256'
    ) = proposal_sha256
    AND json_extract(verification_canonical_json, '$.reviewedAtMs')
      = reviewed_at_ms
    AND json_extract(
      verification_canonical_json,
      '$.configurationSignerTrustAnchorSha256'
    ) = configuration_signer_trust_anchor_sha256
    AND json_extract(
      verification_canonical_json,
      '$.configurationSignerTrustRevocationSha256'
    ) IS configuration_signer_trust_revocation_sha256
    AND json_extract(
      verification_canonical_json,
      '$.authoriserTrustAnchorSha256'
    ) = authoriser_trust_anchor_sha256
    AND json_extract(
      verification_canonical_json,
      '$.authoriserTrustRevocationSha256'
    ) IS authoriser_trust_revocation_sha256
    AND json_extract(verification_canonical_json, '$.candidateStatus')
      = candidate_status
    AND json_extract(verification_canonical_json, '$.selectionDecision')
      = selection_decision
    AND json_extract(
      verification_canonical_json,
      '$.authorisationConsumed'
    ) = authorisation_consumed
    AND json_extract(verification_canonical_json, '$.activationAuthority')
      = activation_authority
    AND json_extract(verification_canonical_json, '$.executionAuthority')
      = execution_authority
  ),
  persisted_at_ms INTEGER NOT NULL CHECK (
    persisted_at_ms >= reviewed_at_ms
  ),
  UNIQUE (proposal_sha256, reviewed_at_ms)
);

CREATE TRIGGER validate_strategy_selection_proposal_verification
BEFORE INSERT ON hourly_trend_breakout_strategy_selection_proposal_verifications
WHEN NOT EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_strategy_selection_proposals proposal
  JOIN hourly_trend_breakout_signed_configurations configuration
    ON configuration.signed_configuration_sha256
      = proposal.signed_configuration_sha256
  JOIN hourly_trend_breakout_strategy_authorisations authorisation
    ON authorisation.signed_authorisation_sha256
      = proposal.signed_authorisation_sha256
  JOIN strategy_signer_trust_anchors configuration_anchor
    ON configuration_anchor.trust_anchor_sha256
      = NEW.configuration_signer_trust_anchor_sha256
  JOIN strategy_signer_trust_anchors authoriser_anchor
    ON authoriser_anchor.trust_anchor_sha256
      = NEW.authoriser_trust_anchor_sha256
  WHERE proposal.proposal_sha256 = NEW.proposal_sha256
    AND proposal.persisted_at_ms <= NEW.reviewed_at_ms
    AND proposal.proposed_at_ms <= NEW.reviewed_at_ms
    AND proposal.candidate_status = 'unselected'
    AND proposal.selection_decision = 'none'
    AND proposal.activation_authority = 'none'
    AND proposal.execution_authority = 'none'
    AND proposal.configuration_signer_trust_anchor_sha256
      = NEW.configuration_signer_trust_anchor_sha256
    AND proposal.authoriser_trust_anchor_sha256
      = NEW.authoriser_trust_anchor_sha256
    AND configuration.signer_trust_anchor_sha256
      = NEW.configuration_signer_trust_anchor_sha256
    AND configuration.execution_authority = 'none'
    AND configuration.persisted_at_ms <= NEW.reviewed_at_ms
    AND configuration.effective_from_ms <= NEW.reviewed_at_ms
    AND configuration.expires_at_ms > NEW.reviewed_at_ms
    AND authorisation.authoriser_trust_anchor_sha256
      = NEW.authoriser_trust_anchor_sha256
    AND authorisation.standalone_execution_authority = 'none'
    AND authorisation.requires_separate_activation_checklist = 1
    AND authorisation.persisted_at_ms <= NEW.reviewed_at_ms
    AND authorisation.effective_from_ms <= NEW.reviewed_at_ms
    AND authorisation.expires_at_ms > NEW.reviewed_at_ms
    AND configuration_anchor.signer_role
      = 'strategy-configuration-signer'
    AND configuration_anchor.key_id = configuration.signer_key_id
    AND configuration_anchor.verification_key_sha256
      = configuration.verification_key_sha256
    AND configuration_anchor.persisted_at_ms <= NEW.reviewed_at_ms
    AND configuration_anchor.valid_from_ms <= configuration.issued_at_ms
    AND configuration_anchor.valid_until_ms > NEW.reviewed_at_ms
    AND authoriser_anchor.signer_role = 'external-strategy-authoriser'
    AND authoriser_anchor.key_id = authorisation.authoriser_key_id
    AND authoriser_anchor.verification_key_sha256
      = authorisation.verification_key_sha256
    AND authoriser_anchor.persisted_at_ms <= NEW.reviewed_at_ms
    AND authoriser_anchor.valid_from_ms <= authorisation.reviewed_at_ms
    AND authoriser_anchor.valid_until_ms > NEW.reviewed_at_ms
    AND (
      (
        NEW.configuration_signer_trust_revocation_sha256 IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM strategy_signer_trust_revocations revocation
          WHERE revocation.trust_anchor_sha256
              = NEW.configuration_signer_trust_anchor_sha256
            AND revocation.persisted_at_ms <= NEW.reviewed_at_ms
            AND revocation.reviewed_at_ms <= NEW.reviewed_at_ms
        )
      )
      OR EXISTS (
        SELECT 1
        FROM strategy_signer_trust_revocations revocation
        WHERE revocation.revocation_sha256
            = NEW.configuration_signer_trust_revocation_sha256
          AND revocation.trust_anchor_sha256
            = NEW.configuration_signer_trust_anchor_sha256
          AND revocation.persisted_at_ms <= NEW.reviewed_at_ms
          AND revocation.reviewed_at_ms <= NEW.reviewed_at_ms
          AND revocation.effective_at_ms > NEW.reviewed_at_ms
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
            AND revocation.persisted_at_ms <= NEW.reviewed_at_ms
            AND revocation.reviewed_at_ms <= NEW.reviewed_at_ms
        )
      )
      OR EXISTS (
        SELECT 1
        FROM strategy_signer_trust_revocations revocation
        WHERE revocation.revocation_sha256
            = NEW.authoriser_trust_revocation_sha256
          AND revocation.trust_anchor_sha256
            = NEW.authoriser_trust_anchor_sha256
          AND revocation.persisted_at_ms <= NEW.reviewed_at_ms
          AND revocation.reviewed_at_ms <= NEW.reviewed_at_ms
          AND revocation.effective_at_ms > NEW.reviewed_at_ms
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Strategy selection proposal verification is invalid');
END;

CREATE TRIGGER reject_strategy_selection_proposal_verification_conflict
BEFORE INSERT ON hourly_trend_breakout_strategy_selection_proposal_verifications
WHEN EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_strategy_selection_proposal_verifications existing
  WHERE (
      existing.proposal_verification_sha256
        = NEW.proposal_verification_sha256
      OR (
        existing.proposal_sha256 = NEW.proposal_sha256
        AND existing.reviewed_at_ms = NEW.reviewed_at_ms
      )
    )
    AND (
      existing.proposal_verification_sha256
        <> NEW.proposal_verification_sha256
      OR existing.verification_canonical_json
        <> NEW.verification_canonical_json
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Strategy selection proposal verification conflict');
END;

CREATE TABLE hourly_trend_breakout_strategy_selection_review_receipts (
  receipt_sha256 TEXT PRIMARY KEY CHECK (
    length(receipt_sha256) = 64
    AND receipt_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (
    schema_version = 'strategy-selection-review-receipt-v1'
  ),
  receipt_id TEXT NOT NULL UNIQUE,
  proposal_sha256 TEXT NOT NULL REFERENCES
    hourly_trend_breakout_strategy_selection_proposals(proposal_sha256),
  proposal_verification_sha256 TEXT NOT NULL REFERENCES
    hourly_trend_breakout_strategy_selection_proposal_verifications(
      proposal_verification_sha256
    ),
  reviewed_at_ms INTEGER NOT NULL CHECK (reviewed_at_ms >= 0),
  disposition TEXT NOT NULL CHECK (
    disposition IN (
      'acknowledged-for-owner-review',
      'deferred',
      'rejected'
    )
  ),
  review_evidence_sha256 TEXT NOT NULL CHECK (
    length(review_evidence_sha256) = 64
    AND review_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  reviewer_key_id TEXT NOT NULL,
  reviewer_trust_anchor_sha256 TEXT NOT NULL REFERENCES
    strategy_signer_trust_anchors(trust_anchor_sha256),
  reviewer_trust_revocation_sha256 TEXT REFERENCES
    strategy_signer_trust_revocations(revocation_sha256),
  proposal_status TEXT NOT NULL CHECK (
    proposal_status = 'non-activating-review-proposal'
  ),
  candidate_status TEXT NOT NULL CHECK (candidate_status = 'unselected'),
  selection_decision TEXT NOT NULL CHECK (selection_decision = 'none'),
  authorisation_consumed INTEGER NOT NULL CHECK (
    authorisation_consumed = 0
  ),
  activation_authority TEXT NOT NULL CHECK (activation_authority = 'none'),
  execution_authority TEXT NOT NULL CHECK (execution_authority = 'none'),
  verification_key_jwk_json TEXT NOT NULL CHECK (
    json_valid(verification_key_jwk_json)
  ),
  verification_key_sha256 TEXT NOT NULL CHECK (
    length(verification_key_sha256) = 64
    AND verification_key_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  signature_hex TEXT NOT NULL CHECK (
    length(signature_hex) = 128
    AND signature_hex NOT GLOB '*[^0-9a-f]*'
  ),
  signed_payload_json TEXT NOT NULL CHECK (
    json_valid(signed_payload_json)
    AND json_extract(signed_payload_json, '$.schemaVersion')
      = schema_version
    AND json_extract(signed_payload_json, '$.receiptId') = receipt_id
    AND json_extract(signed_payload_json, '$.proposalSha256')
      = proposal_sha256
    AND json_extract(
      signed_payload_json,
      '$.proposalVerificationSha256'
    ) = proposal_verification_sha256
    AND json_extract(signed_payload_json, '$.reviewedAtMs')
      = reviewed_at_ms
    AND json_extract(signed_payload_json, '$.disposition') = disposition
    AND json_extract(signed_payload_json, '$.reviewEvidenceSha256')
      = review_evidence_sha256
    AND json_extract(signed_payload_json, '$.reviewerKeyId')
      = reviewer_key_id
    AND json_extract(signed_payload_json, '$.proposalStatus')
      = proposal_status
    AND json_extract(signed_payload_json, '$.candidateStatus')
      = candidate_status
    AND json_extract(signed_payload_json, '$.selectionDecision')
      = selection_decision
    AND json_extract(signed_payload_json, '$.authorisationConsumed')
      = authorisation_consumed
    AND json_extract(signed_payload_json, '$.activationAuthority')
      = activation_authority
    AND json_extract(signed_payload_json, '$.executionAuthority')
      = execution_authority
  ),
  signed_payload_sha256 TEXT NOT NULL CHECK (
    length(signed_payload_sha256) = 64
    AND signed_payload_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  receipt_canonical_json TEXT NOT NULL CHECK (
    json_valid(receipt_canonical_json)
    AND json_extract(receipt_canonical_json, '$.receiptSha256')
      = receipt_sha256
    AND json_extract(receipt_canonical_json, '$.signedPayloadSha256')
      = signed_payload_sha256
    AND json_extract(receipt_canonical_json, '$.verificationKeySha256')
      = verification_key_sha256
    AND json_extract(receipt_canonical_json, '$.signatureHex')
      = signature_hex
    AND json_extract(receipt_canonical_json, '$.authorisationConsumed')
      = authorisation_consumed
    AND json_extract(receipt_canonical_json, '$.activationAuthority')
      = activation_authority
    AND json_extract(receipt_canonical_json, '$.executionAuthority')
      = execution_authority
  ),
  persisted_at_ms INTEGER NOT NULL CHECK (
    persisted_at_ms >= reviewed_at_ms
  )
);

CREATE TRIGGER validate_strategy_selection_review_receipt
BEFORE INSERT ON hourly_trend_breakout_strategy_selection_review_receipts
WHEN NOT EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_strategy_selection_proposal_verifications verification
  JOIN strategy_signer_trust_anchors reviewer_anchor
    ON reviewer_anchor.trust_anchor_sha256
      = NEW.reviewer_trust_anchor_sha256
  WHERE verification.proposal_verification_sha256
      = NEW.proposal_verification_sha256
    AND verification.proposal_sha256 = NEW.proposal_sha256
    AND verification.reviewed_at_ms = NEW.reviewed_at_ms
    AND verification.persisted_at_ms <= NEW.persisted_at_ms
    AND verification.authoriser_trust_anchor_sha256
      = NEW.reviewer_trust_anchor_sha256
    AND verification.authoriser_trust_revocation_sha256
      IS NEW.reviewer_trust_revocation_sha256
    AND verification.candidate_status = 'unselected'
    AND verification.selection_decision = 'none'
    AND verification.authorisation_consumed = 0
    AND verification.activation_authority = 'none'
    AND verification.execution_authority = 'none'
    AND reviewer_anchor.signer_role = 'external-strategy-authoriser'
    AND reviewer_anchor.key_id = NEW.reviewer_key_id
    AND reviewer_anchor.verification_key_sha256
      = NEW.verification_key_sha256
    AND reviewer_anchor.persisted_at_ms <= NEW.reviewed_at_ms
    AND reviewer_anchor.valid_from_ms <= NEW.reviewed_at_ms
    AND reviewer_anchor.valid_until_ms > NEW.reviewed_at_ms
    AND (
      (
        NEW.reviewer_trust_revocation_sha256 IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM strategy_signer_trust_revocations revocation
          WHERE revocation.trust_anchor_sha256
              = NEW.reviewer_trust_anchor_sha256
            AND revocation.persisted_at_ms <= NEW.reviewed_at_ms
            AND revocation.reviewed_at_ms <= NEW.reviewed_at_ms
        )
      )
      OR EXISTS (
        SELECT 1
        FROM strategy_signer_trust_revocations revocation
        WHERE revocation.revocation_sha256
            = NEW.reviewer_trust_revocation_sha256
          AND revocation.trust_anchor_sha256
            = NEW.reviewer_trust_anchor_sha256
          AND revocation.persisted_at_ms <= NEW.reviewed_at_ms
          AND revocation.reviewed_at_ms <= NEW.reviewed_at_ms
          AND revocation.effective_at_ms > NEW.reviewed_at_ms
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Strategy selection review receipt is invalid');
END;

CREATE TRIGGER reject_strategy_selection_review_receipt_conflict
BEFORE INSERT ON hourly_trend_breakout_strategy_selection_review_receipts
WHEN EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_strategy_selection_review_receipts existing
  WHERE (
      existing.receipt_sha256 = NEW.receipt_sha256
      OR existing.receipt_id = NEW.receipt_id
    )
    AND (
      existing.receipt_sha256 <> NEW.receipt_sha256
      OR existing.receipt_canonical_json <> NEW.receipt_canonical_json
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Strategy selection review receipt conflict');
END;

CREATE TRIGGER prevent_strategy_selection_proposal_verification_update
BEFORE UPDATE ON hourly_trend_breakout_strategy_selection_proposal_verifications
BEGIN
  SELECT RAISE(ABORT, 'Strategy selection proposal verifications are immutable');
END;

CREATE TRIGGER prevent_strategy_selection_proposal_verification_delete
BEFORE DELETE ON hourly_trend_breakout_strategy_selection_proposal_verifications
BEGIN
  SELECT RAISE(ABORT, 'Strategy selection proposal verifications are immutable');
END;

CREATE TRIGGER prevent_strategy_selection_review_receipt_update
BEFORE UPDATE ON hourly_trend_breakout_strategy_selection_review_receipts
BEGIN
  SELECT RAISE(ABORT, 'Strategy selection review receipts are immutable');
END;

CREATE TRIGGER prevent_strategy_selection_review_receipt_delete
BEFORE DELETE ON hourly_trend_breakout_strategy_selection_review_receipts
BEGIN
  SELECT RAISE(ABORT, 'Strategy selection review receipts are immutable');
END;
