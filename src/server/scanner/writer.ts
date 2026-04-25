import type { Database as DatabaseType } from 'better-sqlite3';
import type { ParsedMessage } from '../../shared/types.js';
import { computeCostUsdWith, loadPriceTable } from '../pricing.js';

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
  msgs: ParsedMessage[]
): number {
  if (msgs.length === 0) return 0;
  ensureSession(db, sessionId, projectDir);
  const priceTable = loadPriceTable(db);
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO messages
       (message_id, session_id, parent_uuid, role, model, timestamp,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
        cost_usd, stop_reason, tool_names, text_preview)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction((rows: ParsedMessage[]) => {
    let inserted = 0;
    for (const m of rows) {
      const cost = m.model
        ? computeCostUsdWith(priceTable, m.model, {
            inputTokens: m.inputTokens,
            outputTokens: m.outputTokens,
            cacheCreationTokens: m.cacheCreationTokens,
            cacheReadTokens: m.cacheReadTokens,
          })
        : 0;
      const r = stmt.run(
        m.messageId, m.sessionId, m.parentUuid, m.role, m.model, m.timestamp,
        m.inputTokens, m.outputTokens, m.cacheCreationTokens, m.cacheReadTokens,
        cost, m.stopReason, JSON.stringify(m.toolNames), m.textPreview
      );
      if (r.changes > 0) inserted++;
    }
    return inserted;
  });
  return tx(msgs);
}

function ensureSession(db: DatabaseType, sessionId: string, projectDir: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO sessions
       (session_id, project_dir, started_at, ended_at,
        message_count, total_input, total_output, total_cache_create, total_cache_read, total_cost_usd)
     VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, 0)`
  ).run(sessionId, projectDir);
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
            COALESCE(SUM(cost_usd), 0) as cost
     FROM messages WHERE session_id = ?`
  ).get(sessionId) as any;

  db.prepare(
    `UPDATE sessions SET
       started_at = ?, ended_at = ?,
       message_count = ?, total_input = ?, total_output = ?,
       total_cache_create = ?, total_cache_read = ?, total_cost_usd = ?
     WHERE session_id = ?`
  ).run(agg.started, agg.ended, agg.c, agg.in_, agg.out_, agg.cc, agg.cr, agg.cost, sessionId);
}
