import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { openDb } from '../src/server/db.js';
import { scanAll } from '../src/server/scanner/index.js';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function setup(seed = false) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-models-'));
  const projectsRoot = join(dir, 'projects');
  if (seed) {
    const proj = join(projectsRoot, 'D--test-proj');
    mkdirSync(proj, { recursive: true });
    copyFileSync('tests/fixtures/session-sample.jsonl', join(proj, 'sess-1.jsonl'));
  } else {
    mkdirSync(projectsRoot, { recursive: true });
  }
  const db = openDb(join(dir, 'usage.db'));
  if (seed) scanAll(db, projectsRoot, { source: 'claude' });
  const app = await buildApp({ db, projectsRoot });
  return { app, db, cleanup: async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('/api/models', () => {
  it('GET lists seeded Anthropic models with default current price', async () => {
    const { app, cleanup } = await setup();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/models' });
      const body = res.json() as Array<any>;
      const sonnet = body.find(m => m.modelName === 'claude-sonnet-4-6');
      expect(sonnet).toBeDefined();
      expect(sonnet.providerSlug).toBe('anthropic');
      expect(sonnet.priceSource).toBe('default');
      expect(sonnet.currentPrice.input).toBe(3);
      expect(sonnet.messageCount).toBe(0);
    } finally { await cleanup(); }
  });

  it('GET reflects usage after a scan', async () => {
    const { app, cleanup } = await setup(true);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/models' });
      const body = res.json() as Array<any>;
      const sonnet = body.find(m => m.modelName === 'claude-sonnet-4-6');
      expect(sonnet.messageCount).toBeGreaterThan(0);
      expect(sonnet.totalTokens).toBeGreaterThan(0);
    } finally { await cleanup(); }
  });

  it('PATCH moves a model to another provider', async () => {
    const { app, db, cleanup } = await setup();
    try {
      const cr = await app.inject({
        method: 'POST', url: '/api/providers',
        payload: { slug: 'deepseek', displayName: 'DeepSeek' },
        headers: { 'content-type': 'application/json' },
      });
      const dsId = cr.json().id as number;
      db.prepare(
        `INSERT INTO models (model_name, provider_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ).run('deepseek-chat', dsId, Date.now(), Date.now());
      const anthropicId = (db.prepare(`SELECT id FROM providers WHERE slug='anthropic'`).get() as { id: number }).id;
      const r = await app.inject({
        method: 'PATCH', url: '/api/models/deepseek-chat',
        payload: { providerId: anthropicId },
        headers: { 'content-type': 'application/json' },
      });
      expect(r.statusCode).toBe(200);
      const after = db.prepare(
        `SELECT p.slug FROM models m JOIN providers p ON p.id=m.provider_id WHERE m.model_name='deepseek-chat'`,
      ).get() as { slug: string };
      expect(after.slug).toBe('anthropic');
    } finally { await cleanup(); }
  });

  it('POST /api/models registers a new model under a provider', async () => {
    const { app, db, cleanup } = await setup();
    try {
      const cr = await app.inject({
        method: 'POST', url: '/api/providers',
        payload: { slug: 'glm', displayName: 'GLM' },
        headers: { 'content-type': 'application/json' },
      });
      const provId = cr.json().id as number;
      const r = await app.inject({
        method: 'POST', url: '/api/models',
        payload: { modelName: 'glm-4-air', providerId: provId },
        headers: { 'content-type': 'application/json' },
      });
      expect(r.statusCode).toBe(200);
      const got = db.prepare(
        `SELECT p.slug FROM models m JOIN providers p ON p.id=m.provider_id WHERE m.model_name='glm-4-air'`,
      ).get() as { slug: string };
      expect(got.slug).toBe('glm');
    } finally { await cleanup(); }
  });

  it('GET /api/models currentPrice ignores future-dated windows', async () => {
    const { app, cleanup } = await setup();
    try {
      // Add a window dated far in the future
      const r = await app.inject({
        method: 'POST', url: '/api/pricing/claude-sonnet-4-6',
        payload: { effectiveFrom: '2099-01-01', input: 99, output: 99, cacheCreate: 99, cacheRead: 99 },
        headers: { 'content-type': 'application/json' },
      });
      expect(r.statusCode).toBe(200);
      const list = await app.inject({ method: 'GET', url: '/api/models' });
      const sonnet = (list.json() as Array<any>).find(m => m.modelName === 'claude-sonnet-4-6');
      expect(sonnet.priceSource).toBe('default'); // future window should not be picked
      expect(sonnet.currentPrice.input).toBe(3);  // matches DEFAULT_PRICING_PER_M, not 99
    } finally { await cleanup(); }
  });

  it('DELETE removes a model and cascades its pricing windows', async () => {
    const { app, db, cleanup } = await setup();
    try {
      // Seed pricing window first
      await app.inject({
        method: 'POST', url: '/api/pricing/claude-sonnet-4-6',
        payload: { effectiveFrom: '2026-04-01', input: 6, output: 30, cacheCreate: 7.5, cacheRead: 0.6 },
        headers: { 'content-type': 'application/json' },
      });
      const r = await app.inject({ method: 'DELETE', url: '/api/models/claude-sonnet-4-6' });
      expect(r.statusCode).toBe(200);
      const stillThere = db.prepare(
        `SELECT model_name FROM pricing WHERE model_name='claude-sonnet-4-6'`,
      ).all();
      expect(stillThere).toEqual([]); // cascaded
    } finally { await cleanup(); }
  });
});
