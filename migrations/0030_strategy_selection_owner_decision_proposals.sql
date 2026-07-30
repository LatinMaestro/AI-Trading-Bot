CREATE TABLE hourly_trend_breakout_strategy_selection_receipt_verifications (
  receipt_verification_sha256 TEXT PRIMARY KEY CHECK (
    length(receipt_verification_sha256) = 64
    AND receipt_verification_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (
    schema_version =
      'verified-strategy-selection-review-receipt-at-time-v1'
  ),
  receipt_sha256 TEXT NOT NULL REFERENCES
    hourly_trend_breakout_strategy_selection_review_receipts(receipt_sha256),
  owner_decision_at_ms INTEGER NOT NULL CHECK (owner_decision_at_ms >= 0),
  current_proposal_verification_sha256 TEXT NOT NULL CHECK (
    length(current_proposal_verification_sha256) = 64
    AND current_proposal_verification_sha256 NOT GLOB '*[^0-9a-f]*'
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
    maximum_capital_aud > 0 AND maximum_capital_aud <= 1000000
  ),
  configuration_signer_trust_anchor_sha256 TEXT NOT NULL REFERENCES
    strategy_signer_trust_anchors(trust_anchor_sha256),
  configuration_signer_trust_revocation_sha256 TEXT REFERENCES
    strategy_signer_trust_revocations(revocation_sha256),
  reviewer_trust_anchor_sha256 TEXT NOT NULL REFERENCES
    strategy_signer_trust_anchors(trust_anchor_sha256),
  reviewer_trust_revocation_sha256 TEXT REFERENCES
    strategy_signer_trust_revocations(revocation_sha256),
  receipt_status TEXT NOT NULL CHECK (
    receipt_status = 'verified-for-owner-decision'
  ),
  candidate_status TEXT NOT NULL CHECK (candidate_status = 'unselected'),
  selection_decision TEXT NOT NULL CHECK (selection_decision = 'none'),
  authorisation_consumed INTEGER NOT NULL CHECK (
    authorisation_consumed = 0
  ),
  activation_authority TEXT NOT NULL CHECK (activation_authority = 'none'),
  execution_authority TEXT NOT NULL CHECK (execution_authority = 'none'),
  verification_canonical_json TEXT NOT NULL CHECK (
    json_valid(verification_canonical_json)
    AND json_extract(
      verification_canonical_json,
      '$.receiptVerificationSha256'
    ) = receipt_verification_sha256
    AND json_extract(
      verification_canonical_json,
      '$.receipt.receiptSha256'
    ) = receipt_sha256
    AND json_extract(
      verification_canonical_json,
      '$.ownerDecisionAtMs'
    ) = owner_decision_at_ms
    AND json_extract(
      verification_canonical_json,
      '$.currentProposalVerificationSha256'
    ) = current_proposal_verification_sha256
    AND json_extract(
      verification_canonical_json,
      '$.signedConfigurationSha256'
    ) = signed_configuration_sha256
    AND json_extract(
      verification_canonical_json,
      '$.signedAuthorisationSha256'
    ) = signed_authorisation_sha256
    AND json_extract(
      verification_canonical_json,
      '$.authorisationScope'
    ) = authorisation_scope
    AND json_extract(
      verification_canonical_json,
      '$.maximumCapitalAud'
    ) = maximum_capital_aud
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
      '$.reviewerTrustAnchorSha256'
    ) = reviewer_trust_anchor_sha256
    AND json_extract(
      verification_canonical_json,
      '$.reviewerTrustRevocationSha256'
    ) IS reviewer_trust_revocation_sha256
    AND json_extract(verification_canonical_json, '$.receiptStatus')
      = receipt_status
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
    persisted_at_ms >= owner_decision_at_ms
  ),
  UNIQUE (receipt_sha256, owner_decision_at_ms)
);

CREATE TRIGGER validate_strategy_selection_receipt_verification
BEFORE INSERT ON hourly_trend_breakout_strategy_selection_receipt_verifications
WHEN NOT EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_strategy_selection_review_receipts receipt
  JOIN hourly_trend_breakout_strategy_selection_proposals proposal
    ON proposal.proposal_sha256 = receipt.proposal_sha256
  JOIN hourly_trend_breakout_signed_configurations configuration
    ON configuration.signed_configuration_sha256
      = NEW.signed_configuration_sha256
  JOIN hourly_trend_breakout_strategy_authorisations authorisation
    ON authorisation.signed_authorisation_sha256
      = NEW.signed_authorisation_sha256
  JOIN strategy_signer_trust_anchors configuration_anchor
    ON configuration_anchor.trust_anchor_sha256
      = NEW.configuration_signer_trust_anchor_sha256
  JOIN strategy_signer_trust_anchors reviewer_anchor
    ON reviewer_anchor.trust_anchor_sha256
      = NEW.reviewer_trust_anchor_sha256
  WHERE receipt.receipt_sha256 = NEW.receipt_sha256
    AND receipt.persisted_at_ms <= NEW.owner_decision_at_ms
    AND receipt.reviewed_at_ms <= NEW.owner_decision_at_ms
    AND receipt.disposition = 'acknowledged-for-owner-review'
    AND receipt.candidate_status = 'unselected'
    AND receipt.selection_decision = 'none'
    AND receipt.authorisation_consumed = 0
    AND receipt.activation_authority = 'none'
    AND receipt.execution_authority = 'none'
    AND proposal.persisted_at_ms <= NEW.owner_decision_at_ms
    AND proposal.signed_configuration_sha256
      = NEW.signed_configuration_sha256
    AND proposal.signed_authorisation_sha256
      = NEW.signed_authorisation_sha256
    AND proposal.authorisation_scope = NEW.authorisation_scope
    AND proposal.maximum_capital_aud = NEW.maximum_capital_aud
    AND proposal.configuration_signer_trust_anchor_sha256
      = NEW.configuration_signer_trust_anchor_sha256
    AND proposal.authoriser_trust_anchor_sha256
      = NEW.reviewer_trust_anchor_sha256
    AND proposal.candidate_status = 'unselected'
    AND proposal.selection_decision = 'none'
    AND proposal.activation_authority = 'none'
    AND proposal.execution_authority = 'none'
    AND configuration.signer_trust_anchor_sha256
      = NEW.configuration_signer_trust_anchor_sha256
    AND configuration.persisted_at_ms <= NEW.owner_decision_at_ms
    AND configuration.effective_from_ms <= NEW.owner_decision_at_ms
    AND configuration.expires_at_ms > NEW.owner_decision_at_ms
    AND configuration.execution_authority = 'none'
    AND authorisation.authoriser_trust_anchor_sha256
      = NEW.reviewer_trust_anchor_sha256
    AND authorisation.persisted_at_ms <= NEW.owner_decision_at_ms
    AND authorisation.effective_from_ms <= NEW.owner_decision_at_ms
    AND authorisation.expires_at_ms > NEW.owner_decision_at_ms
    AND authorisation.standalone_execution_authority = 'none'
    AND authorisation.requires_separate_activation_checklist = 1
    AND configuration_anchor.signer_role
      = 'strategy-configuration-signer'
    AND configuration_anchor.key_id = configuration.signer_key_id
    AND configuration_anchor.verification_key_sha256
      = configuration.verification_key_sha256
    AND configuration_anchor.persisted_at_ms <= NEW.owner_decision_at_ms
    AND configuration_anchor.valid_from_ms <= configuration.issued_at_ms
    AND configuration_anchor.valid_until_ms > NEW.owner_decision_at_ms
    AND reviewer_anchor.signer_role = 'external-strategy-authoriser'
    AND reviewer_anchor.key_id = authorisation.authoriser_key_id
    AND reviewer_anchor.verification_key_sha256
      = authorisation.verification_key_sha256
    AND reviewer_anchor.persisted_at_ms <= NEW.owner_decision_at_ms
    AND reviewer_anchor.valid_from_ms <= authorisation.reviewed_at_ms
    AND reviewer_anchor.valid_until_ms > NEW.owner_decision_at_ms
    AND (
      (
        NEW.configuration_signer_trust_revocation_sha256 IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM strategy_signer_trust_revocations revocation
          WHERE revocation.trust_anchor_sha256
              = NEW.configuration_signer_trust_anchor_sha256
            AND revocation.persisted_at_ms <= NEW.owner_decision_at_ms
            AND revocation.reviewed_at_ms <= NEW.owner_decision_at_ms
        )
      )
      OR EXISTS (
        SELECT 1
        FROM strategy_signer_trust_revocations revocation
        WHERE revocation.revocation_sha256
            = NEW.configuration_signer_trust_revocation_sha256
          AND revocation.trust_anchor_sha256
            = NEW.configuration_signer_trust_anchor_sha256
          AND revocation.persisted_at_ms <= NEW.owner_decision_at_ms
          AND revocation.reviewed_at_ms <= NEW.owner_decision_at_ms
          AND revocation.effective_at_ms > NEW.owner_decision_at_ms
      )
    )
    AND (
      (
        NEW.reviewer_trust_revocation_sha256 IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM strategy_signer_trust_revocations revocation
          WHERE revocation.trust_anchor_sha256
              = NEW.reviewer_trust_anchor_sha256
            AND revocation.persisted_at_ms <= NEW.owner_decision_at_ms
            AND revocation.reviewed_at_ms <= NEW.owner_decision_at_ms
        )
      )
      OR EXISTS (
        SELECT 1
        FROM strategy_signer_trust_revocations revocation
        WHERE revocation.revocation_sha256
            = NEW.reviewer_trust_revocation_sha256
          AND revocation.trust_anchor_sha256
            = NEW.reviewer_trust_anchor_sha256
          AND revocation.persisted_at_ms <= NEW.owner_decision_at_ms
          AND revocation.reviewed_at_ms <= NEW.owner_decision_at_ms
          AND revocation.effective_at_ms > NEW.owner_decision_at_ms
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Strategy selection receipt verification is invalid');
END;

CREATE TRIGGER reject_strategy_selection_receipt_verification_conflict
BEFORE INSERT ON hourly_trend_breakout_strategy_selection_receipt_verifications
WHEN EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_strategy_selection_receipt_verifications existing
  WHERE (
      existing.receipt_verification_sha256
        = NEW.receipt_verification_sha256
      OR (
        existing.receipt_sha256 = NEW.receipt_sha256
        AND existing.owner_decision_at_ms = NEW.owner_decision_at_ms
      )
    )
    AND (
      existing.receipt_verification_sha256
        <> NEW.receipt_verification_sha256
      OR existing.verification_canonical_json
        <> NEW.verification_canonical_json
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Strategy selection receipt verification conflict');
END;

CREATE TABLE hourly_trend_breakout_strategy_selection_owner_decision_proposals (
  decision_proposal_sha256 TEXT PRIMARY KEY CHECK (
    length(decision_proposal_sha256) = 64
    AND decision_proposal_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (
    schema_version = 'strategy-selection-owner-decision-proposal-v1'
  ),
  decision_proposal_id TEXT NOT NULL UNIQUE,
  prepared_at_ms INTEGER NOT NULL CHECK (prepared_at_ms >= 0),
  receipt_sha256 TEXT NOT NULL REFERENCES
    hourly_trend_breakout_strategy_selection_review_receipts(receipt_sha256),
  receipt_verification_sha256 TEXT NOT NULL REFERENCES
    hourly_trend_breakout_strategy_selection_receipt_verifications(
      receipt_verification_sha256
    ),
  proposal_sha256 TEXT NOT NULL REFERENCES
    hourly_trend_breakout_strategy_selection_proposals(proposal_sha256),
  current_proposal_verification_sha256 TEXT NOT NULL CHECK (
    length(current_proposal_verification_sha256) = 64
    AND current_proposal_verification_sha256 NOT GLOB '*[^0-9a-f]*'
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
    maximum_capital_aud > 0 AND maximum_capital_aud <= 1000000
  ),
  owner_action_required INTEGER NOT NULL CHECK (owner_action_required = 1),
  owner_decision_status TEXT NOT NULL CHECK (
    owner_decision_status = 'pending-explicit-owner-decision'
  ),
  proposal_status TEXT NOT NULL CHECK (
    proposal_status = 'non-activating-owner-decision-proposal'
  ),
  candidate_status TEXT NOT NULL CHECK (candidate_status = 'unselected'),
  selection_decision TEXT NOT NULL CHECK (selection_decision = 'none'),
  authorisation_consumed INTEGER NOT NULL CHECK (
    authorisation_consumed = 0
  ),
  activation_authority TEXT NOT NULL CHECK (activation_authority = 'none'),
  execution_authority TEXT NOT NULL CHECK (execution_authority = 'none'),
  warnings_json TEXT NOT NULL CHECK (
    json_valid(warnings_json)
    AND json_array_length(warnings_json) = 4
    AND json_extract(warnings_json, '$[0]')
      = 'five-year-objective-is-aspirational-not-a-forecast'
    AND json_extract(warnings_json, '$[1]')
      = 'complete-approved-capital-loss-is-possible'
    AND json_extract(warnings_json, '$[2]')
      = 'review-receipt-does-not-imply-owner-selection'
    AND json_extract(warnings_json, '$[3]')
      = 'separate-explicit-owner-decision-and-activation-remain-required'
  ),
  proposal_canonical_json TEXT NOT NULL CHECK (
    json_valid(proposal_canonical_json)
    AND json_extract(
      proposal_canonical_json,
      '$.decisionProposalSha256'
    ) = decision_proposal_sha256
    AND json_extract(proposal_canonical_json, '$.decisionProposalId')
      = decision_proposal_id
    AND json_extract(proposal_canonical_json, '$.preparedAtMs')
      = prepared_at_ms
    AND json_extract(proposal_canonical_json, '$.receiptSha256')
      = receipt_sha256
    AND json_extract(
      proposal_canonical_json,
      '$.receiptVerificationSha256'
    ) = receipt_verification_sha256
    AND json_extract(proposal_canonical_json, '$.proposalSha256')
      = proposal_sha256
    AND json_extract(
      proposal_canonical_json,
      '$.currentProposalVerificationSha256'
    ) = current_proposal_verification_sha256
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
    AND json_extract(proposal_canonical_json, '$.ownerActionRequired')
      = owner_action_required
    AND json_extract(proposal_canonical_json, '$.ownerDecisionStatus')
      = owner_decision_status
    AND json_extract(proposal_canonical_json, '$.proposalStatus')
      = proposal_status
    AND json_extract(proposal_canonical_json, '$.candidateStatus')
      = candidate_status
    AND json_extract(proposal_canonical_json, '$.selectionDecision')
      = selection_decision
    AND json_extract(proposal_canonical_json, '$.authorisationConsumed')
      = authorisation_consumed
    AND json_extract(proposal_canonical_json, '$.activationAuthority')
      = activation_authority
    AND json_extract(proposal_canonical_json, '$.executionAuthority')
      = execution_authority
    AND json_extract(proposal_canonical_json, '$.warnings')
      = json(warnings_json)
  ),
  persisted_at_ms INTEGER NOT NULL CHECK (
    persisted_at_ms >= prepared_at_ms
  )
);

CREATE TRIGGER validate_strategy_selection_owner_decision_proposal
BEFORE INSERT ON hourly_trend_breakout_strategy_selection_owner_decision_proposals
WHEN NOT EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_strategy_selection_receipt_verifications verification
  JOIN hourly_trend_breakout_strategy_selection_review_receipts receipt
    ON receipt.receipt_sha256 = verification.receipt_sha256
  WHERE verification.receipt_verification_sha256
      = NEW.receipt_verification_sha256
    AND verification.receipt_sha256 = NEW.receipt_sha256
    AND verification.owner_decision_at_ms = NEW.prepared_at_ms
    AND verification.current_proposal_verification_sha256
      = NEW.current_proposal_verification_sha256
    AND verification.signed_configuration_sha256
      = NEW.signed_configuration_sha256
    AND verification.signed_authorisation_sha256
      = NEW.signed_authorisation_sha256
    AND verification.authorisation_scope = NEW.authorisation_scope
    AND verification.maximum_capital_aud = NEW.maximum_capital_aud
    AND verification.receipt_status = 'verified-for-owner-decision'
    AND verification.candidate_status = 'unselected'
    AND verification.selection_decision = 'none'
    AND verification.authorisation_consumed = 0
    AND verification.activation_authority = 'none'
    AND verification.execution_authority = 'none'
    AND verification.persisted_at_ms <= NEW.persisted_at_ms
    AND receipt.proposal_sha256 = NEW.proposal_sha256
    AND receipt.disposition = 'acknowledged-for-owner-review'
)
BEGIN
  SELECT RAISE(ABORT, 'Strategy selection owner decision proposal is invalid');
END;

CREATE TRIGGER reject_strategy_selection_owner_decision_proposal_conflict
BEFORE INSERT ON hourly_trend_breakout_strategy_selection_owner_decision_proposals
WHEN EXISTS (
  SELECT 1
  FROM hourly_trend_breakout_strategy_selection_owner_decision_proposals existing
  WHERE (
      existing.decision_proposal_sha256 = NEW.decision_proposal_sha256
      OR existing.decision_proposal_id = NEW.decision_proposal_id
      OR (
        existing.receipt_sha256 = NEW.receipt_sha256
        AND existing.prepared_at_ms = NEW.prepared_at_ms
      )
    )
    AND (
      existing.decision_proposal_sha256 <> NEW.decision_proposal_sha256
      OR existing.proposal_canonical_json <> NEW.proposal_canonical_json
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Strategy selection owner decision proposal conflict');
END;

CREATE TRIGGER prevent_strategy_selection_receipt_verification_update
BEFORE UPDATE ON hourly_trend_breakout_strategy_selection_receipt_verifications
BEGIN
  SELECT RAISE(ABORT, 'Strategy selection receipt verifications are immutable');
END;

CREATE TRIGGER prevent_strategy_selection_receipt_verification_delete
BEFORE DELETE ON hourly_trend_breakout_strategy_selection_receipt_verifications
BEGIN
  SELECT RAISE(ABORT, 'Strategy selection receipt verifications are immutable');
END;

CREATE TRIGGER prevent_strategy_selection_owner_decision_proposal_update
BEFORE UPDATE ON hourly_trend_breakout_strategy_selection_owner_decision_proposals
BEGIN
  SELECT RAISE(ABORT, 'Strategy selection owner decision proposals are immutable');
END;

CREATE TRIGGER prevent_strategy_selection_owner_decision_proposal_delete
BEFORE DELETE ON hourly_trend_breakout_strategy_selection_owner_decision_proposals
BEGIN
  SELECT RAISE(ABORT, 'Strategy selection owner decision proposals are immutable');
END;
