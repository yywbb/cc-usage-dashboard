import type { FastifyInstance } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';
import { scanAll } from '../scanner/index.js';
import { computeCostUsd } from '../pricing.js';
import { recomputeSession } from '../scanner/writer.js';

export interface AdminDeps {
  db: DatabaseType;
  projectsRoot: string;
}

export async function registerAdmin(app: FastifyInstance, deps: AdminDeps) {
  app.get('/api/health', async () => {
    const lastScanAt = (deps.db.prepare(
      'SELECT MAX(last_scanned_at) as t FROM scan_cursor'
    ).get() as any).t ?? null;
    return { ok: true, lastScanAt };
  });

  app.post('/api/scan', async () => scanAll(deps.db, deps.projectsRoot));

  app.post('/api/recompute-cost', async () => {
    const rows = deps.db.prepare(
      `SELECT message_id, model, input_tokens, output_tokens,
              cache_creation_tokens, cache_read_tokens
       FROM messages WHERE model IS NOT NULL`
    ).all() as any[];
    const stmt = deps.db.prepare('UPDATE messages SET cost_usd = ? WHERE message_id = ?');
    const tx = deps.db.transaction(() => {
      for (const r of rows) {
        const cost = computeCostUsd(r.model, {
          inputTokens: r.input_tokens,
          outputTokens: r.output_tokens,
          cacheCreationTokens: r.cache_creation_tokens,
          cacheReadTokens: r.cache_read_tokens,
        });
        stmt.run(cost, r.message_id);
      }
    });
    tx();
    const sids = deps.db.prepare('SELECT session_id FROM sessions').all() as any[];
    for (const { session_id } of sids) recomputeSession(deps.db, session_id);
    const total = (deps.db.prepare(
      'SELECT COALESCE(SUM(total_cost_usd),0) as t FROM sessions'
    ).get() as any).t;
    return { updatedSessions: sids.length, totalCostUsd: total };
  });
}
