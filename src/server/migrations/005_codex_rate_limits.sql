CREATE TABLE IF NOT EXISTS codex_rate_limit_snapshots (
  session_id           TEXT PRIMARY KEY,
  observed_at          INTEGER NOT NULL,
  primary_used_pct     REAL,
  primary_window_min   INTEGER,
  primary_resets_at    INTEGER,
  secondary_used_pct   REAL,
  secondary_window_min INTEGER,
  secondary_resets_at  INTEGER,
  plan_type            TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_observed ON codex_rate_limit_snapshots(observed_at);
