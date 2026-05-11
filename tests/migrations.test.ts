import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../src/server/db.js';
import { mkdtempSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_DIR = join(__dirname, '../src/server/migrations');
const MIG_001 = join(__dirname, '../src/server/migrations/001_init.sql');
const MIG_002 = join(__dirname, '../src/server/migrations/002_pricing_overrides.sql');

function rmRetry(dir: string) {
  for (let i = 0; i < 5; i++) {
    try { rmSync(dir, { recursive: true, force: true }); return; } catch (e: any) {
      if (e.code !== 'EBUSY' || i === 4) throw e;
      // synchronous backoff for Windows WAL handle release (5 × 50ms = 250ms total)
      const until = Date.now() + 50;
      while (Date.now() < until) { /* spin */ }
    }
  }
}

function setup(): { path: string; db: ReturnType<typeof openDb>; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'cc-mig-'));
  const path = join(dir, 'usage.db');
  const db = openDb(path);
  return {
    path,
    db,
    cleanup: () => { db.close(); rmRetry(dir); },
  };
}

/** For tests that need to open the DB themselves (e.g. apply raw migrations first). */
function tmpFile(): { path: string; dir: string; cleanup: (db?: ReturnType<typeof openDb>) => void } {
  const dir = mkdtempSync(join(tmpdir(), 'cc-mig-'));
  return {
    path: join(dir, 'usage.db'),
    dir,
    cleanup: (db?: ReturnType<typeof openDb>) => { if (db) db.close(); rmRetry(dir); },
  };
}

describe('migration 003', () => {
  it('on a fresh DB, creates the new tables and seeds builtin providers + Anthropic models', () => {
    const { db, cleanup } = setup();
    try {
      const provs = db.prepare(`SELECT slug, is_builtin FROM providers ORDER BY slug`).all();
      expect(provs).toEqual([
        { slug: 'anthropic', is_builtin: 1 },
        { slug: 'openai', is_builtin: 1 },
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
    } finally { cleanup(); }
  });

  it('migrates existing pricing_overrides rows into pricing with effective_from=1970-01-01', () => {
    const { path, cleanup } = tmpFile();
    let db: ReturnType<typeof openDb> | undefined;
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
      raw.exec('PRAGMA optimize;');
      raw.exec('PRAGMA wal_checkpoint(RESTART);');
      raw.close();

      db = openDb(path); // runs 003 now
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
    } finally { cleanup(db); }
  });
});

describe('migration 004', () => {
  it('migration 004 adds multi-source columns and backfills source=claude', () => {
    const { db, cleanup } = setup();
    try {
      // Insert a project first (required for foreign key)
      db.prepare(
        `INSERT INTO projects (project_dir, display_name, first_seen_at, last_seen_at) VALUES ('p1', 'proj1', 0, 0)`
      ).run();
      db.prepare(
        `INSERT INTO sessions (session_id, project_dir, started_at, ended_at) VALUES ('s1','p1',0,0)`
      ).run();
      db.prepare(
        `INSERT INTO messages (message_id, session_id, role, timestamp) VALUES ('m1','s1','user',0)`
      ).run();

      // Assert messages columns
      const msgCols = db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>;
      expect(msgCols.map(c => c.name)).toEqual(
        expect.arrayContaining(['source', 'reasoning_tokens', 'originator'])
      );

      // Assert sessions columns
      const sessCols = db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>;
      expect(sessCols.map(c => c.name)).toEqual(
        expect.arrayContaining(['source', 'total_reasoning', 'cwd_real_path'])
      );

      // Assert projects columns
      const projCols = db.prepare(`PRAGMA table_info(projects)`).all() as Array<{ name: string }>;
      expect(projCols.map(c => c.name)).toEqual(
        expect.arrayContaining(['sources'])
      );

      // Assert messages data backfill
      const msgRow = db.prepare(`SELECT source, reasoning_tokens FROM messages WHERE message_id='m1'`).get() as any;
      expect(msgRow.source).toBe('claude');
      expect(msgRow.reasoning_tokens).toBe(0);

      // Assert sessions data backfill
      const sessRow = db.prepare(`SELECT source, total_reasoning FROM sessions WHERE session_id='s1'`).get() as any;
      expect(sessRow.source).toBe('claude');
      expect(sessRow.total_reasoning).toBe(0);
    } finally { cleanup(); }
  });
});

describe('migration 005', () => {
  it('migration 005 creates codex_rate_limit_snapshots', () => {
    const { db, cleanup } = setup();
    try {
      const tbls = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>;
      expect(tbls.map(t => t.name)).toContain('codex_rate_limit_snapshots');
    } finally { cleanup(); }
  });
});

describe('migration 007', () => {
  it('removes Claude API-error synthetic rows and clears remaining synthetic models', () => {
    const { path, cleanup } = tmpFile();
    let db: ReturnType<typeof openDb> | undefined;
    try {
      const raw = new Database(path);
      raw.exec(`CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`);
      const prior = readdirSync(MIG_DIR)
        .filter(f => f.endsWith('.sql') && f < '007_ignore_claude_synthetic_errors.sql')
        .sort();
      for (const f of prior) {
        raw.exec(readFileSync(join(MIG_DIR, f), 'utf8'));
        raw.prepare(`INSERT INTO _migrations(name, applied_at) VALUES (?, ?)`).run(f, Date.now());
      }

      raw.prepare(
        `INSERT INTO projects (project_dir, display_name, first_seen_at, last_seen_at)
         VALUES ('p1', 'proj1', 0, 0)`,
      ).run();
      raw.prepare(
        `INSERT INTO sessions
           (session_id, project_dir, started_at, ended_at, message_count,
            total_input, total_output, total_cache_create, total_cache_read,
            total_reasoning, total_cost_usd, source)
         VALUES ('s1', 'p1', 1, 2, 2, 0, 0, 0, 0, 0, 0, 'claude')`,
      ).run();
      const unknown = raw.prepare(`SELECT id FROM providers WHERE slug='unknown'`).get() as { id: number };
      raw.prepare(
        `INSERT INTO models (model_name, provider_id, created_at, updated_at)
         VALUES ('<synthetic>', ?, 0, 0)`,
      ).run(unknown.id);
      raw.prepare(
        `INSERT INTO messages
           (message_id, session_id, role, model, timestamp,
            input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
            cost_usd, text_preview, source, reasoning_tokens)
         VALUES
           ('err', 's1', 'assistant', '<synthetic>', 10, 0, 0, 0, 0, 0,
            'API Error: 429 rate limit', 'claude', 0),
           ('note', 's1', 'assistant', '<synthetic>', 20, 0, 0, 0, 0, 0,
            'No response requested.', 'claude', 0)`,
      ).run();
      raw.close();

      db = openDb(path);

      expect(db.prepare(`SELECT message_id FROM messages ORDER BY message_id`).all())
        .toEqual([{ message_id: 'note' }]);
      expect(db.prepare(`SELECT model FROM messages WHERE message_id='note'`).get())
        .toEqual({ model: null });
      expect(db.prepare(`SELECT model_name FROM models WHERE model_name='<synthetic>'`).get())
        .toBeUndefined();
      expect(db.prepare(`SELECT message_count, started_at, ended_at FROM sessions WHERE session_id='s1'`).get())
        .toEqual({ message_count: 1, started_at: 20, ended_at: 20 });
    } finally { cleanup(db); }
  });
});
