import type { DatabaseType } from '../db.js';
import { withTransaction } from '../db.js';
import type { ParsedMessage, RateLimitSnapshot } from '../../shared/types.js';
import { loadPriceCtx, priceFor, applyPrice } from '../pricing.js';

export function upsertProject(
  db: DatabaseType,
  p: { projectDir: string; displayName: string; realPath: string | null }
): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects (project_dir, display_name, real_path, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_dir) DO UPDATE SET
       display_name = excluded.display_name,
       real_path = COALESCE(excluded.real_path, projects.real_path),
       last_seen_at = excluded.last_seen_at`
  ).run(p.projectDir, p.displayName, p.realPath, now, now);
}

export function insertMessages(
  db: DatabaseType,
  projectDir: string,
  sessionId: string,
  msgs: ParsedMessage[],
): number {
  if (msgs.length === 0) return 0;
  ensureSession(db, sessionId, projectDir, msgs[0].source, msgs[0].cwdRealPath);
  const ctx = loadPriceCtx(db);
  const stmt = db.prepare(
     `INSERT OR IGNORE INTO messages
       (message_id, session_id, parent_uuid, role, model, timestamp,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
        reasoning_tokens, cost_usd, stop_reason, tool_names, text_preview,
        source, originator, response_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  return withTransaction(db, () => {
    let inserted = 0;
    for (const m of msgs) {
      let cost = 0;
      if (m.model) {
        const price = priceFor(ctx, m.model, m.timestamp);
        if (price) {
          cost = applyPrice(price, {
            inputTokens: m.inputTokens,
            outputTokens: m.outputTokens,
            cacheCreationTokens: m.cacheCreationTokens,
            cacheReadTokens: m.cacheReadTokens,
            reasoningTokens: m.reasoningTokens,
          });
        }
      }
      const r = stmt.run(
        m.messageId, m.sessionId, m.parentUuid, m.role, m.model, m.timestamp,
        m.inputTokens, m.outputTokens, m.cacheCreationTokens, m.cacheReadTokens,
        m.reasoningTokens, cost, m.stopReason, JSON.stringify(m.toolNames), m.textPreview,
        m.source, m.originator, m.responseError ? 1 : 0,
      );
      if (r.changes > 0) inserted++;
    }
    return inserted;
  });
}

export function ensureSession(
  db: DatabaseType,
  sessionId: string,
  projectDir: string,
  source: 'claude' | 'codex',
  cwdRealPath: string | null,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO sessions
       (session_id, project_dir, started_at, ended_at,
        message_count, total_input, total_output, total_cache_create, total_cache_read,
        total_reasoning, total_cost_usd, source, cwd_real_path)
     VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)`
  ).run(sessionId, projectDir, source, cwdRealPath);
}

export function upsertCodexProject(
  db: DatabaseType,
  p: { projectDir: string; displayName: string; realPath: string },
): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects (project_dir, display_name, real_path, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_dir) DO UPDATE SET
       display_name = excluded.display_name,
       real_path = excluded.real_path,
       last_seen_at = excluded.last_seen_at`,
  ).run(p.projectDir, p.displayName, p.realPath, now, now);
}

export function upsertRateLimitSnapshot(db: DatabaseType, s: RateLimitSnapshot): void {
  db.prepare(
    `INSERT INTO codex_rate_limit_snapshots
       (session_id, observed_at,
        primary_used_pct, primary_window_min, primary_resets_at,
        secondary_used_pct, secondary_window_min, secondary_resets_at,
        plan_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       observed_at = excluded.observed_at,
       primary_used_pct = excluded.primary_used_pct,
       primary_window_min = excluded.primary_window_min,
       primary_resets_at = excluded.primary_resets_at,
       secondary_used_pct = excluded.secondary_used_pct,
       secondary_window_min = excluded.secondary_window_min,
       secondary_resets_at = excluded.secondary_resets_at,
       plan_type = excluded.plan_type`,
  ).run(
    s.sessionId, s.observedAt,
    s.primaryUsedPct, s.primaryWindowMin, s.primaryResetsAt,
    s.secondaryUsedPct, s.secondaryWindowMin, s.secondaryResetsAt,
    s.planType,
  );
}

export function recomputeSession(db: DatabaseType, sessionId: string): void {
  const agg = db.prepare(
    `SELECT COUNT(*) as c,
            COALESCE(MIN(timestamp), 0) as started,
            COALESCE(MAX(timestamp), 0) as ended,
            COALESCE(SUM(input_tokens), 0) as in_,
            COALESCE(SUM(output_tokens), 0) as out_,
            COALESCE(SUM(cache_creation_tokens), 0) as cc,
            COALESCE(SUM(cache_read_tokens), 0) as cr,
            COALESCE(SUM(reasoning_tokens), 0) as rs,
            COALESCE(SUM(cost_usd), 0) as cost
     FROM messages WHERE session_id = ?`
  ).get(sessionId) as any;

  db.prepare(
    `UPDATE sessions SET
       started_at = ?, ended_at = ?,
       message_count = ?, total_input = ?, total_output = ?,
       total_cache_create = ?, total_cache_read = ?, total_reasoning = ?, total_cost_usd = ?
     WHERE session_id = ?`
  ).run(agg.started, agg.ended, agg.c, agg.in_, agg.out_, agg.cc, agg.cr, agg.rs, agg.cost, sessionId);
}
