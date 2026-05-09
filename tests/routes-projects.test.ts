import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { openDb } from '../src/server/db.js';
import { scanAll } from '../src/server/scanner/index.js';
import { encodeProjectDir } from '../src/server/paths.js';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function seeded() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-proj-'));
  const projectsRoot = join(dir, 'projects');
  const proj = join(projectsRoot, 'D--test-proj');
  mkdirSync(proj, { recursive: true });
  copyFileSync('tests/fixtures/session-sample.jsonl', join(proj, 'sess-1.jsonl'));
  const db = openDb(join(dir, 'usage.db'));
  scanAll(db, projectsRoot, { source: 'claude' });
  const app = await buildApp({ db, projectsRoot });
  return { app, db, proj, cleanup: async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('/api/projects', () => {
  it('lists projects sorted by cost desc', async () => {
    const { app, cleanup } = await seeded();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/projects?sortBy=cost' });
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body[0].sessionCount).toBe(1);
    } finally { await cleanup(); }
  });

  it('returns timeline for a project', async () => {
    const { app, proj, cleanup } = await seeded();
    try {
      const b64 = encodeProjectDir(proj);
      const res = await app.inject({ method: 'GET', url: `/api/projects/${b64}/timeline?range=all` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('daily');
      expect(body).toHaveProperty('topSessions');
    } finally { await cleanup(); }
  });

  it('filters projects list by source=codex', async () => {
    const { app, db, cleanup } = await seeded();
    try {
      db.prepare(`INSERT INTO projects (project_dir, display_name, real_path, first_seen_at, last_seen_at) VALUES ('codex:p','/p','/p',0,0)`).run();
      db.prepare(`INSERT INTO sessions (session_id, project_dir, started_at, ended_at, source, total_input, total_output, total_cost_usd) VALUES ('s1','codex:p',0,0,'codex',100,50,1.0)`).run();
      const codex = (await app.inject({ method: 'GET', url: '/api/projects?source=codex' })).json();
      const claude = (await app.inject({ method: 'GET', url: '/api/projects?source=claude' })).json();
      expect(codex.some((p: any) => p.projectDir === 'codex:p')).toBe(true);
      expect(claude.some((p: any) => p.projectDir === 'codex:p')).toBe(false);
      expect(codex.some((p: any) => p.projectDir === claude[0]?.projectDir)).toBe(false);
    } finally { await cleanup(); }
  });

  it('filters project timeline detail by source=codex', async () => {
    const { app, db, cleanup } = await seeded();
    try {
      db.prepare(`INSERT INTO projects (project_dir, display_name, real_path, first_seen_at, last_seen_at) VALUES ('codex:p','/p','/p',0,0)`).run();
      db.prepare(`INSERT INTO sessions (session_id, project_dir, started_at, ended_at, source, total_cost_usd) VALUES ('s1','codex:p',1,2,'codex',2.0)`).run();
      db.prepare(`INSERT INTO messages (message_id, session_id, role, model, timestamp, input_tokens, output_tokens, cost_usd, source) VALUES ('m1','s1','assistant','gpt-5',1,50,20,2.0,'codex')`).run();
      const b64 = Buffer.from('codex:p', 'utf8').toString('base64url');
      const res = await app.inject({ method: 'GET', url: `/api/projects/${b64}/timeline?source=codex` });
      const body = res.json();
      expect(body.totals.costUsd).toBeCloseTo(2.0, 6);
    } finally { await cleanup(); }
  });
});
