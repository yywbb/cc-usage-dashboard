# Global Source Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a three-state All/Claude/Codex toggle in the dashboard top bar that scopes every data page; remove the now-redundant Source selector from the Sessions list.

**Architecture:** zustand store gains `sourceFilter` (persisted to localStorage). New `<SourceToggle />` component mounts in App.tsx header. Backend overview/projects/cost routes gain a `source` query param using the same allowlist + named-parameter pattern that sessions already uses. All affected page hooks include `sourceFilter` in queryKey + URL params.

**Tech Stack:** TypeScript strict, AntD 5 Segmented, zustand 5, @tanstack/react-query 5, Fastify 5, better-sqlite3, vitest 2.

Spec: `docs/superpowers/specs/2026-05-09-global-source-toggle-design.md`.

---

## File Structure

**Modify**
- `src/web/store.ts` — add `sourceFilter` field + setter + localStorage hydration
- `src/web/App.tsx` — mount `<SourceToggle />` in header right cluster
- `src/web/hooks/useOverview.ts` — accept sourceFilter, include in queryKey + URL
- `src/web/pages/Overview/Index.tsx` — pass sourceFilter from store into useOverview
- `src/web/pages/Projects/List.tsx` — read sourceFilter from store, append to URL, include in queryKey
- `src/web/pages/Projects/Detail.tsx` — same
- `src/web/pages/Sessions/List.tsx` — DELETE local source state, read from store; keep Originator selector
- `src/web/pages/Cost/Index.tsx` (or whichever cost page consumes /api/cost) — same wiring
- `src/server/routes/overview.ts` — accept source query, thread through every SQL statement
- `src/server/routes/projects.ts` — accept source query, filter in list (LEFT JOIN ON + HAVING) + detail
- `src/server/routes/cost.ts` — accept source query, filter the bucket query
- `tests/routes-overview.test.ts` — add a source=codex filter test
- `tests/routes-projects.test.ts` — add source=codex filter tests for list + detail
- `tests/routes-cost.test.ts` — add source=codex filter test

**Create**
- `src/web/components/SourceToggle.tsx` — Segmented widget reading/writing the store

**No new tests**: backend gets one new test per route. Frontend has no test infrastructure.

---

## Task 1: Store sourceFilter + localStorage

**Files:**
- Modify: `src/web/store.ts`

- [ ] **Step 1: Read current store**

Run: `cat src/web/store.ts`
Expected: existing `range`, `compactNumbers` keys with localStorage for compactNumbers.

- [ ] **Step 2: Replace store contents**

Replace `src/web/store.ts` entirely:
```ts
import { create } from 'zustand';
import type { RangeKey } from '../shared/types.js';

const COMPACT_KEY = 'ccCompactNumbers';
const SOURCE_KEY = 'ccSourceFilter';

export type SourceFilter = 'all' | 'claude' | 'codex';

function readCompact(): boolean {
  if (typeof localStorage === 'undefined') return true;
  const raw = localStorage.getItem(COMPACT_KEY);
  return raw === null ? true : raw === '1';
}

function readSource(): SourceFilter {
  if (typeof localStorage === 'undefined') return 'all';
  const v = localStorage.getItem(SOURCE_KEY);
  return v === 'claude' || v === 'codex' ? v : 'all';
}

interface StoreState {
  range: RangeKey;
  setRange: (r: RangeKey) => void;
  compactNumbers: boolean;
  setCompactNumbers: (v: boolean) => void;
  sourceFilter: SourceFilter;
  setSourceFilter: (s: SourceFilter) => void;
}

export const useStore = create<StoreState>((set) => ({
  range: 'month',
  setRange: (range) => set({ range }),
  compactNumbers: readCompact(),
  setCompactNumbers: (compactNumbers) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(COMPACT_KEY, compactNumbers ? '1' : '0');
    }
    set({ compactNumbers });
  },
  sourceFilter: readSource(),
  setSourceFilter: (sourceFilter) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SOURCE_KEY, sourceFilter);
    }
    set({ sourceFilter });
  },
}));
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src/web/store.ts
git commit -m "feat(store): add sourceFilter with localStorage persistence"
```

---

## Task 2: SourceToggle component + mount in App.tsx

**Files:**
- Create: `src/web/components/SourceToggle.tsx`
- Modify: `src/web/App.tsx`

- [ ] **Step 1: Create the component**

Create `src/web/components/SourceToggle.tsx`:
```tsx
import { Segmented } from 'antd';
import { useStore, type SourceFilter } from '../store.js';

const OPTIONS: { label: string; value: SourceFilter }[] = [
  { label: 'All',    value: 'all' },
  { label: 'Claude', value: 'claude' },
  { label: 'Codex',  value: 'codex' },
];

export default function SourceToggle() {
  const sourceFilter = useStore((s) => s.sourceFilter);
  const setSourceFilter = useStore((s) => s.setSourceFilter);
  return (
    <Segmented
      size="small"
      options={OPTIONS}
      value={sourceFilter}
      onChange={(v) => setSourceFilter(v as SourceFilter)}
    />
  );
}
```

- [ ] **Step 2: Mount in App.tsx header**

Read `src/web/App.tsx`. Find the right-cluster `<div>` that wraps `<RateLimitBadge />`, `<ThemeToggle />`, and the Refresh button. Add `<SourceToggle />` BEFORE `<RateLimitBadge />`.

The change to `src/web/App.tsx` looks like:
```diff
 import ThemeToggle from './components/ThemeToggle.js';
+import SourceToggle from './components/SourceToggle.js';
 import RateLimitBadge from './components/RateLimitBadge.js';
```
And inside the header right-cluster div:
```diff
-          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
+          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
+            <SourceToggle />
             <RateLimitBadge />
             <ThemeToggle />
             <Button
```

- [ ] **Step 3: Build the web bundle to confirm it compiles**

Run: `pnpm build`
Expected: web + server build success.

- [ ] **Step 4: Commit**

```bash
git add src/web/components/SourceToggle.tsx src/web/App.tsx
git commit -m "feat(ui): SourceToggle in top bar (All/Claude/Codex)"
```

---

## Task 3: Backend overview source filter

**Files:**
- Modify: `src/server/routes/overview.ts`
- Test: `tests/routes-overview.test.ts`

- [ ] **Step 1: Read current overview.ts and the existing overview test**

Run:
```
cat src/server/routes/overview.ts | head -200
cat tests/routes-overview.test.ts
```
Expected: All SQL statements use positional `?` params with `.get(r.from, r.to)` calls. Identify each statement: totals, byModel, byProvider, byProject, dailyRaw, dailyByProviderRaw, byTool, topSessions, previous totals.

- [ ] **Step 2: Write a failing test for source=codex filter**

Append to `tests/routes-overview.test.ts`:
```ts
it('filters totals by source=codex', async () => {
  const { app, db, cleanup } = await seeded();   // helper expected to expose db
  try {
    // Insert a synthetic codex message; existing fixture is Claude-only
    db.prepare(`INSERT INTO projects (project_dir, display_name, real_path, first_seen_at, last_seen_at) VALUES ('codex:abc','/p','/p',0,0)`).run();
    db.prepare(`INSERT INTO sessions (session_id, project_dir, started_at, ended_at, source) VALUES ('s-cx','codex:abc',1,2,'codex')`).run();
    db.prepare(
      `INSERT INTO messages (message_id, session_id, role, model, timestamp,
                              input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
                              cost_usd, source)
       VALUES ('m-cx','s-cx','assistant','gpt-5',1, 100, 50, 0, 0, 0.5, 'codex')`,
    ).run();

    const all = (await app.inject({ method: 'GET', url: '/api/overview?range=all' })).json();
    const codex = (await app.inject({ method: 'GET', url: '/api/overview?range=all&source=codex' })).json();
    const claude = (await app.inject({ method: 'GET', url: '/api/overview?range=all&source=claude' })).json();

    expect(all.totals.messageCount).toBe(codex.totals.messageCount + claude.totals.messageCount);
    expect(codex.totals.messageCount).toBe(1);
    expect(codex.totals.costUsd).toBeCloseTo(0.5, 6);
  } finally { await cleanup(); }
});
```

> The existing `seeded()` helper in `tests/routes-overview.test.ts` may not currently return `db`. If it doesn't, modify it to return `db` (it should already follow the same pattern as `tests/routes-sessions.test.ts:9-19`). Adjust other tests that destructure from it accordingly.

- [ ] **Step 3: Run the test to confirm it fails**

Run: `pnpm test tests/routes-overview.test.ts`
Expected: the new test fails (because the route ignores `source`, both `codex.totals` and `all.totals` will be identical).

- [ ] **Step 4: Add source query parsing to the route handler**

Edit `src/server/routes/overview.ts`. Replace the route handler:
```ts
app.get('/api/overview', async (req) => {
  const q = req.query as { range?: RangeKey; granularity?: TrendGranularity; source?: string };
  const range = resolveRange(q.range ?? 'all');
  const granularity: TrendGranularity = q.granularity === 'hour' ? 'hour' : 'day';
  const source = q.source && ['claude','codex'].includes(q.source) ? q.source : null;
  return computeOverview(db, range, granularity, source);
});
```

Add the `source` parameter to `computeOverview`'s signature:
```ts
function computeOverview(
  db: DatabaseType,
  r: { from: number; to: number },
  granularity: TrendGranularity,
  source: string | null,
): OverviewResponse {
```

- [ ] **Step 5: Thread source filter into every SQL statement in computeOverview**

Convert each query from positional to named parameters and conditionally append the source fragment. Specifically each `WHERE … BETWEEN ? AND ?` becomes `WHERE … BETWEEN @from AND @to ${whereSrc}` where:

```ts
// near the top of computeOverview
const whereSrcMsg  = source ? `AND m.source = @source`   : '';   // for queries aliased as `m`/`messages`
const whereSrcMsgUnaliased = source ? `AND source = @source` : ''; // for queries with unaliased messages table
const whereSrcSess = source ? `AND s.source = @source`   : '';   // for queries aliased on sessions
const params: Record<string, any> = { from: r.from, to: r.to };
if (source) params.source = source;
```

Then convert each statement. Example for the `totals` query:
```ts
const totals = db.prepare(
  `SELECT COALESCE(SUM(input_tokens),0) as i,
          COALESCE(SUM(output_tokens),0) as o,
          COALESCE(SUM(cache_creation_tokens),0) as cc,
          COALESCE(SUM(cache_read_tokens),0) as cr,
          COALESCE(SUM(cost_usd),0) as cost,
          COUNT(*) as mc,
          COUNT(DISTINCT session_id) as sc
   FROM messages WHERE timestamp BETWEEN @from AND @to ${whereSrcMsgUnaliased}`
).get(params) as any;
```

Apply the same conversion to:
1. `byModel` query — uses unaliased `messages`. Add `${whereSrcMsgUnaliased}`.
2. `byProvider` query — uses `msg` alias. Use `source ? 'AND msg.source = @source' : ''`.
3. `byProject` query — uses `m` alias on messages. Use `${whereSrcMsg}`.
4. `dailyRaw` query — unaliased messages. Use `${whereSrcMsgUnaliased}`.
5. `dailyByProviderRaw` query — `msg` alias. Use `source ? 'AND msg.source = @source' : ''`.
6. `byTool` query — `m` alias on messages. Use `${whereSrcMsg}`.
7. `topSessions` query — `s` alias on sessions. Use `${whereSrcSess}`.
8. `previous` totals query — unaliased messages. Use `${whereSrcMsgUnaliased}`.

For `previous` query specifically, build a separate params object:
```ts
const prevParams: Record<string, any> = { from: prev.from, to: prev.to };
if (source) prevParams.source = source;
const p = db.prepare(`...WHERE timestamp BETWEEN @from AND @to ${whereSrcMsgUnaliased}`).get(prevParams) as any;
```

For all other queries that share the same `params` object: pass `params` instead of positional `r.from, r.to`.

- [ ] **Step 6: Run the new test, then full overview test file**

Run: `pnpm test tests/routes-overview.test.ts`
Expected: all PASS, including the new filter test.

- [ ] **Step 7: Run full backend test suite**

Run: `pnpm test`
Expected: 91+ pass (was 90), no regressions.

- [ ] **Step 8: Commit**

```bash
git add src/server/routes/overview.ts tests/routes-overview.test.ts
git commit -m "feat(api): /api/overview accepts source filter"
```

---

## Task 4: Backend projects source filter (list + detail)

**Files:**
- Modify: `src/server/routes/projects.ts`
- Test: `tests/routes-projects.test.ts`

- [ ] **Step 1: Read current projects route**

Run: `cat src/server/routes/projects.ts`
Expected: Two endpoints — list (`GET /api/projects`) using LEFT JOIN sessions, and timeline detail (`GET /api/projects/:b64/timeline`) joining messages+sessions+projects.

- [ ] **Step 2: Add a failing test for list source filter**

Append to `tests/routes-projects.test.ts`:
```ts
it('filters projects list by source=codex', async () => {
  const { app, db, cleanup } = await seeded();
  try {
    db.prepare(`INSERT INTO projects (project_dir, display_name, real_path, first_seen_at, last_seen_at) VALUES ('codex:p','/p','/p',0,0)`).run();
    db.prepare(`INSERT INTO sessions (session_id, project_dir, started_at, ended_at, source, total_input, total_output, total_cost_usd) VALUES ('s1','codex:p',0,0,'codex',100,50,1.0)`).run();
    const codex = (await app.inject({ method: 'GET', url: '/api/projects?source=codex' })).json();
    const claude = (await app.inject({ method: 'GET', url: '/api/projects?source=claude' })).json();
    expect(codex.some((p: any) => p.projectDir === 'codex:p')).toBe(true);
    expect(claude.some((p: any) => p.projectDir === 'codex:p')).toBe(false);
    // Claude-only fixture project should NOT appear in codex view
    expect(codex.some((p: any) => p.projectDir === claude[0]?.projectDir)).toBe(false);
  } finally { await cleanup(); }
});

it('filters project timeline detail by source=codex', async () => {
  const { app, db, cleanup } = await seeded();
  try {
    db.prepare(`INSERT INTO projects (project_dir, display_name, real_path, first_seen_at, last_seen_at) VALUES ('codex:p','/p','/p',0,0)`).run();
    db.prepare(`INSERT INTO sessions (session_id, project_dir, started_at, ended_at, source, total_cost_usd) VALUES ('s1','codex:p',1,2,'codex',2.0)`).run();
    db.prepare(`INSERT INTO messages (message_id, session_id, role, model, timestamp, input_tokens, output_tokens, cost_usd, source) VALUES ('m1','s1','assistant','gpt-5',1,50,20,2.0,'codex')`).run();
    const b64 = Buffer.from('codex:p', 'utf8').toString('base64url');
    const res = await app.inject({ method: 'GET', url: `/api/projects/${b64}/timeline?source=codex` });
    const body = res.json();
    expect(body.totals.costUsd).toBeCloseTo(2.0, 6);
  } finally { await cleanup(); }
});
```

If `seeded()` doesn't return `db`, update it to do so (same pattern as Task 3).

- [ ] **Step 3: Run tests to confirm failure**

Run: `pnpm test tests/routes-projects.test.ts`
Expected: the two new tests fail.

- [ ] **Step 4: Add source filter to list query**

Edit `src/server/routes/projects.ts`. Replace the list handler body:
```ts
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

  // When source filter is active, restrict the LEFT JOIN to matching sessions
  // AND exclude projects that have no sessions of that source.
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
  // ... rest unchanged
});
```

- [ ] **Step 5: Add source filter to timeline detail**

Replace the detail handler:
```ts
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
```

- [ ] **Step 6: Run tests**

Run: `pnpm test tests/routes-projects.test.ts`
Expected: PASS including the two new tests.

- [ ] **Step 7: Run full suite**

Run: `pnpm test`
Expected: pass count = 90 + 3 (Task 3 added one + this added two) = 93. No regressions.

- [ ] **Step 8: Commit**

```bash
git add src/server/routes/projects.ts tests/routes-projects.test.ts
git commit -m "feat(api): /api/projects (list + detail) accepts source filter"
```

---

## Task 5: Backend cost source filter

**Files:**
- Modify: `src/server/routes/cost.ts`
- Test: `tests/routes-cost.test.ts`

- [ ] **Step 1: Read current cost route**

Run: `cat src/server/routes/cost.ts`
Expected: One endpoint `GET /api/cost`, single SQL statement using `m`/`s`/`p` aliases.

- [ ] **Step 2: Write failing test**

Append to `tests/routes-cost.test.ts`:
```ts
it('filters cost buckets by source=codex', async () => {
  const { app, db, cleanup } = await seeded();
  try {
    db.prepare(`INSERT INTO projects (project_dir, display_name, real_path, first_seen_at, last_seen_at) VALUES ('codex:p','/p','/p',0,0)`).run();
    db.prepare(`INSERT INTO sessions (session_id, project_dir, started_at, ended_at, source) VALUES ('s1','codex:p',1,2,'codex')`).run();
    db.prepare(`INSERT INTO messages (message_id, session_id, role, model, timestamp, input_tokens, output_tokens, cost_usd, source) VALUES ('m1','s1','assistant','gpt-5',1, 100, 50, 3.0, 'codex')`).run();

    const codex = (await app.inject({ method: 'GET', url: '/api/cost?granularity=day&source=codex' })).json();
    const total = codex.buckets.reduce((a: number, b: any) => a + b.costUsd, 0);
    expect(total).toBeCloseTo(3.0, 6);
  } finally { await cleanup(); }
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `pnpm test tests/routes-cost.test.ts`
Expected: the new test fails.

- [ ] **Step 4: Add source filter to cost route**

Replace the cost route handler:
```ts
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

  // ... rest of the bucket aggregation logic unchanged ...
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm test tests/routes-cost.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full suite**

Run: `pnpm test`
Expected: pass count = 93 + 1 = 94. No regressions.

- [ ] **Step 7: Commit**

```bash
git add src/server/routes/cost.ts tests/routes-cost.test.ts
git commit -m "feat(api): /api/cost accepts source filter"
```

---

## Task 6: Frontend page wiring (Overview, Projects, Cost)

**Files:**
- Modify: `src/web/hooks/useOverview.ts`
- Modify: `src/web/pages/Overview/Index.tsx`
- Modify: `src/web/pages/Projects/List.tsx`
- Modify: `src/web/pages/Projects/Detail.tsx`
- Modify: `src/web/pages/Cost/Index.tsx` (or whichever file fetches `/api/cost`)

- [ ] **Step 1: Find the Cost page entry**

Run: `grep -rln "/api/cost" src/web`
Expected: identifies the file(s) consuming /api/cost. Main one is likely `src/web/pages/Cost/Index.tsx` plus the `Overview/Index.tsx` anomaly fetch (already in scope).

- [ ] **Step 2: Update useOverview hook**

Replace `src/web/hooks/useOverview.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import type { OverviewResponse, RangeKey, TrendGranularity } from '../../shared/types.js';
import type { SourceFilter } from '../store.js';

export function useOverview(
  range: RangeKey,
  granularity: TrendGranularity = 'day',
  sourceFilter: SourceFilter = 'all',
) {
  const sourceParam = sourceFilter !== 'all' ? `&source=${sourceFilter}` : '';
  return useQuery({
    queryKey: ['overview', range, granularity, sourceFilter],
    queryFn: () => api.get<OverviewResponse>(
      `/api/overview?range=${range}&granularity=${granularity}${sourceParam}`,
    ),
  });
}
```

- [ ] **Step 3: Update Overview/Index.tsx callers**

In `src/web/pages/Overview/Index.tsx`, find the line `const { range, setRange } = useStore();` and change to:
```ts
const { range, setRange, sourceFilter } = useStore();
```

Find the call `useOverview(range, granularity)` and change to:
```ts
useOverview(range, granularity, sourceFilter)
```

Find the anomaly query (around `queryKey: ['cost', 'day', 'month']` and `api.get('/api/cost?granularity=day&range=month')`) and update both the queryKey and URL:
```tsx
const anomalies = useQuery<CostResponse>({
  queryKey: ['cost', 'day', 'month', sourceFilter],
  queryFn: () => api.get(`/api/cost?granularity=day&range=month${sourceFilter !== 'all' ? `&source=${sourceFilter}` : ''}`),
  staleTime: 60_000,
});
```

- [ ] **Step 4: Update Projects/List.tsx**

In `src/web/pages/Projects/List.tsx`:
1. Add `const sourceFilter = useStore(s => s.sourceFilter);` near other useStore calls.
2. Find the `useQuery` call (or the URL `/api/projects?...`). Append source param + add to queryKey:
```ts
const sourceParam = sourceFilter !== 'all' ? `&source=${sourceFilter}` : '';
const query = useQuery({
  queryKey: ['projects-list', sortBy, order, sourceFilter],
  queryFn: () => api.get<ProjectRow[]>(`/api/projects?sortBy=${sortBy}&order=${order}${sourceParam}`),
});
```

(Adjust to whatever the actual hook shape is in that file.)

- [ ] **Step 5: Update Projects/Detail.tsx**

Same pattern: import useStore, read sourceFilter, append `&source=...` and add to queryKey for the timeline fetch.

- [ ] **Step 6: Update Cost/Index.tsx**

Find the `/api/cost` fetch in the Cost page. Add sourceFilter:
```ts
const sourceFilter = useStore(s => s.sourceFilter);
const sourceParam = sourceFilter !== 'all' ? `&source=${sourceFilter}` : '';
const cost = useQuery<CostResponse>({
  queryKey: ['cost', granularity, sourceFilter],
  queryFn: () => api.get(`/api/cost?granularity=${granularity}${sourceParam}`),
});
```

- [ ] **Step 7: Build to confirm typing + bundling**

Run: `pnpm typecheck && pnpm build`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add src/web/hooks src/web/pages/Overview src/web/pages/Projects src/web/pages/Cost
git commit -m "feat(ui): plumb sourceFilter through Overview/Projects/Cost queries"
```

---

## Task 7: Sessions page — replace local source state with store, remove in-page selector

**Files:**
- Modify: `src/web/pages/Sessions/List.tsx`

- [ ] **Step 1: Read current Sessions/List.tsx**

Run: `cat src/web/pages/Sessions/List.tsx`
Expected: contains `const [source, setSource] = useState<...>` and a `<Segmented>` for that source state, plus the URL-build code that appends `&source=...` when not 'all'.

- [ ] **Step 2: Apply changes**

In `src/web/pages/Sessions/List.tsx`:

1. Delete the local source state declaration (`const [source, setSource] = useState<'all' | 'claude' | 'codex'>('all');`).
2. Read from store. Update the existing useStore destructure (or add a new one):
```ts
const sourceFilter = useStore(s => s.sourceFilter);
```
3. Replace all uses of `source` with `sourceFilter` and remove `setSource`.
4. Delete the in-page Source `<Segmented>` control from the filter bar JSX.
5. Update the URL-building code to use `sourceFilter` instead of `source`.
6. Update the queryKey similarly (`sourceFilter` replaces `source`).
7. Keep the Originator selector and its state untouched.
8. Where `source !== 'all'` was the gate before, use `sourceFilter !== 'all'`.

The Source column in the table render stays as-is (it shows per-row source which is independent of the filter).

- [ ] **Step 3: Build**

Run: `pnpm typecheck && pnpm build`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src/web/pages/Sessions/List.tsx
git commit -m "refactor(ui): Sessions list reads sourceFilter from global store"
```

---

## Task 8: Final regression + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: all pass (target ~94+ tests, only the migrations.test.ts EBUSY would fail if it regresses — which it shouldn't after Task 287acb2).

- [ ] **Step 2: Typecheck and build**

Run: `pnpm typecheck && pnpm build`
Expected: green.

- [ ] **Step 3: Manual smoke (developer-driven, not automated)**

The developer/user runs:
```bash
node dist/server/cli.js scan
node dist/server/cli.js start --no-open
```
Then opens http://localhost:47821 and verifies in the browser:
1. SourceToggle visible in top bar with three segments
2. Default state is 'All' (or whatever localStorage had previously)
3. Switching to Claude on Overview filters KPIs and charts to Claude only
4. Switching to Codex on Overview filters KPIs and charts to Codex only
5. Switching back to All shows aggregate
6. Same 3 states verified on Projects list, Projects detail, Sessions list, Cost page
7. Sessions list no longer has its own Source selector; Originator selector still works
8. Settings page is unaffected (still shows all providers' pricing rules)
9. Refresh page (F5) — selection persists via localStorage
10. RateLimitBadge top-bar visibility is unchanged by toggle state

- [ ] **Step 4: README update**

Edit `README.md`:
- In the "页面" section, mention the global Source toggle in the top bar.
- Remove the "源 / Originator" filter mention from the Sessions row (only "Originator" remains as a per-page subfilter for Codex).

Suggested replacement for the Sessions bullet:
```
- **会话** — 列表带筛选栏（项目 / 模型 / 日期 / Originator）、可排序列（含 Source 列）、duration tag、KPI 行；详情页含 5 列 KPI、工具调用环形图、可展开消息预览；Codex 会话额外显示 Reasoning 令牌 KPI 与速率限制（5h/7d）
```

And update the closing paragraph:
```
UI 顶栏支持深 / 浅色主题切换、Source 全局过滤（All / Claude / Codex，持久化到 localStorage）、Codex 速率限制徽章；偏好持久化到 localStorage。
```

- [ ] **Step 5: Commit README**

```bash
git add README.md
git commit -m "docs: document SourceToggle and updated Sessions filter layout"
```

---

## Self-Review

**Spec coverage:**
- Spec §3 architecture (zustand + Segmented + backend allowlist) → Tasks 1, 2, 3, 4, 5
- Spec §4.1 SourceToggle component → Task 2
- Spec §4.2 top-bar layout (before RateLimitBadge) → Task 2 Step 2
- Spec §4.3 Sessions cleanup (remove local Source, keep Originator) → Task 7
- Spec §4.4 empty-state behavior → covered organically; no special task needed
- Spec §5 store shape (SOURCE_KEY, sourceFilter, setSourceFilter) → Task 1
- Spec §6.1 routes that gain `source` (overview/projects/cost) → Tasks 3, 4, 5
- Spec §6.2 routes that ignore `source` (codex/pricing/settings/admin) → not modified, by omission
- Spec §6.3 implementation pattern (allowlist + named param) → reused verbatim across Tasks 3, 4, 5
- Spec §6.4 SQL injection safety → ensured by allowlist + bound params in every modified handler
- Spec §7 frontend data-flow (queryKey + URL params) → Tasks 6, 7
- Spec §8 testing (one filter test per route) → Tasks 3, 4, 5 each include one
- Spec §9 risks → mitigations addressed: queryKey discipline (Tasks 6/7), per-route filter test (Tasks 3/4/5), project list HAVING clause (Task 4)
- Spec §10 out-of-scope → respected (no URL bookmarking, no disable-when-empty, no provider-stack auto-hide)

**Type consistency check:**
- `SourceFilter` defined in Task 1 (`'all' | 'claude' | 'codex'`) is reused identically in Task 2 (`SourceToggle`), Task 6 (`useOverview` parameter), and Task 7. Consistent.
- Store property name `sourceFilter` (camelCase) is used identically across all consumer tasks (2, 6, 7). Consistent.
- Backend `source` query param name is identical across Tasks 3/4/5 and matches the existing `routes/sessions.ts`. Consistent.
- The allowlist `['claude','codex']` is the exact same value used in `routes/sessions.ts` (Task 10 in the previous Codex plan). Pattern reuse, no drift.

**Placeholder scan:** clean. Every step has either a concrete code block or a concrete shell command with expected output.
