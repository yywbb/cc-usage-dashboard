import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { openDb } from '../src/server/db.js';
import { scanAll } from '../src/server/scanner/index.js';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function seeded() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-cost-'));
  const projectsRoot = join(dir, 'projects');
  const proj = join(projectsRoot, 'D--test-proj');
  mkdirSync(proj, { recursive: true });
  copyFileSync('tests/fixtures/session-sample.jsonl', join(proj, 'sess-1.jsonl'));
  const db = openDb(join(dir, 'usage.db'));
  scanAll(db, projectsRoot, { source: 'claude' });
  const app = await buildApp({ db, projectsRoot });
  return { app, db, cleanup: async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('/api/cost', () => {
  it('returns daily buckets with byModel/byProject breakdown', async () => {
    const { app, cleanup } = await seeded();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/cost?granularity=day&range=all' });
      const body = res.json();
      expect(Array.isArray(body.buckets)).toBe(true);
      expect(Array.isArray(body.anomalies)).toBe(true);
      expect(body.buckets[0]).toHaveProperty('bucketKey');
      expect(body.buckets[0]).toHaveProperty('costUsd');
    } finally { await cleanup(); }
  });

  it('filters cost buckets by source=codex', async () => {
    const { app, db, cleanup } = await seeded();
    try {
      db.prepare(`INSERT INTO projects (project_dir, display_name, real_path, first_seen_at, last_seen_at) VALUES ('codex:p','/p','/p',0,0)`).run();
      db.prepare(`INSERT INTO sessions (session_id, project_dir, started_at, ended_at, source) VALUES ('s1','codex:p',1,2,'codex')`).run();
      db.prepare(`INSERT INTO messages (message_id, session_id, role, model, timestamp, input_tokens, output_tokens, cost_usd, source) VALUES ('m1','s1','assistant','gpt-5',1, 100, 50, 3.0, 'codex')`).run();

      const codex = (await app.inject({ method: 'GET', url: '/api/cost?granularity=day&source=codex' })).json();
      const total = codex.buckets.reduce((a: number, b: any) => a + b.costUsd, 0);
      expect(total).toBeCloseTo(3.0, 6);
    } finally { await cleanup(); }
  });
});
