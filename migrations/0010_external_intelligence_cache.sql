CREATE TABLE external_intelligence_source_cache (
  source_id TEXT PRIMARY KEY
    CHECK(length(source_id) BETWEEN 1 AND 500)
    CHECK(source_id = trim(source_id)),
  etag TEXT
    CHECK(etag IS NULL OR (length(etag) BETWEEN 1 AND 500 AND etag = trim(etag))),
  last_modified TEXT
    CHECK(last_modified IS NULL OR (length(last_modified) BETWEEN 1 AND 500 AND last_modified = trim(last_modified))),
  observed_at_ms INTEGER NOT NULL
    CHECK(observed_at_ms >= 0)
    CHECK(typeof(observed_at_ms) = 'integer')
);

CREATE TRIGGER prevent_external_intelligence_cache_time_regression
BEFORE UPDATE ON external_intelligence_source_cache
WHEN NEW.observed_at_ms < OLD.observed_at_ms
BEGIN
  SELECT RAISE(ABORT, 'External intelligence cache time cannot regress');
END;

CREATE TRIGGER prevent_external_intelligence_cache_same_time_conflict
BEFORE UPDATE ON external_intelligence_source_cache
WHEN NEW.observed_at_ms = OLD.observed_at_ms
  AND (
    NEW.etag IS NOT OLD.etag
    OR NEW.last_modified IS NOT OLD.last_modified
  )
BEGIN
  SELECT RAISE(ABORT, 'External intelligence cache identity conflict');
END;
