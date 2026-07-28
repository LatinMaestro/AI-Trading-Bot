CREATE TABLE kraken_lifecycle_document_captures (
  capture_id TEXT PRIMARY KEY CHECK (
    length(capture_id) = 64
    AND capture_id NOT GLOB '*[^0-9a-f]*'
  ),
  source_kind TEXT NOT NULL CHECK (
    source_kind IN (
      'asset-listing-document',
      'asset-listings-index-page',
      'support-lifecycle-document'
    )
  ),
  source_ref TEXT NOT NULL CHECK (
    length(source_ref) BETWEEN 1 AND 500
    AND source_ref = trim(source_ref)
    AND instr(source_ref, '?') = 0
    AND instr(source_ref, '#') = 0
    AND instr(source_ref, '%') = 0
    AND instr(source_ref, '\') = 0
    AND (
      (source_kind = 'asset-listing-document'
        AND source_ref GLOB
          'https://blog.kraken.com/product/asset-listings/[a-z0-9]*')
      OR (source_kind = 'asset-listings-index-page'
        AND (
          source_ref GLOB
            'https://blog.kraken.com/category/product/asset-listings/page/[2-9]'
          OR source_ref GLOB
            'https://blog.kraken.com/category/product/asset-listings/page/[1-9][0-9]'
          OR source_ref GLOB
            'https://blog.kraken.com/category/product/asset-listings/page/[1-4][0-9][0-9]'
          OR source_ref =
            'https://blog.kraken.com/category/product/asset-listings/page/500'
        ))
      OR (source_kind = 'support-lifecycle-document'
        AND source_ref GLOB 'https://support.kraken.com/articles/*')
    )
  ),
  discovered_from_capture_id TEXT NOT NULL CHECK (
    length(discovered_from_capture_id) = 64
    AND discovered_from_capture_id NOT GLOB '*[^0-9a-f]*'
  ),
  discovered_from_payload_sha256 TEXT NOT NULL CHECK (
    length(discovered_from_payload_sha256) = 64
    AND discovered_from_payload_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  discovery_sha256 TEXT NOT NULL CHECK (
    length(discovery_sha256) = 64
    AND discovery_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  fetched_at_ms INTEGER NOT NULL CHECK (fetched_at_ms >= 0),
  payload_sha256 TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type = 'text/html'),
  etag TEXT CHECK (etag IS NULL OR length(etag) BETWEEN 1 AND 500),
  last_modified TEXT CHECK (
    last_modified IS NULL OR length(last_modified) BETWEEN 1 AND 500
  ),
  UNIQUE (source_ref, fetched_at_ms),
  FOREIGN KEY (discovered_from_payload_sha256)
    REFERENCES kraken_lifecycle_source_payloads(payload_sha256),
  FOREIGN KEY (payload_sha256)
    REFERENCES kraken_lifecycle_source_payloads(payload_sha256)
);

CREATE TABLE kraken_lifecycle_document_capture_commits (
  capture_id TEXT PRIMARY KEY,
  committed_at_ms INTEGER NOT NULL CHECK (committed_at_ms >= 0),
  FOREIGN KEY (capture_id)
    REFERENCES kraken_lifecycle_document_captures(capture_id)
);

CREATE INDEX idx_kraken_lifecycle_document_captures_source_time
  ON kraken_lifecycle_document_captures(source_kind, fetched_at_ms);

CREATE INDEX idx_kraken_lifecycle_document_captures_discovery
  ON kraken_lifecycle_document_captures(discovery_sha256);

CREATE TRIGGER enforce_kraken_lifecycle_document_capture_integer_fields
BEFORE INSERT ON kraken_lifecycle_document_captures
WHEN typeof(NEW.fetched_at_ms) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle document capture times must be integers');
END;

CREATE TRIGGER enforce_kraken_lifecycle_document_discovery_provenance
BEFORE INSERT ON kraken_lifecycle_document_captures
WHEN NOT (
  EXISTS (
    SELECT 1
    FROM kraken_lifecycle_source_captures source
    JOIN kraken_lifecycle_source_capture_commits committed
      ON committed.capture_id = source.capture_id
    WHERE source.capture_id = NEW.discovered_from_capture_id
      AND source.payload_sha256 = NEW.discovered_from_payload_sha256
      AND (
        (NEW.source_kind IN (
            'asset-listing-document',
            'asset-listings-index-page'
          )
          AND source.source_kind = 'asset-listings-index')
        OR (NEW.source_kind = 'support-lifecycle-document'
          AND source.source_kind = 'delistings-index')
      )
  )
  OR EXISTS (
    SELECT 1
    FROM kraken_lifecycle_document_captures source
    JOIN kraken_lifecycle_document_capture_commits committed
      ON committed.capture_id = source.capture_id
    WHERE source.capture_id = NEW.discovered_from_capture_id
      AND source.payload_sha256 = NEW.discovered_from_payload_sha256
      AND source.source_kind = 'asset-listings-index-page'
      AND NEW.source_kind IN (
        'asset-listing-document',
        'asset-listings-index-page'
      )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle document discovery provenance is incomplete');
END;

CREATE TRIGGER reject_kraken_lifecycle_document_capture_conflict
BEFORE INSERT ON kraken_lifecycle_document_captures
WHEN EXISTS (
  SELECT 1
  FROM kraken_lifecycle_document_captures existing
  WHERE existing.capture_id = NEW.capture_id
    AND (
      existing.source_kind <> NEW.source_kind
      OR existing.source_ref <> NEW.source_ref
      OR existing.discovered_from_capture_id <> NEW.discovered_from_capture_id
      OR existing.discovered_from_payload_sha256
        <> NEW.discovered_from_payload_sha256
      OR existing.discovery_sha256 <> NEW.discovery_sha256
      OR existing.fetched_at_ms <> NEW.fetched_at_ms
      OR existing.payload_sha256 <> NEW.payload_sha256
      OR existing.content_type <> NEW.content_type
      OR COALESCE(existing.etag, '') <> COALESCE(NEW.etag, '')
      OR COALESCE(existing.last_modified, '')
        <> COALESCE(NEW.last_modified, '')
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle document capture conflict');
END;

CREATE TRIGGER reject_kraken_lifecycle_document_natural_identity_conflict
BEFORE INSERT ON kraken_lifecycle_document_captures
WHEN EXISTS (
  SELECT 1
  FROM kraken_lifecycle_document_captures existing
  WHERE existing.source_ref = NEW.source_ref
    AND existing.fetched_at_ms = NEW.fetched_at_ms
    AND existing.capture_id <> NEW.capture_id
)
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle document natural identity conflict');
END;

CREATE TRIGGER enforce_kraken_lifecycle_document_capture_completion
BEFORE INSERT ON kraken_lifecycle_document_capture_commits
WHEN typeof(NEW.committed_at_ms) <> 'integer'
  OR NOT EXISTS (
    SELECT 1
    FROM kraken_lifecycle_document_captures capture
    JOIN kraken_lifecycle_source_payloads payload
      ON payload.payload_sha256 = capture.payload_sha256
    WHERE capture.capture_id = NEW.capture_id
  )
  OR NEW.committed_at_ms < COALESCE((
    SELECT fetched_at_ms
    FROM kraken_lifecycle_document_captures
    WHERE capture_id = NEW.capture_id
  ), NEW.committed_at_ms + 1)
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle document capture is incomplete');
END;

CREATE TRIGGER prevent_kraken_lifecycle_document_capture_update
BEFORE UPDATE ON kraken_lifecycle_document_captures
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle document captures are immutable');
END;

CREATE TRIGGER prevent_kraken_lifecycle_document_capture_delete
BEFORE DELETE ON kraken_lifecycle_document_captures
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle document captures are immutable');
END;

CREATE TRIGGER prevent_kraken_lifecycle_document_commit_update
BEFORE UPDATE ON kraken_lifecycle_document_capture_commits
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle document commits are immutable');
END;

CREATE TRIGGER prevent_kraken_lifecycle_document_commit_delete
BEFORE DELETE ON kraken_lifecycle_document_capture_commits
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle document commits are immutable');
END;
