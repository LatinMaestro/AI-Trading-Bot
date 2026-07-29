CREATE TABLE historical_candle_backfills (
  backfill_id TEXT PRIMARY KEY CHECK (length(backfill_id) = 64),
  source_contract_sha256 TEXT NOT NULL CHECK (length(source_contract_sha256) = 64),
  archive_kind TEXT NOT NULL CHECK (archive_kind IN ('complete', 'quarterly')),
  archive_url TEXT NOT NULL,
  archive_sha256 TEXT NOT NULL CHECK (length(archive_sha256) = 64),
  archive_byte_length INTEGER NOT NULL CHECK (archive_byte_length > 0),
  acquired_at TEXT NOT NULL,
  csv_member_name TEXT NOT NULL,
  csv_sha256 TEXT NOT NULL CHECK (length(csv_sha256) = 64),
  csv_byte_length INTEGER NOT NULL CHECK (csv_byte_length > 0),
  canonical_pair TEXT NOT NULL CHECK (canonical_pair IN ('BTC/AUD', 'ETH/AUD')),
  exchange_pair TEXT NOT NULL CHECK (exchange_pair IN ('XBTAUD', 'ETHAUD')),
  interval_minutes INTEGER NOT NULL CHECK (interval_minutes IN (60, 1440)),
  row_count INTEGER NOT NULL CHECK (row_count > 0),
  first_open_time_ms INTEGER NOT NULL,
  last_open_time_ms INTEGER NOT NULL,
  csv_manifest_sha256 TEXT NOT NULL CHECK (length(csv_manifest_sha256) = 64),
  rest_overlap_count INTEGER NOT NULL CHECK (rest_overlap_count > 0),
  rest_overlap_sha256 TEXT NOT NULL CHECK (length(rest_overlap_sha256) = 64),
  CHECK (first_open_time_ms <= last_open_time_ms),
  CHECK (first_open_time_ms % (interval_minutes * 60000) = 0),
  CHECK (last_open_time_ms % (interval_minutes * 60000) = 0),
  CHECK (
    (canonical_pair = 'BTC/AUD' AND exchange_pair = 'XBTAUD')
    OR (canonical_pair = 'ETH/AUD' AND exchange_pair = 'ETHAUD')
  ),
  UNIQUE (archive_sha256, csv_member_name)
);

CREATE TABLE historical_market_candles (
  canonical_pair TEXT NOT NULL CHECK (canonical_pair IN ('BTC/AUD', 'ETH/AUD')),
  exchange_pair TEXT NOT NULL CHECK (exchange_pair IN ('XBTAUD', 'ETHAUD')),
  interval_minutes INTEGER NOT NULL CHECK (interval_minutes IN (60, 1440)),
  open_time_ms INTEGER NOT NULL,
  close_time_ms INTEGER NOT NULL,
  open REAL NOT NULL CHECK (open > 0),
  high REAL NOT NULL CHECK (high > 0),
  low REAL NOT NULL CHECK (low > 0),
  close REAL NOT NULL CHECK (close > 0),
  vwap REAL NOT NULL CHECK (vwap > 0),
  volume REAL NOT NULL CHECK (volume >= 0),
  trade_count INTEGER NOT NULL CHECK (trade_count > 0),
  candle_sha256 TEXT NOT NULL CHECK (length(candle_sha256) = 64),
  PRIMARY KEY (canonical_pair, interval_minutes, open_time_ms),
  CHECK (open_time_ms % (interval_minutes * 60000) = 0),
  CHECK (close_time_ms = open_time_ms + (interval_minutes * 60000)),
  CHECK (high >= open),
  CHECK (high >= close),
  CHECK (low <= open),
  CHECK (low <= close),
  CHECK (low <= high),
  CHECK (
    (canonical_pair = 'BTC/AUD' AND exchange_pair = 'XBTAUD')
    OR (canonical_pair = 'ETH/AUD' AND exchange_pair = 'ETHAUD')
  )
);

CREATE TABLE historical_candle_backfill_memberships (
  backfill_id TEXT NOT NULL,
  canonical_pair TEXT NOT NULL,
  interval_minutes INTEGER NOT NULL,
  open_time_ms INTEGER NOT NULL,
  candle_sha256 TEXT NOT NULL CHECK (length(candle_sha256) = 64),
  PRIMARY KEY (backfill_id, canonical_pair, interval_minutes, open_time_ms),
  FOREIGN KEY (backfill_id)
    REFERENCES historical_candle_backfills(backfill_id),
  FOREIGN KEY (canonical_pair, interval_minutes, open_time_ms)
    REFERENCES historical_market_candles(
      canonical_pair, interval_minutes, open_time_ms
    )
);

CREATE TABLE historical_candle_backfill_commits (
  backfill_id TEXT PRIMARY KEY,
  committed_at TEXT NOT NULL,
  committed_count INTEGER NOT NULL CHECK (committed_count > 0),
  rest_overlap_count INTEGER NOT NULL CHECK (rest_overlap_count > 0),
  commit_sha256 TEXT NOT NULL CHECK (length(commit_sha256) = 64),
  FOREIGN KEY (backfill_id)
    REFERENCES historical_candle_backfills(backfill_id)
);

CREATE TRIGGER reject_historical_backfill_conflict
BEFORE INSERT ON historical_candle_backfills
WHEN EXISTS (
  SELECT 1
  FROM historical_candle_backfills existing
  WHERE existing.backfill_id = NEW.backfill_id
    AND (
      existing.source_contract_sha256 <> NEW.source_contract_sha256
      OR existing.archive_kind <> NEW.archive_kind
      OR existing.archive_url <> NEW.archive_url
      OR existing.archive_sha256 <> NEW.archive_sha256
      OR existing.archive_byte_length <> NEW.archive_byte_length
      OR existing.acquired_at <> NEW.acquired_at
      OR existing.csv_member_name <> NEW.csv_member_name
      OR existing.csv_sha256 <> NEW.csv_sha256
      OR existing.csv_byte_length <> NEW.csv_byte_length
      OR existing.canonical_pair <> NEW.canonical_pair
      OR existing.exchange_pair <> NEW.exchange_pair
      OR existing.interval_minutes <> NEW.interval_minutes
      OR existing.row_count <> NEW.row_count
      OR existing.first_open_time_ms <> NEW.first_open_time_ms
      OR existing.last_open_time_ms <> NEW.last_open_time_ms
      OR existing.csv_manifest_sha256 <> NEW.csv_manifest_sha256
      OR existing.rest_overlap_count <> NEW.rest_overlap_count
      OR existing.rest_overlap_sha256 <> NEW.rest_overlap_sha256
    )
)
BEGIN
  SELECT RAISE(ABORT, 'historical backfill identity conflict');
END;

CREATE TRIGGER reject_historical_candle_conflict
BEFORE INSERT ON historical_market_candles
WHEN EXISTS (
  SELECT 1
  FROM historical_market_candles existing
  WHERE existing.canonical_pair = NEW.canonical_pair
    AND existing.interval_minutes = NEW.interval_minutes
    AND existing.open_time_ms = NEW.open_time_ms
    AND (
      existing.exchange_pair <> NEW.exchange_pair
      OR existing.close_time_ms <> NEW.close_time_ms
      OR existing.open <> NEW.open
      OR existing.high <> NEW.high
      OR existing.low <> NEW.low
      OR existing.close <> NEW.close
      OR existing.vwap <> NEW.vwap
      OR existing.volume <> NEW.volume
      OR existing.trade_count <> NEW.trade_count
      OR existing.candle_sha256 <> NEW.candle_sha256
    )
)
BEGIN
  SELECT RAISE(ABORT, 'historical candle content conflict');
END;

CREATE TRIGGER reject_historical_membership_conflict
BEFORE INSERT ON historical_candle_backfill_memberships
WHEN EXISTS (
  SELECT 1
  FROM historical_candle_backfill_memberships existing
  WHERE existing.backfill_id = NEW.backfill_id
    AND existing.canonical_pair = NEW.canonical_pair
    AND existing.interval_minutes = NEW.interval_minutes
    AND existing.open_time_ms = NEW.open_time_ms
    AND existing.candle_sha256 <> NEW.candle_sha256
)
BEGIN
  SELECT RAISE(ABORT, 'historical membership content conflict');
END;

CREATE TRIGGER validate_historical_backfill_commit
BEFORE INSERT ON historical_candle_backfill_commits
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM historical_candle_backfills backfill
    WHERE backfill.backfill_id = NEW.backfill_id
      AND backfill.acquired_at = NEW.committed_at
      AND backfill.row_count = NEW.committed_count
      AND backfill.rest_overlap_count = NEW.rest_overlap_count
      AND backfill.backfill_id = NEW.commit_sha256
  ) THEN RAISE(ABORT, 'historical backfill commit header mismatch') END;

  SELECT CASE WHEN (
    SELECT COUNT(*)
    FROM historical_candle_backfill_memberships membership
    JOIN historical_market_candles candle
      ON candle.canonical_pair = membership.canonical_pair
     AND candle.interval_minutes = membership.interval_minutes
     AND candle.open_time_ms = membership.open_time_ms
     AND candle.candle_sha256 = membership.candle_sha256
    WHERE membership.backfill_id = NEW.backfill_id
  ) <> NEW.committed_count
  THEN RAISE(ABORT, 'historical backfill membership is incomplete') END;

  SELECT CASE WHEN (
    SELECT COUNT(*)
    FROM historical_candle_backfill_memberships membership
    JOIN historical_market_candles historical
      ON historical.canonical_pair = membership.canonical_pair
     AND historical.interval_minutes = membership.interval_minutes
     AND historical.open_time_ms = membership.open_time_ms
    JOIN market_candles recent
      ON recent.venue = 'kraken'
     AND recent.canonical_pair = historical.canonical_pair
     AND recent.interval_minutes = historical.interval_minutes
     AND recent.open_time_ms = historical.open_time_ms
     AND recent.open = historical.open
     AND recent.high = historical.high
     AND recent.low = historical.low
     AND recent.close = historical.close
     AND recent.volume = historical.volume
    WHERE membership.backfill_id = NEW.backfill_id
  ) <> NEW.rest_overlap_count
  THEN RAISE(ABORT, 'historical backfill REST overlap mismatch') END;

  SELECT CASE WHEN (
    SELECT COUNT(*)
    FROM historical_candle_backfills backfill
    JOIN market_candles recent
      ON recent.venue = 'kraken'
     AND recent.canonical_pair = backfill.canonical_pair
     AND recent.interval_minutes = backfill.interval_minutes
     AND recent.open_time_ms BETWEEN
       backfill.first_open_time_ms AND backfill.last_open_time_ms
    WHERE backfill.backfill_id = NEW.backfill_id
  ) <> NEW.rest_overlap_count
  THEN RAISE(ABORT, 'historical backfill REST coverage mismatch') END;
END;

CREATE TRIGGER reject_historical_commit_conflict
BEFORE INSERT ON historical_candle_backfill_commits
WHEN EXISTS (
  SELECT 1
  FROM historical_candle_backfill_commits existing
  WHERE existing.backfill_id = NEW.backfill_id
    AND (
      existing.committed_at <> NEW.committed_at
      OR existing.committed_count <> NEW.committed_count
      OR existing.rest_overlap_count <> NEW.rest_overlap_count
      OR existing.commit_sha256 <> NEW.commit_sha256
    )
)
BEGIN
  SELECT RAISE(ABORT, 'historical backfill commit conflict');
END;

CREATE TRIGGER prevent_historical_backfill_update
BEFORE UPDATE ON historical_candle_backfills
BEGIN
  SELECT RAISE(ABORT, 'historical backfills are immutable');
END;

CREATE TRIGGER prevent_historical_backfill_delete
BEFORE DELETE ON historical_candle_backfills
BEGIN
  SELECT RAISE(ABORT, 'historical backfills are immutable');
END;

CREATE TRIGGER prevent_historical_candle_update
BEFORE UPDATE ON historical_market_candles
BEGIN
  SELECT RAISE(ABORT, 'historical candles are immutable');
END;

CREATE TRIGGER prevent_historical_candle_delete
BEFORE DELETE ON historical_market_candles
BEGIN
  SELECT RAISE(ABORT, 'historical candles are immutable');
END;

CREATE TRIGGER prevent_historical_membership_update
BEFORE UPDATE ON historical_candle_backfill_memberships
BEGIN
  SELECT RAISE(ABORT, 'historical memberships are immutable');
END;

CREATE TRIGGER prevent_historical_membership_delete
BEFORE DELETE ON historical_candle_backfill_memberships
BEGIN
  SELECT RAISE(ABORT, 'historical memberships are immutable');
END;

CREATE TRIGGER prevent_historical_commit_update
BEFORE UPDATE ON historical_candle_backfill_commits
BEGIN
  SELECT RAISE(ABORT, 'historical commits are immutable');
END;

CREATE TRIGGER prevent_historical_commit_delete
BEFORE DELETE ON historical_candle_backfill_commits
BEGIN
  SELECT RAISE(ABORT, 'historical commits are immutable');
END;
