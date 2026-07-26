CREATE TABLE kraken_lifecycle_capture_runs (
  run_sha256 TEXT PRIMARY KEY CHECK (
    length(run_sha256) = 64
    AND run_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0),
  target_count INTEGER NOT NULL CHECK (target_count >= 1),
  document_count INTEGER NOT NULL CHECK (document_count >= 1),
  CHECK (target_count = document_count)
);

CREATE TABLE kraken_lifecycle_source_documents (
  document_sha256 TEXT PRIMARY KEY CHECK (
    length(document_sha256) = 64
    AND document_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  source_class TEXT NOT NULL CHECK (
    source_class IN (
      'asset-listing',
      'delisting-notice',
      'status-incident',
      'regional-availability'
    )
  ),
  source_ref TEXT NOT NULL,
  fetched_at_ms INTEGER NOT NULL CHECK (fetched_at_ms >= 0),
  payload_sha256 TEXT NOT NULL CHECK (
    length(payload_sha256) = 64
    AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  content_type TEXT NOT NULL,
  etag TEXT,
  last_modified TEXT,
  byte_length INTEGER NOT NULL CHECK (byte_length >= 1),
  payload_text TEXT NOT NULL,
  UNIQUE (source_ref, fetched_at_ms)
);

CREATE TABLE kraken_lifecycle_capture_run_documents (
  run_sha256 TEXT NOT NULL,
  document_sha256 TEXT NOT NULL,
  PRIMARY KEY (run_sha256, document_sha256),
  FOREIGN KEY (run_sha256)
    REFERENCES kraken_lifecycle_capture_runs(run_sha256),
  FOREIGN KEY (document_sha256)
    REFERENCES kraken_lifecycle_source_documents(document_sha256)
);

CREATE TABLE kraken_lifecycle_capture_run_commits (
  run_sha256 TEXT PRIMARY KEY,
  FOREIGN KEY (run_sha256)
    REFERENCES kraken_lifecycle_capture_runs(run_sha256)
);

CREATE INDEX idx_kraken_lifecycle_documents_source_time
  ON kraken_lifecycle_source_documents(source_ref, fetched_at_ms);

CREATE INDEX idx_kraken_lifecycle_runs_recorded
  ON kraken_lifecycle_capture_runs(recorded_at_ms);

CREATE TRIGGER enforce_kraken_lifecycle_run_integer_fields
BEFORE INSERT ON kraken_lifecycle_capture_runs
WHEN typeof(NEW.recorded_at_ms) <> 'integer'
  OR typeof(NEW.target_count) <> 'integer'
  OR typeof(NEW.document_count) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'lifecycle capture run times and counts must be integers');
END;

CREATE TRIGGER enforce_kraken_lifecycle_document_integer_fields
BEFORE INSERT ON kraken_lifecycle_source_documents
WHEN typeof(NEW.fetched_at_ms) <> 'integer'
  OR typeof(NEW.byte_length) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'lifecycle document time and length must be integers');
END;

CREATE TRIGGER reject_kraken_lifecycle_run_conflict
BEFORE INSERT ON kraken_lifecycle_capture_runs
WHEN EXISTS (
  SELECT 1
  FROM kraken_lifecycle_capture_runs existing
  WHERE existing.run_sha256 = NEW.run_sha256
    AND (
      existing.recorded_at_ms <> NEW.recorded_at_ms
      OR existing.target_count <> NEW.target_count
      OR existing.document_count <> NEW.document_count
    )
)
BEGIN
  SELECT RAISE(ABORT, 'lifecycle capture run payload conflict');
END;

CREATE TRIGGER reject_kraken_lifecycle_document_conflict
BEFORE INSERT ON kraken_lifecycle_source_documents
WHEN EXISTS (
  SELECT 1
  FROM kraken_lifecycle_source_documents existing
  WHERE existing.document_sha256 = NEW.document_sha256
    AND (
      existing.source_class <> NEW.source_class
      OR existing.source_ref <> NEW.source_ref
      OR existing.fetched_at_ms <> NEW.fetched_at_ms
      OR existing.payload_sha256 <> NEW.payload_sha256
      OR existing.content_type <> NEW.content_type
      OR COALESCE(existing.etag, '') <> COALESCE(NEW.etag, '')
      OR COALESCE(existing.last_modified, '') <> COALESCE(NEW.last_modified, '')
      OR existing.byte_length <> NEW.byte_length
      OR existing.payload_text <> NEW.payload_text
    )
)
BEGIN
  SELECT RAISE(ABORT, 'lifecycle source document payload conflict');
END;

CREATE TRIGGER reject_kraken_lifecycle_document_natural_conflict
BEFORE INSERT ON kraken_lifecycle_source_documents
WHEN EXISTS (
  SELECT 1
  FROM kraken_lifecycle_source_documents existing
  WHERE existing.source_ref = NEW.source_ref
    AND existing.fetched_at_ms = NEW.fetched_at_ms
    AND existing.document_sha256 <> NEW.document_sha256
)
BEGIN
  SELECT RAISE(ABORT, 'lifecycle source document natural identity conflict');
END;

CREATE TRIGGER enforce_kraken_lifecycle_run_membership
BEFORE INSERT ON kraken_lifecycle_capture_run_documents
WHEN NOT EXISTS (
  SELECT 1
  FROM kraken_lifecycle_source_documents document
  JOIN kraken_lifecycle_capture_runs run
    ON run.run_sha256 = NEW.run_sha256
  WHERE document.document_sha256 = NEW.document_sha256
    AND document.fetched_at_ms <= run.recorded_at_ms
)
BEGIN
  SELECT RAISE(ABORT, 'invalid lifecycle capture run membership');
END;

CREATE TRIGGER enforce_kraken_lifecycle_run_completion
BEFORE INSERT ON kraken_lifecycle_capture_run_commits
WHEN NOT EXISTS (
    SELECT 1
    FROM kraken_lifecycle_capture_runs
    WHERE run_sha256 = NEW.run_sha256
  )
  OR (
    SELECT COUNT(*)
    FROM kraken_lifecycle_capture_run_documents
    WHERE run_sha256 = NEW.run_sha256
  ) <> (
    SELECT document_count
    FROM kraken_lifecycle_capture_runs
    WHERE run_sha256 = NEW.run_sha256
  )
BEGIN
  SELECT RAISE(ABORT, 'lifecycle capture run is incomplete');
END;

CREATE TRIGGER prevent_kraken_lifecycle_run_update
BEFORE UPDATE ON kraken_lifecycle_capture_runs
BEGIN
  SELECT RAISE(ABORT, 'lifecycle capture runs are immutable');
END;

CREATE TRIGGER prevent_kraken_lifecycle_run_delete
BEFORE DELETE ON kraken_lifecycle_capture_runs
BEGIN
  SELECT RAISE(ABORT, 'lifecycle capture runs are immutable');
END;

CREATE TRIGGER prevent_kraken_lifecycle_document_update
BEFORE UPDATE ON kraken_lifecycle_source_documents
BEGIN
  SELECT RAISE(ABORT, 'lifecycle source documents are immutable');
END;

CREATE TRIGGER prevent_kraken_lifecycle_document_delete
BEFORE DELETE ON kraken_lifecycle_source_documents
BEGIN
  SELECT RAISE(ABORT, 'lifecycle source documents are immutable');
END;

CREATE TRIGGER prevent_kraken_lifecycle_membership_update
BEFORE UPDATE ON kraken_lifecycle_capture_run_documents
BEGIN
  SELECT RAISE(ABORT, 'lifecycle capture memberships are immutable');
END;

CREATE TRIGGER prevent_kraken_lifecycle_membership_delete
BEFORE DELETE ON kraken_lifecycle_capture_run_documents
BEGIN
  SELECT RAISE(ABORT, 'lifecycle capture memberships are immutable');
END;

CREATE TRIGGER prevent_kraken_lifecycle_commit_update
BEFORE UPDATE ON kraken_lifecycle_capture_run_commits
BEGIN
  SELECT RAISE(ABORT, 'lifecycle capture commit markers are immutable');
END;

CREATE TRIGGER prevent_kraken_lifecycle_commit_delete
BEFORE DELETE ON kraken_lifecycle_capture_run_commits
BEGIN
  SELECT RAISE(ABORT, 'lifecycle capture commit markers are immutable');
END;
