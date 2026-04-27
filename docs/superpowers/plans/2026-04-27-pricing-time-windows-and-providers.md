# Pricing Time Windows + Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-row-per-model `pricing_overrides` table with a three-table model (`providers / models / pricing`) so prices have effective-from windows, recompute honors message timestamps, and the user can manage third-party providers (DeepSeek, GLM, …).

**Architecture:** SQL migration `003` creates the new schema and migrates existing overrides into the new `pricing` table with `effective_from='1970-01-01'` (preserves current behavior). A new `pricing.ts` core exposes a preloaded `PriceCtx` and a pure `priceFor(ctx, model, ts)` function shared by ingest (`writer.ts`) and recompute (`admin.ts`). `routes/pricing.ts` is rewritten with REST CRUD over providers / models / pricing. Overview adds `byProvider` aggregations; Sessions adds a `providers[]` filter. Frontend Settings → Pricing is rebuilt around the new shape; Overview gains a provider BarList + trend stack option; Sessions filter bar gains a provider multi-select.

**Tech Stack:** Fastify 5, better-sqlite3 11, Vitest 2 (server). React 18, Ant Design 5, ECharts 5, @tanstack/react-query, react-router-dom 6, Vite 5 (web).

**Spec:** `docs/superpowers/specs/2026-04-27-pricing-time-windows-and-providers-design.md`

---

## File Plan

### New files

- `src/server/migrations/003_provider_pricing.sql` — schema for `providers / models / pricing`, builtin provider rows, data migration from `pricing_overrides`, drop old table.
- `src/server/seed.ts` — exported `syncKnownAnthropicModels(db)`: idempotent INSERT OR IGNORE of every key in `DEFAULT_PRICING_PER_M` into `models` under the `anthropic` provider. Called from `openDb`.
- `tests/migrations.test.ts` — fresh-DB schema + seed assertions; fixture-DB old-overrides migration assertions.
- `tests/routes-providers.test.ts` — provider CRUD + reassign-on-delete coverage.
- `tests/routes-models.test.ts` — model listing + move + delete coverage.
- `tests/routes-pricing-windows.test.ts` — pricing-window CRUD coverage. (Replaces existing `tests/routes-pricing.test.ts` semantics; old file deleted.)

### Rewritten / modified files

- `src/server/db.ts` — call `syncKnownAnthropicModels(db)` after `applyMigrations`.
- `src/server/pricing.ts` — keep `DEFAULT_PRICING_PER_M`; **remove** `PRICING`, `loadPriceTable`, `computeCostUsd`, `computeCostUsdWith`, `perTokenTable`; **add** types `Window`, `PriceCtx`, helpers `loadPriceCtx`, `pickWindow`, `priceFor`, `applyPrice`, `toLocalYMD`, `autoCreateUnderUnknown`.
- `src/server/scanner/writer.ts` — replace `loadPriceTable + computeCostUsdWith` with `loadPriceCtx + priceFor + applyPrice`. Unknown model now → 0 cost (was: Sonnet fallback).
- `src/server/routes/admin.ts` — `/api/recompute-cost` uses `loadPriceCtx + priceFor`; returns `unconfiguredCount`.
- `src/server/routes/pricing.ts` — full rewrite: providers/models/pricing CRUD; old endpoints removed.
- `src/server/routes/overview.ts` — add `byProvider[]` and `dailyTrend[].byProvider` via JOIN to providers.
- `src/server/routes/sessions.ts` — accept `providers` query (comma-separated provider slugs); filter sessions whose any message's model belongs to any of those providers.
- `src/shared/types.ts` — add `ProviderRow`, `ProviderListResponse`, `ModelView`, `PricingWindow`, `PricingHistoryResponse`; extend `OverviewResponse` (`byProvider`, per-bucket `byProvider`); update sessions response if needed.
- `tests/pricing.test.ts` — rewrite for new core (priceFor windowing, unknown model, fallback to defaults).
- `tests/writer.test.ts` — adjust unknown-model expectation (cost=0, model auto-created under unknown).
- `tests/routes-admin.test.ts` — assert `unconfiguredCount` field.
- `tests/routes-overview.test.ts` — add `byProvider` assertions.
- `tests/routes-sessions.test.ts` — add `providers` filter assertions.
- `src/web/api/client.ts` — no change expected (generic methods already cover new endpoints).
- `src/web/pages/Settings/Pricing.tsx` — full rewrite for grouped table + expandable price history + modals.
- `src/web/pages/Settings/index.tsx` — no change (still mounts Pricing pane).
- `src/web/pages/Overview/index.tsx` — add provider BarList card; extend trend stack toggle.
- `src/web/pages/Sessions/List.tsx` — add provider multi-select to filter bar.

### Deleted files

- `tests/routes-pricing.test.ts` — replaced by `routes-providers / routes-models / routes-pricing-windows`.

---

## Task 1: Backend pricing overhaul

**Goal:** Land schema migration, new pricing core, updated ingest + recompute, and rewritten pricing routes in one cohesive commit so the codebase always builds. The end state: `pricing_overrides` table no longer exists; all pricing flows through the new tables; old `loadPriceTable / computeCostUsd*` exports are gone.

**Files:**

- Create: `src/server/migrations/003_provider_pricing.sql`
- Create: `src/server/seed.ts`
- Modify: `src/server/db.ts`
- Rewrite: `src/server/pricing.ts`
- Modify: `src/server/scanner/writer.ts`
- Modify: `src/server/routes/admin.ts`
- Rewrite: `src/server/routes/pricing.ts`
- Test: `tests/migrations.test.ts` (new)
- Test: `tests/pricing.test.ts` (rewrite)
- Test: `tests/writer.test.ts` (adjust)
- Test: `tests/routes-admin.test.ts` (adjust — file already exists)
- Test: `tests/routes-providers.test.ts` (new)
- Test: `tests/routes-models.test.ts` (new)
- Test: `tests/routes-pricing-windows.test.ts` (new)
- Delete: `tests/routes-pricing.test.ts`

### Step 1: Write migration `003_provider_pricing.sql`

- [ ] Create `src/server/migrations/003_provider_pricing.sql` with:

```sql
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
```

Notes for the engineer:
- The `applyMigrations` runner in `src/server/db.ts` reads every `*.sql` file under `migrations/` in name order, runs each missing one inside a transaction, and records it in `_migrations`. The whole file above runs as one tx — the engineer does NOT add transaction wrappers to the SQL itself.
- `pricing_overrides` is created by migration `002`. Both fresh and existing installs will have the table when `003` runs.

### Step 2: Write `syncKnownAnthropicModels(db)`

- [ ] Create `src/server/seed.ts`:

```ts
import type { Database as DatabaseType } from 'better-sqlite3';
import { DEFAULT_PRICING_PER_M } from './pricing.js';

/**
 * Idempotent: registers every model in DEFAULT_PRICING_PER_M as belonging to
 * the builtin 'anthropic' provider. Called on every openDb() so newly-added
 * defaults flow into the DB on next startup without needing a migration.
 */
export function syncKnownAnthropicModels(db: DatabaseType): void {
  const anthropic = db.prepare(`SELECT id FROM providers WHERE slug='anthropic'`).get() as
    | { id: number }
    | undefined;
  if (!anthropic) return; // migration 003 not yet applied (defensive)
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO models (model_name, provider_id, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  );
  const now = Date.now();
  const tx = db.transaction(() => {
    for (const model of Object.keys(DEFAULT_PRICING_PER_M)) {
      stmt.run(model, anthropic.id, now, now);
    }
  });
  tx();
}
```

### Step 3: Wire seed into `openDb`

- [ ] Modify `src/server/db.ts` — at the end of `openDb`, after `applyMigrations(db)`, call the seed:

```ts
import { syncKnownAnthropicModels } from './seed.js';
// ... existing code ...
export function openDb(dbPath: string): DatabaseType {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  syncKnownAnthropicModels(db);
  return db;
}
```

### Step 4: Write migration tests

- [ ] Create `tests/migrations.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/server/db.js';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_001 = join(__dirname, '../src/server/migrations/001_init.sql');
const MIG_002 = join(__dirname, '../src/server/migrations/002_pricing_overrides.sql');

function tmpFile(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'cc-mig-'));
  return { path: join(dir, 'usage.db'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('migration 003', () => {
  it('on a fresh DB, creates the new tables and seeds builtin providers + Anthropic models', () => {
    const { path, cleanup } = tmpFile();
    try {
      const db = openDb(path);
      const provs = db.prepare(`SELECT slug, is_builtin FROM providers ORDER BY slug`).all();
      expect(provs).toEqual([
        { slug: 'anthropic', is_builtin: 1 },
        { slug: 'unknown', is_builtin: 1 },
      ]);
      const sonnet = db.prepare(
        `SELECT m.model_name, p.slug FROM models m JOIN providers p ON p.id=m.provider_id
         WHERE m.model_name='claude-sonnet-4-6'`,
      ).get() as { model_name: string; slug: string };
      expect(sonnet.slug).toBe('anthropic');
      const oldExists = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='pricing_overrides'`,
      ).get();
      expect(oldExists).toBeUndefined();
      db.close();
    } finally { cleanup(); }
  });

  it('migrates existing pricing_overrides rows into pricing with effective_from=1970-01-01', () => {
    const { path, cleanup } = tmpFile();
    try {
      // Apply only 001 + 002, then insert an override, then trigger 003 via openDb.
      const raw = new Database(path);
      raw.exec(readFileSync(MIG_001, 'utf8'));
      raw.exec(readFileSync(MIG_002, 'utf8'));
      raw.exec(`CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`);
      raw.prepare(`INSERT INTO _migrations(name, applied_at) VALUES (?, ?)`)
         .run('001_init.sql', Date.now());
      raw.prepare(`INSERT INTO _migrations(name, applied_at) VALUES (?, ?)`)
         .run('002_pricing_overrides.sql', Date.now());
      raw.prepare(
        `INSERT INTO pricing_overrides (model, input, output, cache_create, cache_read, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('claude-sonnet-4-6', 6, 30, 7.5, 0.6, Date.now());
      raw.close();

      const db = openDb(path); // runs 003 now
      const win = db.prepare(
        `SELECT effective_from, input, output, cache_create, cache_read, note
         FROM pricing WHERE model_name='claude-sonnet-4-6'`,
      ).get() as { effective_from: string; input: number; output: number; cache_create: number; cache_read: number; note: string };
      expect(win.effective_from).toBe('1970-01-01');
      expect(win.input).toBe(6);
      expect(win.output).toBe(30);
      expect(win.cache_create).toBe(7.5);
      expect(win.cache_read).toBe(0.6);
      expect(win.note).toBe('迁移自旧规则');
      const oldExists = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='pricing_overrides'`,
      ).get();
      expect(oldExists).toBeUndefined();
      db.close();
    } finally { cleanup(); }
  });
});
```

### Step 5: Run migration tests — expect FAIL

Run: `npx vitest run tests/migrations.test.ts`
Expected: tests FAIL (migration file + seed not yet wired). After Steps 1-3 are written this should already pass. If it doesn't, fix before continuing.

Re-run after Steps 1-3: expect PASS.

### Step 6: Rewrite `src/server/pricing.ts`

- [ ] Replace the entire file content with:

```ts
import type { Database as DatabaseType } from 'better-sqlite3';

export interface ModelPriceM {
  input: number;        // USD per 1,000,000 tokens
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export type PriceTable = Record<string, ModelPriceM>;

export const DEFAULT_PRICING_PER_M: PriceTable = {
  'claude-opus-4-7':            { input: 5, output: 25, cacheCreate: 6.25, cacheRead: 0.50 },
  'claude-opus-4-6':            { input: 5, output: 25, cacheCreate: 6.25, cacheRead: 0.50 },
  'claude-opus-4-6-thinking':   { input: 5, output: 25, cacheCreate: 6.25, cacheRead: 0.50 },
  'claude-sonnet-4-6':          { input: 3, output: 15, cacheCreate: 3.75, cacheRead: 0.30 },
  'claude-haiku-4-5':           { input: 1, output:  5, cacheCreate: 1.25, cacheRead: 0.10 },
  'claude-haiku-4-5-20251001':  { input: 1, output:  5, cacheCreate: 1.25, cacheRead: 0.10 },
};

const M = 1_000_000;

export interface Window extends ModelPriceM {
  effectiveFrom: string; // 'YYYY-MM-DD'
}

export interface PriceCtx {
  db: DatabaseType;
  modelMeta: Map<string, { providerSlug: string }>;
  windowsByModel: Map<string, Window[]>; // sorted ascending by effectiveFrom
  defaults: Map<string, ModelPriceM>;
  unknownProviderId: number;
}

/**
 * Load everything priceFor() needs into memory once. Caller invokes this at the
 * start of a batch (ingest or recompute) and reuses the ctx for every message.
 */
export function loadPriceCtx(db: DatabaseType): PriceCtx {
  const metaRows = db.prepare(
    `SELECT m.model_name, p.slug
     FROM models m JOIN providers p ON p.id = m.provider_id`,
  ).all() as Array<{ model_name: string; slug: string }>;
  const modelMeta = new Map<string, { providerSlug: string }>();
  for (const r of metaRows) modelMeta.set(r.model_name, { providerSlug: r.slug });

  const winRows = db.prepare(
    `SELECT model_name, effective_from, input, output, cache_create, cache_read
     FROM pricing
     ORDER BY model_name, effective_from ASC`,
  ).all() as Array<{
    model_name: string;
    effective_from: string;
    input: number;
    output: number;
    cache_create: number;
    cache_read: number;
  }>;
  const windowsByModel = new Map<string, Window[]>();
  for (const r of winRows) {
    const w: Window = {
      effectiveFrom: r.effective_from,
      input: r.input,
      output: r.output,
      cacheCreate: r.cache_create,
      cacheRead: r.cache_read,
    };
    const arr = windowsByModel.get(r.model_name);
    if (arr) arr.push(w); else windowsByModel.set(r.model_name, [w]);
  }

  const defaults = new Map<string, ModelPriceM>();
  for (const [k, v] of Object.entries(DEFAULT_PRICING_PER_M)) defaults.set(k, v);

  const unk = db.prepare(`SELECT id FROM providers WHERE slug='unknown'`).get() as { id: number };

  return { db, modelMeta, windowsByModel, defaults, unknownProviderId: unk.id };
}

/**
 * Returns the latest window with effectiveFrom <= date, or undefined.
 * windows must be sorted ascending by effectiveFrom (loadPriceCtx guarantees this).
 */
export function pickWindow(windows: Window[] | undefined, date: string): Window | undefined {
  if (!windows || windows.length === 0) return undefined;
  let hit: Window | undefined;
  for (const w of windows) {
    if (w.effectiveFrom <= date) hit = w; else break;
  }
  return hit;
}

/**
 * Convert a Unix-ms timestamp into a local-date 'YYYY-MM-DD' string. Matches the
 * SQL convention `date(timestamp/1000,'unixepoch','localtime')` used throughout
 * the dashboard so window boundaries align with day buckets.
 */
export function toLocalYMD(timestampMs: number): string {
  const d = new Date(timestampMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Insert a model row pointing to the unknown provider. Used when a message
 * arrives for a model the user has never registered.
 */
export function autoCreateUnderUnknown(db: DatabaseType, model: string, unknownProviderId: number): void {
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO models (model_name, provider_id, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).run(model, unknownProviderId, now, now);
}

/**
 * Returns the per-million price applicable to a message. Mutates ctx.modelMeta
 * to cache an unknown-classification so subsequent calls in the same batch
 * don't re-INSERT.
 *
 * Returns null when the model is on the unknown provider (cost should be 0)
 * OR when no pricing window and no DEFAULT fallback exist.
 */
export function priceFor(ctx: PriceCtx, model: string, messageTimestampMs: number): ModelPriceM | null {
  let meta = ctx.modelMeta.get(model);
  if (!meta) {
    autoCreateUnderUnknown(ctx.db, model, ctx.unknownProviderId);
    meta = { providerSlug: 'unknown' };
    ctx.modelMeta.set(model, meta);
  }
  if (meta.providerSlug === 'unknown') return null;

  const date = toLocalYMD(messageTimestampMs);
  const win = pickWindow(ctx.windowsByModel.get(model), date);
  if (win) return win;
  return ctx.defaults.get(model) ?? null;
}

/** Apply a per-million price to token counts → USD cost. */
export function applyPrice(price: ModelPriceM, t: TokenCounts): number {
  return (
    (t.inputTokens         * price.input)       / M +
    (t.outputTokens        * price.output)      / M +
    (t.cacheCreationTokens * price.cacheCreate) / M +
    (t.cacheReadTokens     * price.cacheRead)   / M
  );
}
```

Important removals (the engineer should NOT preserve compatibility shims):
- `PRICING` constant — gone.
- `perTokenTable()` — gone (lookup now stays per-million; multiplication happens inside `applyPrice`).
- `loadPriceTable()` — gone.
- `computeCostUsd()` and `computeCostUsdWith()` — gone.

### Step 7: Rewrite `tests/pricing.test.ts`

- [ ] Replace the entire file with:

```ts
import { describe, it, expect } from 'vitest';
import {
  loadPriceCtx, priceFor, applyPrice, pickWindow, toLocalYMD,
  DEFAULT_PRICING_PER_M, type Window,
} from '../src/server/pricing.js';
import { openDb } from '../src/server/db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-pricing-'));
  const db = openDb(join(dir, 'usage.db'));
  return { db, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function insertWindow(db: any, model: string, effectiveFrom: string, w: Partial<Window> = {}) {
  db.prepare(
    `INSERT INTO pricing (model_name, effective_from, input, output, cache_create, cache_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    model, effectiveFrom,
    w.input ?? 1, w.output ?? 2, w.cacheCreate ?? 0.5, w.cacheRead ?? 0.1,
    Date.now(),
  );
}

describe('pickWindow', () => {
  const wins: Window[] = [
    { effectiveFrom: '2025-01-01', input: 1, output: 2, cacheCreate: 0.5, cacheRead: 0.1 },
    { effectiveFrom: '2026-04-01', input: 3, output: 6, cacheCreate: 1.5, cacheRead: 0.3 },
  ];
  it('returns latest window with effectiveFrom <= date', () => {
    expect(pickWindow(wins, '2026-04-15')?.input).toBe(3);
    expect(pickWindow(wins, '2025-06-15')?.input).toBe(1);
  });
  it('returns undefined when date precedes all windows', () => {
    expect(pickWindow(wins, '2024-12-31')).toBeUndefined();
  });
  it('returns undefined for empty input', () => {
    expect(pickWindow(undefined, '2026-01-01')).toBeUndefined();
    expect(pickWindow([], '2026-01-01')).toBeUndefined();
  });
});

describe('toLocalYMD', () => {
  it('formats a Unix-ms timestamp as YYYY-MM-DD in the local timezone', () => {
    // 2026-04-15 noon local
    const ts = new Date(2026, 3, 15, 12, 0, 0).getTime();
    expect(toLocalYMD(ts)).toBe('2026-04-15');
  });
});

describe('priceFor (integration)', () => {
  it('uses DEFAULT_PRICING_PER_M when no windows exist for a known model', () => {
    const { db, cleanup } = makeDb();
    try {
      const ctx = loadPriceCtx(db);
      const p = priceFor(ctx, 'claude-sonnet-4-6', Date.now());
      expect(p).toEqual(DEFAULT_PRICING_PER_M['claude-sonnet-4-6']);
    } finally { cleanup(); }
  });

  it('hits the latest window <= message date', () => {
    const { db, cleanup } = makeDb();
    try {
      insertWindow(db, 'claude-sonnet-4-6', '2025-01-01', { input: 4, output: 16, cacheCreate: 5, cacheRead: 0.4 });
      insertWindow(db, 'claude-sonnet-4-6', '2026-04-01', { input: 6, output: 30, cacheCreate: 7.5, cacheRead: 0.6 });
      const ctx = loadPriceCtx(db);
      const p1 = priceFor(ctx, 'claude-sonnet-4-6', new Date(2026, 3, 15).getTime());
      expect(p1?.input).toBe(6);
      const p2 = priceFor(ctx, 'claude-sonnet-4-6', new Date(2025, 6, 1).getTime());
      expect(p2?.input).toBe(4);
    } finally { cleanup(); }
  });

  it('falls back to DEFAULT when message date precedes all windows', () => {
    const { db, cleanup } = makeDb();
    try {
      insertWindow(db, 'claude-sonnet-4-6', '2026-04-01', { input: 6, output: 30, cacheCreate: 7.5, cacheRead: 0.6 });
      const ctx = loadPriceCtx(db);
      const p = priceFor(ctx, 'claude-sonnet-4-6', new Date(2025, 0, 1).getTime());
      expect(p).toEqual(DEFAULT_PRICING_PER_M['claude-sonnet-4-6']);
    } finally { cleanup(); }
  });

  it('auto-creates unregistered model under unknown and returns null', () => {
    const { db, cleanup } = makeDb();
    try {
      const ctx = loadPriceCtx(db);
      const p = priceFor(ctx, 'foo-model-xyz', Date.now());
      expect(p).toBeNull();
      const row = db.prepare(
        `SELECT p.slug FROM models m JOIN providers p ON p.id=m.provider_id
         WHERE m.model_name='foo-model-xyz'`,
      ).get() as { slug: string };
      expect(row.slug).toBe('unknown');
    } finally { cleanup(); }
  });

  it('returns null for models already on the unknown provider', () => {
    const { db, cleanup } = makeDb();
    try {
      const ctx = loadPriceCtx(db);
      priceFor(ctx, 'foo-bar', Date.now()); // creates under unknown
      const p = priceFor(ctx, 'foo-bar', Date.now());
      expect(p).toBeNull();
    } finally { cleanup(); }
  });
});

describe('applyPrice', () => {
  it('computes cost from per-million price and token counts', () => {
    const cost = applyPrice(
      { input: 3, output: 15, cacheCreate: 3.75, cacheRead: 0.3 },
      { inputTokens: 1_000_000, outputTokens: 100_000, cacheCreationTokens: 0, cacheReadTokens: 0 },
    );
    // 1M*3 + 100k*15/1M = 3 + 1.5 = 4.5
    expect(cost).toBeCloseTo(4.5, 6);
  });
});
```

### Step 8: Run pricing + migration tests

Run: `npx vitest run tests/pricing.test.ts tests/migrations.test.ts`
Expected: all PASS. Fix any failures before continuing.

### Step 9: Update `src/server/scanner/writer.ts`

- [ ] Modify imports + `insertMessages`:

```ts
import type { Database as DatabaseType } from 'better-sqlite3';
import type { ParsedMessage } from '../../shared/types.js';
import { loadPriceCtx, priceFor, applyPrice } from '../pricing.js';

export function upsertProject(/* unchanged */) { /* keep existing body */ }

export function insertMessages(
  db: DatabaseType,
  projectDir: string,
  sessionId: string,
  msgs: ParsedMessage[],
): number {
  if (msgs.length === 0) return 0;
  ensureSession(db, sessionId, projectDir);
  const ctx = loadPriceCtx(db);
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO messages
       (message_id, session_id, parent_uuid, role, model, timestamp,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
        cost_usd, stop_reason, tool_names, text_preview)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((rows: ParsedMessage[]) => {
    let inserted = 0;
    for (const m of rows) {
      let cost = 0;
      if (m.model) {
        const price = priceFor(ctx, m.model, m.timestamp);
        if (price) {
          cost = applyPrice(price, {
            inputTokens: m.inputTokens,
            outputTokens: m.outputTokens,
            cacheCreationTokens: m.cacheCreationTokens,
            cacheReadTokens: m.cacheReadTokens,
          });
        }
      }
      const r = stmt.run(
        m.messageId, m.sessionId, m.parentUuid, m.role, m.model, m.timestamp,
        m.inputTokens, m.outputTokens, m.cacheCreationTokens, m.cacheReadTokens,
        cost, m.stopReason, JSON.stringify(m.toolNames), m.textPreview,
      );
      if (r.changes > 0) inserted++;
    }
    return inserted;
  });
  return tx(msgs);
}

// ensureSession + recomputeSession unchanged
```

- [ ] Update `tests/writer.test.ts`. The existing "fall back to sonnet pricing for unknown model" assertion is gone; unknown models now cost 0. Add a new test:

```ts
// Append inside the existing describe('writer', ...) block:

  it('an unknown model gets cost 0 and is auto-created under unknown provider', () => {
    const { db, cleanup } = makeDb();
    try {
      upsertProject(db, { projectDir: '/p', displayName: 'p', realPath: null });
      insertMessages(db, '/p', 's-1', [
        msg({ messageId: 'a', model: 'mystery-model', timestamp: 1 }),
      ]);
      const m = db.prepare(`SELECT cost_usd FROM messages WHERE message_id='a'`).get() as { cost_usd: number };
      expect(m.cost_usd).toBe(0);
      const r = db.prepare(
        `SELECT p.slug FROM models md JOIN providers p ON p.id=md.provider_id
         WHERE md.model_name='mystery-model'`,
      ).get() as { slug: string };
      expect(r.slug).toBe('unknown');
    } finally { cleanup(); }
  });
```

### Step 10: Update `src/server/routes/admin.ts` recompute

- [ ] Replace the `/api/recompute-cost` handler:

```ts
import type { FastifyInstance } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';
import { scanAll } from '../scanner/index.js';
import { loadPriceCtx, priceFor, applyPrice } from '../pricing.js';
import { recomputeSession } from '../scanner/writer.js';

export interface AdminDeps {
  db: DatabaseType;
  projectsRoot: string;
}

export async function registerAdmin(app: FastifyInstance, deps: AdminDeps) {
  app.get('/api/health', async () => {
    const lastScanAt = (deps.db.prepare(
      'SELECT MAX(last_scanned_at) as t FROM scan_cursor',
    ).get() as { t: number | null }).t ?? null;
    return { ok: true, lastScanAt };
  });

  app.post('/api/scan', async () => scanAll(deps.db, deps.projectsRoot));

  app.post('/api/recompute-cost', async () => {
    const rows = deps.db.prepare(
      `SELECT message_id, model, timestamp,
              input_tokens, output_tokens,
              cache_creation_tokens, cache_read_tokens
       FROM messages WHERE model IS NOT NULL`,
    ).all() as Array<{
      message_id: string;
      model: string;
      timestamp: number;
      input_tokens: number;
      output_tokens: number;
      cache_creation_tokens: number;
      cache_read_tokens: number;
    }>;
    const stmt = deps.db.prepare('UPDATE messages SET cost_usd = ? WHERE message_id = ?');
    const ctx = loadPriceCtx(deps.db);
    let unconfiguredCount = 0;
    const tx = deps.db.transaction(() => {
      for (const r of rows) {
        const price = priceFor(ctx, r.model, r.timestamp);
        let cost = 0;
        if (price) {
          cost = applyPrice(price, {
            inputTokens: r.input_tokens,
            outputTokens: r.output_tokens,
            cacheCreationTokens: r.cache_creation_tokens,
            cacheReadTokens: r.cache_read_tokens,
          });
        } else {
          unconfiguredCount++;
        }
        stmt.run(cost, r.message_id);
      }
    });
    tx();
    const sids = deps.db.prepare('SELECT session_id FROM sessions').all() as Array<{ session_id: string }>;
    for (const { session_id } of sids) recomputeSession(deps.db, session_id);
    const total = (deps.db.prepare(
      'SELECT COALESCE(SUM(total_cost_usd),0) as t FROM sessions',
    ).get() as { t: number }).t;
    return { updatedSessions: sids.length, totalCostUsd: total, unconfiguredCount };
  });
}
```

- [ ] Update `tests/routes-admin.test.ts` — assert response includes `unconfiguredCount`. Find the existing `/api/recompute-cost` test and add to its body:

```ts
expect(body.unconfiguredCount).toBe(0); // all messages are claude-* (registered under anthropic)
```

(Read the file first to find the right spot. If the existing test uses a different variable name than `body`, adapt accordingly.)

### Step 11: Rewrite `src/server/routes/pricing.ts`

- [ ] Replace the entire file with a CRUD implementation for providers / models / pricing windows:

```ts
import type { FastifyInstance } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';
import { DEFAULT_PRICING_PER_M, type ModelPriceM } from '../pricing.js';

interface PricingDeps {
  db: DatabaseType;
}

const SLUG_RE = /^[a-z0-9-]{1,32}$/;
const MODEL_RE = /^[A-Za-z0-9._-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRICE_FIELDS = ['input', 'output', 'cacheCreate', 'cacheRead'] as const;

interface PricePayload { input: number; output: number; cacheCreate: number; cacheRead: number; }

function validatePrice(body: unknown): PricePayload | string {
  if (!body || typeof body !== 'object') return 'body must be an object';
  const b = body as Record<string, unknown>;
  const out = {} as PricePayload;
  for (const f of PRICE_FIELDS) {
    const v = b[f];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      return `field "${f}" must be a non-negative finite number`;
    }
    out[f] = v;
  }
  return out;
}

export async function registerPricing(app: FastifyInstance, deps: PricingDeps) {
  // ---------- providers ----------
  app.get('/api/providers', async () => {
    const rows = deps.db.prepare(
      `SELECT p.id, p.slug, p.display_name AS displayName, p.is_builtin AS isBuiltin,
              (SELECT COUNT(*) FROM models m WHERE m.provider_id = p.id) AS modelCount
       FROM providers p
       ORDER BY p.is_builtin DESC, p.slug`,
    ).all();
    return rows;
  });

  app.post('/api/providers', async (req, reply) => {
    const b = (req.body ?? {}) as { slug?: string; displayName?: string };
    if (!b.slug || !SLUG_RE.test(b.slug)) {
      reply.code(400);
      return { error: 'slug must match /^[a-z0-9-]{1,32}$/' };
    }
    if (!b.displayName || typeof b.displayName !== 'string' || !b.displayName.trim()) {
      reply.code(400);
      return { error: 'displayName required' };
    }
    const now = Date.now();
    try {
      const r = deps.db.prepare(
        `INSERT INTO providers (slug, display_name, is_builtin, created_at, updated_at)
         VALUES (?, ?, 0, ?, ?)`,
      ).run(b.slug, b.displayName.trim(), now, now);
      return { id: r.lastInsertRowid, slug: b.slug, displayName: b.displayName.trim(), isBuiltin: 0 };
    } catch (e: any) {
      if (String(e.message).includes('UNIQUE')) {
        reply.code(409);
        return { error: `slug "${b.slug}" already exists` };
      }
      throw e;
    }
  });

  app.patch('/api/providers/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = (req.body ?? {}) as { displayName?: string };
    if (!b.displayName || typeof b.displayName !== 'string' || !b.displayName.trim()) {
      reply.code(400);
      return { error: 'displayName required' };
    }
    const r = deps.db.prepare(
      `UPDATE providers SET display_name = ?, updated_at = ? WHERE id = ?`,
    ).run(b.displayName.trim(), Date.now(), id);
    if (r.changes === 0) { reply.code(404); return { error: 'not found' }; }
    return { id, displayName: b.displayName.trim() };
  });

  app.delete('/api/providers/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const prov = deps.db.prepare(`SELECT id, slug, is_builtin FROM providers WHERE id=?`).get(id) as
      | { id: number; slug: string; is_builtin: number } | undefined;
    if (!prov) { reply.code(404); return { error: 'not found' }; }
    if (prov.is_builtin) { reply.code(400); return { error: 'builtin provider cannot be deleted' }; }
    const unk = deps.db.prepare(`SELECT id FROM providers WHERE slug='unknown'`).get() as { id: number };
    const tx = deps.db.transaction(() => {
      deps.db.prepare(`UPDATE models SET provider_id=?, updated_at=? WHERE provider_id=?`)
             .run(unk.id, Date.now(), id);
      deps.db.prepare(`DELETE FROM providers WHERE id=?`).run(id);
    });
    tx();
    return { id, deleted: true };
  });

  // ---------- models ----------
  app.get('/api/models', async () => {
    const rows = deps.db.prepare(
      `SELECT m.model_name AS modelName, p.id AS providerId, p.slug AS providerSlug,
              p.display_name AS providerDisplayName,
              COALESCE(SUM(msg.input_tokens + msg.output_tokens
                         + msg.cache_creation_tokens + msg.cache_read_tokens), 0) AS totalTokens,
              COALESCE(SUM(msg.cost_usd), 0) AS costUsd,
              COALESCE(COUNT(msg.message_id), 0) AS messageCount
       FROM models m
       JOIN providers p ON p.id = m.provider_id
       LEFT JOIN messages msg ON msg.model = m.model_name
       GROUP BY m.model_name
       ORDER BY p.is_builtin DESC, p.slug, m.model_name`,
    ).all() as Array<{
      modelName: string; providerId: number; providerSlug: string; providerDisplayName: string;
      totalTokens: number; costUsd: number; messageCount: number;
    }>;
    // Attach current effective price (latest pricing window OR DEFAULT_PRICING_PER_M).
    const winStmt = deps.db.prepare(
      `SELECT input, output, cache_create AS cacheCreate, cache_read AS cacheRead, effective_from AS effectiveFrom
       FROM pricing WHERE model_name = ? ORDER BY effective_from DESC LIMIT 1`,
    );
    return rows.map(r => {
      const w = winStmt.get(r.modelName) as
        | (ModelPriceM & { effectiveFrom: string }) | undefined;
      const def = DEFAULT_PRICING_PER_M[r.modelName] ?? null;
      let currentPrice: ModelPriceM | null = w ?? def;
      let priceSource: 'window' | 'default' | 'none' = w ? 'window' : def ? 'default' : 'none';
      return {
        ...r,
        currentPrice,
        priceSource,
        currentEffectiveFrom: w?.effectiveFrom ?? null,
      };
    });
  });

  app.patch('/api/models/:model', async (req, reply) => {
    const model = (req.params as { model: string }).model;
    if (!MODEL_RE.test(model)) { reply.code(400); return { error: 'invalid model name' }; }
    const b = (req.body ?? {}) as { providerId?: number };
    if (typeof b.providerId !== 'number') { reply.code(400); return { error: 'providerId required' }; }
    const prov = deps.db.prepare(`SELECT id FROM providers WHERE id=?`).get(b.providerId);
    if (!prov) { reply.code(400); return { error: 'provider not found' }; }
    const r = deps.db.prepare(`UPDATE models SET provider_id=?, updated_at=? WHERE model_name=?`)
                     .run(b.providerId, Date.now(), model);
    if (r.changes === 0) { reply.code(404); return { error: 'model not found' }; }
    return { model, providerId: b.providerId };
  });

  app.delete('/api/models/:model', async (req, reply) => {
    const model = (req.params as { model: string }).model;
    const r = deps.db.prepare(`DELETE FROM models WHERE model_name=?`).run(model);
    if (r.changes === 0) { reply.code(404); return { error: 'not found' }; }
    return { model, deleted: true };
  });

  // ---------- pricing windows ----------
  app.get('/api/pricing/:model', async (req, reply) => {
    const model = (req.params as { model: string }).model;
    const m = deps.db.prepare(`SELECT model_name FROM models WHERE model_name=?`).get(model);
    if (!m) { reply.code(404); return { error: 'model not found' }; }
    const windows = deps.db.prepare(
      `SELECT id, effective_from AS effectiveFrom, input, output,
              cache_create AS cacheCreate, cache_read AS cacheRead, note, created_at AS createdAt
       FROM pricing WHERE model_name=?
       ORDER BY effective_from DESC`,
    ).all(model);
    const def = DEFAULT_PRICING_PER_M[model] ?? null;
    return { model, windows, defaultFallback: def };
  });

  app.post('/api/pricing/:model', async (req, reply) => {
    const model = (req.params as { model: string }).model;
    const m = deps.db.prepare(`SELECT model_name FROM models WHERE model_name=?`).get(model);
    if (!m) { reply.code(404); return { error: 'model not found' }; }
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (typeof b.effectiveFrom !== 'string' || !DATE_RE.test(b.effectiveFrom)) {
      reply.code(400); return { error: 'effectiveFrom must be YYYY-MM-DD' };
    }
    const price = validatePrice(b);
    if (typeof price === 'string') { reply.code(400); return { error: price }; }
    const note = typeof b.note === 'string' ? b.note : null;
    try {
      const r = deps.db.prepare(
        `INSERT INTO pricing (model_name, effective_from, input, output, cache_create, cache_read, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(model, b.effectiveFrom, price.input, price.output, price.cacheCreate, price.cacheRead, note, Date.now());
      return { id: r.lastInsertRowid, model, effectiveFrom: b.effectiveFrom, ...price, note };
    } catch (e: any) {
      if (String(e.message).includes('UNIQUE')) {
        reply.code(409); return { error: `pricing for (${model}, ${b.effectiveFrom}) already exists` };
      }
      throw e;
    }
  });

  app.patch('/api/pricing/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const price = validatePrice(b);
    if (typeof price === 'string') { reply.code(400); return { error: price }; }
    if (typeof b.effectiveFrom !== 'string' || !DATE_RE.test(b.effectiveFrom)) {
      reply.code(400); return { error: 'effectiveFrom must be YYYY-MM-DD' };
    }
    const note = typeof b.note === 'string' ? b.note : null;
    const r = deps.db.prepare(
      `UPDATE pricing SET effective_from=?, input=?, output=?, cache_create=?, cache_read=?, note=?
       WHERE id=?`,
    ).run(b.effectiveFrom, price.input, price.output, price.cacheCreate, price.cacheRead, note, id);
    if (r.changes === 0) { reply.code(404); return { error: 'not found' }; }
    return { id, effectiveFrom: b.effectiveFrom, ...price, note };
  });

  app.delete('/api/pricing/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const r = deps.db.prepare(`DELETE FROM pricing WHERE id=?`).run(id);
    if (r.changes === 0) { reply.code(404); return { error: 'not found' }; }
    return { id, deleted: true };
  });
}
```

### Step 12: Delete `tests/routes-pricing.test.ts`

- [ ] Run: `git rm tests/routes-pricing.test.ts`

(The file tested the old `loadPriceTable / GET-PUT-DELETE-on-pricing/:model` shape, which is replaced.)

### Step 13: Write `tests/routes-providers.test.ts`

- [ ] Create with:

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { openDb } from '../src/server/db.js';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-prov-'));
  const projectsRoot = join(dir, 'projects');
  mkdirSync(projectsRoot, { recursive: true });
  const db = openDb(join(dir, 'usage.db'));
  const app = await buildApp({ db, projectsRoot });
  return { app, db, cleanup: async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('/api/providers', () => {
  it('GET lists builtin providers with model counts', async () => {
    const { app, cleanup } = await setup();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/providers' });
      const body = res.json() as Array<{ slug: string; isBuiltin: number; modelCount: number }>;
      const slugs = body.map(b => b.slug).sort();
      expect(slugs).toEqual(['anthropic', 'unknown']);
      const anthropic = body.find(b => b.slug === 'anthropic')!;
      expect(anthropic.isBuiltin).toBe(1);
      expect(anthropic.modelCount).toBeGreaterThan(0); // seeded with DEFAULT_PRICING_PER_M
    } finally { await cleanup(); }
  });

  it('POST creates a non-builtin provider', async () => {
    const { app, cleanup } = await setup();
    try {
      const res = await app.inject({
        method: 'POST', url: '/api/providers',
        payload: { slug: 'deepseek', displayName: 'DeepSeek' },
        headers: { 'content-type': 'application/json' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.slug).toBe('deepseek');
      expect(body.isBuiltin).toBe(0);
    } finally { await cleanup(); }
  });

  it('POST rejects bad slug and duplicate slug', async () => {
    const { app, cleanup } = await setup();
    try {
      const bad = await app.inject({
        method: 'POST', url: '/api/providers',
        payload: { slug: 'Bad Slug!', displayName: 'x' },
        headers: { 'content-type': 'application/json' },
      });
      expect(bad.statusCode).toBe(400);
      const dup = await app.inject({
        method: 'POST', url: '/api/providers',
        payload: { slug: 'anthropic', displayName: 'x' },
        headers: { 'content-type': 'application/json' },
      });
      expect(dup.statusCode).toBe(409);
    } finally { await cleanup(); }
  });

  it('PATCH updates displayName', async () => {
    const { app, db, cleanup } = await setup();
    try {
      const id = (db.prepare(`SELECT id FROM providers WHERE slug='anthropic'`).get() as { id: number }).id;
      const r = await app.inject({
        method: 'PATCH', url: `/api/providers/${id}`,
        payload: { displayName: 'Anthropic (PBC)' },
        headers: { 'content-type': 'application/json' },
      });
      expect(r.statusCode).toBe(200);
      const after = (db.prepare(`SELECT display_name FROM providers WHERE id=?`).get(id) as { display_name: string });
      expect(after.display_name).toBe('Anthropic (PBC)');
    } finally { await cleanup(); }
  });

  it('DELETE rejects builtin', async () => {
    const { app, db, cleanup } = await setup();
    try {
      const id = (db.prepare(`SELECT id FROM providers WHERE slug='anthropic'`).get() as { id: number }).id;
      const r = await app.inject({ method: 'DELETE', url: `/api/providers/${id}` });
      expect(r.statusCode).toBe(400);
    } finally { await cleanup(); }
  });

  it('DELETE non-builtin reassigns its models to unknown', async () => {
    const { app, db, cleanup } = await setup();
    try {
      // Create deepseek + a model under it
      const cr = await app.inject({
        method: 'POST', url: '/api/providers',
        payload: { slug: 'deepseek', displayName: 'DeepSeek' },
        headers: { 'content-type': 'application/json' },
      });
      const provId = cr.json().id as number;
      db.prepare(
        `INSERT INTO models (model_name, provider_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ).run('deepseek-chat', provId, Date.now(), Date.now());

      const r = await app.inject({ method: 'DELETE', url: `/api/providers/${provId}` });
      expect(r.statusCode).toBe(200);

      const reassigned = db.prepare(
        `SELECT p.slug FROM models m JOIN providers p ON p.id=m.provider_id
         WHERE m.model_name='deepseek-chat'`,
      ).get() as { slug: string };
      expect(reassigned.slug).toBe('unknown');
    } finally { await cleanup(); }
  });
});
```

### Step 14: Write `tests/routes-models.test.ts`

- [ ] Create with:

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { openDb } from '../src/server/db.js';
import { scanAll } from '../src/server/scanner/index.js';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function setup(seed = false) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-models-'));
  const projectsRoot = join(dir, 'projects');
  if (seed) {
    const proj = join(projectsRoot, 'D--test-proj');
    mkdirSync(proj, { recursive: true });
    copyFileSync('tests/fixtures/session-sample.jsonl', join(proj, 'sess-1.jsonl'));
  } else {
    mkdirSync(projectsRoot, { recursive: true });
  }
  const db = openDb(join(dir, 'usage.db'));
  if (seed) scanAll(db, projectsRoot);
  const app = await buildApp({ db, projectsRoot });
  return { app, db, cleanup: async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('/api/models', () => {
  it('GET lists seeded Anthropic models with default current price', async () => {
    const { app, cleanup } = await setup();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/models' });
      const body = res.json() as Array<any>;
      const sonnet = body.find(m => m.modelName === 'claude-sonnet-4-6');
      expect(sonnet).toBeDefined();
      expect(sonnet.providerSlug).toBe('anthropic');
      expect(sonnet.priceSource).toBe('default');
      expect(sonnet.currentPrice.input).toBe(3);
      expect(sonnet.messageCount).toBe(0);
    } finally { await cleanup(); }
  });

  it('GET reflects usage after a scan', async () => {
    const { app, cleanup } = await setup(true);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/models' });
      const body = res.json() as Array<any>;
      const sonnet = body.find(m => m.modelName === 'claude-sonnet-4-6');
      expect(sonnet.messageCount).toBeGreaterThan(0);
      expect(sonnet.totalTokens).toBeGreaterThan(0);
    } finally { await cleanup(); }
  });

  it('PATCH moves a model to another provider', async () => {
    const { app, db, cleanup } = await setup();
    try {
      const cr = await app.inject({
        method: 'POST', url: '/api/providers',
        payload: { slug: 'deepseek', displayName: 'DeepSeek' },
        headers: { 'content-type': 'application/json' },
      });
      const dsId = cr.json().id as number;
      db.prepare(
        `INSERT INTO models (model_name, provider_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ).run('deepseek-chat', dsId, Date.now(), Date.now());
      const anthropicId = (db.prepare(`SELECT id FROM providers WHERE slug='anthropic'`).get() as { id: number }).id;
      const r = await app.inject({
        method: 'PATCH', url: '/api/models/deepseek-chat',
        payload: { providerId: anthropicId },
        headers: { 'content-type': 'application/json' },
      });
      expect(r.statusCode).toBe(200);
      const after = db.prepare(
        `SELECT p.slug FROM models m JOIN providers p ON p.id=m.provider_id WHERE m.model_name='deepseek-chat'`,
      ).get() as { slug: string };
      expect(after.slug).toBe('anthropic');
    } finally { await cleanup(); }
  });

  it('DELETE removes a model and cascades its pricing windows', async () => {
    const { app, db, cleanup } = await setup();
    try {
      // Seed pricing window first
      await app.inject({
        method: 'POST', url: '/api/pricing/claude-sonnet-4-6',
        payload: { effectiveFrom: '2026-04-01', input: 6, output: 30, cacheCreate: 7.5, cacheRead: 0.6 },
        headers: { 'content-type': 'application/json' },
      });
      const r = await app.inject({ method: 'DELETE', url: '/api/models/claude-sonnet-4-6' });
      expect(r.statusCode).toBe(200);
      const stillThere = db.prepare(
        `SELECT model_name FROM pricing WHERE model_name='claude-sonnet-4-6'`,
      ).all();
      expect(stillThere).toEqual([]); // cascaded
    } finally { await cleanup(); }
  });
});
```

### Step 15: Write `tests/routes-pricing-windows.test.ts`

- [ ] Create with:

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { openDb } from '../src/server/db.js';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-pwin-'));
  const projectsRoot = join(dir, 'projects');
  mkdirSync(projectsRoot, { recursive: true });
  const db = openDb(join(dir, 'usage.db'));
  const app = await buildApp({ db, projectsRoot });
  return { app, db, cleanup: async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('/api/pricing/:model', () => {
  it('GET returns empty windows + defaultFallback for a known model', async () => {
    const { app, cleanup } = await setup();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/pricing/claude-sonnet-4-6' });
      const body = res.json();
      expect(body.windows).toEqual([]);
      expect(body.defaultFallback.input).toBe(3);
    } finally { await cleanup(); }
  });

  it('POST creates a window, GET returns it, PATCH updates, DELETE removes', async () => {
    const { app, cleanup } = await setup();
    try {
      const create = await app.inject({
        method: 'POST', url: '/api/pricing/claude-sonnet-4-6',
        payload: { effectiveFrom: '2026-04-01', input: 6, output: 30, cacheCreate: 7.5, cacheRead: 0.6, note: 'price up' },
        headers: { 'content-type': 'application/json' },
      });
      expect(create.statusCode).toBe(200);
      const id = create.json().id as number;

      const list = await app.inject({ method: 'GET', url: '/api/pricing/claude-sonnet-4-6' });
      expect(list.json().windows).toHaveLength(1);

      const patch = await app.inject({
        method: 'PATCH', url: `/api/pricing/${id}`,
        payload: { effectiveFrom: '2026-05-01', input: 7, output: 31, cacheCreate: 7.5, cacheRead: 0.6 },
        headers: { 'content-type': 'application/json' },
      });
      expect(patch.statusCode).toBe(200);

      const del = await app.inject({ method: 'DELETE', url: `/api/pricing/${id}` });
      expect(del.statusCode).toBe(200);
      const after = await app.inject({ method: 'GET', url: '/api/pricing/claude-sonnet-4-6' });
      expect(after.json().windows).toEqual([]);
    } finally { await cleanup(); }
  });

  it('POST rejects duplicate (model, effectiveFrom)', async () => {
    const { app, cleanup } = await setup();
    try {
      await app.inject({
        method: 'POST', url: '/api/pricing/claude-sonnet-4-6',
        payload: { effectiveFrom: '2026-04-01', input: 1, output: 1, cacheCreate: 1, cacheRead: 1 },
        headers: { 'content-type': 'application/json' },
      });
      const dup = await app.inject({
        method: 'POST', url: '/api/pricing/claude-sonnet-4-6',
        payload: { effectiveFrom: '2026-04-01', input: 2, output: 2, cacheCreate: 2, cacheRead: 2 },
        headers: { 'content-type': 'application/json' },
      });
      expect(dup.statusCode).toBe(409);
    } finally { await cleanup(); }
  });

  it('POST rejects invalid effectiveFrom and negative prices', async () => {
    const { app, cleanup } = await setup();
    try {
      const badDate = await app.inject({
        method: 'POST', url: '/api/pricing/claude-sonnet-4-6',
        payload: { effectiveFrom: '2026/04/01', input: 1, output: 1, cacheCreate: 1, cacheRead: 1 },
        headers: { 'content-type': 'application/json' },
      });
      expect(badDate.statusCode).toBe(400);
      const negative = await app.inject({
        method: 'POST', url: '/api/pricing/claude-sonnet-4-6',
        payload: { effectiveFrom: '2026-04-01', input: -1, output: 1, cacheCreate: 1, cacheRead: 1 },
        headers: { 'content-type': 'application/json' },
      });
      expect(negative.statusCode).toBe(400);
    } finally { await cleanup(); }
  });

  it('POST returns 404 if model not registered', async () => {
    const { app, cleanup } = await setup();
    try {
      const r = await app.inject({
        method: 'POST', url: '/api/pricing/never-heard-of-it',
        payload: { effectiveFrom: '2026-04-01', input: 1, output: 1, cacheCreate: 1, cacheRead: 1 },
        headers: { 'content-type': 'application/json' },
      });
      expect(r.statusCode).toBe(404);
    } finally { await cleanup(); }
  });
});
```

### Step 16: Run the entire test suite

Run: `npx vitest run`
Expected: ALL tests pass (server side). If any pre-existing tests fail because they depended on removed pricing exports, update them to use `priceFor / applyPrice` directly. Common fixes:
- `import { computeCostUsd }` → remove import; use `applyPrice(price, tokens)` with explicit price object.
- `loadPriceTable(db)` references → replace with `loadPriceCtx(db)` or read `pricing` table directly in the test.

Run: `npm run typecheck`
Expected: PASS.

### Step 17: Commit

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(pricing): time-windowed prices + provider model

- Migration 003: providers/models/pricing tables; migrate old overrides to
  effective_from='1970-01-01'; drop pricing_overrides
- New pricing core: PriceCtx + priceFor() honors message timestamp; unknown
  models auto-classify to 'unknown' provider with cost 0 (no Sonnet fallback)
- writer.ts and recompute use the same priceFor()
- routes/pricing.ts rewritten: providers/models/pricing CRUD
- /api/recompute-cost adds unconfiguredCount in response
EOF
)"
```

---

## Task 2: `/api/overview` byProvider

**Files:**

- Modify: `src/server/routes/overview.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/routes-overview.test.ts`

### Step 1: Extend `OverviewResponse` type

- [ ] Modify `src/shared/types.ts` — add to the `OverviewResponse` interface:

```ts
export interface OverviewResponse {
  // ... existing fields ...
  byProvider: Array<{
    providerSlug: string;
    providerDisplayName: string;
    tokens: number;
    costUsd: number;
    share: number;
  }>;
  dailyTrend: Array<{
    date: string;
    inputTokens: number;
    outputTokens: number;
    cacheCreate: number;
    cacheRead: number;
    costUsd: number;
    byModel: Record<string, number>;
    byProvider: Record<string, number>; // NEW: provider slug → tokens
  }>;
  // ... rest ...
}
```

(The shape adds `byProvider` to the top level and a per-bucket `byProvider` map.)

### Step 2: Write failing test

- [ ] Modify `tests/routes-overview.test.ts` — add a new test inside the existing describe block:

```ts
  it('returns byProvider aggregates and per-bucket byProvider', async () => {
    const { app, cleanup } = await setup(true); // seeds session-sample.jsonl
    try {
      const res = await app.inject({ method: 'GET', url: '/api/overview?range=all&granularity=day' });
      const body = res.json();
      expect(Array.isArray(body.byProvider)).toBe(true);
      const anthropic = body.byProvider.find((b: any) => b.providerSlug === 'anthropic');
      expect(anthropic).toBeDefined();
      expect(anthropic.tokens).toBeGreaterThan(0);
      expect(anthropic.share).toBeGreaterThan(0);
      const firstBucket = body.dailyTrend[0];
      expect(firstBucket.byProvider).toBeDefined();
      expect(typeof firstBucket.byProvider).toBe('object');
    } finally { await cleanup(); }
  });
```

(Inspect `tests/routes-overview.test.ts` first; the `setup(true)` helper already exists. If the helper is named differently, adapt.)

Run: `npx vitest run tests/routes-overview.test.ts -t byProvider`
Expected: FAIL (field missing).

### Step 3: Implement `byProvider`

- [ ] Modify `src/server/routes/overview.ts` — inside `computeOverview`, add:

```ts
  // After byModel computation:
  const byProviderRaw = db.prepare(
    `SELECT p.slug AS providerSlug, p.display_name AS providerDisplayName,
            COALESCE(SUM(msg.input_tokens + msg.output_tokens
                       + msg.cache_creation_tokens + msg.cache_read_tokens), 0) AS tokens,
            COALESCE(SUM(msg.cost_usd), 0) AS costUsd
     FROM messages msg
     JOIN models m ON m.model_name = msg.model
     JOIN providers p ON p.id = m.provider_id
     WHERE msg.model IS NOT NULL AND msg.timestamp BETWEEN ? AND ?
     GROUP BY p.slug
     ORDER BY tokens DESC`,
  ).all(r.from, r.to) as Array<{ providerSlug: string; providerDisplayName: string; tokens: number; costUsd: number }>;
  const totalTokensProv = byProviderRaw.reduce((a, x) => a + x.tokens, 0) || 1;
  const byProvider = byProviderRaw.map(p => ({ ...p, share: p.tokens / totalTokensProv }));
```

- [ ] Extend the daily trend query to include provider grouping. Replace the existing `dailyRaw` block with a two-query approach (one for byModel as today, one for byProvider) and merge into the `dailyMap`:

```ts
  const dailyByProviderRaw = db.prepare(
    `SELECT ${bucketExpr} AS d, p.slug AS providerSlug,
            SUM(msg.input_tokens + msg.output_tokens
              + msg.cache_creation_tokens + msg.cache_read_tokens) AS tot
     FROM messages msg
     JOIN models m ON m.model_name = msg.model
     JOIN providers p ON p.id = m.provider_id
     WHERE msg.model IS NOT NULL AND msg.timestamp BETWEEN ? AND ?
     GROUP BY d, p.slug
     ORDER BY d`,
  ).all(r.from, r.to) as Array<{ d: string; providerSlug: string; tot: number }>;
  for (const row of dailyByProviderRaw) {
    let b = dailyMap.get(row.d);
    if (!b) {
      b = {
        date: row.d, inputTokens: 0, outputTokens: 0, cacheCreate: 0, cacheRead: 0,
        costUsd: 0, byModel: {}, byProvider: {},
      };
      dailyMap.set(row.d, b);
    }
    if (!b.byProvider) b.byProvider = {};
    b.byProvider[row.providerSlug] = (b.byProvider[row.providerSlug] ?? 0) + row.tot;
  }
```

- [ ] In the bucket initializer (the original `if (!b)` block), add `byProvider: {}` alongside `byModel: {}`. The full updated initializer:

```ts
      b = {
        date: row.d,
        inputTokens: 0, outputTokens: 0,
        cacheCreate: 0, cacheRead: 0,
        costUsd: 0,
        byModel: {} as Record<string, number>,
        byProvider: {} as Record<string, number>,
      };
```

- [ ] Add `byProvider` to the response object at the bottom of `computeOverview`:

```ts
  return {
    range: { from: new Date(r.from).toISOString(), to: new Date(r.to).toISOString() },
    totals: { /* unchanged */ },
    byModel: byModelOut,
    byProject,
    byProvider,
    byTool,
    topSessions,
    dailyTrend,
    cacheHitRate,
    previous,
  };
```

### Step 4: Run tests

Run: `npx vitest run tests/routes-overview.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

### Step 5: Commit

```bash
git add src/server/routes/overview.ts src/shared/types.ts tests/routes-overview.test.ts
git commit -m "feat(overview): add byProvider aggregations + per-bucket provider map"
```

---

## Task 3: `/api/sessions` providers filter

**Files:**

- Modify: `src/server/routes/sessions.ts`
- Test: `tests/routes-sessions.test.ts`

### Step 1: Write failing test

- [ ] Modify `tests/routes-sessions.test.ts` — add a new test (inspect existing setup helper first; reuse it):

```ts
  it('filters sessions to those with messages from a given provider', async () => {
    const { app, db, cleanup } = await setup(true);
    try {
      // Move claude-sonnet-4-6 to a fresh provider 'deepseek'
      const dsRes = await app.inject({
        method: 'POST', url: '/api/providers',
        payload: { slug: 'deepseek', displayName: 'DeepSeek' },
        headers: { 'content-type': 'application/json' },
      });
      const dsId = dsRes.json().id;
      await app.inject({
        method: 'PATCH', url: '/api/models/claude-sonnet-4-6',
        payload: { providerId: dsId },
        headers: { 'content-type': 'application/json' },
      });

      const all = await app.inject({ method: 'GET', url: '/api/sessions' });
      const ds  = await app.inject({ method: 'GET', url: '/api/sessions?providers=deepseek' });
      const an  = await app.inject({ method: 'GET', url: '/api/sessions?providers=anthropic' });
      expect(ds.json().total).toBeGreaterThan(0);
      // The seeded fixture only uses claude-sonnet-4-6, so anthropic filter now finds 0
      expect(an.json().total).toBe(0);
      expect(ds.json().total).toBe(all.json().total);
    } finally { await cleanup(); }
  });
```

Run: `npx vitest run tests/routes-sessions.test.ts -t providers`
Expected: FAIL.

### Step 2: Implement `providers` query parameter

- [ ] Modify `src/server/routes/sessions.ts` — extend the query parsing and SQL:

```ts
    const q = req.query as {
      projectDir?: string; providers?: string;
      from?: string; to?: string; limit?: string; offset?: string;
      sortBy?: string; sortOrder?: string;
    };
    // ... existing parsing ...
    const providerSlugs = q.providers
      ? q.providers.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    // Provider filter: subquery against messages JOIN models JOIN providers
    const provPlaceholders = providerSlugs.map((_, i) => `@pr${i}`).join(',');
    const whereProv = providerSlugs.length
      ? `AND s.session_id IN (
           SELECT DISTINCT msg.session_id FROM messages msg
           JOIN models m ON m.model_name = msg.model
           JOIN providers pp ON pp.id = m.provider_id
           WHERE pp.slug IN (${provPlaceholders})
         )`
      : '';
    const provParams: Record<string, string> = {};
    providerSlugs.forEach((s, i) => (provParams[`pr${i}`] = s));
```

- [ ] Append `${whereProv}` after `${whereProj}` in BOTH the `totalRow` and `rows` SQL strings, and `${whereProv}` in the `statRows` query. Add `...provParams` to every `.get/.all(...)` call's bound parameter object.

The complete updated `totalRow` example:

```ts
    const totalRow = db.prepare(
      `SELECT COUNT(*) as n FROM sessions s
       WHERE s.started_at BETWEEN @from AND @to ${whereProj} ${whereProv}`,
    ).get({ from, to, ...projParams, ...provParams }) as { n: number };
```

Apply the same pattern to `rows` and `statRows`.

### Step 3: Run tests

Run: `npx vitest run tests/routes-sessions.test.ts`
Expected: PASS.

### Step 4: Commit

```bash
git add src/server/routes/sessions.ts tests/routes-sessions.test.ts
git commit -m "feat(sessions): providers[] query param filters by message provider"
```

---

## Task 4: Settings UI — Pricing rewrite

**Files:**

- Modify: `src/web/api/client.ts` (add `patch` method)
- Rewrite: `src/web/pages/Settings/Pricing.tsx`
- Create: `src/web/pages/Settings/ProvidersModal.tsx`
- Create: `src/web/pages/Settings/PricingHistoryTable.tsx`

This task has no automated tests (the project has no FE test framework). After the steps below, perform a manual smoke check.

### Step 1: Add `patch` method to the API client

The backend uses PATCH for partial updates of providers / models / pricing. The shared `api` client currently exports only `get / post / put / delete`. Add `patch`.

- [ ] Modify `src/web/api/client.ts` — replace the `api` const with:

```ts
export const api = {
  get:    <T>(url: string) => request<T>('GET', url),
  post:   <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put:    <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  patch:  <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  delete: <T>(url: string) => request<T>('DELETE', url),
};
```

### Step 2: Build the providers modal

- [ ] Create `src/web/pages/Settings/ProvidersModal.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Table, Button, Input, Form, Space, Tag, Popconfirm, message } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { api } from '../../api/client.js';

interface Provider {
  id: number; slug: string; displayName: string; isBuiltin: number; modelCount: number;
}

export default function ProvidersModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [form] = Form.useForm<{ slug: string; displayName: string }>();
  const [editing, setEditing] = useState<Record<number, string>>({});

  const list = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.get<Provider[]>('/api/providers'),
    enabled: open,
  });

  const addMut = useMutation({
    mutationFn: (v: { slug: string; displayName: string }) => api.post<Provider>('/api/providers', v),
    onSuccess: () => {
      message.success('已新增供应商');
      setAddOpen(false); form.resetFields();
      qc.invalidateQueries({ queryKey: ['providers'] });
      qc.invalidateQueries({ queryKey: ['models'] });
    },
    onError: (e: Error) => message.error(e.message),
  });

  const renameMut = useMutation({
    mutationFn: (v: { id: number; displayName: string }) =>
      api.patch(`/api/providers/${v.id}`, { displayName: v.displayName }),
    onSuccess: (_d, v) => {
      message.success('已更新');
      setEditing(prev => { const n = { ...prev }; delete n[v.id]; return n; });
      qc.invalidateQueries({ queryKey: ['providers'] });
      qc.invalidateQueries({ queryKey: ['models'] });
    },
    onError: (e: Error) => message.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: number) => api.delete(`/api/providers/${id}`),
    onSuccess: () => {
      message.success('已删除供应商，旗下模型已转移到 Unknown，建议重算成本');
      qc.invalidateQueries();
    },
    onError: (e: Error) => message.error(e.message),
  });

  return (
    <>
      <Modal
        title="管理供应商"
        open={open}
        onCancel={onClose}
        footer={null}
        width={680}
        destroyOnClose
      >
        <div style={{ textAlign: 'right', marginBottom: 12 }}>
          <Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>新增供应商</Button>
        </div>
        <Table<Provider>
          rowKey="id"
          loading={list.isLoading}
          dataSource={list.data ?? []}
          pagination={false}
          size="small"
          columns={[
            { title: 'Slug', dataIndex: 'slug', width: 130, render: (s, r) => (
              <Space size={6}>
                <code>{s}</code>
                {r.isBuiltin === 1 && <Tag color="default">内置</Tag>}
              </Space>
            ) },
            {
              title: '显示名', dataIndex: 'displayName',
              render: (v: string, row: Provider) => editing[row.id] !== undefined ? (
                <Input
                  size="small"
                  value={editing[row.id]}
                  onChange={(e) => setEditing(prev => ({ ...prev, [row.id]: e.target.value }))}
                  onPressEnter={() => renameMut.mutate({ id: row.id, displayName: editing[row.id] })}
                  style={{ width: 200 }}
                />
              ) : (
                <span style={{ cursor: 'pointer' }}
                      onClick={() => setEditing(prev => ({ ...prev, [row.id]: v }))}>
                  {v}
                </span>
              ),
            },
            { title: '模型数', dataIndex: 'modelCount', width: 80, align: 'right' },
            {
              title: '操作', width: 140, align: 'right',
              render: (_: unknown, row: Provider) => (
                <Space size={6}>
                  {editing[row.id] !== undefined && (
                    <Button size="small" type="primary"
                            onClick={() => renameMut.mutate({ id: row.id, displayName: editing[row.id] })}>
                      保存
                    </Button>
                  )}
                  {row.isBuiltin === 0 && (
                    <Popconfirm
                      title={`删除 ${row.slug}？`}
                      description={row.modelCount > 0
                        ? `该供应商下有 ${row.modelCount} 个模型，删除后会转移到 Unknown。`
                        : '确认删除？'}
                      onConfirm={() => delMut.mutate(row.id)}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        title="新增供应商"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={async () => {
          const v = await form.validateFields();
          addMut.mutate(v);
        }}
        confirmLoading={addMut.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            label="Slug"
            name="slug"
            rules={[
              { required: true, message: '请输入 slug' },
              { pattern: /^[a-z0-9-]{1,32}$/, message: '只能小写字母、数字与连字符' },
            ]}
            extra="用于内部标识，例如 deepseek、glm。最长 32 字符。"
          >
            <Input placeholder="deepseek" />
          </Form.Item>
          <Form.Item label="显示名" name="displayName" rules={[{ required: true }]}>
            <Input placeholder="DeepSeek" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
```

### Step 3: Build the price-history sub-table

- [ ] Create `src/web/pages/Settings/PricingHistoryTable.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Table, Button, InputNumber, DatePicker, Modal, Form, Input, Popconfirm, Space, Empty, message } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { api } from '../../api/client.js';

interface Window {
  id: number;
  effectiveFrom: string;
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  note: string | null;
}

interface PricingHistoryResponse {
  model: string;
  windows: Window[];
  defaultFallback: { input: number; output: number; cacheCreate: number; cacheRead: number } | null;
}

interface FormValues {
  effectiveFrom: Dayjs;
  input: number; output: number; cacheCreate: number; cacheRead: number;
  note?: string;
}

export default function PricingHistoryTable({ model }: { model: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Window | null>(null);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const { data, isLoading } = useQuery({
    queryKey: ['pricing-history', model],
    queryFn: () => api.get<PricingHistoryResponse>(`/api/pricing/${encodeURIComponent(model)}`),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['pricing-history', model] });
    qc.invalidateQueries({ queryKey: ['models'] });
  };

  const createMut = useMutation({
    mutationFn: (v: FormValues) => api.post(`/api/pricing/${encodeURIComponent(model)}`, {
      effectiveFrom: v.effectiveFrom.format('YYYY-MM-DD'),
      input: v.input, output: v.output, cacheCreate: v.cacheCreate, cacheRead: v.cacheRead,
      note: v.note ?? null,
    }),
    onSuccess: () => { message.success('已添加'); setCreating(false); form.resetFields(); invalidate(); },
    onError: (e: Error) => message.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: (v: FormValues & { id: number }) => api.patch(`/api/pricing/${v.id}`, {
      effectiveFrom: v.effectiveFrom.format('YYYY-MM-DD'),
      input: v.input, output: v.output, cacheCreate: v.cacheCreate, cacheRead: v.cacheRead,
      note: v.note ?? null,
    }),
    onSuccess: () => { message.success('已更新'); setEditing(null); form.resetFields(); invalidate(); },
    onError: (e: Error) => message.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/api/pricing/${id}`),
    onSuccess: () => { message.success('已删除'); invalidate(); },
    onError: (e: Error) => message.error(e.message),
  });

  const today = dayjs().format('YYYY-MM-DD');
  const rows = data?.windows ?? [];

  const submit = async () => {
    const v = await form.validateFields();
    if (editing) updateMut.mutate({ ...v, id: editing.id });
    else createMut.mutate(v);
  };

  return (
    <div style={{ background: 'var(--cc-bg-subtle, transparent)', padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <strong>价格历史</strong>
        <Button size="small" icon={<PlusOutlined />} onClick={() => {
          setEditing(null);
          setCreating(true);
          form.resetFields();
          form.setFieldsValue({ effectiveFrom: dayjs(), input: 0, output: 0, cacheCreate: 0, cacheRead: 0 });
        }}>新增价格调整</Button>
      </div>
      <Table<Window>
        size="small"
        rowKey="id"
        loading={isLoading}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: <Empty description={data?.defaultFallback ? '尚无窗口，使用内置默认价' : '尚无窗口'} /> }}
        columns={[
          {
            title: '生效日期', dataIndex: 'effectiveFrom', width: 130,
            render: (v: string) => (
              <span style={{
                fontVariantNumeric: 'tabular-nums',
                opacity: v > today ? 0.6 : 1,
              }}>
                {v}{v > today && ' (待生效)'}
              </span>
            ),
          },
          { title: 'Input', dataIndex: 'input',       width: 90, render: (v) => `$${v}` },
          { title: 'Output', dataIndex: 'output',     width: 90, render: (v) => `$${v}` },
          { title: 'CC', dataIndex: 'cacheCreate',    width: 80, render: (v) => `$${v}` },
          { title: 'CR', dataIndex: 'cacheRead',      width: 80, render: (v) => `$${v}` },
          { title: '备注', dataIndex: 'note', render: (v: string | null) => v ?? <span style={{ opacity: 0.5 }}>—</span> },
          {
            title: '操作', width: 120, align: 'right',
            render: (_: unknown, row: Window) => (
              <Space size={4}>
                <Button size="small" icon={<EditOutlined />} onClick={() => {
                  setCreating(false);
                  setEditing(row);
                  form.setFieldsValue({
                    effectiveFrom: dayjs(row.effectiveFrom),
                    input: row.input, output: row.output,
                    cacheCreate: row.cacheCreate, cacheRead: row.cacheRead,
                    note: row.note ?? undefined,
                  });
                }} />
                <Popconfirm title="删除该窗口？" onConfirm={() => deleteMut.mutate(row.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? '编辑价格窗口' : '新增价格调整'}
        open={creating || editing !== null}
        onCancel={() => { setCreating(false); setEditing(null); form.resetFields(); }}
        onOk={submit}
        confirmLoading={createMut.isPending || updateMut.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item label="生效日期" name="effectiveFrom" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
          </Form.Item>
          <Space size={12} wrap>
            <Form.Item label="Input ($/M)" name="input" rules={[{ required: true }]}>
              <InputNumber min={0} step={0.01} style={{ width: 140 }} prefix="$" />
            </Form.Item>
            <Form.Item label="Output ($/M)" name="output" rules={[{ required: true }]}>
              <InputNumber min={0} step={0.01} style={{ width: 140 }} prefix="$" />
            </Form.Item>
            <Form.Item label="Cache Create ($/M)" name="cacheCreate" rules={[{ required: true }]}>
              <InputNumber min={0} step={0.01} style={{ width: 160 }} prefix="$" />
            </Form.Item>
            <Form.Item label="Cache Read ($/M)" name="cacheRead" rules={[{ required: true }]}>
              <InputNumber min={0} step={0.01} style={{ width: 160 }} prefix="$" />
            </Form.Item>
          </Space>
          <Form.Item label="备注" name="note">
            <Input.TextArea rows={2} placeholder="可选：说明调价原因或来源链接" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
```

### Step 4: Rewrite the Pricing pane

- [ ] Replace the entire content of `src/web/pages/Settings/Pricing.tsx` with:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Button, Input, Space, Tag, Popconfirm, Modal, Form, Alert,
  Empty, Select, InputNumber, DatePicker, message,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../../api/client.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';
import ProvidersModal from './ProvidersModal.js';
import PricingHistoryTable from './PricingHistoryTable.js';

interface Provider {
  id: number; slug: string; displayName: string; isBuiltin: number; modelCount: number;
}

interface ModelPriceM {
  input: number; output: number; cacheCreate: number; cacheRead: number;
}

interface ModelView {
  modelName: string;
  providerId: number;
  providerSlug: string;
  providerDisplayName: string;
  totalTokens: number;
  costUsd: number;
  messageCount: number;
  currentPrice: ModelPriceM | null;
  priceSource: 'window' | 'default' | 'none';
  currentEffectiveFrom: string | null;
}

interface RecomputeResp {
  updatedSessions: number;
  totalCostUsd: number;
  unconfiguredCount: number;
}

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

export default function PricingSettings() {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const qc = useQueryClient();
  const [providersOpen, setProvidersOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [form] = Form.useForm<{
    modelName: string; providerId: number;
    effectiveFrom: any; input: number; output: number; cacheCreate: number; cacheRead: number;
  }>();

  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.get<Provider[]>('/api/providers'),
  });

  const models = useQuery({
    queryKey: ['models'],
    queryFn: () => api.get<ModelView[]>('/api/models'),
  });

  const moveMut = useMutation({
    mutationFn: (v: { model: string; providerId: number }) =>
      api.patch(`/api/models/${encodeURIComponent(v.model)}`, { providerId: v.providerId }),
    onSuccess: () => {
      message.success('已转移');
      qc.invalidateQueries();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const addMut = useMutation({
    mutationFn: async (v: {
      modelName: string; providerId: number;
      effectiveFrom: string; input: number; output: number; cacheCreate: number; cacheRead: number;
    }) => {
      await api.post('/api/models', { modelName: v.modelName, providerId: v.providerId });
      return api.post(`/api/pricing/${encodeURIComponent(v.modelName)}`, {
        effectiveFrom: v.effectiveFrom,
        input: v.input, output: v.output, cacheCreate: v.cacheCreate, cacheRead: v.cacheRead,
      });
    },
    onSuccess: () => {
      message.success('已新增模型');
      setAddOpen(false); form.resetFields();
      qc.invalidateQueries();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const recomputeMut = useMutation({
    mutationFn: () => api.post<RecomputeResp>('/api/recompute-cost'),
    onSuccess: (r) => {
      const tail = r.unconfiguredCount > 0 ? `（${r.unconfiguredCount} 条因未配置计为 0）` : '';
      message.success(`已重算 ${r.updatedSessions} 个会话，总成本 $${r.totalCostUsd.toFixed(2)}${tail}`);
      qc.invalidateQueries();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const rows = models.data ?? [];
  const unconfigured = rows.filter(r => r.providerSlug === 'unknown');

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
        <Button onClick={() => setProvidersOpen(true)}>管理供应商</Button>
        <Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>新增模型</Button>
        <Button
          type="primary"
          icon={<ReloadOutlined />}
          loading={recomputeMut.isPending}
          onClick={() => recomputeMut.mutate()}
        >重算历史成本</Button>
      </div>

      {unconfigured.length > 0 && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 12 }}
          message={`检测到 ${unconfigured.length} 个未配置模型 (${unconfigured.map(r => r.modelName).join(', ')})，当前成本计为 0。请将其移到正确的供应商并设置价格。`}
        />
      )}
      <Alert
        type="info" showIcon style={{ marginBottom: 16 }}
        message="新数据落库时按消息时间戳查窗口价；修改价格不影响已存入的成本，需要手动「重算历史成本」。"
      />

      <Card>
        <Table<ModelView>
          rowKey="modelName"
          loading={models.isLoading}
          dataSource={rows}
          pagination={false}
          size="middle"
          locale={{ emptyText: <Empty description="还没有数据，先去刷新或在「新增模型」中预先配置" /> }}
          expandable={{
            expandedRowRender: (r) => <PricingHistoryTable model={r.modelName} />,
            rowExpandable: (r) => r.providerSlug !== 'unknown',
          }}
          columns={[
            {
              title: '供应商', dataIndex: 'providerSlug', width: 130,
              render: (slug: string, row: ModelView) => slug === 'unknown'
                ? <Tag color="warning">⚠ Unknown</Tag>
                : <Tag color="processing">{row.providerDisplayName}</Tag>,
            },
            {
              title: '模型', dataIndex: 'modelName',
              render: (v: string) => <span style={{ fontWeight: 500, color: t.textPrimary }}>{v}</span>,
            },
            {
              title: '使用量', key: 'usage', width: 280,
              render: (_: unknown, r: ModelView) => (
                <span style={{ color: t.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
                  {r.messageCount.toLocaleString()} 条 · {fmt(r.totalTokens)} tokens · ${r.costUsd.toFixed(2)}
                </span>
              ),
            },
            {
              title: '当前价 (input/output/cc/cr)', key: 'price', width: 280,
              render: (_: unknown, r: ModelView) => {
                if (!r.currentPrice) return <span style={{ color: t.danger }}>未配置</span>;
                const tag = r.priceSource === 'default' ? '默认' : r.currentEffectiveFrom ?? '';
                return (
                  <Space size={6}>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                      ${r.currentPrice.input}/${r.currentPrice.output}/${r.currentPrice.cacheCreate}/${r.currentPrice.cacheRead}
                    </span>
                    <Tag color={r.priceSource === 'default' ? 'default' : 'green'}>{tag}</Tag>
                  </Space>
                );
              },
            },
            {
              title: '操作', key: 'actions', width: 200, align: 'right',
              render: (_: unknown, r: ModelView) => (
                <Space size={6}>
                  <Select<number>
                    size="small"
                    style={{ width: 140 }}
                    value={r.providerId}
                    onChange={(pid) => moveMut.mutate({ model: r.modelName, providerId: pid })}
                    options={(providers.data ?? []).map(p => ({ label: p.displayName, value: p.id }))}
                  />
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <ProvidersModal open={providersOpen} onClose={() => setProvidersOpen(false)} />

      <Modal
        title="新增模型"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={async () => {
          const v = await form.validateFields();
          addMut.mutate({
            modelName: v.modelName.trim(),
            providerId: v.providerId,
            effectiveFrom: v.effectiveFrom.format('YYYY-MM-DD'),
            input: v.input, output: v.output, cacheCreate: v.cacheCreate, cacheRead: v.cacheRead,
          });
        }}
        confirmLoading={addMut.isPending}
        destroyOnClose
      >
        <Form
          form={form} layout="vertical" preserve={false}
          initialValues={{ effectiveFrom: dayjs(), input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }}
        >
          <Form.Item label="模型名" name="modelName" rules={[
            { required: true },
            { pattern: /^[A-Za-z0-9._-]{1,64}$/, message: '只能包含字母、数字、. _ -' },
          ]}><Input placeholder="例如 deepseek-chat" /></Form.Item>
          <Form.Item label="供应商" name="providerId" rules={[{ required: true }]}>
            <Select options={(providers.data ?? []).map(p => ({ label: p.displayName, value: p.id }))} />
          </Form.Item>
          <Form.Item label="生效日期" name="effectiveFrom" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
          </Form.Item>
          <Space size={12} wrap>
            <Form.Item label="Input ($/M)" name="input" rules={[{ required: true }]}>
              <InputNumber min={0} step={0.01} style={{ width: 140 }} prefix="$" />
            </Form.Item>
            <Form.Item label="Output ($/M)" name="output" rules={[{ required: true }]}>
              <InputNumber min={0} step={0.01} style={{ width: 140 }} prefix="$" />
            </Form.Item>
            <Form.Item label="Cache Create ($/M)" name="cacheCreate" rules={[{ required: true }]}>
              <InputNumber min={0} step={0.01} style={{ width: 160 }} prefix="$" />
            </Form.Item>
            <Form.Item label="Cache Read ($/M)" name="cacheRead" rules={[{ required: true }]}>
              <InputNumber min={0} step={0.01} style={{ width: 160 }} prefix="$" />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </>
  );
}
```

### Step 5: Add the missing `POST /api/models` backend endpoint

The Pricing pane's "新增模型" calls `POST /api/models`. Task 1's pricing.ts route did not include it. Add it now in a small targeted edit:

- [ ] Modify `src/server/routes/pricing.ts` — add the following route inside `registerPricing` (under the model section, before `app.patch('/api/models/:model'...)`):

```ts
  app.post('/api/models', async (req, reply) => {
    const b = (req.body ?? {}) as { modelName?: string; providerId?: number };
    if (!b.modelName || !MODEL_RE.test(b.modelName)) {
      reply.code(400); return { error: 'invalid modelName' };
    }
    if (typeof b.providerId !== 'number') {
      reply.code(400); return { error: 'providerId required' };
    }
    const prov = deps.db.prepare(`SELECT id FROM providers WHERE id=?`).get(b.providerId);
    if (!prov) { reply.code(400); return { error: 'provider not found' }; }
    const now = Date.now();
    try {
      deps.db.prepare(
        `INSERT INTO models (model_name, provider_id, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      ).run(b.modelName, b.providerId, now, now);
    } catch (e: any) {
      if (String(e.message).includes('UNIQUE')) {
        // Already exists — treat as idempotent and PATCH provider
        deps.db.prepare(`UPDATE models SET provider_id=?, updated_at=? WHERE model_name=?`)
               .run(b.providerId, now, b.modelName);
      } else throw e;
    }
    return { modelName: b.modelName, providerId: b.providerId };
  });
```

- [ ] Add a corresponding test to `tests/routes-models.test.ts`:

```ts
  it('POST /api/models registers a new model under a provider', async () => {
    const { app, db, cleanup } = await setup();
    try {
      const cr = await app.inject({
        method: 'POST', url: '/api/providers',
        payload: { slug: 'glm', displayName: 'GLM' },
        headers: { 'content-type': 'application/json' },
      });
      const provId = cr.json().id as number;
      const r = await app.inject({
        method: 'POST', url: '/api/models',
        payload: { modelName: 'glm-4-air', providerId: provId },
        headers: { 'content-type': 'application/json' },
      });
      expect(r.statusCode).toBe(200);
      const got = db.prepare(
        `SELECT p.slug FROM models m JOIN providers p ON p.id=m.provider_id WHERE m.model_name='glm-4-air'`,
      ).get() as { slug: string };
      expect(got.slug).toBe('glm');
    } finally { await cleanup(); }
  });
```

Run: `npx vitest run tests/routes-models.test.ts`
Expected: PASS.

### Step 6: Manual smoke check

Start the dev server: `npm run dev`

In the browser at `http://localhost:5173`:

- [ ] Settings → 计费规则: model table shows providers (Anthropic for known models, possibly Unknown for any seen-but-unregistered models).
- [ ] Click 管理供应商 → modal lists `anthropic` + `unknown` (内置), `+ 新增供应商` adds DeepSeek successfully.
- [ ] Expand a model row → price-history sub-table loads; `+ 新增价格调整` opens modal with date picker; saving creates a row.
- [ ] Future-dated row shows "(待生效)" suffix.
- [ ] Edit/Delete buttons work; current-price column updates after edits.
- [ ] Click 重算历史成本 → success toast includes `unconfiguredCount` if any.
- [ ] Click 新增模型 → modal collects model name, provider, first window; saving registers the model.
- [ ] Try moving a model to another provider via the row's Select dropdown → tag updates.

### Step 7: Commit

```bash
git add -A
git commit -m "feat(settings): pricing UI rewrite — providers/models/windows + history"
```

---

## Task 5: Overview UI integration

**Files:**

- Modify: `src/web/pages/Overview/index.tsx`

### Step 1: Extend `trendMode` state and add provider series

- [ ] In `src/web/pages/Overview/index.tsx`, change line 107 from:

```tsx
  const [trendMode, setTrendMode] = useState<'model' | 'type'>('model');
```

to:

```tsx
  const [trendMode, setTrendMode] = useState<'model' | 'type' | 'provider'>('model');
```

- [ ] After the existing `seriesByModel` definition (after line 142), insert a `seriesByProvider`:

```tsx
  const trendProviders = new Set<string>();
  data.dailyTrend.forEach(d => Object.keys(d.byProvider ?? {}).forEach(p => trendProviders.add(p)));
  const seriesByProvider = [...trendProviders].map(slug => ({
    name: slug,
    type: 'line',
    stack: 'all',
    areaStyle: { opacity: 0.7 },
    smooth: false,
    data: data.dailyTrend.map(d => d.byProvider?.[slug] ?? 0),
  }));
```

- [ ] Replace the existing `series` composition (line 183) from:

```tsx
  const series = [
    ...(trendMode === 'type' ? seriesByType : seriesByModel),
    hitRateSeries,
  ];
```

to:

```tsx
  const series = [
    ...(trendMode === 'type'
      ? seriesByType
      : trendMode === 'provider'
        ? seriesByProvider
        : seriesByModel),
    hitRateSeries,
  ];
```

### Step 2: Add provider option to the Segmented toggle and update Card title

- [ ] At line 239, replace the Card `title` line:

```tsx
            title={trendMode === 'type' ? 'Token 趋势 · 按类型堆叠' : 'Token 趋势 · 按模型堆叠'}
```

with:

```tsx
            title={
              trendMode === 'type'
                ? 'Token 趋势 · 按类型堆叠'
                : trendMode === 'provider'
                  ? 'Token 趋势 · 按供应商堆叠'
                  : 'Token 趋势 · 按模型堆叠'
            }
```

- [ ] At lines 242-247, replace the Segmented for trendMode:

```tsx
                <Segmented
                  size="small"
                  options={[{ label: '模型', value: 'model' }, { label: '类型', value: 'type' }]}
                  value={trendMode}
                  onChange={(v) => setTrendMode(v as 'model' | 'type')}
                />
```

with:

```tsx
                <Segmented
                  size="small"
                  options={[
                    { label: '模型', value: 'model' },
                    { label: '类型', value: 'type' },
                    { label: '供应商', value: 'provider' },
                  ]}
                  value={trendMode}
                  onChange={(v) => setTrendMode(v as 'model' | 'type' | 'provider')}
                />
```

### Step 3: Add the byProvider BarList card

The existing BarList row (lines 337-366) has three `<Col span={8}>` cards: Top 10 projects, byModel, byTool. Add a fourth card for providers and rebalance to four equal columns.

- [ ] Replace the entire `<Row gutter={14} style={{ marginBottom: 18 }}>` block at lines 337-366 with:

```tsx
      <Row gutter={14} style={{ marginBottom: 18 }}>
        <Col span={6}>
          <Card title="按项目 · Top 10"
                extra={<span style={{ fontSize: 11, color: t.textSecondary }}>按 token</span>}>
            <BarList
              items={data.byProject.map(p => ({ label: p.displayName, value: p.tokens }))}
              formatter={fmtTokens}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card title="按模型 · 用量分布"
                extra={<span style={{ fontSize: 11, color: t.textSecondary }}>按 token</span>}>
            <BarList
              items={data.byModel.map(m => ({ label: m.model, value: m.tokens }))}
              formatter={fmtTokens}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card title="按供应商 · 用量分布"
                extra={<span style={{ fontSize: 11, color: t.textSecondary }}>按 token</span>}>
            <BarList
              items={data.byProvider.map(p => ({ label: p.providerDisplayName, value: p.tokens }))}
              formatter={fmtTokens}
              emptyText="暂无供应商数据"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card title="按工具 · Top 10"
                extra={<span style={{ fontSize: 11, color: t.textSecondary }}>按调用次数</span>}>
            <BarList
              items={data.byTool.map(x => ({ label: x.tool, value: x.count }))}
              formatter={(v) => v.toLocaleString()}
              emptyText="当前周期没有工具调用"
            />
          </Card>
        </Col>
      </Row>
```

### Step 4: Manual smoke check

- [ ] `npm run dev` → Overview page loads without errors.
- [ ] Trend chart "供应商" segment stacks by provider with distinct colors per provider.
- [ ] 按供应商 BarList card appears next to 按模型, populated when ≥1 provider has tokens.
- [ ] Switching between 模型 / 类型 / 供应商 segments re-renders the trend chart cleanly (the existing `key={`trend-${trendMode}-${granularity}`}` on `<ReactECharts>` already handles this; no additional change needed).

### Step 5: Commit

```bash
git add src/web/pages/Overview/index.tsx
git commit -m "feat(overview): byProvider BarList + provider stack toggle"
```

---

## Task 6: Sessions UI provider filter

**Files:**

- Modify: `src/web/pages/Sessions/List.tsx`

### Step 1: Add state and a `providers` query

- [ ] In `src/web/pages/Sessions/List.tsx`, find the `const [projectDirs, setProjectDirs] = useState<string[]>([]);` line (around line 56) and add directly after it:

```tsx
  const [providerSlugs, setProviderSlugs] = useState<string[]>([]);
```

- [ ] Locate the existing `projects` query (around lines 62-65):

```tsx
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRow[]>('/api/projects?sortBy=cost'),
  });
```

Add a sibling query immediately below it:

```tsx
  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.get<Array<{ slug: string; displayName: string }>>('/api/providers'),
  });
```

### Step 2: Send `providers` to the API

- [ ] In the `useMemo` that builds `url` (around lines 67-79), find the `if (projectDirs.length) params.set('projectDir', projectDirs.join(','));` line and add directly after it:

```tsx
    if (providerSlugs.length) params.set('providers', providerSlugs.join(','));
```

- [ ] In the same `useMemo`'s dependency array (the line ending with `[page, pageSize, projectDirs, range, sortBy, sortOrder]`), add `providerSlugs`:

```tsx
  }, [page, pageSize, projectDirs, providerSlugs, range, sortBy, sortOrder]);
```

### Step 3: Render the provider Select

- [ ] Find the existing project filter `<div>` (around lines 107-120). It currently looks like:

```tsx
      <div style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: t.textSecondary }}>项目</span>
        <Select<string[]>
          mode="multiple"
          allowClear
          style={{ minWidth: 280 }}
          placeholder="全部项目"
          value={projectDirs}
          onChange={(v) => { setProjectDirs(v); setPage(1); }}
          options={(projects.data ?? []).map(p => ({
            label: p.displayName, value: p.projectDir,
          }))}
        />
      </div>
```

Replace the contents of that `<div>` with both selects:

```tsx
      <div style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: t.textSecondary }}>项目</span>
        <Select<string[]>
          mode="multiple"
          allowClear
          style={{ minWidth: 280 }}
          placeholder="全部项目"
          value={projectDirs}
          onChange={(v) => { setProjectDirs(v); setPage(1); }}
          options={(projects.data ?? []).map(p => ({
            label: p.displayName, value: p.projectDir,
          }))}
        />
        <span style={{ fontSize: 12, color: t.textSecondary }}>供应商</span>
        <Select<string[]>
          mode="multiple"
          allowClear
          style={{ minWidth: 200 }}
          placeholder="全部供应商"
          value={providerSlugs}
          onChange={(v) => { setProviderSlugs(v); setPage(1); }}
          options={(providers.data ?? []).map(p => ({
            label: p.displayName, value: p.slug,
          }))}
        />
      </div>
```

(The only changes from the existing `<div>`: added `flexWrap: 'wrap'` for narrow viewports, plus the trailing supplier label + Select.)

### Step 4: Manual smoke check

- [ ] `npm run dev` → Sessions page loads. The 供应商 multi-select appears next to 项目.
- [ ] Selecting one or more providers filters the session list; the count in the page header subtitle (`共 X 条`) updates.
- [ ] Clearing the selection restores the full list.

### Step 5: Commit

```bash
git add src/web/pages/Sessions/List.tsx
git commit -m "feat(sessions): provider multi-select filter"
```

---

## Task 7: Final smoke + cleanup

### Step 1: Run all tests

Run: `npx vitest run`
Expected: ALL pass.

Run: `npm run typecheck`
Expected: PASS.

### Step 2: Build

Run: `npm run build`
Expected: builds without warnings/errors.

### Step 3: End-to-end manual check

- [ ] `npm start` (or `npm run build && node dist/server/cli.js start --no-open`).
- [ ] Open `http://localhost:47821`.
- [ ] Settings → 计费规则: add a DeepSeek provider, register `deepseek-chat` model, add a window with effectiveFrom in the past, click 重算 → assert `totalCostUsd` reflects new pricing.
- [ ] Add a future-dated window for an Anthropic model → it shows but does not affect current-day pricing in Overview.
- [ ] Sessions: filter by `deepseek` provider → list filters correctly.
- [ ] Overview: switch trend stack to 按 provider → chart re-renders.

### Step 4: Commit anything that drifted (e.g., regenerated `package-lock.json`)

```bash
git status
# if clean, skip
git add -A && git commit -m "chore: post-feature cleanup"
```

---

## Self-Review Checklist

(For the engineer executing the plan, run these against the spec at end of work.)

- [ ] Spec §"数据模型" — three tables exist with shape + indexes ✓ Task 1 Step 1.
- [ ] Spec §"种子数据" — `anthropic` + `unknown` builtin providers, all `DEFAULT_PRICING_PER_M` keys registered to anthropic ✓ Task 1 Steps 1, 2, 3.
- [ ] Spec §"老数据迁移" — old pricing_overrides → pricing.effective_from='1970-01-01', table dropped ✓ Task 1 Step 1.
- [ ] Spec §"价格查找算法" — `priceFor` honors timestamp, unknown returns null, fallback to defaults ✓ Task 1 Step 6.
- [ ] Spec §API — providers/models/pricing CRUD all present, `unconfiguredCount` in recompute response ✓ Task 1 Steps 10, 11; Task 4 Step 4.
- [ ] Spec §"UI Settings → 计费规则" — providers modal, expandable rows, history table, future-dated badge, alert ✓ Task 4.
- [ ] Spec §"Overview" — byProvider BarList + provider stack option ✓ Tasks 2 & 5.
- [ ] Spec §"Sessions" — providers[] query + multi-select filter ✓ Tasks 3 & 6.
- [ ] No tests reference removed symbols (`PRICING`, `loadPriceTable`, `computeCostUsd`, `computeCostUsdWith`, `perTokenTable`).
