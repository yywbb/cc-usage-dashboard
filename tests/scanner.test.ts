import { describe, it, expect } from 'vitest';
import { openDb } from '../src/server/db.js';
import { scanAll } from '../src/server/scanner/index.js';
import { mkdtempSync, rmSync, copyFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-scan-'));
  const projectsRoot = join(dir, 'projects');
  const projDir = join(projectsRoot, 'D--test-proj');
  mkdirSync(projDir, { recursive: true });
  copyFileSync('tests/fixtures/session-sample.jsonl', join(projDir, 'sess-1.jsonl'));
  const db = openDb(join(dir, 'usage.db'));
  return {
    db, projectsRoot, projDir,
    cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); }
  };
}

describe('scanAll', () => {
  it('full scan creates project, session, messages', () => {
    const { db, projectsRoot, cleanup } = setup();
    try {
      const result = scanAll(db, projectsRoot, { source: 'claude' });
      expect(result.scannedFiles).toBe(1);
      expect(result.newMessages).toBe(3);
      const sessions = db.prepare('SELECT * FROM sessions').all() as any[];
      expect(sessions).toHaveLength(1);
      expect(sessions[0].message_count).toBe(3);
      const projects = db.prepare('SELECT * FROM projects').all() as any[];
      expect(projects).toHaveLength(1);
      expect(projects[0].real_path).toBe('D:/test/proj');
    } finally { cleanup(); }
  });

  it('incremental scan reads only appended bytes', () => {
    const { db, projectsRoot, projDir, cleanup } = setup();
    try {
      scanAll(db, projectsRoot, { source: 'claude' });
      const before = (db.prepare('SELECT COUNT(*) as n FROM messages').get() as any).n;
      const extraLine = JSON.stringify({
        uuid: 'a-3', sessionId: 'sess-1', parentUuid: 'a-2',
        timestamp: '2026-04-20T10:00:20.000Z',
        message: {
          id: 'msg_01xyz', role: 'assistant', model: 'claude-sonnet-4-6',
          stop_reason: 'end_turn', content: [],
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }
      }) + '\n';
      appendFileSync(join(projDir, 'sess-1.jsonl'), extraLine);
      const second = scanAll(db, projectsRoot, { source: 'claude' });
      expect(second.newMessages).toBe(1);
      const after = (db.prepare('SELECT COUNT(*) as n FROM messages').get() as any).n;
      expect(after).toBe(before + 1);
    } finally { cleanup(); }
  });

  it('skips file when size & mtime unchanged', () => {
    const { db, projectsRoot, cleanup } = setup();
    try {
      scanAll(db, projectsRoot, { source: 'claude' });
      const second = scanAll(db, projectsRoot, { source: 'claude' });
      expect(second.newMessages).toBe(0);
    } finally { cleanup(); }
  });

  it('marks Claude messages with source=claude', () => {
    const { db, projectsRoot, cleanup } = setup();
    try {
      scanAll(db, projectsRoot, { source: 'claude' });
      const r = db.prepare(`SELECT DISTINCT source FROM messages`).all() as Array<{ source: string }>;
      expect(r).toEqual([{ source: 'claude' }]);
    } finally { cleanup(); }
  });
});
