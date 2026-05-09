import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { openDb } from '../src/server/db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function setupApp() {
  const dir = mkdtempSync(join(tmpdir(), 'cx-routes-'));
  const db = openDb(join(dir, 'usage.db'));
  const app = await buildApp({ db, projectsRoot: dir });
  return { app, db, cleanup: async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('codex routes', () => {
  it('returns null aggregates when no snapshots exist', async () => {
    const { app, cleanup } = await setupApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/codex/rate-limits/current' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ primaryMaxPct: null, secondaryMaxPct: null, observedAt: null });
    } finally { await cleanup(); }
  });

  it('returns aggregate after a snapshot is inserted', async () => {
    const { app, db, cleanup } = await setupApp();
    try {
      db.prepare(`INSERT INTO projects (project_dir, display_name, real_path, first_seen_at, last_seen_at)
                  VALUES ('p','p','/p',0,0)`).run();
      db.prepare(`INSERT INTO sessions (session_id, project_dir, started_at, ended_at)
                  VALUES ('s1','p',0,0)`).run();
      db.prepare(`INSERT INTO codex_rate_limit_snapshots
        (session_id, observed_at, primary_used_pct, secondary_used_pct, plan_type)
        VALUES ('s1', 100, 12.5, 22.0, 'pro')`).run();
      const res = await app.inject({ method: 'GET', url: '/api/codex/rate-limits/current' });
      expect(res.json().primaryMaxPct).toBeCloseTo(12.5);
    } finally { await cleanup(); }
  });

  it('history endpoint returns rows ordered by observed_at asc', async () => {
    const { app, db, cleanup } = await setupApp();
    try {
      db.prepare(`INSERT INTO projects (project_dir, display_name, real_path, first_seen_at, last_seen_at)
                  VALUES ('p','p','/p',0,0)`).run();
      db.prepare(`INSERT INTO sessions (session_id, project_dir, started_at, ended_at)
                  VALUES ('s1','p',0,0)`).run();
      db.prepare(`INSERT INTO sessions (session_id, project_dir, started_at, ended_at)
                  VALUES ('s2','p',0,0)`).run();
      db.prepare(`INSERT INTO codex_rate_limit_snapshots (session_id, observed_at, primary_used_pct) VALUES ('s2', 200, 30)`).run();
      db.prepare(`INSERT INTO codex_rate_limit_snapshots (session_id, observed_at, primary_used_pct) VALUES ('s1', 100, 10)`).run();
      const res = await app.inject({ method: 'GET', url: '/api/codex/rate-limits/history' });
      const rows = res.json() as Array<any>;
      expect(rows.map(r => r.sessionId)).toEqual(['s1', 's2']);
    } finally { await cleanup(); }
  });
});
