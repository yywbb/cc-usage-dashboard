import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { openDb } from '../src/server/db.js';
import { scanAll } from '../src/server/scanner/index.js';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function setup(seed = false) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-pricing-rt-'));
  const projectsRoot = join(dir, 'projects');
  if (seed) {
    const proj = join(projectsRoot, 'D--test-proj');
    mkdirSync(proj, { recursive: true });
    copyFileSync('tests/fixtures/session-sample.jsonl', join(proj, 'sess-1.jsonl'));
  } else {
    mkdirSync(projectsRoot, { recursive: true });
  }
  const db = openDb(join(dir, 'usage.db'));
  if (seed) scanAll(db, projectsRoot);
  const app = await buildApp({ db, projectsRoot });
  return {
    app, db,
    cleanup: async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

describe('/api/pricing', () => {
  it('GET returns defaults, overrides, effective tables and an empty models[] when no usage', async () => {
    const { app, cleanup } = await setup();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/pricing' });
      const body = res.json();
      expect(res.statusCode).toBe(200);
      expect(body.defaults['claude-sonnet-4-6'].input).toBe(3);
      expect(body.overrides).toEqual({});
      expect(body.effective['claude-sonnet-4-6'].input).toBe(3);
      expect(body.fallbackModel).toBe('claude-sonnet-4-6');
      expect(body.models).toEqual([]);
    } finally { await cleanup(); }
  });

  it('GET models[] is derived from messages.model with usage stats', async () => {
    const { app, cleanup } = await setup(true);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/pricing' });
      const body = res.json();
      const sonnet = body.models.find((m: { model: string }) => m.model === 'claude-sonnet-4-6');
      expect(sonnet).toBeDefined();
      expect(sonnet.source).toBe('default');
      expect(sonnet.usage.messages).toBeGreaterThan(0);
      expect(sonnet.usage.totalTokens).toBeGreaterThan(0);
      expect(sonnet.price.input).toBe(3);
    } finally { await cleanup(); }
  });

  it('GET models[] includes orphan overrides not yet seen in usage', async () => {
    const { app, cleanup } = await setup();
    try {
      await app.inject({
        method: 'PUT', url: '/api/pricing/my-future-model',
        payload: { input: 2, output: 8, cacheCreate: 2.5, cacheRead: 0.2 },
        headers: { 'content-type': 'application/json' },
      });
      const res = await app.inject({ method: 'GET', url: '/api/pricing' });
      const body = res.json();
      const row = body.models.find((m: { model: string }) => m.model === 'my-future-model');
      expect(row).toBeDefined();
      expect(row.source).toBe('custom');
      expect(row.usage.messages).toBe(0);
    } finally { await cleanup(); }
  });

  it('PUT saves override and is reflected in subsequent GET', async () => {
    const { app, cleanup } = await setup();
    try {
      const put = await app.inject({
        method: 'PUT', url: '/api/pricing/claude-sonnet-4-6',
        payload: { input: 6, output: 30, cacheCreate: 7.5, cacheRead: 0.6 },
        headers: { 'content-type': 'application/json' },
      });
      expect(put.statusCode).toBe(200);
      const get = await app.inject({ method: 'GET', url: '/api/pricing' });
      const body = get.json();
      expect(body.overrides['claude-sonnet-4-6'].input).toBe(6);
      expect(body.effective['claude-sonnet-4-6'].output).toBe(30);
    } finally { await cleanup(); }
  });

  it('PUT rejects negative or non-finite numbers', async () => {
    const { app, cleanup } = await setup();
    try {
      const r = await app.inject({
        method: 'PUT', url: '/api/pricing/claude-sonnet-4-6',
        payload: { input: -1, output: 30, cacheCreate: 7.5, cacheRead: 0.6 },
        headers: { 'content-type': 'application/json' },
      });
      expect(r.statusCode).toBe(400);
    } finally { await cleanup(); }
  });

  it('PUT rejects invalid model names', async () => {
    const { app, cleanup } = await setup();
    try {
      const r = await app.inject({
        method: 'PUT', url: '/api/pricing/' + encodeURIComponent('bad name!!'),
        payload: { input: 1, output: 1, cacheCreate: 1, cacheRead: 1 },
        headers: { 'content-type': 'application/json' },
      });
      expect(r.statusCode).toBe(400);
    } finally { await cleanup(); }
  });

  it('DELETE removes an override and reverts to default', async () => {
    const { app, cleanup } = await setup();
    try {
      await app.inject({
        method: 'PUT', url: '/api/pricing/claude-sonnet-4-6',
        payload: { input: 6, output: 30, cacheCreate: 7.5, cacheRead: 0.6 },
        headers: { 'content-type': 'application/json' },
      });
      const del = await app.inject({ method: 'DELETE', url: '/api/pricing/claude-sonnet-4-6' });
      expect(del.statusCode).toBe(200);
      const get = await app.inject({ method: 'GET', url: '/api/pricing' });
      const body = get.json();
      expect(body.overrides).toEqual({});
      expect(body.effective['claude-sonnet-4-6'].input).toBe(3);
    } finally { await cleanup(); }
  });

  it('overrides + recompute-cost change historical message cost_usd', async () => {
    const { app, db, cleanup } = await setup(true);
    try {
      const before = (db.prepare(
        `SELECT COALESCE(SUM(cost_usd),0) as t FROM messages WHERE model = 'claude-sonnet-4-6'`
      ).get() as { t: number }).t;
      await app.inject({
        method: 'PUT', url: '/api/pricing/claude-sonnet-4-6',
        payload: { input: 6, output: 30, cacheCreate: 7.5, cacheRead: 0.6 },
        headers: { 'content-type': 'application/json' },
      });
      const rc = await app.inject({ method: 'POST', url: '/api/recompute-cost' });
      expect(rc.statusCode).toBe(200);
      const after = (db.prepare(
        `SELECT COALESCE(SUM(cost_usd),0) as t FROM messages WHERE model = 'claude-sonnet-4-6'`
      ).get() as { t: number }).t;
      if (before > 0) expect(after).toBeCloseTo(before * 2, 4);
    } finally { await cleanup(); }
  });
});
