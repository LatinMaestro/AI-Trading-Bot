CREATE TABLE market_universe_definitions (
  definition_id TEXT PRIMARY KEY,
  venue TEXT NOT NULL,
  canonical_pair TEXT NOT NULL,
  exchange_pair TEXT NOT NULL,
  base_asset TEXT NOT NULL,
  quote_asset TEXT NOT NULL,
  instrument_kind TEXT NOT NULL CHECK (
    instrument_kind IN (
      'spot',
      'leveraged-token',
      'inverse-token',
      'derivative-wrapper',
      'unknown'
    )
  ),
  available_at_ms INTEGER NOT NULL,
  source_ref TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  UNIQUE (venue, canonical_pair, available_at_ms)
);

CREATE TABLE market_universe_events (
  event_id TEXT PRIMARY KEY,
  venue TEXT NOT NULL,
  canonical_pair TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'listed',
      'trading-online',
      'trading-suspended',
      'trading-resumed',
      'delisted',
      'au-enabled',
      'au-disabled'
    )
  ),
  effective_at_ms INTEGER NOT NULL,
  published_at_ms INTEGER NOT NULL,
  recorded_at_ms INTEGER NOT NULL,
  source_ref TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  CHECK (published_at_ms <= recorded_at_ms),
  UNIQUE (
    venue,
    canonical_pair,
    event_type,
    effective_at_ms,
    published_at_ms
  )
);

CREATE TABLE market_quality_observations (
  observation_id TEXT PRIMARY KEY,
  venue TEXT NOT NULL,
  canonical_pair TEXT NOT NULL,
  observed_at_ms INTEGER NOT NULL,
  available_at_ms INTEGER NOT NULL,
  spread_bps REAL NOT NULL CHECK (spread_bps >= 0),
  quote_turnover_aud_24h REAL NOT NULL CHECK (quote_turnover_aud_24h >= 0),
  available_quote_volume_aud REAL NOT NULL CHECK (available_quote_volume_aud >= 0),
  estimated_impact_bps REAL NOT NULL CHECK (estimated_impact_bps >= 0),
  minimum_order_aud REAL NOT NULL CHECK (minimum_order_aud >= 0),
  aud_valuation_complete INTEGER NOT NULL CHECK (aud_valuation_complete IN (0, 1)),
  daily_committed_candles INTEGER NOT NULL CHECK (daily_committed_candles >= 0),
  hourly_committed_candles INTEGER NOT NULL CHECK (hourly_committed_candles >= 0),
  annualised_volatility REAL NOT NULL CHECK (annualised_volatility >= 0),
  data_quality_state TEXT NOT NULL CHECK (
    data_quality_state IN ('complete', 'gap', 'conflict', 'stale', 'ambiguous')
  ),
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  CHECK (observed_at_ms <= available_at_ms),
  UNIQUE (venue, canonical_pair, observed_at_ms, available_at_ms)
);

CREATE INDEX idx_market_universe_definitions_at
  ON market_universe_definitions(venue, canonical_pair, available_at_ms);

CREATE INDEX idx_market_universe_events_at
  ON market_universe_events(venue, canonical_pair, effective_at_ms, published_at_ms);

CREATE INDEX idx_market_quality_observations_at
  ON market_quality_observations(venue, canonical_pair, observed_at_ms, available_at_ms);

CREATE TRIGGER reject_market_universe_definition_conflict
BEFORE INSERT ON market_universe_definitions
WHEN EXISTS (
  SELECT 1
  FROM market_universe_definitions existing
  WHERE (
      existing.definition_id = NEW.definition_id
      OR (
        existing.venue = NEW.venue
        AND existing.canonical_pair = NEW.canonical_pair
        AND existing.available_at_ms = NEW.available_at_ms
      )
    )
    AND (
      existing.definition_id <> NEW.definition_id
      OR existing.venue <> NEW.venue
      OR existing.canonical_pair <> NEW.canonical_pair
      OR existing.exchange_pair <> NEW.exchange_pair
      OR existing.base_asset <> NEW.base_asset
      OR existing.quote_asset <> NEW.quote_asset
      OR existing.instrument_kind <> NEW.instrument_kind
      OR existing.available_at_ms <> NEW.available_at_ms
      OR existing.source_ref <> NEW.source_ref
      OR existing.payload_sha256 <> NEW.payload_sha256
    )
)
BEGIN
  SELECT RAISE(ABORT, 'market universe definition payload conflict');
END;

CREATE TRIGGER reject_market_universe_event_conflict
BEFORE INSERT ON market_universe_events
WHEN EXISTS (
  SELECT 1
  FROM market_universe_events existing
  WHERE (
      existing.event_id = NEW.event_id
      OR (
        existing.venue = NEW.venue
        AND existing.canonical_pair = NEW.canonical_pair
        AND existing.event_type = NEW.event_type
        AND existing.effective_at_ms = NEW.effective_at_ms
        AND existing.published_at_ms = NEW.published_at_ms
      )
    )
    AND (
      existing.event_id <> NEW.event_id
      OR existing.venue <> NEW.venue
      OR existing.canonical_pair <> NEW.canonical_pair
      OR existing.event_type <> NEW.event_type
      OR existing.effective_at_ms <> NEW.effective_at_ms
      OR existing.published_at_ms <> NEW.published_at_ms
      OR existing.recorded_at_ms <> NEW.recorded_at_ms
      OR existing.source_ref <> NEW.source_ref
      OR existing.payload_sha256 <> NEW.payload_sha256
    )
)
BEGIN
  SELECT RAISE(ABORT, 'market universe event payload conflict');
END;

CREATE TRIGGER reject_market_quality_observation_conflict
BEFORE INSERT ON market_quality_observations
WHEN EXISTS (
  SELECT 1
  FROM market_quality_observations existing
  WHERE (
      existing.observation_id = NEW.observation_id
      OR (
        existing.venue = NEW.venue
        AND existing.canonical_pair = NEW.canonical_pair
        AND existing.observed_at_ms = NEW.observed_at_ms
        AND existing.available_at_ms = NEW.available_at_ms
      )
    )
    AND (
      existing.observation_id <> NEW.observation_id
      OR existing.venue <> NEW.venue
      OR existing.canonical_pair <> NEW.canonical_pair
      OR existing.observed_at_ms <> NEW.observed_at_ms
      OR existing.available_at_ms <> NEW.available_at_ms
      OR existing.spread_bps <> NEW.spread_bps
      OR existing.quote_turnover_aud_24h <> NEW.quote_turnover_aud_24h
      OR existing.available_quote_volume_aud <> NEW.available_quote_volume_aud
      OR existing.estimated_impact_bps <> NEW.estimated_impact_bps
      OR existing.minimum_order_aud <> NEW.minimum_order_aud
      OR existing.aud_valuation_complete <> NEW.aud_valuation_complete
      OR existing.daily_committed_candles <> NEW.daily_committed_candles
      OR existing.hourly_committed_candles <> NEW.hourly_committed_candles
      OR existing.annualised_volatility <> NEW.annualised_volatility
      OR existing.data_quality_state <> NEW.data_quality_state
      OR existing.payload_sha256 <> NEW.payload_sha256
    )
)
BEGIN
  SELECT RAISE(ABORT, 'market quality observation payload conflict');
END;

CREATE TRIGGER prevent_market_universe_definition_update
BEFORE UPDATE ON market_universe_definitions
BEGIN
  SELECT RAISE(ABORT, 'market universe definitions are immutable');
END;

CREATE TRIGGER prevent_market_universe_definition_delete
BEFORE DELETE ON market_universe_definitions
BEGIN
  SELECT RAISE(ABORT, 'market universe definitions are immutable');
END;

CREATE TRIGGER prevent_market_universe_event_update
BEFORE UPDATE ON market_universe_events
BEGIN
  SELECT RAISE(ABORT, 'market universe events are immutable');
END;

CREATE TRIGGER prevent_market_universe_event_delete
BEFORE DELETE ON market_universe_events
BEGIN
  SELECT RAISE(ABORT, 'market universe events are immutable');
END;

CREATE TRIGGER prevent_market_quality_observation_update
BEFORE UPDATE ON market_quality_observations
BEGIN
  SELECT RAISE(ABORT, 'market quality observations are immutable');
END;

CREATE TRIGGER prevent_market_quality_observation_delete
BEFORE DELETE ON market_quality_observations
BEGIN
  SELECT RAISE(ABORT, 'market quality observations are immutable');
END;
