CREATE TABLE strategy_signer_trust_anchors (
  trust_anchor_sha256 TEXT PRIMARY KEY CHECK (
    length(trust_anchor_sha256) = 64
    AND trust_anchor_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (
    schema_version = 'strategy-signer-trust-anchor-v1'
  ),
  trust_anchor_id TEXT NOT NULL UNIQUE,
  signer_role TEXT NOT NULL CHECK (
    signer_role IN (
      'strategy-configuration-signer',
      'external-strategy-authoriser'
    )
  ),
  key_id TEXT NOT NULL UNIQUE,
  verification_key_sha256 TEXT NOT NULL UNIQUE CHECK (
    length(verification_key_sha256) = 64
    AND verification_key_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  review_evidence_sha256 TEXT NOT NULL CHECK (
    length(review_evidence_sha256) = 64
    AND review_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  reviewed_at_ms INTEGER NOT NULL CHECK (reviewed_at_ms >= 0),
  valid_from_ms INTEGER NOT NULL CHECK (
    valid_from_ms >= reviewed_at_ms
  ),
  valid_until_ms INTEGER NOT NULL CHECK (
    valid_until_ms > valid_from_ms
    AND valid_until_ms - valid_from_ms <= 31622400000
  ),
  predecessor_trust_anchor_sha256 TEXT REFERENCES
    strategy_signer_trust_anchors(trust_anchor_sha256),
  execution_authority TEXT NOT NULL CHECK (execution_authority = 'none'),
  trust_anchor_canonical_json TEXT NOT NULL CHECK (
    json_valid(trust_anchor_canonical_json)
    AND json_extract(
      trust_anchor_canonical_json,
      '$.trustAnchorSha256'
    ) = trust_anchor_sha256
    AND json_extract(
      trust_anchor_canonical_json,
      '$.trustAnchorId'
    ) = trust_anchor_id
    AND json_extract(trust_anchor_canonical_json, '$.role') = signer_role
    AND json_extract(trust_anchor_canonical_json, '$.keyId') = key_id
    AND json_extract(
      trust_anchor_canonical_json,
      '$.verificationKeySha256'
    ) = verification_key_sha256
    AND json_extract(
      trust_anchor_canonical_json,
      '$.reviewEvidenceSha256'
    ) = review_evidence_sha256
    AND json_extract(trust_anchor_canonical_json, '$.reviewedAtMs')
      = reviewed_at_ms
    AND json_extract(trust_anchor_canonical_json, '$.validFromMs')
      = valid_from_ms
    AND json_extract(trust_anchor_canonical_json, '$.validUntilMs')
      = valid_until_ms
    AND json_extract(
      trust_anchor_canonical_json,
      '$.predecessorTrustAnchorSha256'
    ) IS predecessor_trust_anchor_sha256
    AND json_extract(
      trust_anchor_canonical_json,
      '$.executionAuthority'
    ) = execution_authority
  ),
  persisted_at_ms INTEGER NOT NULL CHECK (
    persisted_at_ms >= reviewed_at_ms
  )
);

CREATE TABLE strategy_signer_trust_revocations (
  revocation_sha256 TEXT PRIMARY KEY CHECK (
    length(revocation_sha256) = 64
    AND revocation_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (
    schema_version = 'strategy-signer-trust-revocation-v1'
  ),
  revocation_id TEXT NOT NULL UNIQUE,
  trust_anchor_sha256 TEXT NOT NULL UNIQUE REFERENCES
    strategy_signer_trust_anchors(trust_anchor_sha256),
  revocation_reason TEXT NOT NULL CHECK (
    revocation_reason IN (
      'suspected-compromise',
      'planned-rotation',
      'review-withdrawn',
      'key-retired',
      'other-security-event'
    )
  ),
  effective_at_ms INTEGER NOT NULL CHECK (effective_at_ms >= 0),
  reviewed_at_ms INTEGER NOT NULL CHECK (reviewed_at_ms >= 0),
  review_evidence_sha256 TEXT NOT NULL CHECK (
    length(review_evidence_sha256) = 64
    AND review_evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  execution_authority TEXT NOT NULL CHECK (execution_authority = 'none'),
  revocation_canonical_json TEXT NOT NULL CHECK (
    json_valid(revocation_canonical_json)
    AND json_extract(
      revocation_canonical_json,
      '$.revocationSha256'
    ) = revocation_sha256
    AND json_extract(
      revocation_canonical_json,
      '$.revocationId'
    ) = revocation_id
    AND json_extract(
      revocation_canonical_json,
      '$.trustAnchorSha256'
    ) = trust_anchor_sha256
    AND json_extract(
      revocation_canonical_json,
      '$.reason'
    ) = revocation_reason
    AND json_extract(revocation_canonical_json, '$.effectiveAtMs')
      = effective_at_ms
    AND json_extract(revocation_canonical_json, '$.reviewedAtMs')
      = reviewed_at_ms
    AND json_extract(
      revocation_canonical_json,
      '$.reviewEvidenceSha256'
    ) = review_evidence_sha256
    AND json_extract(
      revocation_canonical_json,
      '$.executionAuthority'
    ) = execution_authority
  ),
  persisted_at_ms INTEGER NOT NULL CHECK (
    persisted_at_ms >= reviewed_at_ms
  )
);

ALTER TABLE hourly_trend_breakout_signed_configurations
  ADD COLUMN signer_trust_anchor_sha256 TEXT REFERENCES
    strategy_signer_trust_anchors(trust_anchor_sha256);

ALTER TABLE hourly_trend_breakout_strategy_authorisations
  ADD COLUMN authoriser_trust_anchor_sha256 TEXT REFERENCES
    strategy_signer_trust_anchors(trust_anchor_sha256);

CREATE TRIGGER validate_strategy_signer_trust_predecessor
BEFORE INSERT ON strategy_signer_trust_anchors
WHEN NEW.predecessor_trust_anchor_sha256 IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM strategy_signer_trust_anchors predecessor
    WHERE predecessor.trust_anchor_sha256
        = NEW.predecessor_trust_anchor_sha256
      AND predecessor.signer_role = NEW.signer_role
      AND predecessor.persisted_at_ms <= NEW.persisted_at_ms
      AND predecessor.valid_from_ms < NEW.valid_from_ms
      AND predecessor.trust_anchor_sha256 <> NEW.trust_anchor_sha256
  )
BEGIN
  SELECT RAISE(ABORT, 'Strategy signer trust predecessor is invalid');
END;

CREATE TRIGGER validate_strategy_signer_trust_revocation
BEFORE INSERT ON strategy_signer_trust_revocations
WHEN NOT EXISTS (
  SELECT 1
  FROM strategy_signer_trust_anchors anchor
  WHERE anchor.trust_anchor_sha256 = NEW.trust_anchor_sha256
    AND anchor.persisted_at_ms <= NEW.persisted_at_ms
    AND anchor.valid_from_ms <= NEW.effective_at_ms
    AND anchor.valid_until_ms > NEW.effective_at_ms
    AND anchor.reviewed_at_ms <= NEW.reviewed_at_ms
)
BEGIN
  SELECT RAISE(ABORT, 'Strategy signer trust revocation is invalid');
END;

CREATE TRIGGER validate_signed_configuration_signer_trust
BEFORE INSERT ON hourly_trend_breakout_signed_configurations
WHEN NOT EXISTS (
  SELECT 1
  FROM strategy_signer_trust_anchors anchor
  WHERE anchor.trust_anchor_sha256 = NEW.signer_trust_anchor_sha256
    AND anchor.signer_role = 'strategy-configuration-signer'
    AND anchor.key_id = NEW.signer_key_id
    AND anchor.verification_key_sha256 = NEW.verification_key_sha256
    AND anchor.persisted_at_ms <= NEW.persisted_at_ms
    AND anchor.valid_from_ms <= NEW.issued_at_ms
    AND anchor.valid_until_ms > NEW.persisted_at_ms
    AND NOT EXISTS (
      SELECT 1
      FROM strategy_signer_trust_revocations revocation
      WHERE revocation.trust_anchor_sha256 = anchor.trust_anchor_sha256
        AND revocation.persisted_at_ms <= NEW.persisted_at_ms
        AND revocation.reviewed_at_ms <= NEW.persisted_at_ms
        AND revocation.effective_at_ms <= NEW.persisted_at_ms
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Signed configuration signer trust is invalid');
END;

CREATE TRIGGER validate_strategy_authorisation_signer_trust
BEFORE INSERT ON hourly_trend_breakout_strategy_authorisations
WHEN NOT EXISTS (
  SELECT 1
  FROM strategy_signer_trust_anchors anchor
  WHERE anchor.trust_anchor_sha256
      = NEW.authoriser_trust_anchor_sha256
    AND anchor.signer_role = 'external-strategy-authoriser'
    AND anchor.key_id = NEW.authoriser_key_id
    AND anchor.verification_key_sha256 = NEW.verification_key_sha256
    AND anchor.persisted_at_ms <= NEW.persisted_at_ms
    AND anchor.valid_from_ms <= NEW.reviewed_at_ms
    AND anchor.valid_until_ms > NEW.persisted_at_ms
    AND NOT EXISTS (
      SELECT 1
      FROM strategy_signer_trust_revocations revocation
      WHERE revocation.trust_anchor_sha256 = anchor.trust_anchor_sha256
        AND revocation.persisted_at_ms <= NEW.persisted_at_ms
        AND revocation.reviewed_at_ms <= NEW.persisted_at_ms
        AND revocation.effective_at_ms <= NEW.persisted_at_ms
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Strategy authorisation signer trust is invalid');
END;

CREATE TRIGGER reject_strategy_signer_trust_anchor_conflict
BEFORE INSERT ON strategy_signer_trust_anchors
WHEN EXISTS (
  SELECT 1
  FROM strategy_signer_trust_anchors existing
  WHERE existing.trust_anchor_sha256 = NEW.trust_anchor_sha256
    AND existing.trust_anchor_canonical_json
      <> NEW.trust_anchor_canonical_json
)
BEGIN
  SELECT RAISE(ABORT, 'Strategy signer trust anchor conflict');
END;

CREATE TRIGGER reject_strategy_signer_trust_anchor_identity_reuse
BEFORE INSERT ON strategy_signer_trust_anchors
WHEN EXISTS (
  SELECT 1
  FROM strategy_signer_trust_anchors existing
  WHERE (
      existing.trust_anchor_id = NEW.trust_anchor_id
      OR existing.key_id = NEW.key_id
    )
    AND existing.trust_anchor_sha256 <> NEW.trust_anchor_sha256
)
BEGIN
  SELECT RAISE(ABORT, 'Strategy signer trust anchor identity conflict');
END;

CREATE TRIGGER reject_strategy_signer_trust_revocation_conflict
BEFORE INSERT ON strategy_signer_trust_revocations
WHEN EXISTS (
  SELECT 1
  FROM strategy_signer_trust_revocations existing
  WHERE existing.revocation_sha256 = NEW.revocation_sha256
    AND existing.revocation_canonical_json
      <> NEW.revocation_canonical_json
)
BEGIN
  SELECT RAISE(ABORT, 'Strategy signer trust revocation conflict');
END;

CREATE TRIGGER reject_strategy_signer_trust_revocation_identity_reuse
BEFORE INSERT ON strategy_signer_trust_revocations
WHEN EXISTS (
  SELECT 1
  FROM strategy_signer_trust_revocations existing
  WHERE (
      existing.revocation_id = NEW.revocation_id
      OR existing.trust_anchor_sha256 = NEW.trust_anchor_sha256
    )
    AND existing.revocation_sha256 <> NEW.revocation_sha256
)
BEGIN
  SELECT RAISE(ABORT, 'Strategy signer trust revocation identity conflict');
END;

CREATE TRIGGER reject_strategy_signer_key_alias
BEFORE INSERT ON strategy_signer_trust_anchors
WHEN EXISTS (
  SELECT 1
  FROM strategy_signer_trust_anchors existing
  WHERE existing.verification_key_sha256 = NEW.verification_key_sha256
    AND existing.key_id <> NEW.key_id
)
BEGIN
  SELECT RAISE(ABORT, 'Strategy signer key alias is invalid');
END;

CREATE TRIGGER prevent_strategy_signer_trust_anchor_update
BEFORE UPDATE ON strategy_signer_trust_anchors
BEGIN
  SELECT RAISE(ABORT, 'Strategy signer trust anchors are immutable');
END;

CREATE TRIGGER prevent_strategy_signer_trust_anchor_delete
BEFORE DELETE ON strategy_signer_trust_anchors
BEGIN
  SELECT RAISE(ABORT, 'Strategy signer trust anchors are immutable');
END;

CREATE TRIGGER prevent_strategy_signer_trust_revocation_update
BEFORE UPDATE ON strategy_signer_trust_revocations
BEGIN
  SELECT RAISE(ABORT, 'Strategy signer trust revocations are immutable');
END;

CREATE TRIGGER prevent_strategy_signer_trust_revocation_delete
BEFORE DELETE ON strategy_signer_trust_revocations
BEGIN
  SELECT RAISE(ABORT, 'Strategy signer trust revocations are immutable');
END;
