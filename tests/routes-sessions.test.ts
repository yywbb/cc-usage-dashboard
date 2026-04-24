import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { openDb } from '../src/server/db.js';
import { scanAll } from '../src/server/scanner/index.js';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function seeded() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-sess-'));
  const projectsRoot = join(dir, 'projects');
  const proj = join(projectsRoot, 'D--test-proj');
  mkdirSync(proj, { recursive: true });
  copyFileSync('tests/fixtures/session-sample.jsonl', join(proj, 'sess-1.jsonl'));
  const db = openDb(join(dir, 'usage.db'));
  scanAll(db, projectsRoot);
  const app = await buildApp({ db, projectsRoot });
  return { app, cleanup: async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('/api/sessions', () => {
  it('lists sessions with pagination', async () => {
    const { app, cleanup } = await seeded();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/sessions?limit=10&offset=0' });
      const body = res.json();
      expect(body.total).toBe(1);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].topTools).toEqual(expect.arrayContaining(['Write']));
    } finally { await cleanup(); }
  });

  it('returns session detail with messages and toolDistribution', async () => {
    const { app, cleanup } = await seeded();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/sessions/sess-1' });
      const body = res.json();
      expect(body.session.sessionId).toBe('sess-1');
      expect(body.messages.length).toBeGreaterThan(0);
      expect(body.toolDistribution.length).toBeGreaterThan(0);
    } finally { await cleanup(); }
  });

  it('returns filter-wide stats alongside paginated items', async () => {
    const { app, cleanup } = await seeded();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/sessions?limit=10&offset=0' });
      const body = res.json();
      expect(body.stats).toBeDefined();
      expect(body.stats.count).toBe(1);
      expect(body.stats.totalCostUsd).toBeGreaterThanOrEqual(0);
      expect(body.stats.avgCostUsd).toBeCloseTo(body.stats.totalCostUsd / body.stats.count, 6);
      expect(body.stats.medianDurationMs).toBeGreaterThanOrEqual(0);
    } finally { await cleanup(); }
  });

  it('filters by multiple projectDir values (comma separated)', async () => {
    const { app, cleanup } = await seeded();
    try {
      const projRes = await app.inject({ method: 'GET', url: '/api/projects' });
      const projects = projRes.json() as Array<{ projectDir: string }>;
      const realDir = projects[0].projectDir;

      const hitRes = await app.inject({
        method: 'GET',
        url: `/api/sessions?projectDir=${encodeURIComponent(realDir)},${encodeURIComponent('/nonexistent/path')}`,
      });
      expect(hitRes.json().total).toBe(1);

      const missRes = await app.inject({
        method: 'GET',
        url: `/api/sessions?projectDir=${encodeURIComponent('/nonexistent/path')}`,
      });
      expect(missRes.json().total).toBe(0);
    } finally { await cleanup(); }
  });
});
