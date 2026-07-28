CREATE TABLE kraken_lifecycle_backfill_manifests (
  manifest_sha256 TEXT PRIMARY KEY CHECK (
    length(manifest_sha256) = 64
    AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  schema_version TEXT NOT NULL CHECK (
    schema_version = 'kraken-lifecycle-backfill-v1'
  ),
  recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0),
  binding_sha256 TEXT NOT NULL CHECK (
    length(binding_sha256) = 64
    AND binding_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  evidence_sha256 TEXT NOT NULL CHECK (
    length(evidence_sha256) = 64
    AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (status IN ('partial', 'complete')),
  coverage_authoritative INTEGER NOT NULL CHECK (
    coverage_authoritative IN (0, 1)
    AND coverage_authoritative = (status = 'complete')
  ),
  pair_count INTEGER NOT NULL CHECK (pair_count BETWEEN 1 AND 500),
  complete_pair_count INTEGER NOT NULL CHECK (
    complete_pair_count BETWEEN 0 AND pair_count
  ),
  document_count INTEGER NOT NULL CHECK (
    document_count BETWEEN 1 AND 200
  ),
  declaration_count INTEGER NOT NULL CHECK (
    declaration_count BETWEEN 1 AND 100000
  ),
  CHECK (
    status = 'partial'
    OR complete_pair_count = pair_count
  )
);

CREATE TABLE kraken_lifecycle_backfill_pair_coverage (
  manifest_sha256 TEXT NOT NULL,
  canonical_pair TEXT NOT NULL CHECK (
    length(canonical_pair) BETWEEN 5 AND 100
    AND canonical_pair = trim(canonical_pair)
    AND canonical_pair GLOB '[A-Z0-9]*/AUD'
    AND canonical_pair NOT GLOB '*[^A-Z0-9./]*'
    AND length(canonical_pair) - length(replace(canonical_pair, '/', '')) = 1
  ),
  complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
  missing_evidence_json TEXT NOT NULL CHECK (
    json_valid(missing_evidence_json)
    AND json_type(missing_evidence_json) = 'array'
  ),
  PRIMARY KEY (manifest_sha256, canonical_pair),
  FOREIGN KEY (manifest_sha256)
    REFERENCES kraken_lifecycle_backfill_manifests(manifest_sha256)
);

CREATE TABLE kraken_lifecycle_backfill_manifest_commits (
  manifest_sha256 TEXT PRIMARY KEY,
  committed_at_ms INTEGER NOT NULL CHECK (committed_at_ms >= 0),
  FOREIGN KEY (manifest_sha256)
    REFERENCES kraken_lifecycle_backfill_manifests(manifest_sha256)
);

CREATE TRIGGER enforce_kraken_lifecycle_backfill_integer_fields
BEFORE INSERT ON kraken_lifecycle_backfill_manifests
WHEN typeof(NEW.recorded_at_ms) <> 'integer'
  OR typeof(NEW.coverage_authoritative) <> 'integer'
  OR typeof(NEW.pair_count) <> 'integer'
  OR typeof(NEW.complete_pair_count) <> 'integer'
  OR typeof(NEW.document_count) <> 'integer'
  OR typeof(NEW.declaration_count) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle backfill fields must be integers');
END;

CREATE TRIGGER reject_kraken_lifecycle_backfill_manifest_conflict
BEFORE INSERT ON kraken_lifecycle_backfill_manifests
WHEN EXISTS (
  SELECT 1
  FROM kraken_lifecycle_backfill_manifests existing
  WHERE existing.manifest_sha256 = NEW.manifest_sha256
    AND (
      existing.schema_version <> NEW.schema_version
      OR existing.recorded_at_ms <> NEW.recorded_at_ms
      OR existing.binding_sha256 <> NEW.binding_sha256
      OR existing.evidence_sha256 <> NEW.evidence_sha256
      OR existing.status <> NEW.status
      OR existing.coverage_authoritative <> NEW.coverage_authoritative
      OR existing.pair_count <> NEW.pair_count
      OR existing.complete_pair_count <> NEW.complete_pair_count
      OR existing.document_count <> NEW.document_count
      OR existing.declaration_count <> NEW.declaration_count
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle backfill manifest conflict');
END;

CREATE TRIGGER enforce_kraken_lifecycle_backfill_pair_consistency
BEFORE INSERT ON kraken_lifecycle_backfill_pair_coverage
WHEN (
  NEW.complete = 1
  AND json_array_length(NEW.missing_evidence_json) <> 0
)
OR (
  NEW.complete = 0
  AND json_array_length(NEW.missing_evidence_json) = 0
)
OR EXISTS (
  SELECT 1
  FROM json_each(NEW.missing_evidence_json)
  WHERE type <> 'text'
    OR value NOT IN (
      'listing-history',
      'trading-history',
      'australian-availability-history'
    )
)
OR (
  SELECT COUNT(*)
  FROM json_each(NEW.missing_evidence_json)
) <> (
  SELECT COUNT(DISTINCT value)
  FROM json_each(NEW.missing_evidence_json)
)
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle backfill pair coverage is inconsistent');
END;

CREATE TRIGGER reject_kraken_lifecycle_backfill_pair_conflict
BEFORE INSERT ON kraken_lifecycle_backfill_pair_coverage
WHEN EXISTS (
  SELECT 1
  FROM kraken_lifecycle_backfill_pair_coverage existing
  WHERE existing.manifest_sha256 = NEW.manifest_sha256
    AND existing.canonical_pair = NEW.canonical_pair
    AND (
      existing.complete <> NEW.complete
      OR existing.missing_evidence_json <> NEW.missing_evidence_json
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle backfill pair conflict');
END;

CREATE TRIGGER enforce_kraken_lifecycle_backfill_completion
BEFORE INSERT ON kraken_lifecycle_backfill_manifest_commits
WHEN typeof(NEW.committed_at_ms) <> 'integer'
  OR NOT EXISTS (
    SELECT 1
    FROM kraken_lifecycle_backfill_manifests manifest
    WHERE manifest.manifest_sha256 = NEW.manifest_sha256
      AND NEW.committed_at_ms >= manifest.recorded_at_ms
      AND (
        SELECT COUNT(*)
        FROM kraken_lifecycle_backfill_pair_coverage pair
        WHERE pair.manifest_sha256 = manifest.manifest_sha256
      ) = manifest.pair_count
      AND (
        SELECT COUNT(*)
        FROM kraken_lifecycle_backfill_pair_coverage pair
        WHERE pair.manifest_sha256 = manifest.manifest_sha256
          AND pair.complete = 1
      ) = manifest.complete_pair_count
      AND (
        manifest.status = 'partial'
        OR NOT EXISTS (
          SELECT 1
          FROM kraken_lifecycle_backfill_pair_coverage pair
          WHERE pair.manifest_sha256 = manifest.manifest_sha256
            AND pair.complete = 0
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle backfill manifest is incomplete');
END;

CREATE TRIGGER prevent_kraken_lifecycle_backfill_manifest_update
BEFORE UPDATE ON kraken_lifecycle_backfill_manifests
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle backfill manifests are immutable');
END;

CREATE TRIGGER prevent_kraken_lifecycle_backfill_manifest_delete
BEFORE DELETE ON kraken_lifecycle_backfill_manifests
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle backfill manifests are immutable');
END;

CREATE TRIGGER prevent_kraken_lifecycle_backfill_pair_update
BEFORE UPDATE ON kraken_lifecycle_backfill_pair_coverage
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle backfill pair coverage is immutable');
END;

CREATE TRIGGER prevent_kraken_lifecycle_backfill_pair_delete
BEFORE DELETE ON kraken_lifecycle_backfill_pair_coverage
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle backfill pair coverage is immutable');
END;

CREATE TRIGGER prevent_kraken_lifecycle_backfill_commit_update
BEFORE UPDATE ON kraken_lifecycle_backfill_manifest_commits
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle backfill commits are immutable');
END;

CREATE TRIGGER prevent_kraken_lifecycle_backfill_commit_delete
BEFORE DELETE ON kraken_lifecycle_backfill_manifest_commits
BEGIN
  SELECT RAISE(ABORT, 'Kraken lifecycle backfill commits are immutable');
END;
