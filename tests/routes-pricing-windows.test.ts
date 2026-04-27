import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { openDb } from '../src/server/db.js';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-pwin-'));
  const projectsRoot = join(dir, 'projects');
  mkdirSync(projectsRoot, { recursive: true });
  const db = openDb(join(dir, 'usage.db'));
  const app = await buildApp({ db, projectsRoot });
  return { app, db, cleanup: async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('/api/pricing/:model', () => {
  it('GET returns empty windows + defaultFallback for a known model', async () => {
    const { app, cleanup } = await setup();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/pricing/claude-sonnet-4-6' });
      const body = res.json();
      expect(body.windows).toEqual([]);
      expect(body.defaultFallback.input).toBe(3);
    } finally { await cleanup(); }
  });

  it('POST creates a window, GET returns it, PATCH updates, DELETE removes', async () => {
    const { app, cleanup } = await setup();
    try {
      const create = await app.inject({
        method: 'POST', url: '/api/pricing/claude-sonnet-4-6',
        payload: { effectiveFrom: '2026-04-01', input: 6, output: 30, cacheCreate: 7.5, cacheRead: 0.6, note: 'price up' },
        headers: { 'content-type': 'application/json' },
      });
      expect(create.statusCode).toBe(200);
      const id = create.json().id as number;

      const list = await app.inject({ method: 'GET', url: '/api/pricing/claude-sonnet-4-6' });
      expect(list.json().windows).toHaveLength(1);

      const patch = await app.inject({
        method: 'PATCH', url: `/api/pricing/${id}`,
        payload: { effectiveFrom: '2026-05-01', input: 7, output: 31, cacheCreate: 7.5, cacheRead: 0.6 },
        headers: { 'content-type': 'application/json' },
      });
      expect(patch.statusCode).toBe(200);

      const del = await app.inject({ method: 'DELETE', url: `/api/pricing/${id}` });
      expect(del.statusCode).toBe(200);
      const after = await app.inject({ method: 'GET', url: '/api/pricing/claude-sonnet-4-6' });
      expect(after.json().windows).toEqual([]);
    } finally { await cleanup(); }
  });

  it('POST rejects duplicate (model, effectiveFrom)', async () => {
    const { app, cleanup } = await setup();
    try {
      await app.inject({
        method: 'POST', url: '/api/pricing/claude-sonnet-4-6',
        payload: { effectiveFrom: '2026-04-01', input: 1, output: 1, cacheCreate: 1, cacheRead: 1 },
        headers: { 'content-type': 'application/json' },
      });
      const dup = await app.inject({
        method: 'POST', url: '/api/pricing/claude-sonnet-4-6',
        payload: { effectiveFrom: '2026-04-01', input: 2, output: 2, cacheCreate: 2, cacheRead: 2 },
        headers: { 'content-type': 'application/json' },
      });
      expect(dup.statusCode).toBe(409);
    } finally { await cleanup(); }
  });

  it('POST rejects invalid effectiveFrom and negative prices', async () => {
    const { app, cleanup } = await setup();
    try {
      const badDate = await app.inject({
        method: 'POST', url: '/api/pricing/claude-sonnet-4-6',
        payload: { effectiveFrom: '2026/04/01', input: 1, output: 1, cacheCreate: 1, cacheRead: 1 },
        headers: { 'content-type': 'application/json' },
      });
      expect(badDate.statusCode).toBe(400);
      const negative = await app.inject({
        method: 'POST', url: '/api/pricing/claude-sonnet-4-6',
        payload: { effectiveFrom: '2026-04-01', input: -1, output: 1, cacheCreate: 1, cacheRead: 1 },
        headers: { 'content-type': 'application/json' },
      });
      expect(negative.statusCode).toBe(400);
    } finally { await cleanup(); }
  });

  it('PATCH rejects duplicate (model, effectiveFrom) with 409', async () => {
    const { app, cleanup } = await setup();
    try {
      const a = await app.inject({
        method: 'POST', url: '/api/pricing/claude-sonnet-4-6',
        payload: { effectiveFrom: '2026-04-01', input: 1, output: 1, cacheCreate: 1, cacheRead: 1 },
        headers: { 'content-type': 'application/json' },
      });
      const b = await app.inject({
        method: 'POST', url: '/api/pricing/claude-sonnet-4-6',
        payload: { effectiveFrom: '2026-05-01', input: 2, output: 2, cacheCreate: 2, cacheRead: 2 },
        headers: { 'content-type': 'application/json' },
      });
      const aId = a.json().id as number;
      // Try to PATCH row a's effectiveFrom to collide with row b's
      const r = await app.inject({
        method: 'PATCH', url: `/api/pricing/${aId}`,
        payload: { effectiveFrom: '2026-05-01', input: 3, output: 3, cacheCreate: 3, cacheRead: 3 },
        headers: { 'content-type': 'application/json' },
      });
      expect(r.statusCode).toBe(409);
    } finally { await cleanup(); }
  });

  it('POST returns 404 if model not registered', async () => {
    const { app, cleanup } = await setup();
    try {
      const r = await app.inject({
        method: 'POST', url: '/api/pricing/never-heard-of-it',
        payload: { effectiveFrom: '2026-04-01', input: 1, output: 1, cacheCreate: 1, cacheRead: 1 },
        headers: { 'content-type': 'application/json' },
      });
      expect(r.statusCode).toBe(404);
    } finally { await cleanup(); }
  });
});
