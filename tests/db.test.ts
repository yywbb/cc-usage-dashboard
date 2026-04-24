import { describe, it, expect } from 'vitest';
import { openDb } from '../src/server/db.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

describe('openDb', () => {
  it('creates schema from migrations when db is new', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-db-'));
    try {
      const db = openDb(join(dir, 'usage.db'));
      const tables = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
      ).all() as { name: string }[];
      const names = tables.map(t => t.name);
      expect(names).toContain('scan_cursor');
      expect(names).toContain('projects');
      expect(names).toContain('sessions');
      expect(names).toContain('messages');
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is idempotent: reopening does not throw', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-db-'));
    try {
      const p = join(dir, 'usage.db');
      openDb(p).close();
      const db = openDb(p);
      expect(() => db.prepare('SELECT 1').get()).not.toThrow();
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
