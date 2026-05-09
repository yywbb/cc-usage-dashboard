import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/server/db.js';
import { codexSource } from '../src/server/scanner/sources/codex/index.js';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'cx-'));
  const root = join(dir, 'sessions', '2026', '04', '01');
  mkdirSync(root, { recursive: true });
  copyFileSync('tests/fixtures/codex/normal.jsonl', join(root, 'rollout-2026-04-01T10-00-00-test-sess-001.jsonl'));
  copyFileSync('tests/fixtures/codex/duplicate-token-count.jsonl', join(root, 'rollout-2026-04-01T10-00-00-test-sess-002.jsonl'));
  const db = openDb(join(dir, 'usage.db'));
  return { db, sessionsRoot: join(dir, 'sessions'), cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('codexSource.scanAll', () => {
  it('inserts sessions, messages, project, and rate_limit snapshot', () => {
    const { db, sessionsRoot, cleanup } = setup();
    try {
      const r = codexSource.scanAll(db, sessionsRoot);
      expect(r.scannedFiles).toBe(2);
      expect(r.newMessages).toBe(4);

      const sess = db.prepare(`SELECT session_id, source, cwd_real_path FROM sessions ORDER BY session_id`).all() as Array<any>;
      expect(sess).toHaveLength(2);
      expect(sess.every(s => s.source === 'codex')).toBe(true);
      expect(sess[0].cwd_real_path).toBe('D:/Demo/proj');

      const projs = db.prepare(`SELECT project_dir, real_path FROM projects`).all() as Array<any>;
      expect(projs.some(p => p.project_dir.startsWith('codex:'))).toBe(true);

      const rl = db.prepare(`SELECT session_id, primary_used_pct, plan_type FROM codex_rate_limit_snapshots`).all() as Array<any>;
      expect(rl.some(x => x.session_id === 'test-sess-001' && x.plan_type === 'pro')).toBe(true);
    } finally { cleanup(); }
  });

  it('is idempotent: re-running scanAll on unchanged files produces no new messages', () => {
    const { db, sessionsRoot, cleanup } = setup();
    try {
      codexSource.scanAll(db, sessionsRoot);
      const r2 = codexSource.scanAll(db, sessionsRoot);
      expect(r2.newMessages).toBe(0);
    } finally { cleanup(); }
  });

  it('regression: SUM tokens equals fixture last cumulative total (issue #884)', () => {
    const { db, sessionsRoot, cleanup } = setup();
    try {
      codexSource.scanAll(db, sessionsRoot);
      const row = db.prepare(
        `SELECT SUM(input_tokens + output_tokens + cache_read_tokens + reasoning_tokens) as total
         FROM messages WHERE session_id = 'test-sess-002'`,
      ).get() as { total: number };
      expect(row.total).toBe(280);
    } finally { cleanup(); }
  });

  it('records rate_limit snapshot even when session produced no token deltas', () => {
    // Reproduces a real-world FK failure: rollout files can carry rate_limits
    // without any monotonic token_count delta (e.g. session aborted early).
    // The scanner must ensure the parent session row exists before upserting
    // codex_rate_limit_snapshots, otherwise FOREIGN KEY constraint trips.
    const dir = mkdtempSync(join(tmpdir(), 'cx-rl-'));
    const root = join(dir, 'sessions', '2026', '04', '01');
    mkdirSync(root, { recursive: true });
    copyFileSync(
      'tests/fixtures/codex/rate-limit-only.jsonl',
      join(root, 'rollout-2026-04-01T10-00-00-test-sess-rl-only.jsonl'),
    );
    const db = openDb(join(dir, 'usage.db'));
    try {
      expect(() => codexSource.scanAll(db, join(dir, 'sessions'))).not.toThrow();
      const sess = db.prepare(
        `SELECT session_id, source FROM sessions WHERE session_id = 'test-sess-rl-only'`,
      ).get() as any;
      expect(sess?.source).toBe('codex');
      const rl = db.prepare(
        `SELECT primary_used_pct, plan_type FROM codex_rate_limit_snapshots
         WHERE session_id = 'test-sess-rl-only'`,
      ).get() as any;
      expect(rl?.primary_used_pct).toBeCloseTo(5.0);
      expect(rl?.plan_type).toBe('pro');
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
