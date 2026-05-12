import type { FastifyInstance } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { OverviewResponse, RangeKey, TrendGranularity } from '../../shared/types.js';

export function registerOverview(app: FastifyInstance, db: DatabaseType) {
  app.get('/api/overview', async (req) => {
    const q = req.query as { range?: RangeKey; granularity?: TrendGranularity; source?: string };
    const range = resolveRange(q.range ?? 'all');
    const granularity: TrendGranularity = q.granularity === 'hour' ? 'hour' : 'day';
    const source = q.source && ['claude', 'codex'].includes(q.source) ? q.source : null;
    return computeOverview(db, range, granularity, source);
  });
}

function previousRange(r: { from: number; to: number }): { from: number; to: number } | null {
  if (r.from === 0) return null;
  const dur = r.to - r.from;
  return { from: Math.max(0, r.from - dur), to: r.from };
}

function resolveRange(key: RangeKey): { from: number; to: number } {
  const to = Date.now();
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  switch (key) {
    case 'today': return { from: startOfDay, to };
    case 'week':  return { from: to - 7  * 86400_000, to };
    case 'month': return { from: to - 30 * 86400_000, to };
    case 'ytd':   return { from: new Date(now.getFullYear(), 0, 1).getTime(), to };
    case 'all':
    default:      return { from: 0, to };
  }
}

function computeOverview(
  db: DatabaseType,
  r: { from: number; to: number },
  granularity: TrendGranularity,
  source: string | null,
): OverviewResponse {
  const whereSrcMsg = source ? `AND m.source = @source` : '';
  const whereSrcMsgUnaliased = source ? `AND source = @source` : '';
  const whereSrcSess = source ? `AND s.source = @source` : '';
  const params: Record<string, any> = { from: r.from, to: r.to };
  if (source) params.source = source;

  const totals = db.prepare(
    `SELECT COALESCE(SUM(input_tokens),0) as i,
            COALESCE(SUM(output_tokens),0) as o,
            COALESCE(SUM(cache_creation_tokens),0) as cc,
            COALESCE(SUM(cache_read_tokens),0) as cr,
            COALESCE(SUM(cost_usd),0) as cost,
            COUNT(*) as mc,
            COUNT(DISTINCT session_id) as sc,
            COALESCE(SUM(CASE WHEN role = 'assistant' AND response_error = 0 AND model IS NOT NULL THEN 1 ELSE 0 END), 0) as ok,
            COALESCE(SUM(CASE WHEN response_error = 1 THEN 1 ELSE 0 END), 0) as fail
     FROM messages WHERE timestamp BETWEEN @from AND @to ${whereSrcMsgUnaliased}`
  ).get(params) as any;
  const responseAttempts = totals.ok + totals.fail;
  const responseSuccessRate = responseAttempts > 0 ? totals.ok / responseAttempts : 0;

  const byModel = (db.prepare(
    `SELECT model,
            COALESCE(SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens),0) as tokens,
            COALESCE(SUM(cost_usd),0) as costUsd
     FROM messages
     WHERE model IS NOT NULL AND timestamp BETWEEN @from AND @to ${whereSrcMsgUnaliased}
     GROUP BY model ORDER BY tokens DESC`
  ).all(params) as any[]);
  const totalTokens = byModel.reduce((a, x) => a + x.tokens, 0) || 1;
  const byModelOut = byModel.map(m => ({
    model: m.model, tokens: m.tokens, costUsd: m.costUsd, share: m.tokens / totalTokens
  }));

  const whereSrcByProvider = source ? `AND msg.source = @source` : '';
  const byProviderRaw = db.prepare(
    `SELECT p.slug AS providerSlug, p.display_name AS providerDisplayName,
            COALESCE(SUM(msg.input_tokens + msg.output_tokens
                       + msg.cache_creation_tokens + msg.cache_read_tokens), 0) AS tokens,
            COALESCE(SUM(msg.cost_usd), 0) AS costUsd
     FROM messages msg
     JOIN models m ON m.model_name = msg.model
     JOIN providers p ON p.id = m.provider_id
     WHERE msg.model IS NOT NULL AND msg.timestamp BETWEEN @from AND @to ${whereSrcByProvider}
     GROUP BY p.slug
     ORDER BY tokens DESC`,
  ).all(params) as Array<{ providerSlug: string; providerDisplayName: string; tokens: number; costUsd: number }>;
  const totalTokensProv = byProviderRaw.reduce((a, x) => a + x.tokens, 0) || 1;
  const byProvider = byProviderRaw.map(p => ({ ...p, share: p.tokens / totalTokensProv }));

  const byProject = (db.prepare(
    `SELECT s.project_dir, p.display_name as displayName,
            SUM(m.input_tokens + m.output_tokens + m.cache_creation_tokens + m.cache_read_tokens) as tokens,
            SUM(m.cost_usd) as costUsd
     FROM messages m
     JOIN sessions s ON s.session_id = m.session_id
     JOIN projects p ON p.project_dir = s.project_dir
     WHERE m.timestamp BETWEEN @from AND @to ${whereSrcMsg}
     GROUP BY s.project_dir
     ORDER BY tokens DESC LIMIT 10`
  ).all(params) as any[]).map(x => ({
    projectDir: x.project_dir, displayName: x.displayName,
    tokens: x.tokens, costUsd: x.costUsd,
    share: x.tokens / totalTokens,
  }));

  const bucketExpr = granularity === 'hour'
    ? `strftime('%Y-%m-%d %H:00', timestamp/1000, 'unixepoch', 'localtime')`
    : `date(timestamp/1000, 'unixepoch', 'localtime')`;
  const dailyRaw = db.prepare(
    `SELECT ${bucketExpr} as d, model,
            SUM(input_tokens) as i, SUM(output_tokens) as o,
            SUM(cache_creation_tokens) as cc, SUM(cache_read_tokens) as cr,
            SUM(cost_usd) as cost,
            SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens) as tot
     FROM messages
     WHERE model IS NOT NULL AND timestamp BETWEEN @from AND @to ${whereSrcMsgUnaliased}
     GROUP BY d, model ORDER BY d`
  ).all(params) as any[];
  const dailyMap = new Map<string, any>();
  for (const row of dailyRaw) {
    let b = dailyMap.get(row.d);
    if (!b) {
      b = {
        date: row.d,
        inputTokens: 0, outputTokens: 0,
        cacheCreate: 0, cacheRead: 0,
        costUsd: 0,
        byModel: {} as Record<string, number>,
        byProvider: {} as Record<string, number>,
      };
      dailyMap.set(row.d, b);
    }
    b.inputTokens += row.i;
    b.outputTokens += row.o;
    b.cacheCreate += row.cc;
    b.cacheRead += row.cr;
    b.costUsd += row.cost;
    b.byModel[row.model] = (b.byModel[row.model] ?? 0) + row.tot;
  }

  const bucketExprMsg = granularity === 'hour'
    ? `strftime('%Y-%m-%d %H:00', msg.timestamp/1000, 'unixepoch', 'localtime')`
    : `date(msg.timestamp/1000, 'unixepoch', 'localtime')`;
  const dailyByProviderRaw = db.prepare(
    `SELECT ${bucketExprMsg} AS d, p.slug AS providerSlug,
            SUM(msg.input_tokens + msg.output_tokens
              + msg.cache_creation_tokens + msg.cache_read_tokens) AS tot
     FROM messages msg
     JOIN models m ON m.model_name = msg.model
     JOIN providers p ON p.id = m.provider_id
     WHERE msg.model IS NOT NULL AND msg.timestamp BETWEEN @from AND @to ${whereSrcByProvider}
     GROUP BY d, p.slug
     ORDER BY d`,
  ).all(params) as Array<{ d: string; providerSlug: string; tot: number }>;
  for (const row of dailyByProviderRaw) {
    const b = dailyMap.get(row.d);
    // dailyRaw runs first against the same WHERE clause, so every bucket key
    // emitted here already exists in dailyMap. Skip defensively.
    if (!b) continue;
    b.byProvider[row.providerSlug] = (b.byProvider[row.providerSlug] ?? 0) + row.tot;
  }

  const dailyTrend = [...dailyMap.values()];

  const cacheDenominator = totals.i + totals.cc + totals.cr;
  const cacheHitRate = cacheDenominator > 0 ? totals.cr / cacheDenominator : 0;

  const byTool = (db.prepare(
    `SELECT je.value as tool, COUNT(*) as count
     FROM messages m, json_each(m.tool_names) je
     WHERE m.tool_names IS NOT NULL AND m.tool_names != '[]'
       AND m.timestamp BETWEEN @from AND @to ${whereSrcMsg}
     GROUP BY je.value
     ORDER BY count DESC
     LIMIT 10`
  ).all(params) as Array<{ tool: string; count: number }>);

  const topSessions = (db.prepare(
    `SELECT s.session_id as sessionId, s.project_dir as projectDir,
            p.display_name as displayName,
            s.total_cost_usd as costUsd,
            (s.total_input + s.total_output + s.total_cache_create + s.total_cache_read) as tokens,
            s.started_at as startedAt, s.message_count as messageCount
     FROM sessions s
     JOIN projects p ON p.project_dir = s.project_dir
     WHERE s.started_at BETWEEN @from AND @to ${whereSrcSess}
     ORDER BY s.total_cost_usd DESC
     LIMIT 5`
  ).all(params) as Array<{
    sessionId: string; projectDir: string; displayName: string;
    costUsd: number; tokens: number; startedAt: number; messageCount: number;
  }>);

  const prev = previousRange(r);
  let previous: OverviewResponse['previous'] = null;
  if (prev) {
    const prevParams: Record<string, any> = { from: prev.from, to: prev.to };
    if (source) prevParams.source = source;
    const p = db.prepare(
      `SELECT COALESCE(SUM(input_tokens),0) as i,
              COALESCE(SUM(output_tokens),0) as o,
              COALESCE(SUM(cache_creation_tokens),0) as cc,
              COALESCE(SUM(cache_read_tokens),0) as cr,
              COALESCE(SUM(cost_usd),0) as cost,
              COUNT(*) as mc,
              COUNT(DISTINCT session_id) as sc,
              COALESCE(SUM(CASE WHEN role = 'assistant' AND response_error = 0 AND model IS NOT NULL THEN 1 ELSE 0 END), 0) as ok,
              COALESCE(SUM(CASE WHEN response_error = 1 THEN 1 ELSE 0 END), 0) as fail
       FROM messages WHERE timestamp BETWEEN @from AND @to ${whereSrcMsgUnaliased}`
    ).get(prevParams) as {
      i: number; o: number; cc: number; cr: number;
      cost: number; mc: number; sc: number; ok: number; fail: number;
    };
    const pDenom = p.i + p.cc + p.cr;
    const pAttempts = p.ok + p.fail;
    previous = {
      inputTokens: p.i, outputTokens: p.o,
      cacheCreate: p.cc, cacheRead: p.cr,
      costUsd: p.cost, messageCount: p.mc, sessionCount: p.sc,
      cacheHitRate: pDenom > 0 ? p.cr / pDenom : 0,
      successfulResponses: p.ok,
      failedResponses: p.fail,
      responseAttempts: pAttempts,
      responseSuccessRate: pAttempts > 0 ? p.ok / pAttempts : 0,
    };
  }

  return {
    range: { from: new Date(r.from).toISOString(), to: new Date(r.to).toISOString() },
    totals: {
      inputTokens: totals.i, outputTokens: totals.o,
      cacheCreate: totals.cc, cacheRead: totals.cr,
      costUsd: totals.cost, messageCount: totals.mc, sessionCount: totals.sc,
      successfulResponses: totals.ok,
      failedResponses: totals.fail,
      responseAttempts,
      responseSuccessRate,
    },
    byModel: byModelOut,
    byProject,
    byProvider,
    byTool,
    topSessions,
    dailyTrend,
    cacheHitRate,
    previous,
  };
}
