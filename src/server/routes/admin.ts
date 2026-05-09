import type { FastifyInstance } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';
import { scanAll } from '../scanner/index.js';
import { loadPriceCtx, priceFor, applyPrice } from '../pricing.js';
import { recomputeSession } from '../scanner/writer.js';

export interface AdminDeps {
  db: DatabaseType;
  projectsRoot: string;
}

export async function registerAdmin(app: FastifyInstance, deps: AdminDeps) {
  app.get('/api/health', async () => {
    const lastScanAt = (deps.db.prepare(
      'SELECT MAX(last_scanned_at) as t FROM scan_cursor',
    ).get() as { t: number | null }).t ?? null;
    return { ok: true, lastScanAt };
  });

  app.post('/api/scan', async () => scanAll(deps.db, deps.projectsRoot, { source: 'claude' }));

  app.post('/api/recompute-cost', async () => {
    const rows = deps.db.prepare(
      `SELECT message_id, model, timestamp,
              input_tokens, output_tokens,
              cache_creation_tokens, cache_read_tokens
       FROM messages WHERE model IS NOT NULL`,
    ).all() as Array<{
      message_id: string;
      model: string;
      timestamp: number;
      input_tokens: number;
      output_tokens: number;
      cache_creation_tokens: number;
      cache_read_tokens: number;
    }>;
    const stmt = deps.db.prepare('UPDATE messages SET cost_usd = ? WHERE message_id = ?');
    const ctx = loadPriceCtx(deps.db);
    let unconfiguredCount = 0;
    const tx = deps.db.transaction(() => {
      for (const r of rows) {
        const price = priceFor(ctx, r.model, r.timestamp);
        let cost = 0;
        if (price) {
          cost = applyPrice(price, {
            inputTokens: r.input_tokens,
            outputTokens: r.output_tokens,
            cacheCreationTokens: r.cache_creation_tokens,
            cacheReadTokens: r.cache_read_tokens,
          });
        } else {
          unconfiguredCount++;
        }
        stmt.run(cost, r.message_id);
      }
    });
    tx();
    const sids = deps.db.prepare('SELECT session_id FROM sessions').all() as Array<{ session_id: string }>;
    for (const { session_id } of sids) recomputeSession(deps.db, session_id);
    const total = (deps.db.prepare(
      'SELECT COALESCE(SUM(total_cost_usd),0) as t FROM sessions',
    ).get() as { t: number }).t;
    return { updatedSessions: sids.length, totalCostUsd: total, unconfiguredCount };
  });
}
