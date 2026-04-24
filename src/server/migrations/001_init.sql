CREATE TABLE IF NOT EXISTS scan_cursor (
  file_path       TEXT PRIMARY KEY,
  project_dir     TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  mtime_ms        INTEGER NOT NULL,
  last_offset     INTEGER NOT NULL,
  last_scanned_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  project_dir     TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  real_path       TEXT,
  first_seen_at   INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id         TEXT PRIMARY KEY,
  project_dir        TEXT NOT NULL,
  started_at         INTEGER NOT NULL,
  ended_at           INTEGER NOT NULL,
  message_count      INTEGER NOT NULL DEFAULT 0,
  total_input        INTEGER NOT NULL DEFAULT 0,
  total_output       INTEGER NOT NULL DEFAULT 0,
  total_cache_create INTEGER NOT NULL DEFAULT 0,
  total_cache_read   INTEGER NOT NULL DEFAULT 0,
  total_cost_usd     REAL    NOT NULL DEFAULT 0,
  FOREIGN KEY (project_dir) REFERENCES projects(project_dir)
);

CREATE TABLE IF NOT EXISTS messages (
  message_id            TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL,
  parent_uuid           TEXT,
  role                  TEXT NOT NULL,
  model                 TEXT,
  timestamp             INTEGER NOT NULL,
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cost_usd              REAL    NOT NULL DEFAULT 0,
  stop_reason           TEXT,
  tool_names            TEXT,
  text_preview          TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_session
  ON messages(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_day
  ON messages(date(timestamp/1000,'unixepoch'));
CREATE INDEX IF NOT EXISTS idx_sessions_project
  ON sessions(project_dir, started_at);
