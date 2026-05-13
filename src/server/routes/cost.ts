import type { FastifyInstance } from 'fastify';
import type { DatabaseType } from '../db.js';
import type { CostResponse } from '../../shared/types.js';

export function registerCost(app: FastifyInstance, db: DatabaseType) {
  app.get('/api/cost', async (req): Promise<CostResponse> => {
    const q = req.query as { granularity?: 'day' | 'week' | 'month'; range?: string; source?: string };
    const granularity = q.granularity ?? 'day';
    const bucketExpr = {
      day:   `date(m.timestamp/1000,'unixepoch','localtime')`,
      week:  `strftime('%Y-W%W', m.timestamp/1000,'unixepoch','localtime')`,
      month: `strftime('%Y-%m',  m.timestamp/1000,'unixepoch','localtime')`,
    }[granularity];

    const source = q.source && ['claude','codex'].includes(q.source) ? q.source : null;
    const whereSrc = source ? `WHERE m.source = @source` : '';
    const params: Record<string, any> = {};
    if (source) params.source = source;

    const rows = db.prepare(
      `SELECT ${bucketExpr} as bucketKey, m.model,
              s.project_dir as projectDir, p.display_name as displayName,
              SUM(m.input_tokens + m.output_tokens + m.cache_creation_tokens + m.cache_read_tokens) as tokens,
              SUM(m.cost_usd) as costUsd
       FROM messages m
       JOIN sessions s ON s.session_id = m.session_id
       JOIN projects p ON p.project_dir = s.project_dir
       ${whereSrc}
       GROUP BY bucketKey, m.model, s.project_dir
       ORDER BY bucketKey`
    ).all(params) as any[];

    const buckets = new Map<string, {
      bucketKey: string; costUsd: number; tokens: number;
      byModel: Record<string, number>;
      byProject: Array<{ projectDir: string; costUsd: number }>;
    }>();
    for (const r of rows) {
      let b = buckets.get(r.bucketKey);
      if (!b) {
        b = { bucketKey: r.bucketKey, costUsd: 0, tokens: 0, byModel: {}, byProject: [] };
        buckets.set(r.bucketKey, b);
      }
      b.costUsd += r.costUsd;
      b.tokens += r.tokens;
      b.byModel[r.model ?? 'unknown'] = (b.byModel[r.model ?? 'unknown'] ?? 0) + r.costUsd;
      const pIdx = b.byProject.findIndex(p => p.projectDir === r.projectDir);
      if (pIdx >= 0) b.byProject[pIdx].costUsd += r.costUsd;
      else b.byProject.push({ projectDir: r.projectDir, costUsd: r.costUsd });
    }
    const bucketsArr = [...buckets.values()];

    const anomalies = detectAnomalies(bucketsArr);
    return { buckets: bucketsArr, anomalies };
  });
}

function detectAnomalies(buckets: { bucketKey: string; costUsd: number }[]) {
  if (buckets.length < 5) return [];
  const costs = buckets.map(b => b.costUsd);
  const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
  const variance = costs.reduce((a, b) => a + (b - mean) ** 2, 0) / costs.length;
  const sd = Math.sqrt(variance);
  if (sd === 0) return [];
  return buckets
    .map(b => ({ date: b.bucketKey, costUsd: b.costUsd, zScore: (b.costUsd - mean) / sd }))
    .filter(a => a.zScore > 2);
}
