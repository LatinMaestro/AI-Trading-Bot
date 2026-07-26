CREATE TABLE universe_ingestion_batches (
  batch_sha256 TEXT PRIMARY KEY CHECK (
    length(batch_sha256) = 64
    AND batch_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  venue TEXT NOT NULL,
  recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0),
  definition_count INTEGER NOT NULL CHECK (definition_count >= 0),
  event_count INTEGER NOT NULL CHECK (event_count >= 0),
  observation_count INTEGER NOT NULL CHECK (observation_count >= 0),
  source_count INTEGER NOT NULL CHECK (source_count >= 1),
  CHECK (definition_count + event_count + observation_count > 0)
);

CREATE TABLE universe_ingestion_batch_sources (
  batch_sha256 TEXT NOT NULL,
  source_digest TEXT NOT NULL CHECK (
    length(source_digest) = 64
    AND source_digest NOT GLOB '*[^0-9a-f]*'
  ),
  PRIMARY KEY (batch_sha256, source_digest),
  FOREIGN KEY (batch_sha256)
    REFERENCES universe_ingestion_batches(batch_sha256)
);

CREATE TABLE universe_ingestion_batch_definitions (
  batch_sha256 TEXT NOT NULL,
  definition_id TEXT NOT NULL,
  PRIMARY KEY (batch_sha256, definition_id),
  FOREIGN KEY (batch_sha256)
    REFERENCES universe_ingestion_batches(batch_sha256),
  FOREIGN KEY (definition_id)
    REFERENCES market_universe_definitions(definition_id)
);

CREATE TABLE universe_ingestion_batch_events (
  batch_sha256 TEXT NOT NULL,
  event_id TEXT NOT NULL,
  PRIMARY KEY (batch_sha256, event_id),
  FOREIGN KEY (batch_sha256)
    REFERENCES universe_ingestion_batches(batch_sha256),
  FOREIGN KEY (event_id)
    REFERENCES market_universe_events(event_id)
);

CREATE TABLE universe_ingestion_batch_observations (
  batch_sha256 TEXT NOT NULL,
  observation_id TEXT NOT NULL,
  PRIMARY KEY (batch_sha256, observation_id),
  FOREIGN KEY (batch_sha256)
    REFERENCES universe_ingestion_batches(batch_sha256),
  FOREIGN KEY (observation_id)
    REFERENCES market_quality_observations(observation_id)
);

CREATE TABLE universe_ingestion_batch_commits (
  batch_sha256 TEXT PRIMARY KEY,
  FOREIGN KEY (batch_sha256)
    REFERENCES universe_ingestion_batches(batch_sha256)
);

CREATE INDEX idx_universe_ingestion_batches_recorded
  ON universe_ingestion_batches(venue, recorded_at_ms);

CREATE TRIGGER enforce_universe_ingestion_batch_integer_fields
BEFORE INSERT ON universe_ingestion_batches
WHEN typeof(NEW.recorded_at_ms) <> 'integer'
  OR typeof(NEW.definition_count) <> 'integer'
  OR typeof(NEW.event_count) <> 'integer'
  OR typeof(NEW.observation_count) <> 'integer'
  OR typeof(NEW.source_count) <> 'integer'
BEGIN
  SELECT RAISE(ABORT, 'universe ingestion batch times and counts must be integers');
END;

CREATE TRIGGER reject_universe_ingestion_batch_conflict
BEFORE INSERT ON universe_ingestion_batches
WHEN EXISTS (
  SELECT 1
  FROM universe_ingestion_batches existing
  WHERE existing.batch_sha256 = NEW.batch_sha256
    AND (
      existing.venue <> NEW.venue
      OR existing.recorded_at_ms <> NEW.recorded_at_ms
      OR existing.definition_count <> NEW.definition_count
      OR existing.event_count <> NEW.event_count
      OR existing.observation_count <> NEW.observation_count
      OR existing.source_count <> NEW.source_count
    )
)
BEGIN
  SELECT RAISE(ABORT, 'universe ingestion batch payload conflict');
END;

CREATE TRIGGER enforce_universe_ingestion_definition_membership
BEFORE INSERT ON universe_ingestion_batch_definitions
WHEN NOT EXISTS (
  SELECT 1
  FROM market_universe_definitions item
  JOIN universe_ingestion_batches batch
    ON batch.batch_sha256 = NEW.batch_sha256
  WHERE item.definition_id = NEW.definition_id
    AND item.venue = batch.venue
)
BEGIN
  SELECT RAISE(ABORT, 'invalid universe definition batch membership');
END;

CREATE TRIGGER enforce_universe_ingestion_event_membership
BEFORE INSERT ON universe_ingestion_batch_events
WHEN NOT EXISTS (
  SELECT 1
  FROM market_universe_events item
  JOIN universe_ingestion_batches batch
    ON batch.batch_sha256 = NEW.batch_sha256
  WHERE item.event_id = NEW.event_id
    AND item.venue = batch.venue
)
BEGIN
  SELECT RAISE(ABORT, 'invalid universe event batch membership');
END;

CREATE TRIGGER enforce_universe_ingestion_observation_membership
BEFORE INSERT ON universe_ingestion_batch_observations
WHEN NOT EXISTS (
  SELECT 1
  FROM market_quality_observations item
  JOIN universe_ingestion_batches batch
    ON batch.batch_sha256 = NEW.batch_sha256
  WHERE item.observation_id = NEW.observation_id
    AND item.venue = batch.venue
)
BEGIN
  SELECT RAISE(ABORT, 'invalid universe observation batch membership');
END;

CREATE TRIGGER enforce_universe_ingestion_batch_completion
BEFORE INSERT ON universe_ingestion_batch_commits
WHEN NOT EXISTS (
    SELECT 1
    FROM universe_ingestion_batches
    WHERE batch_sha256 = NEW.batch_sha256
  )
  OR (
    SELECT COUNT(*)
    FROM universe_ingestion_batch_sources
    WHERE batch_sha256 = NEW.batch_sha256
  ) <> (
    SELECT source_count
    FROM universe_ingestion_batches
    WHERE batch_sha256 = NEW.batch_sha256
  )
  OR (
    SELECT COUNT(*)
    FROM universe_ingestion_batch_definitions
    WHERE batch_sha256 = NEW.batch_sha256
  ) <> (
    SELECT definition_count
    FROM universe_ingestion_batches
    WHERE batch_sha256 = NEW.batch_sha256
  )
  OR (
    SELECT COUNT(*)
    FROM universe_ingestion_batch_events
    WHERE batch_sha256 = NEW.batch_sha256
  ) <> (
    SELECT event_count
    FROM universe_ingestion_batches
    WHERE batch_sha256 = NEW.batch_sha256
  )
  OR (
    SELECT COUNT(*)
    FROM universe_ingestion_batch_observations
    WHERE batch_sha256 = NEW.batch_sha256
  ) <> (
    SELECT observation_count
    FROM universe_ingestion_batches
    WHERE batch_sha256 = NEW.batch_sha256
  )
BEGIN
  SELECT RAISE(ABORT, 'universe ingestion batch is incomplete');
END;

CREATE TRIGGER prevent_universe_ingestion_batch_update
BEFORE UPDATE ON universe_ingestion_batches
BEGIN
  SELECT RAISE(ABORT, 'universe ingestion batches are immutable');
END;

CREATE TRIGGER prevent_universe_ingestion_batch_delete
BEFORE DELETE ON universe_ingestion_batches
BEGIN
  SELECT RAISE(ABORT, 'universe ingestion batches are immutable');
END;

CREATE TRIGGER prevent_universe_ingestion_source_update
BEFORE UPDATE ON universe_ingestion_batch_sources
BEGIN
  SELECT RAISE(ABORT, 'universe ingestion source memberships are immutable');
END;

CREATE TRIGGER prevent_universe_ingestion_source_delete
BEFORE DELETE ON universe_ingestion_batch_sources
BEGIN
  SELECT RAISE(ABORT, 'universe ingestion source memberships are immutable');
END;

CREATE TRIGGER prevent_universe_ingestion_definition_membership_update
BEFORE UPDATE ON universe_ingestion_batch_definitions
BEGIN
  SELECT RAISE(ABORT, 'universe definition batch memberships are immutable');
END;

CREATE TRIGGER prevent_universe_ingestion_definition_membership_delete
BEFORE DELETE ON universe_ingestion_batch_definitions
BEGIN
  SELECT RAISE(ABORT, 'universe definition batch memberships are immutable');
END;

CREATE TRIGGER prevent_universe_ingestion_event_membership_update
BEFORE UPDATE ON universe_ingestion_batch_events
BEGIN
  SELECT RAISE(ABORT, 'universe event batch memberships are immutable');
END;

CREATE TRIGGER prevent_universe_ingestion_event_membership_delete
BEFORE DELETE ON universe_ingestion_batch_events
BEGIN
  SELECT RAISE(ABORT, 'universe event batch memberships are immutable');
END;

CREATE TRIGGER prevent_universe_ingestion_observation_membership_update
BEFORE UPDATE ON universe_ingestion_batch_observations
BEGIN
  SELECT RAISE(ABORT, 'universe observation batch memberships are immutable');
END;

CREATE TRIGGER prevent_universe_ingestion_observation_membership_delete
BEFORE DELETE ON universe_ingestion_batch_observations
BEGIN
  SELECT RAISE(ABORT, 'universe observation batch memberships are immutable');
END;

CREATE TRIGGER prevent_universe_ingestion_commit_update
BEFORE UPDATE ON universe_ingestion_batch_commits
BEGIN
  SELECT RAISE(ABORT, 'universe ingestion commit markers are immutable');
END;

CREATE TRIGGER prevent_universe_ingestion_commit_delete
BEFORE DELETE ON universe_ingestion_batch_commits
BEGIN
  SELECT RAISE(ABORT, 'universe ingestion commit markers are immutable');
END;
