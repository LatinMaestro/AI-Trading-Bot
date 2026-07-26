CREATE TABLE cycle_runs (
  schedule_key TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL UNIQUE,
  holder_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  lease_expires_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  detail_json TEXT NOT NULL
);

CREATE INDEX idx_cycle_runs_status_lease
  ON cycle_runs(status, lease_expires_at);

CREATE UNIQUE INDEX idx_order_intents_request_fingerprint
  ON order_intents(request_fingerprint);
