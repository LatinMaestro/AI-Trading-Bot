CREATE TABLE signed_universe_policies (
  signed_policy_sha256 TEXT PRIMARY KEY CHECK (
    length(signed_policy_sha256) = 64
    AND signed_policy_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  policy_version TEXT NOT NULL UNIQUE CHECK (
    length(policy_version) BETWEEN 3 AND 64
    AND policy_version = trim(policy_version)
  ),
  signed_payload_sha256 TEXT NOT NULL CHECK (
    length(signed_payload_sha256) = 64
    AND signed_payload_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  verification_key_sha256 TEXT NOT NULL CHECK (
    length(verification_key_sha256) = 64
    AND verification_key_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  signer_key_id TEXT NOT NULL CHECK (
    length(signer_key_id) BETWEEN 3 AND 128
    AND signer_key_id = trim(signer_key_id)
  ),
  approved_at_ms INTEGER NOT NULL CHECK (approved_at_ms >= 0),
  effective_from_ms INTEGER NOT NULL CHECK (
    effective_from_ms >= approved_at_ms
  ),
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > effective_from_ms),
  policy_json TEXT NOT NULL CHECK (json_valid(policy_json)),
  calibration_sha256s_json TEXT NOT NULL CHECK (
    json_valid(calibration_sha256s_json)
    AND json_type(calibration_sha256s_json) = 'array'
    AND json_array_length(calibration_sha256s_json) BETWEEN 1 AND 100
  ),
  verification_key_jwk_json TEXT NOT NULL CHECK (
    json_valid(verification_key_jwk_json)
    AND json_extract(verification_key_jwk_json, '$.kty') = 'EC'
    AND json_extract(verification_key_jwk_json, '$.crv') = 'P-256'
  ),
  signature_hex TEXT NOT NULL CHECK (
    length(signature_hex) = 128
    AND signature_hex NOT GLOB '*[^0-9a-f]*'
  )
);

CREATE TABLE universe_policy_snapshots (
  snapshot_sha256 TEXT PRIMARY KEY CHECK (
    length(snapshot_sha256) = 64
    AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  signed_policy_sha256 TEXT NOT NULL REFERENCES
    signed_universe_policies(signed_policy_sha256),
  ingestion_batch_sha256 TEXT NOT NULL REFERENCES
    universe_ingestion_batch_commits(batch_sha256),
  as_of_ms INTEGER NOT NULL CHECK (as_of_ms >= 0),
  snapshot_json TEXT NOT NULL CHECK (
    json_valid(snapshot_json)
    AND json_extract(snapshot_json, '$.asOfMs') = as_of_ms
  ),
  source_digests_json TEXT NOT NULL CHECK (
    json_valid(source_digests_json)
    AND json_type(source_digests_json) = 'array'
    AND json_array_length(source_digests_json) >= 1
  ),
  candidate_count INTEGER NOT NULL CHECK (
    candidate_count >= 0
    AND candidate_count
      = json_array_length(json_extract(snapshot_json, '$.candidates'))
  ),
  eligible_pair_count INTEGER NOT NULL CHECK (
    eligible_pair_count >= 0
    AND eligible_pair_count
      = json_array_length(json_extract(snapshot_json, '$.eligiblePairs'))
    AND eligible_pair_count <= candidate_count
  ),
  persisted_at_ms INTEGER NOT NULL CHECK (persisted_at_ms >= as_of_ms)
);

CREATE INDEX idx_universe_policy_snapshots_as_of
  ON universe_policy_snapshots(as_of_ms);
CREATE INDEX idx_universe_policy_snapshots_policy
  ON universe_policy_snapshots(signed_policy_sha256, as_of_ms);

CREATE TRIGGER enforce_universe_policy_snapshot_evidence
BEFORE INSERT ON universe_policy_snapshots
WHEN NOT EXISTS (
    SELECT 1
    FROM universe_ingestion_batch_commits
    WHERE batch_sha256 = NEW.ingestion_batch_sha256
  )
  OR json_array_length(NEW.source_digests_json) <> (
    SELECT COUNT(*)
    FROM universe_ingestion_batch_sources
    WHERE batch_sha256 = NEW.ingestion_batch_sha256
  )
  OR EXISTS (
    SELECT 1
    FROM json_each(NEW.source_digests_json) requested
    WHERE NOT EXISTS (
      SELECT 1
      FROM universe_ingestion_batch_sources committed
      WHERE committed.batch_sha256 = NEW.ingestion_batch_sha256
        AND committed.source_digest = CAST(requested.value AS TEXT)
    )
  )
BEGIN
  SELECT RAISE(
    ABORT,
    'Universe policy snapshot evidence is not exactly committed'
  );
END;

CREATE TRIGGER reject_signed_universe_policy_conflict
BEFORE INSERT ON signed_universe_policies
WHEN EXISTS (
  SELECT 1
  FROM signed_universe_policies existing
  WHERE existing.signed_policy_sha256 = NEW.signed_policy_sha256
    AND (
      existing.policy_version <> NEW.policy_version
      OR existing.signed_payload_sha256 <> NEW.signed_payload_sha256
      OR existing.verification_key_sha256 <> NEW.verification_key_sha256
      OR existing.signer_key_id <> NEW.signer_key_id
      OR existing.approved_at_ms <> NEW.approved_at_ms
      OR existing.effective_from_ms <> NEW.effective_from_ms
      OR existing.expires_at_ms <> NEW.expires_at_ms
      OR existing.policy_json <> NEW.policy_json
      OR existing.calibration_sha256s_json
        <> NEW.calibration_sha256s_json
      OR existing.verification_key_jwk_json
        <> NEW.verification_key_jwk_json
      OR existing.signature_hex <> NEW.signature_hex
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Signed universe policy conflict');
END;

CREATE TRIGGER reject_universe_policy_snapshot_conflict
BEFORE INSERT ON universe_policy_snapshots
WHEN EXISTS (
  SELECT 1
  FROM universe_policy_snapshots existing
  WHERE existing.snapshot_sha256 = NEW.snapshot_sha256
    AND (
      existing.signed_policy_sha256 <> NEW.signed_policy_sha256
      OR existing.ingestion_batch_sha256 <> NEW.ingestion_batch_sha256
      OR existing.as_of_ms <> NEW.as_of_ms
      OR existing.snapshot_json <> NEW.snapshot_json
      OR existing.source_digests_json <> NEW.source_digests_json
      OR existing.candidate_count <> NEW.candidate_count
      OR existing.eligible_pair_count <> NEW.eligible_pair_count
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Universe policy snapshot conflict');
END;

CREATE TRIGGER prevent_signed_universe_policy_update
BEFORE UPDATE ON signed_universe_policies
BEGIN
  SELECT RAISE(ABORT, 'Signed universe policies are immutable');
END;

CREATE TRIGGER prevent_signed_universe_policy_delete
BEFORE DELETE ON signed_universe_policies
BEGIN
  SELECT RAISE(ABORT, 'Signed universe policies are immutable');
END;

CREATE TRIGGER prevent_universe_policy_snapshot_update
BEFORE UPDATE ON universe_policy_snapshots
BEGIN
  SELECT RAISE(ABORT, 'Universe policy snapshots are immutable');
END;

CREATE TRIGGER prevent_universe_policy_snapshot_delete
BEFORE DELETE ON universe_policy_snapshots
BEGIN
  SELECT RAISE(ABORT, 'Universe policy snapshots are immutable');
END;
