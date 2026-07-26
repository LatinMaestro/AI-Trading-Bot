CREATE TABLE kraken_lifecycle_source_payloads (
  payload_sha256 TEXT PRIMARY KEY CHECK (
    length(payload_sha256) = 64
    AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  payload_byte_length INTEGER NOT NULL CHECK (
    payload_byte_length >= 1
    AND payload_byte_length <= 1048576
  ),
  payload_text TEXT NOT NULL CHECK (
    length(payload_text) >= 1
    AND payload_byte_length = length(CAST(payload_text AS BLOB))
  )
);

CREATE TABLE kraken_lifecycle_source_captures (
  capture_id TEXT PRIMARY KEY CHECK (
    length(capture_id) = 64
    AND capture_id NOT GLOB '*[^0-9a-f]*'
  ),
  source_kind TEXT NOT NULL CHECK (
    source_kind IN (
      'asset-listings-index',
      'delistings-index',
      'status-incidents',
      'status-maintenance'
    )
  ),
  source_ref TEXT NOT NULL CHECK (
    (source_kind = 'asset-listings-index'
      AND source_ref = 'https://blog.kraken.com/category/product/asset-listings')
    OR (source_kind = 'delistings-index'
      AND source_ref = 'https://support.kraken.com/sections/delistings')
    OR (source_kind = 'status-incidents'
      AND source_ref = 'https://status.kraken.com/api/v2/incidents.json')
    OR (source_kind = 'status-maintenance'
      AND source_ref = 'https://status.kraken.com/api/v2/scheduled-maintenances.json')
  ),
  fetched_at_ms INTEGER NOT NULL CHECK (fetched_at_ms >= 0),
  payload_sha256 TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (
    (source_kind IN ('asset-listings-index', 'delistings-index')
      AND content_type = 'text/html')
    OR (source_kind IN ('status-incidents', 'status-maintenance')
      AND content_type = 'application/json')
  ),
  etag TEXT CHECK (etag IS NULL OR length(etag) BETWEEN 1 AND 500),
  last_modified TEXT CHECK (
    last_modified IS NULL OR length(last_modified) BETWEEN 1 AND 500
  ),
  UNIQUE (source_ref, fetched_at_ms),
  FOREIGN KEY (payload_sha256)
    REFERENCES kraken_lifecycle_source_payloads(payload_sha256)
);

CREATE TABLE kraken_lifecycle_source_capture_commits (
  capture_id TEXT PRIMARY KEY,
  committed_at_ms INTEGER NOT NULL CHECK (committed_at_ms >= 0),
  FOREIGN KEY (capture_id)
    REFERENCES kraken_lifecycle_source_captures(capture_id)
);

CREATE INDEX idx_kraken_lifecycle_captures_source_time
  ON kraken_lifecycle_source_captures(source_kind, fetched_at_ms);

CREATE INDEX idx_kraken_lifecycle_captures_payload
  ON kraken_lifecycle_source_captures(payload_sha256);

CREATE TRIGGER enforce_kraken_lifecycle_payload_integer_fields
BEFORE INSERT ON kraken_lifecycle_source_payloads
WHEN typeof(NEW.payload_byte_length) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle payload lengths must be integers');
END;

CREATE TRIGGER reject_kraken_lifecycle_payload_conflict
BEFORE INSERT ON kraken_lifecycle_source_payloads
WHEN EXISTS (
  SELECT 1
  FROM kraken_lifecycle_source_payloads existing
  WHERE existing.payload_sha256 = NEW.payload_sha256
    AND (
      existing.payload_byte_length <> NEW.payload_byte_length
      OR existing.payload_text <> NEW.payload_text
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle source payload conflict');
END;

CREATE TRIGGER enforce_kraken_lifecycle_capture_integer_fields
BEFORE INSERT ON kraken_lifecycle_source_captures
WHEN typeof(NEW.fetched_at_ms) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle capture times must be integers');
END;

CREATE TRIGGER reject_kraken_lifecycle_capture_conflict
BEFORE INSERT ON kraken_lifecycle_source_captures
WHEN EXISTS (
  SELECT 1
  FROM kraken_lifecycle_source_captures existing
  WHERE existing.capture_id = NEW.capture_id
    AND (
      existing.source_kind <> NEW.source_kind
      OR existing.source_ref <> NEW.source_ref
      OR existing.fetched_at_ms <> NEW.fetched_at_ms
      OR existing.payload_sha256 <> NEW.payload_sha256
      OR existing.content_type <> NEW.content_type
      OR COALESCE(existing.etag, '') <> COALESCE(NEW.etag, '')
      OR COALESCE(existing.last_modified, '') <> COALESCE(NEW.last_modified, '')
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle capture payload conflict');
END;

CREATE TRIGGER reject_kraken_lifecycle_capture_natural_identity_conflict
BEFORE INSERT ON kraken_lifecycle_source_captures
WHEN EXISTS (
  SELECT 1
  FROM kraken_lifecycle_source_captures existing
  WHERE existing.source_ref = NEW.source_ref
    AND existing.fetched_at_ms = NEW.fetched_at_ms
    AND existing.capture_id <> NEW.capture_id
)
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle capture natural identity conflict');
END;

CREATE TRIGGER enforce_kraken_lifecycle_capture_completion
BEFORE INSERT ON kraken_lifecycle_source_capture_commits
WHEN typeof(NEW.committed_at_ms) <> 'integer'
  OR NOT EXISTS (
    SELECT 1
    FROM kraken_lifecycle_source_captures capture
    JOIN kraken_lifecycle_source_payloads payload
      ON payload.payload_sha256 = capture.payload_sha256
    WHERE capture.capture_id = NEW.capture_id
  )
  OR NEW.committed_at_ms < COALESCE((
    SELECT fetched_at_ms
    FROM kraken_lifecycle_source_captures
    WHERE capture_id = NEW.capture_id
  ), NEW.committed_at_ms + 1)
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle capture is incomplete');
END;

CREATE TRIGGER prevent_kraken_lifecycle_payload_update
BEFORE UPDATE ON kraken_lifecycle_source_payloads
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle source payloads are immutable');
END;

CREATE TRIGGER prevent_kraken_lifecycle_payload_delete
BEFORE DELETE ON kraken_lifecycle_source_payloads
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle source payloads are immutable');
END;

CREATE TRIGGER prevent_kraken_lifecycle_capture_update
BEFORE UPDATE ON kraken_lifecycle_source_captures
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle source captures are immutable');
END;

CREATE TRIGGER prevent_kraken_lifecycle_capture_delete
BEFORE DELETE ON kraken_lifecycle_source_captures
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle source captures are immutable');
END;

CREATE TRIGGER prevent_kraken_lifecycle_commit_update
BEFORE UPDATE ON kraken_lifecycle_source_capture_commits
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle source capture commits are immutable');
END;

CREATE TRIGGER prevent_kraken_lifecycle_commit_delete
BEFORE DELETE ON kraken_lifecycle_source_capture_commits
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle source capture commits are immutable');
END;
