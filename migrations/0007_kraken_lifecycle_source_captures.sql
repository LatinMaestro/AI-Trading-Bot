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
  source_ref TEXT NOT NULL,
  fetched_at_ms INTEGER NOT NULL CHECK (fetched_at_ms >= 0),
  payload_sha256 TEXT NOT NULL CHECK (
    length(payload_sha256) = 64
    AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  payload_byte_length INTEGER NOT NULL CHECK (
    payload_byte_length >= 1
    AND payload_byte_length <= 1048576
  ),
  chunk_count INTEGER NOT NULL CHECK (
    chunk_count >= 1
    AND chunk_count <= 64
  ),
  content_type TEXT NOT NULL,
  etag TEXT,
  last_modified TEXT,
  UNIQUE (source_ref, fetched_at_ms)
);

CREATE TABLE kraken_lifecycle_source_capture_chunks (
  capture_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  chunk_sha256 TEXT NOT NULL CHECK (
    length(chunk_sha256) = 64
    AND chunk_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  chunk_byte_length INTEGER NOT NULL CHECK (
    chunk_byte_length >= 1
    AND chunk_byte_length <= 32768
  ),
  chunk_text TEXT NOT NULL,
  PRIMARY KEY (capture_id, chunk_index),
  FOREIGN KEY (capture_id)
    REFERENCES kraken_lifecycle_source_captures(capture_id)
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

CREATE TRIGGER enforce_kraken_lifecycle_capture_integer_fields
BEFORE INSERT ON kraken_lifecycle_source_captures
WHEN typeof(NEW.fetched_at_ms) <> 'integer'
  OR typeof(NEW.payload_byte_length) <> 'integer'
  OR typeof(NEW.chunk_count) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle capture times, lengths and counts must be integers');
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
      OR existing.payload_byte_length <> NEW.payload_byte_length
      OR existing.chunk_count <> NEW.chunk_count
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

CREATE TRIGGER enforce_kraken_lifecycle_chunk_integer_fields
BEFORE INSERT ON kraken_lifecycle_source_capture_chunks
WHEN typeof(NEW.chunk_index) <> 'integer'
  OR typeof(NEW.chunk_byte_length) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle chunk index and length must be integers');
END;

CREATE TRIGGER reject_kraken_lifecycle_chunk_conflict
BEFORE INSERT ON kraken_lifecycle_source_capture_chunks
WHEN EXISTS (
  SELECT 1
  FROM kraken_lifecycle_source_capture_chunks existing
  WHERE existing.capture_id = NEW.capture_id
    AND existing.chunk_index = NEW.chunk_index
    AND (
      existing.chunk_sha256 <> NEW.chunk_sha256
      OR existing.chunk_byte_length <> NEW.chunk_byte_length
      OR existing.chunk_text <> NEW.chunk_text
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle capture chunk conflict');
END;

CREATE TRIGGER enforce_kraken_lifecycle_capture_completion
BEFORE INSERT ON kraken_lifecycle_source_capture_commits
WHEN NOT EXISTS (
    SELECT 1
    FROM kraken_lifecycle_source_captures
    WHERE capture_id = NEW.capture_id
  )
  OR (
    SELECT COUNT(*)
    FROM kraken_lifecycle_source_capture_chunks
    WHERE capture_id = NEW.capture_id
  ) <> (
    SELECT chunk_count
    FROM kraken_lifecycle_source_captures
    WHERE capture_id = NEW.capture_id
  )
  OR (
    SELECT COALESCE(SUM(chunk_byte_length), 0)
    FROM kraken_lifecycle_source_capture_chunks
    WHERE capture_id = NEW.capture_id
  ) <> (
    SELECT payload_byte_length
    FROM kraken_lifecycle_source_captures
    WHERE capture_id = NEW.capture_id
  )
  OR EXISTS (
    SELECT 1
    FROM kraken_lifecycle_source_capture_chunks chunk
    JOIN kraken_lifecycle_source_captures capture
      ON capture.capture_id = chunk.capture_id
    WHERE chunk.capture_id = NEW.capture_id
      AND chunk.chunk_index >= capture.chunk_count
  )
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle capture is incomplete');
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

CREATE TRIGGER prevent_kraken_lifecycle_chunk_update
BEFORE UPDATE ON kraken_lifecycle_source_capture_chunks
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle source capture chunks are immutable');
END;

CREATE TRIGGER prevent_kraken_lifecycle_chunk_delete
BEFORE DELETE ON kraken_lifecycle_source_capture_chunks
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle source capture chunks are immutable');
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