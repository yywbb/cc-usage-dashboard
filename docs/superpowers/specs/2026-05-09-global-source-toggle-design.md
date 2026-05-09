# Global Source Toggle — Design

Status: Draft · Date: 2026-05-09 · Owner: scorliss457@gmail.com

## 1. Background

After shipping multi-source support (Claude + Codex), all aggregation pages currently display blended data, which feels noisy when the user wants to inspect one tool in isolation. We need a single global control in the top bar that scopes every data page to `all`, `claude`, or `codex`. The Sessions page already has an in-page Source filter (added in the multi-source rollout, commit 484683e); that selector becomes redundant once the global toggle exists and will be removed.

## 2. Goals / Non-Goals

**Goals**
- A three-state toggle (All / Claude / Codex) in the top bar, visible on every page.
- Selection persists across reloads (localStorage).
- All KPI / list / chart pages read the same source filter and render filtered data.
- Sessions list page no longer carries its own Source selector; Originator selector stays.

**Non-Goals**
- URL-based sharing/bookmarking of filtered views (single-user local tool, no need).
- Per-page source overrides (UX should match user's mental model: one global state).
- Filtering Settings, the rate-limit badge, the manual Refresh button, or any admin endpoint.
- New backend telemetry or auditing.

## 3. Architecture

State lives in the existing zustand store at `src/web/store.ts`. New field + setter mirror the existing `compactNumbers` pattern (read once on init, persist on change).

UI control is a small component `<SourceToggle />` (AntD `Segmented`) mounted in `src/web/App.tsx`'s top bar.

Data flow:

```
SourceToggle  ──writes──▶  store.sourceFilter  ──reads──▶  page component
                                                       │
                                                       ▼
                                          query key + URL ?source=…
                                                       │
                                                       ▼
                                          backend route handler  ──filters──▶  SQL
```

The backend extends every aggregation route with a `source` query parameter validated against an allowlist (`['claude','codex']`); `null`/missing means no filter.

## 4. UI

### 4.1 Component

`src/web/components/SourceToggle.tsx`:
- AntD `Segmented` with three options: `All` / `Claude` / `Codex`.
- Reads `sourceFilter` from `useStore`; writes via `setSourceFilter`.
- Width fixed (or compact); placed in the top-bar right cluster.

### 4.2 Top bar layout

In `src/web/App.tsx`'s header right cluster, the order becomes:

```
[ ...PageHeaderContext...  | SourceToggle | RateLimitBadge | ThemeToggle | RefreshButton ]
```

`SourceToggle` is always visible. `RateLimitBadge` continues to render only when Codex rate-limit data exists (its existing logic is unchanged).

### 4.3 Sessions list cleanup

In `src/web/pages/Sessions/List.tsx`:
- Delete the `source` / `setSource` `useState` and the `Segmented` control.
- Replace with `const sourceFilter = useStore(s => s.sourceFilter)` and use that in the URL params.
- Keep Originator selector (CLI / VS Code) — it's a Codex-internal sub-dimension orthogonal to the global filter.

### 4.4 Empty-state behavior

When `sourceFilter='claude'` and DB has only Codex data (or vice-versa), pages render zero values / empty lists naturally. No special handling — the existing empty-state UI is sufficient.

## 5. Store

Add to `src/web/store.ts`:

```ts
const SOURCE_KEY = 'ccSourceFilter';

function readSource(): 'all' | 'claude' | 'codex' {
  if (typeof localStorage === 'undefined') return 'all';
  const v = localStorage.getItem(SOURCE_KEY);
  return v === 'claude' || v === 'codex' ? v : 'all';
}

// inside StoreState
sourceFilter: 'all' | 'claude' | 'codex';
setSourceFilter: (s: 'all' | 'claude' | 'codex') => void;

// inside create()
sourceFilter: readSource(),
setSourceFilter: (sourceFilter) => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(SOURCE_KEY, sourceFilter);
  }
  set({ sourceFilter });
},
```

## 6. Backend

### 6.1 Routes that gain `source` param

| Route | File | Filter target |
|---|---|---|
| `GET /api/overview` | `routes/overview.ts` | `messages.source` |
| `GET /api/projects` | `routes/projects.ts` | `messages.source` (sub-aggregations) |
| `GET /api/projects/:dir` | `routes/projects.ts` | `messages.source` |
| `GET /api/cost` | `routes/cost.ts` | `messages.source` |

`GET /api/sessions` already accepts `source` (added during the Codex rollout). Behavior unchanged; only the caller is now the global store rather than a page-local filter.

### 6.2 Routes that ignore `source`

`/api/codex/rate-limits/*`, `/api/pricing/*`, `/api/providers`, `/api/models`, `/api/health`, `/api/scan`, `/api/recompute-cost`, `/api/sessions/:sid` (single-session detail).

### 6.3 Implementation pattern

Sessions route is the reference. Each new handler adds:

```ts
const source = q.source && ['claude','codex'].includes(q.source) ? q.source : null;
const whereSource = source ? `AND <alias>.source = @source` : '';
// concat into WHERE; pass `source` in named params object
```

Where `<alias>` is the table alias used in that query (`m.source` for messages, `s.source` for sessions). Some routes do multiple SQL statements in one handler; every statement that aggregates messages must include the same fragment so totals stay consistent across return-shape sub-fields (e.g., overview's `totals`, `byProject`, `byModel`, `dailyTrend` must all share the filter).

### 6.4 SQL injection safety

The allowlist (`['claude','codex']`) is checked before the value is interpolated as a literal SQL fragment; the value itself is bound via the `@source` named parameter. Same pattern already used in sessions route.

## 7. Data flow per page

For each page, the data hook gets:

```ts
const sourceFilter = useStore(s => s.sourceFilter);
const params = new URLSearchParams({ ... });
if (sourceFilter !== 'all') params.set('source', sourceFilter);
const data = useQuery({
  queryKey: ['<page>', ..., sourceFilter],
  queryFn: () => api.get(`/api/<page>?${params}`),
});
```

`sourceFilter` MUST be in the queryKey so changing it invalidates the cached query.

Pages affected:
- `pages/Overview/*` — main aggregation
- `pages/Projects/List.tsx`, `pages/Projects/Detail.tsx`
- `pages/Sessions/List.tsx` — replace local source state with store read
- `pages/Cost/*`

`pages/Sessions/Detail.tsx` is single-session and reads from `/api/sessions/:sid` which doesn't take `source` (it's already scoped to one session). No change needed there.

`pages/Settings/*` ignores the global filter (intentional).

## 8. Testing

- Backend: each modified route gets one new test asserting `source=codex` filter narrows the response. Mirror the `'filters sessions by source=codex'` test in `tests/routes-sessions.test.ts`.
- Frontend: project has no UI test infrastructure; manual smoke (toggle through three states on every data page, verify expected filtering).

## 9. Risks & Mitigations

- **Forgetting to thread `sourceFilter` into a query** → cached data goes stale across toggle changes. Mitigation: code review checks that every `useQuery` on data routes has `sourceFilter` in its queryKey.
- **SQL filter applied to one statement but not another in a multi-statement handler** → return-shape inconsistency (e.g., `byProject` filtered but `totals` not). Mitigation: add a per-route test that asserts a known sub-field's filtered total matches the top-level totals.
- **Toggle interacts with the projects list when a project has zero rows for the selected source** → project disappears from the list. Acceptable behavior; documented in §4.4.

## 10. Out of Scope

- Saving a "last filter per page" or "URL-bound filter" — global state is intentionally single-source-of-truth.
- Hiding/disabling the byProvider stack toggle on Overview when source filter is single — keep it; visually degrades to one bar, no extra logic needed.
- Disabling the Codex segment when DB has no Codex data — kept enabled so users can confirm they're looking at the right slice.
