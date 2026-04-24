import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { openDb } from '../src/server/db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-app-'));
  const db = openDb(join(dir, 'usage.db'));
  const app = await buildApp({ db, projectsRoot: 'tests/fixtures/projects' });
  return { app, cleanup: async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('admin routes', () => {
  it('GET /api/health returns ok', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true });
    } finally { await cleanup(); }
  });

  it('POST /api/scan triggers a scan', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const res = await app.inject({ method: 'POST', url: '/api/scan' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty('scannedFiles');
    } finally { await cleanup(); }
  });
});
