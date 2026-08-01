CREATE TABLE market_data_batches (
  batch_id TEXT PRIMARY KEY,
  venue TEXT NOT NULL,
  canonical_pair TEXT NOT NULL,
  exchange_pair TEXT NOT NULL,
  interval_minutes INTEGER NOT NULL CHECK (interval_minutes IN (60, 1440)),
  requested_since_seconds INTEGER CHECK (requested_since_seconds IS NULL OR requested_since_seconds >= 0),
  source_cursor TEXT,
  fetched_at TEXT NOT NULL,
  committed_count INTEGER NOT NULL CHECK (committed_count >= 1),
  first_open_time_ms INTEGER NOT NULL,
  last_open_time_ms INTEGER NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK (
    length(payload_sha256) = 64
    AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  CHECK (first_open_time_ms <= last_open_time_ms),
  CHECK (committed_count = ((last_open_time_ms - first_open_time_ms) / (interval_minutes * 60000)) + 1),
  CHECK (first_open_time_ms % (interval_minutes * 60000) = 0),
  CHECK (last_open_time_ms % (interval_minutes * 60000) = 0)
);

CREATE TABLE market_candles (
  venue TEXT NOT NULL,
  canonical_pair TEXT NOT NULL,
  exchange_pair TEXT NOT NULL,
  interval_minutes INTEGER NOT NULL CHECK (interval_minutes IN (60, 1440)),
  open_time_ms INTEGER NOT NULL,
  close_time_ms INTEGER NOT NULL,
  open REAL NOT NULL CHECK (open > 0),
  high REAL NOT NULL CHECK (high > 0),
  low REAL NOT NULL CHECK (low > 0),
  close REAL NOT NULL CHECK (close > 0),
  volume REAL NOT NULL CHECK (volume >= 0),
  source_batch_id TEXT NOT NULL,
  candle_sha256 TEXT NOT NULL CHECK (
    length(candle_sha256) = 64
    AND candle_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  PRIMARY KEY (venue, canonical_pair, interval_minutes, open_time_ms),
  FOREIGN KEY (source_batch_id) REFERENCES market_data_batches(batch_id),
  CHECK (open_time_ms % (interval_minutes * 60000) = 0),
  CHECK (close_time_ms = open_time_ms + (interval_minutes * 60000)),
  CHECK (high >= open),
  CHECK (high >= close),
  CHECK (low <= open),
  CHECK (low <= close),
  CHECK (low <= high)
);

CREATE INDEX idx_market_candles_lookup
  ON market_candles(venue, canonical_pair, interval_minutes, open_time_ms);

CREATE INDEX idx_market_data_batches_fetched
  ON market_data_batches(venue, canonical_pair, interval_minutes, fetched_at);

CREATE TRIGGER reject_market_data_batch_conflict
BEFORE INSERT ON market_data_batches
WHEN EXISTS (
  SELECT 1
  FROM market_data_batches existing
  WHERE existing.batch_id = NEW.batch_id
    AND (
      existing.venue <> NEW.venue
      OR existing.canonical_pair <> NEW.canonical_pair
      OR existing.exchange_pair <> NEW.exchange_pair
      OR existing.interval_minutes <> NEW.interval_minutes
      OR existing.requested_since_seconds IS NOT NEW.requested_since_seconds
      OR existing.source_cursor IS NOT NEW.source_cursor
      OR existing.fetched_at <> NEW.fetched_at
      OR existing.committed_count <> NEW.committed_count
      OR existing.first_open_time_ms <> NEW.first_open_time_ms
      OR existing.last_open_time_ms <> NEW.last_open_time_ms
      OR existing.payload_sha256 <> NEW.payload_sha256
    )
)
BEGIN
  SELECT RAISE(ABORT, 'market data batch payload conflict');
END;

CREATE TRIGGER reject_market_candle_source_mismatch
BEFORE INSERT ON market_candles
WHEN NOT EXISTS (
  SELECT 1
  FROM market_data_batches source
  WHERE source.batch_id = NEW.source_batch_id
    AND source.venue = NEW.venue
    AND source.canonical_pair = NEW.canonical_pair
    AND source.exchange_pair = NEW.exchange_pair
    AND source.interval_minutes = NEW.interval_minutes
    AND NEW.open_time_ms BETWEEN source.first_open_time_ms AND source.last_open_time_ms
)
BEGIN
  SELECT RAISE(ABORT, 'market candle source batch mismatch');
END;

CREATE TRIGGER reject_market_candle_conflict
BEFORE INSERT ON market_candles
WHEN EXISTS (
  SELECT 1
  FROM market_candles existing
  WHERE existing.venue = NEW.venue
    AND existing.canonical_pair = NEW.canonical_pair
    AND existing.interval_minutes = NEW.interval_minutes
    AND existing.open_time_ms = NEW.open_time_ms
    AND (
      existing.exchange_pair <> NEW.exchange_pair
      OR existing.close_time_ms <> NEW.close_time_ms
      OR existing.open <> NEW.open
      OR existing.high <> NEW.high
      OR existing.low <> NEW.low
      OR existing.close <> NEW.close
      OR existing.volume <> NEW.volume
      OR existing.candle_sha256 <> NEW.candle_sha256
    )
)
BEGIN
  SELECT RAISE(ABORT, 'market candle payload conflict');
END;

CREATE TRIGGER prevent_market_data_batch_update
BEFORE UPDATE ON market_data_batches
BEGIN
  SELECT RAISE(ABORT, 'market data batches are immutable');
END;

CREATE TRIGGER prevent_market_data_batch_delete
BEFORE DELETE ON market_data_batches
BEGIN
  SELECT RAISE(ABORT, 'market data batches are immutable');
END;

CREATE TRIGGER prevent_market_candle_update
BEFORE UPDATE ON market_candles
BEGIN
  SELECT RAISE(ABORT, 'market candles are immutable');
END;

CREATE TRIGGER prevent_market_candle_delete
BEFORE DELETE ON market_candles
BEGIN
  SELECT RAISE(ABORT, 'market candles are immutable');
END;
