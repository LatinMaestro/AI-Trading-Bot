CREATE TRIGGER enforce_market_universe_definition_integer_times
BEFORE INSERT ON market_universe_definitions
WHEN typeof(NEW.available_at_ms) <> 'integer' OR NEW.available_at_ms < 0
BEGIN
  SELECT RAISE(ABORT, 'market universe definition time must be a non-negative integer');
END;

CREATE TRIGGER enforce_market_universe_event_integer_times
BEFORE INSERT ON market_universe_events
WHEN typeof(NEW.effective_at_ms) <> 'integer'
  OR typeof(NEW.published_at_ms) <> 'integer'
  OR typeof(NEW.recorded_at_ms) <> 'integer'
  OR NEW.effective_at_ms < 0
  OR NEW.published_at_ms < 0
  OR NEW.recorded_at_ms < 0
BEGIN
  SELECT RAISE(ABORT, 'market universe event times must be non-negative integers');
END;

CREATE TRIGGER enforce_market_quality_observation_integer_fields
BEFORE INSERT ON market_quality_observations
WHEN typeof(NEW.observed_at_ms) <> 'integer'
  OR typeof(NEW.available_at_ms) <> 'integer'
  OR typeof(NEW.daily_committed_candles) <> 'integer'
  OR typeof(NEW.hourly_committed_candles) <> 'integer'
  OR NEW.observed_at_ms < 0
  OR NEW.available_at_ms < 0
  OR NEW.daily_committed_candles < 0
  OR NEW.hourly_committed_candles < 0
BEGIN
  SELECT RAISE(ABORT, 'market quality observation times and counts must be non-negative integers');
END;
