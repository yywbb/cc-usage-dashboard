import type { FastifyInstance } from 'fastify';
import type { DatabaseType } from '../db.js';

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function registerSessions(app: FastifyInstance, db: DatabaseType) {
  // projectDir query string accepts a comma-separated list of RAW project_dir values
  // (as returned by /api/projects), not base64-encoded. project_dir strings come from
  // folder names and never contain commas in practice.
  const SORT_COLUMN: Record<string, string> = {
    startedAt: 's.started_at',
    duration: '(s.ended_at - s.started_at)',
    messageCount: 's.message_count',
    totalTokens: '(s.total_input + s.total_output + s.total_cache_create + s.total_cache_read)',
    totalCostUsd: 's.total_cost_usd',
  };

  app.get('/api/sessions', async (req) => {
    const q = req.query as {
      projectDir?: string; providers?: string;
      from?: string; to?: string; limit?: string; offset?: string;
      sortBy?: string; sortOrder?: string;
      source?: string; originator?: string;
    };
    const projectDirs = q.projectDir
      ? q.projectDir.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const from = q.from ? new Date(q.from).getTime() : 0;
    const to = q.to ? new Date(q.to).getTime() : Date.now();
    const limit = Number(q.limit ?? 50);
    const offset = Number(q.offset ?? 0);
    const sortBy = q.sortBy && SORT_COLUMN[q.sortBy] ? q.sortBy : 'startedAt';
    const sortOrder = q.sortOrder === 'asc' ? 'ASC' : 'DESC';

    const projPlaceholders = projectDirs.map((_, i) => `@p${i}`).join(',');
    const whereProj = projectDirs.length ? `AND s.project_dir IN (${projPlaceholders})` : '';
    const projParams: Record<string, string> = {};
    projectDirs.forEach((p, i) => (projParams[`p${i}`] = p));

    const providerSlugs = q.providers
      ? q.providers.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const provPlaceholders = providerSlugs.map((_, i) => `@pr${i}`).join(',');
    const whereProv = providerSlugs.length
      ? `AND s.session_id IN (
           SELECT DISTINCT msg.session_id FROM messages msg
           JOIN models m ON m.model_name = msg.model
           JOIN providers pp ON pp.id = m.provider_id
           WHERE pp.slug IN (${provPlaceholders})
         )`
      : '';
    const provParams: Record<string, string> = {};
    providerSlugs.forEach((s, i) => (provParams[`pr${i}`] = s));

    const source = q.source && ['claude', 'codex'].includes(q.source) ? q.source : null;
    const originator = q.originator ?? null;
    const whereSource = source ? `AND s.source = @source` : '';
    const whereOriginator = originator
      ? `AND s.session_id IN (SELECT session_id FROM messages WHERE originator = @originator)`
      : '';
    const baseParams: Record<string, string | number> = { from, to, ...projParams, ...provParams };
    if (source) baseParams.source = source;
    if (originator) baseParams.originator = originator;

    const totalRow = db.prepare(
      `SELECT COUNT(*) as n FROM sessions s
       WHERE s.started_at BETWEEN @from AND @to ${whereProj} ${whereProv} ${whereSource} ${whereOriginator}`
    ).get(baseParams) as { n: number };
    const total = totalRow.n;

    const rows = db.prepare(
      `SELECT s.session_id as sessionId, s.project_dir as projectDir,
              s.source as source,
              s.started_at as startedAt, s.ended_at as endedAt,
              s.message_count as messageCount,
              s.total_input + s.total_output + s.total_cache_create + s.total_cache_read as totalTokens,
              s.total_cost_usd as totalCostUsd
       FROM sessions s
       WHERE s.started_at BETWEEN @from AND @to ${whereProj} ${whereProv} ${whereSource} ${whereOriginator}
       ORDER BY ${SORT_COLUMN[sortBy]} ${sortOrder}, s.session_id ${sortOrder}
       LIMIT @limit OFFSET @offset`
    ).all({ ...baseParams, limit, offset }) as Array<{
      sessionId: string; projectDir: string; source: string | null; startedAt: number; endedAt: number;
      messageCount: number; totalTokens: number; totalCostUsd: number;
    }>;

    const items = rows.map(r => {
      const tools = db.prepare(
        `SELECT tool_names FROM messages WHERE session_id = ? AND tool_names IS NOT NULL AND tool_names != '[]'`
      ).all(r.sessionId) as Array<{ tool_names: string }>;
      const counts = new Map<string, number>();
      for (const t of tools) {
        for (const name of JSON.parse(t.tool_names) as string[]) {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
      const topTools = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
      return { ...r, topTools };
    });

    const statRows = db.prepare(
      `SELECT s.total_cost_usd as cost, s.ended_at - s.started_at as durMs
       FROM sessions s
       WHERE s.started_at BETWEEN @from AND @to ${whereProj} ${whereProv} ${whereSource} ${whereOriginator}`
    ).all(baseParams) as Array<{ cost: number; durMs: number }>;

    const totalCostUsd = statRows.reduce((a, r) => a + (r.cost ?? 0), 0);
    const count = statRows.length;
    const avgCostUsd = count > 0 ? totalCostUsd / count : 0;
    const durations = statRows.map(r => Math.max(0, r.durMs ?? 0)).sort((a, b) => a - b);
    const medianDurationMs = median(durations);

    return {
      total,
      items,
      stats: { count, totalCostUsd, avgCostUsd, medianDurationMs },
    };
  });

  app.get('/api/sessions/:sid', async (req, reply) => {
    const { sid } = req.params as { sid: string };
    const session = db.prepare(
      `SELECT session_id as sessionId, project_dir as projectDir,
              source, cwd_real_path as cwdRealPath,
              started_at as startedAt, ended_at as endedAt,
              message_count as messageCount,
              total_input as totalInput, total_output as totalOutput,
              total_cache_create as totalCacheCreate, total_cache_read as totalCacheRead,
              total_reasoning as totalReasoning,
              total_cost_usd as totalCostUsd
       FROM sessions WHERE session_id = ?`
    ).get(sid) as Record<string, unknown> | undefined;
    if (!session) return reply.code(404).send({ error: 'not found' });

    const messages = (db.prepare(
      `SELECT message_id as messageId, role, model, timestamp,
              input_tokens as inputTokens, output_tokens as outputTokens,
              cache_creation_tokens as cacheCreate, cache_read_tokens as cacheRead,
              cost_usd as costUsd, stop_reason as stopReason,
              tool_names as toolNames, text_preview as textPreview,
              source, originator, reasoning_tokens as reasoningTokens
       FROM messages WHERE session_id = ? ORDER BY timestamp`
    ).all(sid) as Array<Record<string, unknown> & { toolNames: string | null }>).map(m => ({
      ...m,
      toolNames: m.toolNames ? JSON.parse(m.toolNames) : [],
    }));

    const counts = new Map<string, number>();
    for (const m of messages) for (const t of m.toolNames as string[]) counts.set(t, (counts.get(t) ?? 0) + 1);
    const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
    const toolDistribution = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tool, count]) => ({ tool, count, share: count / total }));

    const rateLimit = db.prepare(
      `SELECT observed_at as observedAt,
              primary_used_pct as primaryUsedPct, primary_window_min as primaryWindowMin, primary_resets_at as primaryResetsAt,
              secondary_used_pct as secondaryUsedPct, secondary_window_min as secondaryWindowMin, secondary_resets_at as secondaryResetsAt,
              plan_type as planType
       FROM codex_rate_limit_snapshots WHERE session_id = ?`
    ).get(sid) ?? null;

    return { session, messages, toolDistribution, rateLimit };
  });
}
