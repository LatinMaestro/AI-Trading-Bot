CREATE TABLE market_universe_ingestion_batches (
  batch_sha256 TEXT PRIMARY KEY CHECK (
    length(batch_sha256) = 64
    AND batch_sha256 = lower(batch_sha256)
  ),
  venue TEXT NOT NULL,
  recorded_at_ms INTEGER NOT NULL CHECK (
    typeof(recorded_at_ms) = 'integer'
    AND recorded_at_ms >= 0
  ),
  source_digests_json TEXT NOT NULL CHECK (
    json_valid(source_digests_json)
    AND json_type(source_digests_json) = 'array'
  ),
  definition_count INTEGER NOT NULL CHECK (
    typeof(definition_count) = 'integer'
    AND definition_count >= 0
  ),
  event_count INTEGER NOT NULL CHECK (
    typeof(event_count) = 'integer'
    AND event_count >= 0
  ),
  observation_count INTEGER NOT NULL CHECK (
    typeof(observation_count) = 'integer'
    AND observation_count >= 0
  ),
  UNIQUE (venue, recorded_at_ms)
);

CREATE TABLE market_universe_ingestion_batch_items (
  batch_sha256 TEXT NOT NULL,
  item_kind TEXT NOT NULL CHECK (
    item_kind IN ('definition', 'event', 'observation')
  ),
  item_id TEXT NOT NULL,
  item_position INTEGER NOT NULL CHECK (
    typeof(item_position) = 'integer'
    AND item_position >= 0
  ),
  payload_sha256 TEXT NOT NULL CHECK (
    length(payload_sha256) = 64
    AND payload_sha256 = lower(payload_sha256)
  ),
  PRIMARY KEY (batch_sha256, item_kind, item_id),
  UNIQUE (batch_sha256, item_kind, item_position),
  FOREIGN KEY (batch_sha256)
    REFERENCES market_universe_ingestion_batches(batch_sha256)
    ON DELETE RESTRICT
);

CREATE INDEX idx_market_universe_ingestion_batches_recorded
  ON market_universe_ingestion_batches(venue, recorded_at_ms);

CREATE INDEX idx_market_universe_ingestion_batch_items_item
  ON market_universe_ingestion_batch_items(item_kind, item_id);

CREATE TRIGGER reject_market_universe_ingestion_batch_conflict
BEFORE INSERT ON market_universe_ingestion_batches
WHEN EXISTS (
  SELECT 1
  FROM market_universe_ingestion_batches existing
  WHERE (
      existing.batch_sha256 = NEW.batch_sha256
      OR (
        existing.venue = NEW.venue
        AND existing.recorded_at_ms = NEW.recorded_at_ms
      )
    )
    AND (
      existing.batch_sha256 <> NEW.batch_sha256
      OR existing.venue <> NEW.venue
      OR existing.recorded_at_ms <> NEW.recorded_at_ms
      OR existing.source_digests_json <> NEW.source_digests_json
      OR existing.definition_count <> NEW.definition_count
      OR existing.event_count <> NEW.event_count
      OR existing.observation_count <> NEW.observation_count
    )
)
BEGIN
  SELECT RAISE(ABORT, 'market universe ingestion batch payload conflict');
END;

CREATE TRIGGER reject_market_universe_ingestion_batch_item_conflict
BEFORE INSERT ON market_universe_ingestion_batch_items
WHEN EXISTS (
  SELECT 1
  FROM market_universe_ingestion_batch_items existing
  WHERE (
      (
        existing.batch_sha256 = NEW.batch_sha256
        AND existing.item_kind = NEW.item_kind
        AND existing.item_id = NEW.item_id
      )
      OR (
        existing.batch_sha256 = NEW.batch_sha256
        AND existing.item_kind = NEW.item_kind
        AND existing.item_position = NEW.item_position
      )
    )
    AND (
      existing.item_id <> NEW.item_id
      OR existing.item_position <> NEW.item_position
      OR existing.payload_sha256 <> NEW.payload_sha256
    )
)
BEGIN
  SELECT RAISE(ABORT, 'market universe ingestion batch item conflict');
END;

CREATE TRIGGER prevent_market_universe_ingestion_batch_update
BEFORE UPDATE ON market_universe_ingestion_batches
BEGIN
  SELECT RAISE(ABORT, 'market universe ingestion batches are immutable');
END;

CREATE TRIGGER prevent_market_universe_ingestion_batch_delete
BEFORE DELETE ON market_universe_ingestion_batches
BEGIN
  SELECT RAISE(ABORT, 'market universe ingestion batches are immutable');
END;

CREATE TRIGGER prevent_market_universe_ingestion_batch_item_update
BEFORE UPDATE ON market_universe_ingestion_batch_items
BEGIN
  SELECT RAISE(ABORT, 'market universe ingestion batch items are immutable');
END;

CREATE TRIGGER prevent_market_universe_ingestion_batch_item_delete
BEFORE DELETE ON market_universe_ingestion_batch_items
BEGIN
  SELECT RAISE(ABORT, 'market universe ingestion batch items are immutable');
END;
