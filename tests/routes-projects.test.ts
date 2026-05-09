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
  return { app, proj, cleanup: async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
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
});
