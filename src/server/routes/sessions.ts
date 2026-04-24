import type { FastifyInstance } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';
import { decodeProjectDir } from '../paths.js';

export function registerSessions(app: FastifyInstance, db: DatabaseType) {
  app.get('/api/sessions', async (req) => {
    const q = req.query as { projectDir?: string; from?: string; to?: string; limit?: string; offset?: string };
    const projectDir = q.projectDir ? decodeProjectDir(q.projectDir) : null;
    const from = q.from ? new Date(q.from).getTime() : 0;
    const to = q.to ? new Date(q.to).getTime() : Date.now();
    const limit = Number(q.limit ?? 50);
    const offset = Number(q.offset ?? 0);

    const whereProj = projectDir ? 'AND s.project_dir = @projectDir' : '';
    const total = (db.prepare(
      `SELECT COUNT(*) as n FROM sessions s
       WHERE s.started_at BETWEEN @from AND @to ${whereProj}`
    ).get({ from, to, projectDir }) as any).n;

    const rows = db.prepare(
      `SELECT s.session_id as sessionId, s.project_dir as projectDir,
              s.started_at as startedAt, s.ended_at as endedAt,
              s.message_count as messageCount,
              s.total_input + s.total_output + s.total_cache_create + s.total_cache_read as totalTokens,
              s.total_cost_usd as totalCostUsd
       FROM sessions s
       WHERE s.started_at BETWEEN @from AND @to ${whereProj}
       ORDER BY s.started_at DESC LIMIT @limit OFFSET @offset`
    ).all({ from, to, projectDir, limit, offset }) as any[];

    const items = rows.map(r => {
      const tools = db.prepare(
        `SELECT tool_names FROM messages WHERE session_id = ? AND tool_names IS NOT NULL AND tool_names != '[]'`
      ).all(r.sessionId) as any[];
      const counts = new Map<string, number>();
      for (const t of tools) {
        for (const name of JSON.parse(t.tool_names) as string[]) {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
      const topTools = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
      return { ...r, topTools };
    });
    return { total, items };
  });

  app.get('/api/sessions/:sid', async (req, reply) => {
    const { sid } = req.params as { sid: string };
    const session = db.prepare(
      `SELECT session_id as sessionId, project_dir as projectDir,
              started_at as startedAt, ended_at as endedAt,
              message_count as messageCount,
              total_input as totalInput, total_output as totalOutput,
              total_cache_create as totalCacheCreate, total_cache_read as totalCacheRead,
              total_cost_usd as totalCostUsd
       FROM sessions WHERE session_id = ?`
    ).get(sid) as any;
    if (!session) return reply.code(404).send({ error: 'not found' });

    const messages = (db.prepare(
      `SELECT message_id as messageId, role, model, timestamp,
              input_tokens as inputTokens, output_tokens as outputTokens,
              cache_creation_tokens as cacheCreate, cache_read_tokens as cacheRead,
              cost_usd as costUsd, stop_reason as stopReason,
              tool_names as toolNames, text_preview as textPreview
       FROM messages WHERE session_id = ? ORDER BY timestamp`
    ).all(sid) as any[]).map(m => ({
      ...m,
      toolNames: m.toolNames ? JSON.parse(m.toolNames) : [],
    }));

    const counts = new Map<string, number>();
    for (const m of messages) for (const t of m.toolNames) counts.set(t, (counts.get(t) ?? 0) + 1);
    const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
    const toolDistribution = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tool, count]) => ({ tool, count, share: count / total }));

    return { session, messages, toolDistribution };
  });
}
