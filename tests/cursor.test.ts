import { describe, it, expect } from 'vitest';
import { openDb } from '../src/server/db.js';
import { getCursor, upsertCursor, allCursors } from '../src/server/scanner/cursor.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-cursor-'));
  const db = openDb(join(dir, 'usage.db'));
  return { db, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('scan_cursor CRUD', () => {
  it('returns null for unknown file', () => {
    const { db, cleanup } = makeDb();
    try {
      expect(getCursor(db, '/a/b.jsonl')).toBeNull();
    } finally { cleanup(); }
  });

  it('upserts and reads back', () => {
    const { db, cleanup } = makeDb();
    try {
      upsertCursor(db, {
        filePath: '/a/b.jsonl', projectDir: '/a', sizeBytes: 100, mtimeMs: 1,
        lastOffset: 50, lastScannedAt: 123,
      });
      const r = getCursor(db, '/a/b.jsonl');
      expect(r?.lastOffset).toBe(50);
      expect(r?.sizeBytes).toBe(100);
    } finally { cleanup(); }
  });

  it('allCursors lists entries for a project_dir', () => {
    const { db, cleanup } = makeDb();
    try {
      upsertCursor(db, { filePath: '/a/1.jsonl', projectDir: '/a', sizeBytes: 10, mtimeMs: 1, lastOffset: 10, lastScannedAt: 1 });
      upsertCursor(db, { filePath: '/a/2.jsonl', projectDir: '/a', sizeBytes: 20, mtimeMs: 2, lastOffset: 20, lastScannedAt: 2 });
      upsertCursor(db, { filePath: '/b/3.jsonl', projectDir: '/b', sizeBytes: 30, mtimeMs: 3, lastOffset: 30, lastScannedAt: 3 });
      expect(allCursors(db, '/a')).toHaveLength(2);
      expect(allCursors(db, '/b')).toHaveLength(1);
    } finally { cleanup(); }
  });
});
