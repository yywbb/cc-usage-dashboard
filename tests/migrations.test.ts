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
