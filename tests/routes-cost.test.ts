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
  return { app, cleanup: async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
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
});
