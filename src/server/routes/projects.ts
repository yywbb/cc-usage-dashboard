import type { FastifyInstance } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';
import { decodeProjectDir } from '../paths.js';
import type { ProjectRow } from '../../shared/types.js';

export function registerProjects(app: FastifyInstance, db: DatabaseType) {
  app.get('/api/projects', async (req) => {
    const q = req.query as { sortBy?: 'cost' | 'tokens' | 'sessions'; order?: 'asc' | 'desc'; source?: string };
    const sortBy = q.sortBy ?? 'cost';
    const order = q.order === 'asc' ? 'ASC' : 'DESC';
    const sortCol = {
      cost: 'total_cost_usd',
      tokens: 'total_tokens',
      sessions: 'session_count',
    }[sortBy];
    const source = q.source && ['claude','codex'].includes(q.source) ? q.source : null;

    const joinCond = source ? `s.project_dir = p.project_dir AND s.source = @source` : `s.project_dir = p.project_dir`;
    const havingClause = source ? `HAVING COUNT(s.session_id) > 0` : ``;

    const params: Record<string, any> = {};
    if (source) params.source = source;

    const rows = db.prepare(
      `SELECT p.project_dir as projectDir, p.display_name as displayName, p.real_path as realPath,
              COUNT(s.session_id) as session_count,
              COALESCE(SUM(s.total_input + s.total_output + s.total_cache_create + s.total_cache_read),0) as total_tokens,
              COALESCE(SUM(s.total_cost_usd),0) as total_cost_usd,
              COALESCE(MIN(s.started_at), p.first_seen_at) as firstSeenAt,
              COALESCE(MAX(s.ended_at),   p.last_seen_at)  as lastSeenAt
       FROM projects p
       LEFT JOIN sessions s ON ${joinCond}
       GROUP BY p.project_dir
       ${havingClause}
       ORDER BY ${sortCol} ${order}`
    ).all(params) as any[];
    const out: ProjectRow[] = rows.map(r => ({
      projectDir: r.projectDir, displayName: r.displayName, realPath: r.realPath,
      sessionCount: r.session_count, totalTokens: r.total_tokens, totalCostUsd: r.total_cost_usd,
      avgTokensPerSession: r.session_count > 0 ? r.total_tokens / r.session_count : 0,
      firstSeenAt: r.firstSeenAt, lastSeenAt: r.lastSeenAt,
    }));
    return out;
  });

  app.get('/api/projects/:b64/timeline', async (req) => {
    const { b64 } = req.params as { b64: string };
    const q = req.query as { source?: string };
    const projectDir = decodeProjectDir(b64);
    const source = q.source && ['claude','codex'].includes(q.source) ? q.source : null;
    const whereSrcMsg  = source ? `AND m.source = @source` : '';
    const whereSrcSess = source ? `AND source = @source`   : '';
    const params: Record<string, any> = { projectDir };
    if (source) params.source = source;

    const daily = db.prepare(
      `SELECT date(m.timestamp/1000,'unixepoch','localtime') as date,
              SUM(m.input_tokens + m.output_tokens + m.cache_creation_tokens + m.cache_read_tokens) as tokens,
              SUM(m.cost_usd) as costUsd,
              COUNT(DISTINCT m.session_id) as sessionCount
       FROM messages m
       JOIN sessions s ON s.session_id = m.session_id
       WHERE s.project_dir = @projectDir ${whereSrcMsg}
       GROUP BY date ORDER BY date`
    ).all(params);
    const topSessions = db.prepare(
      `SELECT session_id as sessionId, total_cost_usd as totalCostUsd,
              total_input + total_output + total_cache_create + total_cache_read as totalTokens,
              message_count as messageCount, started_at as startedAt, ended_at as endedAt
       FROM sessions WHERE project_dir = @projectDir ${whereSrcSess}
       ORDER BY total_cost_usd DESC LIMIT 20`
    ).all(params);
    const totalsRow = db.prepare(
      `SELECT COALESCE(SUM(m.input_tokens),0) as inputTokens,
              COALESCE(SUM(m.output_tokens),0) as outputTokens,
              COALESCE(SUM(m.cache_creation_tokens),0) as cacheCreate,
              COALESCE(SUM(m.cache_read_tokens),0) as cacheRead,
              COALESCE(SUM(m.cost_usd),0) as costUsd,
              COUNT(*) as messageCount,
              COUNT(DISTINCT m.session_id) as sessionCount
       FROM messages m
       JOIN sessions s ON s.session_id = m.session_id
       WHERE s.project_dir = @projectDir ${whereSrcMsg}`
    ).get(params) as {
      inputTokens: number; outputTokens: number;
      cacheCreate: number; cacheRead: number;
      costUsd: number; messageCount: number; sessionCount: number;
    };
    const cacheDenom = totalsRow.inputTokens + totalsRow.cacheCreate + totalsRow.cacheRead;
    const totals = {
      ...totalsRow,
      cacheHitRate: cacheDenom > 0 ? totalsRow.cacheRead / cacheDenom : 0,
    };
    return { daily, topSessions, totals };
  });
}
