CREATE TABLE reddit_transient_post_observations (
  observation_id TEXT PRIMARY KEY CHECK (
    length(observation_id) = 64
    AND observation_id NOT GLOB '*[^0-9a-f]*'
  ),
  source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 500),
  source_contract_sha256 TEXT NOT NULL CHECK (
    length(source_contract_sha256) = 64
    AND source_contract_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  subreddit TEXT NOT NULL CHECK (
    length(subreddit) BETWEEN 3 AND 21
    AND subreddit NOT GLOB '*[^A-Za-z0-9_]*'
  ),
  fullname TEXT NOT NULL CHECK (
    fullname GLOB 't3_[0-9a-z]*'
    AND length(fullname) BETWEEN 4 AND 16
  ),
  published_at_ms INTEGER NOT NULL CHECK (published_at_ms >= 0),
  first_seen_at_ms INTEGER NOT NULL CHECK (first_seen_at_ms >= published_at_ms),
  last_seen_at_ms INTEGER NOT NULL CHECK (
    last_seen_at_ms >= first_seen_at_ms
    AND last_seen_at_ms <= delete_by_ms
  ),
  delete_by_ms INTEGER NOT NULL CHECK (
    delete_by_ms > first_seen_at_ms
    AND delete_by_ms <= first_seen_at_ms + 172800000
  ),
  metadata_sha256 TEXT NOT NULL CHECK (
    length(metadata_sha256) = 64
    AND metadata_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  model_training_allowed INTEGER NOT NULL CHECK (model_training_allowed = 0),
  UNIQUE (source_id, fullname)
);

CREATE TABLE reddit_transient_watch_state (
  source_id TEXT PRIMARY KEY CHECK (length(source_id) BETWEEN 1 AND 500),
  observed_at_ms INTEGER NOT NULL CHECK (observed_at_ms >= 0),
  active_observation_count INTEGER NOT NULL CHECK (
    active_observation_count >= 0
  ),
  valid_until_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('watch', 'empty', 'invalidated')),
  invalidated_at_ms INTEGER,
  invalidation_reason TEXT CHECK (
    invalidation_reason IS NULL
    OR invalidation_reason IN (
      'provider-unavailable', 'retention-expired', 'mixed'
    )
  ),
  CHECK (
    (status = 'watch'
      AND active_observation_count > 0
      AND valid_until_ms > observed_at_ms
      AND invalidated_at_ms IS NULL
      AND invalidation_reason IS NULL)
    OR (status = 'empty'
      AND active_observation_count = 0
      AND valid_until_ms IS NULL
      AND invalidated_at_ms IS NULL
      AND invalidation_reason IS NULL)
    OR (status = 'invalidated'
      AND invalidated_at_ms = observed_at_ms
      AND invalidation_reason IS NOT NULL)
  )
);

CREATE TABLE reddit_retention_audits (
  audit_id TEXT PRIMARY KEY CHECK (
    length(audit_id) = 64
    AND audit_id NOT GLOB '*[^0-9a-f]*'
  ),
  source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 500),
  observed_at_ms INTEGER NOT NULL CHECK (observed_at_ms >= 0),
  checked_count INTEGER NOT NULL CHECK (checked_count BETWEEN 0 AND 1000000),
  present_count INTEGER NOT NULL CHECK (present_count BETWEEN 0 AND 1000000),
  provider_unavailable_count INTEGER NOT NULL CHECK (
    provider_unavailable_count BETWEEN 0 AND checked_count
  ),
  retention_expired_count INTEGER NOT NULL CHECK (
    retention_expired_count BETWEEN 0 AND checked_count
  ),
  retained_count INTEGER NOT NULL CHECK (
    retained_count BETWEEN 0 AND checked_count
  ),
  next_sweep_at_ms INTEGER,
  contains_reddit_post_data INTEGER NOT NULL CHECK (
    contains_reddit_post_data = 0
  ),
  CHECK (
    provider_unavailable_count + retention_expired_count + retained_count
      = checked_count
  ),
  CHECK (present_count <= checked_count),
  CHECK (
    (retained_count = 0 AND next_sweep_at_ms IS NULL)
    OR (retained_count > 0 AND next_sweep_at_ms > observed_at_ms)
  )
);

CREATE TABLE reddit_watch_state_events (
  operation_id TEXT PRIMARY KEY CHECK (
    length(operation_id) = 36
    AND operation_id GLOB
      '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-4[0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
  ),
  source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 500),
  event_kind TEXT NOT NULL CHECK (
    event_kind IN ('watch-refreshed', 'watch-invalidated', 'retention-checked')
  ),
  observed_at_ms INTEGER NOT NULL CHECK (observed_at_ms >= 0),
  active_observation_count INTEGER NOT NULL CHECK (
    active_observation_count >= 0
  ),
  valid_until_ms INTEGER,
  invalidation_reason TEXT CHECK (
    invalidation_reason IS NULL
    OR invalidation_reason IN (
      'provider-unavailable', 'retention-expired', 'mixed'
    )
  ),
  contains_reddit_post_data INTEGER NOT NULL CHECK (
    contains_reddit_post_data = 0
  )
);

CREATE TABLE reddit_transient_purge_authorizations (
  source_id TEXT PRIMARY KEY CHECK (length(source_id) BETWEEN 1 AND 500),
  operation_id TEXT NOT NULL CHECK (length(operation_id) = 36),
  executed_at_ms INTEGER NOT NULL CHECK (executed_at_ms >= 0)
);

CREATE INDEX idx_reddit_transient_delete_by
  ON reddit_transient_post_observations(delete_by_ms, source_id);

CREATE TRIGGER reject_reddit_transient_observation_conflict
BEFORE INSERT ON reddit_transient_post_observations
WHEN EXISTS (
  SELECT 1 FROM reddit_transient_post_observations existing
  WHERE (
      existing.observation_id = NEW.observation_id
      OR (
        existing.source_id = NEW.source_id
        AND existing.fullname = NEW.fullname
      )
    )
    AND (
      existing.observation_id <> NEW.observation_id
      OR existing.source_id <> NEW.source_id
      OR existing.source_contract_sha256 <> NEW.source_contract_sha256
      OR existing.subreddit <> NEW.subreddit
      OR existing.fullname <> NEW.fullname
      OR existing.published_at_ms <> NEW.published_at_ms
      OR existing.metadata_sha256 <> NEW.metadata_sha256
      OR existing.model_training_allowed <> NEW.model_training_allowed
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Reddit transient observation conflict');
END;

CREATE TRIGGER enforce_reddit_transient_observation_update
BEFORE UPDATE ON reddit_transient_post_observations
WHEN
  OLD.observation_id <> NEW.observation_id
  OR OLD.source_id <> NEW.source_id
  OR OLD.source_contract_sha256 <> NEW.source_contract_sha256
  OR OLD.subreddit <> NEW.subreddit
  OR OLD.fullname <> NEW.fullname
  OR OLD.published_at_ms <> NEW.published_at_ms
  OR OLD.first_seen_at_ms <> NEW.first_seen_at_ms
  OR OLD.delete_by_ms <> NEW.delete_by_ms
  OR OLD.metadata_sha256 <> NEW.metadata_sha256
  OR OLD.model_training_allowed <> NEW.model_training_allowed
  OR NEW.last_seen_at_ms < OLD.last_seen_at_ms
  OR NEW.last_seen_at_ms > OLD.delete_by_ms
BEGIN
  SELECT RAISE(ABORT, 'Reddit transient observation update is invalid');
END;

CREATE TRIGGER require_reddit_transient_purge_authorization
BEFORE DELETE ON reddit_transient_post_observations
WHEN NOT EXISTS (
  SELECT 1 FROM reddit_transient_purge_authorizations authorization
  WHERE authorization.source_id = OLD.source_id
)
BEGIN
  SELECT RAISE(ABORT, 'Reddit transient deletion requires purge authorization');
END;

CREATE TRIGGER reject_reddit_watch_state_time_regression
BEFORE UPDATE ON reddit_transient_watch_state
WHEN NEW.observed_at_ms < OLD.observed_at_ms
BEGIN
  SELECT RAISE(ABORT, 'Reddit watch-state time regression');
END;

CREATE TRIGGER prevent_reddit_retention_audit_update
BEFORE UPDATE ON reddit_retention_audits
BEGIN
  SELECT RAISE(ABORT, 'Reddit retention audits are immutable');
END;

CREATE TRIGGER reject_reddit_retention_audit_conflict
BEFORE INSERT ON reddit_retention_audits
WHEN EXISTS (
  SELECT 1 FROM reddit_retention_audits existing
  WHERE existing.audit_id = NEW.audit_id
    AND (
      existing.source_id <> NEW.source_id
      OR existing.observed_at_ms <> NEW.observed_at_ms
      OR existing.checked_count <> NEW.checked_count
      OR existing.present_count <> NEW.present_count
      OR existing.provider_unavailable_count
        <> NEW.provider_unavailable_count
      OR existing.retention_expired_count <> NEW.retention_expired_count
      OR existing.retained_count <> NEW.retained_count
      OR existing.next_sweep_at_ms IS NOT NEW.next_sweep_at_ms
      OR existing.contains_reddit_post_data
        <> NEW.contains_reddit_post_data
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Reddit retention audit conflict');
END;

CREATE TRIGGER prevent_reddit_retention_audit_delete
BEFORE DELETE ON reddit_retention_audits
BEGIN
  SELECT RAISE(ABORT, 'Reddit retention audits are immutable');
END;

CREATE TRIGGER prevent_reddit_watch_event_update
BEFORE UPDATE ON reddit_watch_state_events
BEGIN
  SELECT RAISE(ABORT, 'Reddit watch-state events are immutable');
END;

CREATE TRIGGER reject_reddit_watch_event_conflict
BEFORE INSERT ON reddit_watch_state_events
WHEN EXISTS (
  SELECT 1 FROM reddit_watch_state_events existing
  WHERE existing.operation_id = NEW.operation_id
    AND (
      existing.source_id <> NEW.source_id
      OR existing.event_kind <> NEW.event_kind
      OR existing.observed_at_ms <> NEW.observed_at_ms
      OR existing.active_observation_count
        <> NEW.active_observation_count
      OR existing.valid_until_ms IS NOT NEW.valid_until_ms
      OR existing.invalidation_reason IS NOT NEW.invalidation_reason
      OR existing.contains_reddit_post_data
        <> NEW.contains_reddit_post_data
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Reddit watch-state event conflict');
END;

CREATE TRIGGER prevent_reddit_watch_event_delete
BEFORE DELETE ON reddit_watch_state_events
BEGIN
  SELECT RAISE(ABORT, 'Reddit watch-state events are immutable');
END;
