import type { FastifyInstance } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';

export function registerCodex(app: FastifyInstance, db: DatabaseType) {
  // Latest snapshot — i.e. the rate-limit usage as of Codex's most recent report.
  // (Field names kept as `*MaxPct` for backward compatibility with the existing client.)
  app.get('/api/codex/rate-limits/current', async () => {
    const row = db.prepare(
      `SELECT primary_used_pct   as primaryMaxPct,
              secondary_used_pct as secondaryMaxPct,
              observed_at        as observedAt
       FROM codex_rate_limit_snapshots
       ORDER BY observed_at DESC
       LIMIT 1`,
    ).get() as { primaryMaxPct: number | null; secondaryMaxPct: number | null; observedAt: number | null } | undefined;
    return row ?? { primaryMaxPct: null, secondaryMaxPct: null, observedAt: null };
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
