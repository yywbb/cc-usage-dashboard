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
  return {
    path: join(dir, 'usage.db'),
    cleanup: () => {
      for (let i = 0; i < 3; i++) {
        try { rmSync(dir, { recursive: true, force: true }); return; } catch (e: any) {
          if (e.code !== 'EBUSY' || i === 2) throw e;
          // brief synchronous backoff for Windows WAL handle release
          const until = Date.now() + 10;
          while (Date.now() < until) { /* spin */ }
        }
      }
    },
  };
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
      raw.exec('PRAGMA optimize;');
      raw.exec('PRAGMA wal_checkpoint(RESTART);');
      raw.close();
      // Small delay to allow SQLite WAL files to fully release on Windows
      const until = Date.now() + 500;
      while (Date.now() < until) {
        /* spin */
      }

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
      db.exec('PRAGMA optimize;');
      db.exec('PRAGMA wal_checkpoint(RESTART);');
      db.close();
      // Small delay to allow SQLite WAL files to fully release on Windows
      const until2 = Date.now() + 250;
      while (Date.now() < until2) {
        /* spin */
      }
    } finally { cleanup(); }
  });
});

describe('migration 004', () => {
  it('migration 004 adds multi-source columns and backfills source=claude', () => {
    const { path, cleanup } = tmpFile();
    try {
      const db = openDb(path);
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

      db.close();
    } finally { cleanup(); }
  });
});

describe('migration 005', () => {
  it('migration 005 creates codex_rate_limit_snapshots', () => {
    const { path, cleanup } = tmpFile();
    try {
      const db = openDb(path);
      const tbls = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>;
      expect(tbls.map(t => t.name)).toContain('codex_rate_limit_snapshots');
      db.close();
    } finally { cleanup(); }
  });
});
