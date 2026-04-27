import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { openDb } from '../src/server/db.js';
import { scanAll } from '../src/server/scanner/index.js';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function seeded() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-ov-'));
  const projectsRoot = join(dir, 'projects');
  const proj = join(projectsRoot, 'D--test-proj');
  mkdirSync(proj, { recursive: true });
  copyFileSync('tests/fixtures/session-sample.jsonl', join(proj, 'sess-1.jsonl'));
  const db = openDb(join(dir, 'usage.db'));
  scanAll(db, projectsRoot);
  const app = await buildApp({ db, projectsRoot });
  return { app, cleanup: async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('/api/overview', () => {
  it('returns totals and byModel', async () => {
    const { app, cleanup } = await seeded();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/overview?range=all' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totals.messageCount).toBeGreaterThan(0);
      expect(body.totals.sessionCount).toBe(1);
      expect(body.byModel.length).toBeGreaterThan(0);
      expect(body.byProject.length).toBe(1);
      expect(typeof body.cacheHitRate).toBe('number');
    } finally { await cleanup(); }
  });

  it('returns byProvider aggregates and per-bucket byProvider', async () => {
    const { app, cleanup } = await seeded(); // seeds session-sample.jsonl
    try {
      const res = await app.inject({ method: 'GET', url: '/api/overview?range=all&granularity=day' });
      const body = res.json();
      expect(Array.isArray(body.byProvider)).toBe(true);
      const anthropic = body.byProvider.find((b: any) => b.providerSlug === 'anthropic');
      expect(anthropic).toBeDefined();
      expect(anthropic.tokens).toBeGreaterThan(0);
      expect(anthropic.share).toBeGreaterThan(0);
      const firstBucket = body.dailyTrend[0];
      expect(firstBucket.byProvider).toBeDefined();
      expect(typeof firstBucket.byProvider).toBe('object');
    } finally { await cleanup(); }
  });
});
