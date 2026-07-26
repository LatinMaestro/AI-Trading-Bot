PRAGMA foreign_keys = ON;

CREATE TABLE system_state (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE cycle_leases (
  lease_name TEXT PRIMARY KEY,
  holder_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  acquired_at TEXT NOT NULL
);

CREATE TABLE strategy_decisions (
  decision_id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  mode TEXT NOT NULL,
  pair TEXT,
  action TEXT NOT NULL CHECK (action IN ('hold', 'buy', 'sell')),
  target_exposure_pct REAL NOT NULL,
  reference_price_aud REAL,
  reason_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE order_intents (
  intent_id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  pair TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  order_type TEXT NOT NULL CHECK (order_type IN ('limit')),
  price_aud REAL NOT NULL,
  volume REAL NOT NULL,
  max_notional_aud REAL NOT NULL,
  status TEXT NOT NULL,
  exchange_order_id TEXT,
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (decision_id) REFERENCES strategy_decisions(decision_id)
);

CREATE TABLE fills (
  fill_id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL,
  exchange_trade_id TEXT NOT NULL UNIQUE,
  pair TEXT NOT NULL,
  side TEXT NOT NULL,
  price_aud REAL NOT NULL,
  volume REAL NOT NULL,
  fee_aud REAL NOT NULL,
  filled_at TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  FOREIGN KEY (intent_id) REFERENCES order_intents(intent_id)
);

CREATE TABLE equity_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  equity_aud REAL NOT NULL,
  cash_aud REAL NOT NULL,
  gross_exposure_aud REAL NOT NULL,
  high_water_mark_aud REAL NOT NULL,
  drawdown_pct REAL NOT NULL,
  captured_at TEXT NOT NULL
);

CREATE TABLE risk_events (
  event_id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'pause', 'kill')),
  code TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  cycle_id TEXT,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  previous_hash TEXT,
  event_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE tax_ledger (
  ledger_id TEXT PRIMARY KEY,
  exchange_trade_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  asset TEXT NOT NULL,
  quantity REAL NOT NULL,
  value_aud REAL NOT NULL,
  fee_aud REAL NOT NULL,
  valuation_source TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  local_date_australia TEXT NOT NULL,
  metadata_json TEXT NOT NULL
);

CREATE INDEX idx_order_intents_status ON order_intents(status, updated_at);
CREATE INDEX idx_equity_snapshots_captured ON equity_snapshots(captured_at);
CREATE INDEX idx_risk_events_created ON risk_events(created_at);
CREATE INDEX idx_tax_ledger_occurred ON tax_ledger(occurred_at);
