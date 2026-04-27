CREATE TABLE IF NOT EXISTS providers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  is_builtin    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  model_name    TEXT PRIMARY KEY,
  provider_id   INTEGER NOT NULL REFERENCES providers(id),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pricing (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  model_name      TEXT NOT NULL REFERENCES models(model_name) ON DELETE CASCADE,
  effective_from  TEXT NOT NULL,
  input           REAL NOT NULL,
  output          REAL NOT NULL,
  cache_create    REAL NOT NULL,
  cache_read      REAL NOT NULL,
  note            TEXT,
  created_at      INTEGER NOT NULL,
  UNIQUE (model_name, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_pricing_lookup ON pricing(model_name, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider_id);

-- Builtin providers
INSERT OR IGNORE INTO providers (slug, display_name, is_builtin, created_at, updated_at)
VALUES ('anthropic', 'Anthropic', 1, strftime('%s','now')*1000, strftime('%s','now')*1000),
       ('unknown',   'Unknown',   1, strftime('%s','now')*1000, strftime('%s','now')*1000);

-- Migrate any existing pricing_overrides:
--   1) ensure each overridden model has a row in models under anthropic
--   2) copy overrides into pricing with effective_from='1970-01-01'
INSERT OR IGNORE INTO models (model_name, provider_id, created_at, updated_at)
SELECT model,
       (SELECT id FROM providers WHERE slug='anthropic'),
       strftime('%s','now')*1000,
       strftime('%s','now')*1000
FROM pricing_overrides;

INSERT OR IGNORE INTO pricing
       (model_name, effective_from, input, output, cache_create, cache_read, note, created_at)
SELECT model, '1970-01-01', input, output, cache_create, cache_read,
       '迁移自旧规则', strftime('%s','now')*1000
FROM pricing_overrides;

DROP TABLE IF EXISTS pricing_overrides;
