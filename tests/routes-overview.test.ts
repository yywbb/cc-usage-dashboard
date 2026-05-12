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
  scanAll(db, projectsRoot, { source: 'claude' });
  const app = await buildApp({ db, projectsRoot });
  return { app, db, cleanup: async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
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
      expect(body.totals.successfulResponses).toBe(2);
      expect(body.totals.failedResponses).toBe(0);
      expect(body.totals.responseAttempts).toBe(2);
      expect(body.totals.responseSuccessRate).toBe(1);
    } finally { await cleanup(); }
  });

  it('counts Claude API-error rows as failed response attempts', async () => {
    const { app, db, cleanup } = await seeded();
    try {
      db.prepare(
        `INSERT INTO messages (message_id, session_id, role, model, timestamp,
                                input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
                                cost_usd, text_preview, source, response_error)
         VALUES ('m-fail','sess-1','assistant',NULL,3, 0, 0, 0, 0, 0,
                 'API Error: 429 rate limit', 'claude', 1)`,
      ).run();

      const body = (await app.inject({ method: 'GET', url: '/api/overview?range=all' })).json();

      expect(body.totals.successfulResponses).toBe(2);
      expect(body.totals.failedResponses).toBe(1);
      expect(body.totals.responseAttempts).toBe(3);
      expect(body.totals.responseSuccessRate).toBeCloseTo(2 / 3, 6);
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
      expect(anthropic.share).toBeCloseTo(1.0);
      const firstBucket = body.dailyTrend[0];
      expect(firstBucket.byProvider).toBeDefined();
      expect(firstBucket.byProvider.anthropic).toBeGreaterThan(0);
    } finally { await cleanup(); }
  });

  it('filters totals by source=codex', async () => {
    const { app, db, cleanup } = await seeded();
    try {
      db.prepare(`INSERT INTO projects (project_dir, display_name, real_path, first_seen_at, last_seen_at) VALUES ('codex:abc','/p','/p',0,0)`).run();
      db.prepare(`INSERT INTO sessions (session_id, project_dir, started_at, ended_at, source) VALUES ('s-cx','codex:abc',1,2,'codex')`).run();
      db.prepare(
        `INSERT INTO messages (message_id, session_id, role, model, timestamp,
                                input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
                                cost_usd, source)
         VALUES ('m-cx','s-cx','assistant','gpt-5',1, 100, 50, 0, 0, 0.5, 'codex')`,
      ).run();

      const all = (await app.inject({ method: 'GET', url: '/api/overview?range=all' })).json();
      const codex = (await app.inject({ method: 'GET', url: '/api/overview?range=all&source=codex' })).json();
      const claude = (await app.inject({ method: 'GET', url: '/api/overview?range=all&source=claude' })).json();

      expect(all.totals.messageCount).toBe(codex.totals.messageCount + claude.totals.messageCount);
      expect(codex.totals.messageCount).toBe(1);
      expect(codex.totals.costUsd).toBeCloseTo(0.5, 6);
    } finally { await cleanup(); }
  });
});
