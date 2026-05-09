import type { FastifyInstance } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';

export function registerCodex(app: FastifyInstance, db: DatabaseType) {
  // 全局聚合：当前最高水位（用于顶栏徽章）
  app.get('/api/codex/rate-limits/current', async () => {
    const r = db.prepare(
      `SELECT MAX(primary_used_pct) as primaryMaxPct,
              MAX(secondary_used_pct) as secondaryMaxPct,
              MAX(observed_at) as observedAt
       FROM codex_rate_limit_snapshots`,
    ).get() as { primaryMaxPct: number | null; secondaryMaxPct: number | null; observedAt: number | null };
    return r;
  });

  // 历史快照（折线图）
  app.get('/api/codex/rate-limits/history', async () => {
    return db.prepare(
      `SELECT session_id as sessionId, observed_at as observedAt,
              primary_used_pct as primaryUsedPct, secondary_used_pct as secondaryUsedPct,
              plan_type as planType
       FROM codex_rate_limit_snapshots
       ORDER BY observed_at ASC`,
    ).all();
  });
}
