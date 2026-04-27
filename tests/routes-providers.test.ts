import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { openDb } from '../src/server/db.js';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-prov-'));
  const projectsRoot = join(dir, 'projects');
  mkdirSync(projectsRoot, { recursive: true });
  const db = openDb(join(dir, 'usage.db'));
  const app = await buildApp({ db, projectsRoot });
  return { app, db, cleanup: async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('/api/providers', () => {
  it('GET lists builtin providers with model counts', async () => {
    const { app, cleanup } = await setup();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/providers' });
      const body = res.json() as Array<{ slug: string; isBuiltin: number; modelCount: number }>;
      const slugs = body.map(b => b.slug).sort();
      expect(slugs).toEqual(['anthropic', 'unknown']);
      const anthropic = body.find(b => b.slug === 'anthropic')!;
      expect(anthropic.isBuiltin).toBe(1);
      expect(anthropic.modelCount).toBeGreaterThan(0); // seeded with DEFAULT_PRICING_PER_M
    } finally { await cleanup(); }
  });

  it('POST creates a non-builtin provider', async () => {
    const { app, cleanup } = await setup();
    try {
      const res = await app.inject({
        method: 'POST', url: '/api/providers',
        payload: { slug: 'deepseek', displayName: 'DeepSeek' },
        headers: { 'content-type': 'application/json' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.slug).toBe('deepseek');
      expect(body.isBuiltin).toBe(0);
    } finally { await cleanup(); }
  });

  it('POST rejects bad slug and duplicate slug', async () => {
    const { app, cleanup } = await setup();
    try {
      const bad = await app.inject({
        method: 'POST', url: '/api/providers',
        payload: { slug: 'Bad Slug!', displayName: 'x' },
        headers: { 'content-type': 'application/json' },
      });
      expect(bad.statusCode).toBe(400);
      const dup = await app.inject({
        method: 'POST', url: '/api/providers',
        payload: { slug: 'anthropic', displayName: 'x' },
        headers: { 'content-type': 'application/json' },
      });
      expect(dup.statusCode).toBe(409);
    } finally { await cleanup(); }
  });

  it('PATCH updates displayName', async () => {
    const { app, db, cleanup } = await setup();
    try {
      const id = (db.prepare(`SELECT id FROM providers WHERE slug='anthropic'`).get() as { id: number }).id;
      const r = await app.inject({
        method: 'PATCH', url: `/api/providers/${id}`,
        payload: { displayName: 'Anthropic (PBC)' },
        headers: { 'content-type': 'application/json' },
      });
      expect(r.statusCode).toBe(200);
      const after = (db.prepare(`SELECT display_name FROM providers WHERE id=?`).get(id) as { display_name: string });
      expect(after.display_name).toBe('Anthropic (PBC)');
    } finally { await cleanup(); }
  });

  it('DELETE rejects builtin', async () => {
    const { app, db, cleanup } = await setup();
    try {
      const id = (db.prepare(`SELECT id FROM providers WHERE slug='anthropic'`).get() as { id: number }).id;
      const r = await app.inject({ method: 'DELETE', url: `/api/providers/${id}` });
      expect(r.statusCode).toBe(400);
    } finally { await cleanup(); }
  });

  it('DELETE non-builtin reassigns its models to unknown', async () => {
    const { app, db, cleanup } = await setup();
    try {
      // Create deepseek + a model under it
      const cr = await app.inject({
        method: 'POST', url: '/api/providers',
        payload: { slug: 'deepseek', displayName: 'DeepSeek' },
        headers: { 'content-type': 'application/json' },
      });
      const provId = cr.json().id as number;
      db.prepare(
        `INSERT INTO models (model_name, provider_id, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ).run('deepseek-chat', provId, Date.now(), Date.now());

      const r = await app.inject({ method: 'DELETE', url: `/api/providers/${provId}` });
      expect(r.statusCode).toBe(200);

      const reassigned = db.prepare(
        `SELECT p.slug FROM models m JOIN providers p ON p.id=m.provider_id
         WHERE m.model_name='deepseek-chat'`,
      ).get() as { slug: string };
      expect(reassigned.slug).toBe('unknown');
    } finally { await cleanup(); }
  });
});
