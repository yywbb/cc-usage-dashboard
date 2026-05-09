import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { openDb } from '../src/server/db.js';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyPrice } from '../src/server/pricing.js';

/**
 * Build an isolated app. Always redirects CODEX_HOME to an empty tmp dir so
 * tests never accidentally scan the developer's real ~/.codex directory.
 * Returns a cleanup function that restores the env var and removes temp dirs.
 */
async function makeApp(opts: { claudeRoot?: string } = {}) {
  // Empty codex home — codex scanner will skip it (existsSync → false on 'sessions')
  const codexHome = mkdtempSync(join(tmpdir(), 'cc-codex-empty-'));
  const prevCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;

  const dir = mkdtempSync(join(tmpdir(), 'cc-app-'));
  const db = openDb(join(dir, 'usage.db'));
  // projectsRoot is the Claude scan root when source='claude' single-run, but
  // with source='all' each source uses its own defaultRoot(). We pass an empty
  // dir so that if ever legacyRoot logic applies it stays clean.
  const app = await buildApp({ db, projectsRoot: opts.claudeRoot ?? 'tests/fixtures/projects' });
  return {
    app, db, dir,
    cleanup: async () => {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
      rmSync(codexHome, { recursive: true, force: true });
      if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prevCodexHome;
    },
  };
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

  // source='all' — both Claude and Codex roots are redirected to empty dirs
  // so the scan completes instantly with scannedFiles=0.
  it('POST /api/scan triggers a scan (no real data; verifies shape)', async () => {
    const { app, cleanup } = await makeApp();
    try {
      const res = await app.inject({ method: 'POST', url: '/api/scan' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty('scannedFiles');
      expect(res.json()).toHaveProperty('newMessages');
      expect(res.json()).toHaveProperty('durationMs');
    } finally { await cleanup(); }
  });

  it('POST /api/recompute-cost returns expected shape', async () => {
    const { app, cleanup } = await makeApp();
    try {
      // Scan first so there are messages (none here since dirs are empty)
      await app.inject({ method: 'POST', url: '/api/scan' });
      const res = await app.inject({ method: 'POST', url: '/api/recompute-cost' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('updatedSessions');
      expect(body).toHaveProperty('totalCostUsd');
      expect(body).toHaveProperty('unconfiguredCount');
      // unconfiguredCount is a non-negative integer; the exact value depends on
      // what the Claude source finds in ~/.claude/projects on this machine.
      expect(body.unconfiguredCount).toBeGreaterThanOrEqual(0);
    } finally { await cleanup(); }
  });

  // --- Regression: Bug 1 — /api/scan must scan Codex sessions too ---
  it('POST /api/scan also scans Codex sessions (source: all)', async () => {
    // Build a temp dir that acts as CODEX_HOME with a real fixture file
    const codexHome = mkdtempSync(join(tmpdir(), 'cx-scan-'));
    const sessionsDir = join(codexHome, 'sessions', '2026', '04', '01');
    mkdirSync(sessionsDir, { recursive: true });
    copyFileSync(
      'tests/fixtures/codex/normal.jsonl',
      join(sessionsDir, 'rollout-2026-04-01T10-00-00-test-sess-001.jsonl'),
    );

    const prev = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;

    // Build app with an empty claude projects root — only Codex data is present
    const dir = mkdtempSync(join(tmpdir(), 'cc-app-'));
    const db = openDb(join(dir, 'usage.db'));
    const emptyClaudeRoot = mkdtempSync(join(tmpdir(), 'cc-claude-empty-'));
    const app = await buildApp({ db, projectsRoot: emptyClaudeRoot });
    try {
      const res = await app.inject({ method: 'POST', url: '/api/scan' });
      expect(res.statusCode).toBe(200);

      // Verify Codex messages were inserted
      const codexMsgs = db
        .prepare(`SELECT COUNT(*) as n FROM messages WHERE source = 'codex'`)
        .get() as { n: number };
      expect(codexMsgs.n).toBeGreaterThan(0);

      // Verify Codex session was recorded
      const codexSess = db
        .prepare(`SELECT COUNT(*) as n FROM sessions WHERE source = 'codex'`)
        .get() as { n: number };
      expect(codexSess.n).toBeGreaterThan(0);
    } finally {
      // Restore env var
      if (prev === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = prev;
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
      rmSync(codexHome, { recursive: true, force: true });
      rmSync(emptyClaudeRoot, { recursive: true, force: true });
    }
  });

  // --- Regression: Bug 2 — /api/recompute-cost must bill reasoning tokens ---
  it('POST /api/recompute-cost accounts for reasoning_tokens in Codex messages', async () => {
    const { app, db, cleanup } = await makeApp();
    try {
      // Ensure the openai provider and gpt-5-codex model exist (seeded by migrations)
      const provRow = db
        .prepare(`SELECT id FROM providers WHERE slug = 'openai'`)
        .get() as { id: number } | undefined;
      expect(provRow).toBeDefined();

      // Insert a synthetic Codex project + session so FK constraints are satisfied
      const projectDir = 'codex:dGVzdA';
      const sessionId = 'recompute-reasoning-test-sess';
      db.prepare(
        `INSERT OR IGNORE INTO projects (project_dir, display_name, real_path, first_seen_at, last_seen_at)
         VALUES (?, 'test', '/test', 0, 0)`,
      ).run(projectDir);
      db.prepare(
        `INSERT OR IGNORE INTO sessions
           (session_id, project_dir, started_at, ended_at,
            message_count, total_input, total_output, total_cache_create,
            total_cache_read, total_reasoning, total_cost_usd, source)
         VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'codex')`,
      ).run(sessionId, projectDir);

      // Insert a Codex message with reasoning_tokens=500_000, cost set to 0 initially
      const msgId = 'recompute-reasoning-msg-001';
      const model = 'gpt-5-codex'; // registered under openai in migrations
      const ts = new Date('2026-04-01T10:00:00Z').getTime();
      db.prepare(
        `INSERT INTO messages
           (message_id, session_id, parent_uuid, role, model, timestamp,
            input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
            reasoning_tokens, cost_usd, stop_reason, tool_names, text_preview,
            source, originator)
         VALUES (?, ?, NULL, 'assistant', ?, ?, 1000000, 1000000, 0, 0, 500000,
                 0, 'end_turn', '[]', 'test', 'codex', 'codex_cli')`,
      ).run(msgId, sessionId, model, ts);

      // Sanity: cost starts at 0
      const before = db
        .prepare(`SELECT cost_usd FROM messages WHERE message_id = ?`)
        .get(msgId) as { cost_usd: number };
      expect(before.cost_usd).toBe(0);

      // Run recompute
      const res = await app.inject({ method: 'POST', url: '/api/recompute-cost' });
      expect(res.statusCode).toBe(200);

      // Verify cost is now non-zero
      const after = db
        .prepare(`SELECT cost_usd FROM messages WHERE message_id = ?`)
        .get(msgId) as { cost_usd: number };
      expect(after.cost_usd).toBeGreaterThan(0);

      // Verify the exact math using applyPrice with gpt-5-codex default pricing
      // DEFAULT_PRICING_PER_M: { input: 1.25, output: 10, cacheCreate: 0, cacheRead: 0.125 }
      const expected = applyPrice(
        { input: 1.25, output: 10, cacheCreate: 0, cacheRead: 0.125 },
        {
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          reasoningTokens: 500_000,
        },
      );
      expect(after.cost_usd).toBeCloseTo(expected, 10);

      // Verify session totals were also updated by recomputeSession
      const sess = db
        .prepare(`SELECT total_cost_usd, total_reasoning FROM sessions WHERE session_id = ?`)
        .get(sessionId) as { total_cost_usd: number; total_reasoning: number };
      expect(sess.total_cost_usd).toBeCloseTo(expected, 10);
      expect(sess.total_reasoning).toBe(500_000);
    } finally { await cleanup(); }
  });
});
