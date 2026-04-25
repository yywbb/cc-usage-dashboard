CREATE TABLE IF NOT EXISTS pricing_overrides (
  model         TEXT PRIMARY KEY,
  input         REAL NOT NULL,
  output        REAL NOT NULL,
  cache_create  REAL NOT NULL,
  cache_read    REAL NOT NULL,
  updated_at    INTEGER NOT NULL
);
