# Codex Usage Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `cc-usage-dashboard` 中加入 OpenAI Codex CLI 的用量统计；与 Claude Code 数据共享同一 SQLite，按 `real_path` 在项目维度统一。

**Architecture:** Phase 0（不拆 monorepo）。把现有 scanner 重构为 source-pluggable，在 `src/server/scanner/sources/{claude,codex}/` 下放各自实现。引入两条 SQL 迁移：`messages.source/reasoning_tokens/originator`、`sessions.source/total_reasoning/cwd_real_path`、新表 `codex_rate_limit_snapshots`。新增 `openai` builtin provider 与默认 GPT-5 系列价格。CLI 增加 `--source claude|codex|all` 旗标。

**Tech Stack:** TypeScript（strict），better-sqlite3 11，Fastify 5，Vitest 2，pnpm 10，React 18 + AntD 5 + ECharts。

参考 spec：`docs/superpowers/specs/2026-05-09-codex-usage-tracking-design.md`。

---

## File Structure

**已存在 — 将被改动**
- `src/server/db.ts` — `syncKnownAnthropicModels` 改名调用
- `src/server/seed.ts` — 函数改名 + 多 provider
- `src/server/pricing.ts` — `applyPrice` 加 `reasoningTokens`；`DEFAULT_PRICING_PER_M` 加 OpenAI 行
- `src/server/scanner/index.ts` — 改成"调度器"，按 source 分发
- `src/server/scanner/parser.ts` — 移到 `sources/claude/parser.ts`
- `src/server/scanner/writer.ts` — 留在 `scanner/writer.ts`（共享），加 `source/originator/reasoningTokens` 字段；`recomputeSession` 加 `total_reasoning`
- `src/server/scanner/cursor.ts` — 不动（共享）
- `src/server/cli.ts` — 加 `--source` flag、Codex root 探测
- `src/server/app.ts` — 新增 routes 注册
- `src/server/routes/sessions.ts` — 加 `source` / `originator` 过滤
- `src/shared/types.ts` — `ParsedMessage` 加 source/originator/reasoningTokens；新增 RateLimitSnapshot 类型
- `tests/scanner.test.ts` — 不动（仍跑 Claude）

**新增**
- `src/server/migrations/004_multi_source.sql`
- `src/server/migrations/005_codex_rate_limits.sql`
- `src/server/scanner/sources/types.ts` — `ScanSource` 接口
- `src/server/scanner/sources/claude/index.ts` — 现有 walk + readFromOffset 移到这里
- `src/server/scanner/sources/claude/parser.ts` — 现有 parser 内容
- `src/server/scanner/sources/codex/index.ts` — Codex 文件枚举与扫描
- `src/server/scanner/sources/codex/parser.ts` — token_count 累计差分算法
- `src/server/scanner/sources/codex/paths.ts` — `normalizePath`、`defaultCodexHome`
- `src/server/routes/codex.ts` — `/api/codex/rate-limits` 端点
- `src/web/components/RateLimitBadge.tsx` — 顶栏额度徽章
- `tests/sources-codex-parser.test.ts`
- `tests/sources-codex-scanner.test.ts`
- `tests/sources-codex-paths.test.ts`
- `tests/fixtures/codex/normal.jsonl` — 标准 Codex 会话
- `tests/fixtures/codex/duplicate-token-count.jsonl` — 重复 token_count 事件
- `tests/fixtures/codex/no-turn-context.jsonl` — 缺 turn_context（应回退 gpt-5）
- `tests/fixtures/codex/multi-model.jsonl` — 跨 turn_context 模型切换

---

## Task 1: 多 source schema 迁移

**Files:**
- Create: `src/server/migrations/004_multi_source.sql`
- Test: `tests/migrations.test.ts`（追加用例）

- [ ] **Step 1: 写迁移 SQL**

Create `src/server/migrations/004_multi_source.sql`:
```sql
ALTER TABLE messages ADD COLUMN source TEXT;
ALTER TABLE messages ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN originator TEXT;

ALTER TABLE sessions ADD COLUMN source TEXT;
ALTER TABLE sessions ADD COLUMN total_reasoning INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN cwd_real_path TEXT;

ALTER TABLE projects ADD COLUMN sources TEXT;

UPDATE messages SET source = 'claude' WHERE source IS NULL;
UPDATE sessions SET source = 'claude' WHERE source IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_source ON messages(source, timestamp);
CREATE INDEX IF NOT EXISTS idx_sessions_real_path ON sessions(cwd_real_path);
CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions(source);
```

- [ ] **Step 2: 写迁移回归测试**

Append to `tests/migrations.test.ts`:
```ts
it('migration 004 adds multi-source columns and backfills source=claude', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mig-'));
  const dbPath = join(tmp, 'usage.db');
  const db = openDb(dbPath);
  // 写一条 fake message（pre-migration row 已被回填）
  db.prepare(
    `INSERT INTO sessions (session_id, project_dir, started_at, ended_at) VALUES ('s1','p1',0,0)`
  ).run();
  db.prepare(
    `INSERT INTO messages (message_id, session_id, role, timestamp) VALUES ('m1','s1','user',0)`
  ).run();
  const cols = db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>;
  expect(cols.map(c => c.name)).toEqual(
    expect.arrayContaining(['source', 'reasoning_tokens', 'originator'])
  );
  const r = db.prepare(`SELECT source, reasoning_tokens FROM messages WHERE message_id='m1'`).get() as any;
  expect(r.source).toBe('claude');
  expect(r.reasoning_tokens).toBe(0);
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});
```

- [ ] **Step 3: 跑测试确认通过**

Run: `pnpm test tests/migrations.test.ts`
Expected: 全部 PASS。

- [ ] **Step 4: 提交**

```bash
git add src/server/migrations/004_multi_source.sql tests/migrations.test.ts
git commit -m "feat(db): add multi-source columns to messages/sessions/projects"
```

---

## Task 2: rate_limit 快照表迁移

**Files:**
- Create: `src/server/migrations/005_codex_rate_limits.sql`
- Test: `tests/migrations.test.ts`

- [ ] **Step 1: 写迁移**

Create `src/server/migrations/005_codex_rate_limits.sql`:
```sql
CREATE TABLE IF NOT EXISTS codex_rate_limit_snapshots (
  session_id           TEXT PRIMARY KEY,
  observed_at          INTEGER NOT NULL,
  primary_used_pct     REAL,
  primary_window_min   INTEGER,
  primary_resets_at    INTEGER,
  secondary_used_pct   REAL,
  secondary_window_min INTEGER,
  secondary_resets_at  INTEGER,
  plan_type            TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_observed ON codex_rate_limit_snapshots(observed_at);
```

- [ ] **Step 2: 测试存在性**

Append:
```ts
it('migration 005 creates codex_rate_limit_snapshots', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mig-'));
  const db = openDb(join(tmp, 'usage.db'));
  const tbls = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>;
  expect(tbls.map(t => t.name)).toContain('codex_rate_limit_snapshots');
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});
```

- [ ] **Step 3: 跑测试**

Run: `pnpm test tests/migrations.test.ts`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add src/server/migrations/005_codex_rate_limits.sql tests/migrations.test.ts
git commit -m "feat(db): add codex_rate_limit_snapshots table"
```

---

## Task 3: 注册 OpenAI provider 与默认价

**Files:**
- Modify: `src/server/pricing.ts`
- Modify: `src/server/seed.ts`
- Modify: `src/server/db.ts`
- Test: `tests/pricing.test.ts`

- [ ] **Step 1: pricing.ts — 新增 GPT-5 系列默认价 + 把 reasoningTokens 加进 TokenCounts/applyPrice**

Edit `src/server/pricing.ts`:
```ts
export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens?: number;
}
```

Append to `DEFAULT_PRICING_PER_M`:
```ts
'gpt-5':            { input: 1.25,  output: 10,   cacheCreate: 0, cacheRead: 0.125 },
'gpt-5-codex':      { input: 1.25,  output: 10,   cacheCreate: 0, cacheRead: 0.125 },
'gpt-5.3-codex':    { input: 1.25,  output: 10,   cacheCreate: 0, cacheRead: 0.125 },
'gpt-5-mini':       { input: 0.25,  output: 2,    cacheCreate: 0, cacheRead: 0.025 },
'gpt-4.1':          { input: 2,     output: 8,    cacheCreate: 0, cacheRead: 0.50  },
'o4-mini':          { input: 1.10,  output: 4.40, cacheCreate: 0, cacheRead: 0.275 },
```

Replace `applyPrice`:
```ts
export function applyPrice(price: ModelPriceM, t: TokenCounts): number {
  return (
    (t.inputTokens          * price.input)       / M +
    (t.outputTokens         * price.output)      / M +
    ((t.reasoningTokens ?? 0) * price.output)    / M +
    (t.cacheCreationTokens  * price.cacheCreate) / M +
    (t.cacheReadTokens      * price.cacheRead)   / M
  );
}
```

- [ ] **Step 2: seed.ts — 改名为 syncKnownModels，按 model 名映射 provider**

Replace `src/server/seed.ts` 内容:
```ts
import type { Database as DatabaseType } from 'better-sqlite3';
import { DEFAULT_PRICING_PER_M } from './pricing.js';

const OPENAI_MODELS = new Set([
  'gpt-5', 'gpt-5-codex', 'gpt-5.3-codex', 'gpt-5-mini', 'gpt-4.1', 'o4-mini',
]);

export function syncKnownModels(db: DatabaseType): void {
  // 确保 openai builtin provider 存在（migration 003 只插入 anthropic / unknown）
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO providers (slug, display_name, is_builtin, created_at, updated_at)
     VALUES ('openai', 'OpenAI', 1, ?, ?)`,
  ).run(now, now);

  const idBySlug = new Map<string, number>();
  for (const r of db.prepare(`SELECT id, slug FROM providers`).all() as Array<{ id: number; slug: string }>) {
    idBySlug.set(r.slug, r.id);
  }
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO models (model_name, provider_id, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    for (const model of Object.keys(DEFAULT_PRICING_PER_M)) {
      const slug = OPENAI_MODELS.has(model) ? 'openai' : 'anthropic';
      const pid = idBySlug.get(slug);
      if (pid !== undefined) stmt.run(model, pid, now, now);
    }
  });
  tx();
}
```

- [ ] **Step 3: db.ts — 调用点改名**

Edit `src/server/db.ts:5,16`：
```ts
import { syncKnownModels } from './seed.js';
// ...
syncKnownModels(db);
```

- [ ] **Step 4: 写 unit test 覆盖 reasoning 计费**

Append to `tests/pricing.test.ts`:
```ts
it('applyPrice charges reasoning tokens at output rate', () => {
  const price = { input: 1, output: 10, cacheCreate: 0, cacheRead: 0.1 };
  const cost = applyPrice(price, {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 500_000,
  });
  // 1*1 + 10*1 + 10*0.5 = 16
  expect(cost).toBeCloseTo(16, 6);
});

it('applyPrice tolerates missing reasoningTokens', () => {
  const price = { input: 1, output: 10, cacheCreate: 0, cacheRead: 0 };
  const cost = applyPrice(price, {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  });
  expect(cost).toBeCloseTo(11, 6);
});

it('syncKnownModels registers openai provider and gpt-5', () => {
  // 利用 openDb；它内部已调用 syncKnownModels
  const { db, cleanup } = openTestDb();
  try {
    const provs = db.prepare(`SELECT slug FROM providers`).all() as Array<{ slug: string }>;
    expect(provs.map(p => p.slug)).toEqual(expect.arrayContaining(['openai', 'anthropic', 'unknown']));
    const m = db.prepare(
      `SELECT p.slug FROM models JOIN providers p ON p.id = models.provider_id WHERE model_name='gpt-5'`,
    ).get() as { slug: string };
    expect(m.slug).toBe('openai');
  } finally { cleanup(); }
});
```

`openTestDb` 用现有 helper（看看 pricing.test.ts 顶部，复用既有 setup）；若没有就内联：
```ts
function openTestDb() {
  const tmp = mkdtempSync(join(tmpdir(), 'pr-'));
  const db = openDb(join(tmp, 'usage.db'));
  return { db, cleanup: () => { db.close(); rmSync(tmp, { recursive: true, force: true }); } };
}
```

- [ ] **Step 5: 跑测试 + typecheck**

Run: `pnpm test tests/pricing.test.ts && pnpm typecheck`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/server/pricing.ts src/server/seed.ts src/server/db.ts tests/pricing.test.ts
git commit -m "feat(pricing): add openai provider, gpt-5 defaults, reasoning cost"
```

---

## Task 4: ScanSource 接口 + Claude 重构

**Files:**
- Create: `src/server/scanner/sources/types.ts`
- Create: `src/server/scanner/sources/claude/index.ts`
- Create: `src/server/scanner/sources/claude/parser.ts`
- Modify: `src/server/scanner/index.ts`（变成 dispatcher）
- Delete: `src/server/scanner/parser.ts`（搬到 sources/claude/）
- Modify: `tests/parser.test.ts`、`tests/scanner.test.ts` 的 import 路径

- [ ] **Step 1: 定义接口**

Create `src/server/scanner/sources/types.ts`:
```ts
import type { Database as DatabaseType } from 'better-sqlite3';
import type { ScanResult } from '../../../shared/types.js';

export type SourceId = 'claude' | 'codex';

export interface ScanSource {
  readonly id: SourceId;
  /** 默认根目录（不存在时调用方应跳过） */
  defaultRoot(): string;
  /** 全量/增量扫描；scan_cursor 表自动断点续扫 */
  scanAll(db: DatabaseType, root: string): ScanResult;
}
```

- [ ] **Step 2: 把 parser.ts 整体移到 sources/claude/parser.ts**

Run:
```bash
git mv src/server/scanner/parser.ts src/server/scanner/sources/claude/parser.ts
```

文件内容**不改**。

- [ ] **Step 3: 把现有 scanAll 抽到 sources/claude/index.ts**

Create `src/server/scanner/sources/claude/index.ts`，把现有 `src/server/scanner/index.ts` 的实现搬过来；改两处：
1. import 改为 `./parser.js`、`../../writer.js`、`../../cursor.js`、`../../../paths.js`、`../../../../shared/types.js`
2. 在文件顶部 export 一个 `ScanSource` 实例：
```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ScanSource } from '../types.js';

// ...existing scanAll/walkJsonl/scanOne/readFromOffset 内容（仅 import 路径调整）...

export const claudeSource: ScanSource = {
  id: 'claude',
  defaultRoot: () => join(homedir(), '.claude', 'projects'),
  scanAll,
};
```

> 注意：Claude path 反推 `reverseProjectDirName` 已经写到 `src/server/paths.ts`，**不要**搬走（其它代码也会用）。

> 在 Claude 写库时需要把 `source='claude'` 标到 message/session 上。这一步先**不动 writer**，留到 Task 5；Task 4 仅做位置重构。

- [ ] **Step 4: 把 scanner/index.ts 改成 dispatcher**

Replace `src/server/scanner/index.ts` 全部内容:
```ts
import { existsSync } from 'node:fs';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { ScanResult } from '../../shared/types.js';
import type { ScanSource, SourceId } from './sources/types.js';
import { claudeSource } from './sources/claude/index.js';

export const SOURCES: Record<SourceId, ScanSource> = {
  claude: claudeSource,
  // codex: 注册在 Task 8
} as Record<SourceId, ScanSource>;

export interface ScanAllOptions {
  /** 'all' | 'claude' | 'codex'。默认 'all'。 */
  source?: 'all' | SourceId;
  /** 覆盖默认 root；仅当只指定单一 source 有效。 */
  rootOverride?: string;
}

export function scanAll(
  db: DatabaseType,
  legacyRoot: string | undefined,
  opts: ScanAllOptions = {},
): ScanResult {
  const target = opts.source ?? 'all';
  const ids: SourceId[] = target === 'all' ? (Object.keys(SOURCES) as SourceId[]) : [target];

  const totals: ScanResult = { scannedFiles: 0, newMessages: 0, durationMs: 0 };
  const t0 = Date.now();
  for (const id of ids) {
    const src = SOURCES[id];
    if (!src) continue;
    let root = ids.length === 1 && opts.rootOverride ? opts.rootOverride : src.defaultRoot();
    // 兼容旧调用签名：legacyRoot 仅当 source='claude' 单跑时使用
    if (id === 'claude' && legacyRoot && target !== 'all' && !opts.rootOverride) root = legacyRoot;
    if (!existsSync(root)) continue;
    const r = src.scanAll(db, root);
    totals.scannedFiles += r.scannedFiles;
    totals.newMessages  += r.newMessages;
  }
  totals.durationMs = Date.now() - t0;
  return totals;
}
```

> 旧 `scanAll(db, projectsRoot)` 调用点（`cli.ts` / 测试）继续用第二参数，但默认 source='all'；想锁定 Claude 时显式传 `{ source: 'claude' }`。

- [ ] **Step 5: 修测试 import**

`tests/parser.test.ts` 顶部:
```ts
import { parseJsonlLine } from '../src/server/scanner/sources/claude/parser.js';
```
`tests/scanner.test.ts` 不动（它 import 的是 `scanner/index.js` 的 `scanAll`，签名兼容）。

- [ ] **Step 6: 跑全部测试**

Run: `pnpm test`
Expected: 所有现有用例 PASS（无行为变更）。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "refactor(scanner): introduce ScanSource interface + claude source"
```

---

## Task 5: writer 写入 source/originator/reasoning

**Files:**
- Modify: `src/server/scanner/writer.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/server/scanner/sources/claude/index.ts`（写库前补 source='claude'）
- Test: `tests/writer.test.ts`

- [ ] **Step 1: ParsedMessage 加字段**

Edit `src/shared/types.ts`:
```ts
export interface ParsedMessage {
  messageId: string;
  sessionId: string;
  parentUuid: string | null;
  role: 'user' | 'assistant';
  model: string | null;
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;        // NEW
  stopReason: string | null;
  toolNames: string[];
  textPreview: string | null;
  source: 'claude' | 'codex';     // NEW
  originator: string | null;      // NEW
  cwdRealPath: string | null;     // NEW，Codex 专用；Claude 传 null
}

export interface RateLimitSnapshot {
  sessionId: string;
  observedAt: number;
  primaryUsedPct: number | null;
  primaryWindowMin: number | null;
  primaryResetsAt: number | null;
  secondaryUsedPct: number | null;
  secondaryWindowMin: number | null;
  secondaryResetsAt: number | null;
  planType: string | null;
}
```

- [ ] **Step 2: writer 持久化新字段**

Edit `src/server/scanner/writer.ts`:

替换 `insertMessages` 中 `INSERT OR IGNORE INTO messages` 的 SQL 与 stmt.run：
```ts
const stmt = db.prepare(
  `INSERT OR IGNORE INTO messages
     (message_id, session_id, parent_uuid, role, model, timestamp,
      input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
      reasoning_tokens, cost_usd, stop_reason, tool_names, text_preview,
      source, originator)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
// stmt.run(...)
const r = stmt.run(
  m.messageId, m.sessionId, m.parentUuid, m.role, m.model, m.timestamp,
  m.inputTokens, m.outputTokens, m.cacheCreationTokens, m.cacheReadTokens,
  m.reasoningTokens, cost, m.stopReason, JSON.stringify(m.toolNames), m.textPreview,
  m.source, m.originator,
);
```

cost 计算调用要带 reasoning：
```ts
cost = applyPrice(price, {
  inputTokens: m.inputTokens,
  outputTokens: m.outputTokens,
  cacheCreationTokens: m.cacheCreationTokens,
  cacheReadTokens: m.cacheReadTokens,
  reasoningTokens: m.reasoningTokens,
});
```

`ensureSession` 改为：
```ts
function ensureSession(
  db: DatabaseType,
  sessionId: string,
  projectDir: string,
  source: 'claude' | 'codex',
  cwdRealPath: string | null,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO sessions
       (session_id, project_dir, started_at, ended_at,
        message_count, total_input, total_output, total_cache_create, total_cache_read,
        total_reasoning, total_cost_usd, source, cwd_real_path)
     VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)`
  ).run(sessionId, projectDir, source, cwdRealPath);
}
```

`insertMessages` 调用 ensureSession 时多传两参：
```ts
ensureSession(db, sessionId, projectDir, msgs[0].source, msgs[0].cwdRealPath);
```

`recomputeSession` SQL 加 `total_reasoning`：
```ts
const agg = db.prepare(
  `SELECT COUNT(*) as c,
          COALESCE(MIN(timestamp), 0) as started,
          COALESCE(MAX(timestamp), 0) as ended,
          COALESCE(SUM(input_tokens), 0) as in_,
          COALESCE(SUM(output_tokens), 0) as out_,
          COALESCE(SUM(cache_creation_tokens), 0) as cc,
          COALESCE(SUM(cache_read_tokens), 0) as cr,
          COALESCE(SUM(reasoning_tokens), 0) as rs,
          COALESCE(SUM(cost_usd), 0) as cost
   FROM messages WHERE session_id = ?`
).get(sessionId) as any;

db.prepare(
  `UPDATE sessions SET
     started_at = ?, ended_at = ?,
     message_count = ?, total_input = ?, total_output = ?,
     total_cache_create = ?, total_cache_read = ?, total_reasoning = ?, total_cost_usd = ?
   WHERE session_id = ?`
).run(agg.started, agg.ended, agg.c, agg.in_, agg.out_, agg.cc, agg.cr, agg.rs, agg.cost, sessionId);
```

- [ ] **Step 3: Claude parser 输出新字段**

Edit `src/server/scanner/sources/claude/parser.ts`：在返回对象里补 3 个字段：
```ts
return {
  messageId, sessionId, parentUuid: obj.parentUuid ?? null, role,
  model: m.model ?? null, timestamp,
  inputTokens: Number(usage.input_tokens) || 0,
  outputTokens: Number(usage.output_tokens) || 0,
  cacheCreationTokens: Number(usage.cache_creation_input_tokens) || 0,
  cacheReadTokens: Number(usage.cache_read_input_tokens) || 0,
  reasoningTokens: 0,
  stopReason: m.stop_reason ?? null,
  toolNames, textPreview,
  source: 'claude',
  originator: null,
  cwdRealPath: null,
};
```

- [ ] **Step 4: 跑现有 writer / scanner / parser 测试**

Run: `pnpm test tests/writer.test.ts tests/scanner.test.ts tests/parser.test.ts`
Expected: 全 PASS（旧断言 message_count/total tokens 等不受影响）。

- [ ] **Step 5: 加一个新断言：Claude 入库后 source='claude'**

Append to `tests/scanner.test.ts`:
```ts
it('marks Claude messages with source=claude', () => {
  const { db, projectsRoot, cleanup } = setup();
  try {
    scanAll(db, projectsRoot);
    const r = db.prepare(`SELECT DISTINCT source FROM messages`).all() as Array<{ source: string }>;
    expect(r).toEqual([{ source: 'claude' }]);
  } finally { cleanup(); }
});
```

Run: `pnpm test tests/scanner.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(scanner): persist source/originator/reasoning on every message"
```

---

## Task 6: Codex paths 工具

**Files:**
- Create: `src/server/scanner/sources/codex/paths.ts`
- Create: `tests/sources-codex-paths.test.ts`

- [ ] **Step 1: 写测试**

Create `tests/sources-codex-paths.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { normalizeCwd, defaultCodexHome, syntheticProjectDir } from '../src/server/scanner/sources/codex/paths.js';

describe('codex paths', () => {
  it('normalizes Windows cwd: lower drive + backslashes -> upper drive + forward', () => {
    expect(normalizeCwd('d:\\QC\\code\\aiden\\pigx')).toBe('D:/QC/code/aiden/pigx');
  });
  it('keeps POSIX paths unchanged', () => {
    expect(normalizeCwd('/home/u/proj')).toBe('/home/u/proj');
  });
  it('treats null/undefined cwd safely', () => {
    expect(normalizeCwd(null)).toBeNull();
    expect(normalizeCwd(undefined)).toBeNull();
  });
  it('syntheticProjectDir is stable + url-safe', () => {
    const a = syntheticProjectDir('D:/QC/code/aiden/pigx');
    const b = syntheticProjectDir('D:/QC/code/aiden/pigx');
    expect(a).toBe(b);
    expect(a.startsWith('codex:')).toBe(true);
    expect(/[/+=]/.test(a.slice(6))).toBe(false);  // base64url 无 / +
  });
  it('defaultCodexHome respects $CODEX_HOME', () => {
    const old = process.env.CODEX_HOME;
    process.env.CODEX_HOME = 'C:/x';
    try { expect(defaultCodexHome()).toBe('C:/x'); }
    finally { if (old === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = old; }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/sources-codex-paths.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

Create `src/server/scanner/sources/codex/paths.ts`:
```ts
import { homedir } from 'node:os';
import { join } from 'node:path';

export function defaultCodexHome(): string {
  return process.env.CODEX_HOME ?? join(homedir(), '.codex');
}

export function defaultCodexSessionsRoot(): string {
  return join(defaultCodexHome(), 'sessions');
}

export function normalizeCwd(cwd: string | null | undefined): string | null {
  if (!cwd) return null;
  let s = cwd.replace(/\\/g, '/');
  // Windows 盘符 d:/... → D:/...
  s = s.replace(/^([a-z]):/, (_, d) => `${d.toUpperCase()}:`);
  return s;
}

export function syntheticProjectDir(realPath: string): string {
  return 'codex:' + Buffer.from(realPath, 'utf8').toString('base64url');
}
```

- [ ] **Step 4: 跑测试**

Run: `pnpm test tests/sources-codex-paths.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/server/scanner/sources/codex/paths.ts tests/sources-codex-paths.test.ts
git commit -m "feat(codex): path utilities (normalizeCwd, syntheticProjectDir)"
```

---

## Task 7: Codex parser（核心算法）

**Files:**
- Create: `src/server/scanner/sources/codex/parser.ts`
- Create: `tests/fixtures/codex/normal.jsonl`
- Create: `tests/fixtures/codex/duplicate-token-count.jsonl`
- Create: `tests/fixtures/codex/no-turn-context.jsonl`
- Create: `tests/fixtures/codex/multi-model.jsonl`
- Create: `tests/sources-codex-parser.test.ts`

- [ ] **Step 1: 准备最小可用 fixture — normal.jsonl**

Create `tests/fixtures/codex/normal.jsonl`（每行一条对象；下面用紧凑写法，实际入库是单行）:
```jsonl
{"timestamp":"2026-04-01T10:00:00.000Z","type":"session_meta","payload":{"id":"test-sess-001","timestamp":"2026-04-01T10:00:00.000Z","cwd":"d:\\Demo\\proj","originator":"codex_cli","cli_version":"0.99.0","model_provider":"openai"}}
{"timestamp":"2026-04-01T10:00:01.000Z","type":"turn_context","payload":{"cwd":"d:\\Demo\\proj","model":"gpt-5-codex","effort":"high"}}
{"timestamp":"2026-04-01T10:00:02.000Z","type":"event_msg","payload":{"type":"agent_message","message":"first reply text"}}
{"timestamp":"2026-04-01T10:00:03.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":200,"output_tokens":300,"reasoning_output_tokens":100,"total_tokens":1400},"last_token_usage":{"input_tokens":1000,"cached_input_tokens":200,"output_tokens":300,"reasoning_output_tokens":100,"total_tokens":1400},"model_context_window":256000},"rate_limits":{"primary":{"used_percent":10.5,"window_minutes":300,"resets_at":1781000000},"secondary":{"used_percent":22.0,"window_minutes":10080,"resets_at":1781700000},"plan_type":"pro"}}}
{"timestamp":"2026-04-01T10:00:10.000Z","type":"event_msg","payload":{"type":"agent_message","message":"second reply"}}
{"timestamp":"2026-04-01T10:00:11.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1500,"cached_input_tokens":350,"output_tokens":600,"reasoning_output_tokens":250,"total_tokens":2350},"last_token_usage":{"input_tokens":500,"cached_input_tokens":150,"output_tokens":300,"reasoning_output_tokens":150,"total_tokens":950},"model_context_window":256000},"rate_limits":{"primary":{"used_percent":12.0,"window_minutes":300,"resets_at":1781000000},"secondary":{"used_percent":22.5,"window_minutes":10080,"resets_at":1781700000},"plan_type":"pro"}}}
```

- [ ] **Step 2: duplicate-token-count.jsonl**

```jsonl
{"timestamp":"2026-04-01T10:00:00.000Z","type":"session_meta","payload":{"id":"test-sess-002","cwd":"/home/u/p","originator":"codex_vscode"}}
{"timestamp":"2026-04-01T10:00:01.000Z","type":"turn_context","payload":{"model":"gpt-5"}}
{"timestamp":"2026-04-01T10:00:02.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":50,"reasoning_output_tokens":0,"total_tokens":150}}}}
{"timestamp":"2026-04-01T10:00:03.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":50,"reasoning_output_tokens":0,"total_tokens":150}}}}
{"timestamp":"2026-04-01T10:00:04.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":200,"cached_input_tokens":0,"output_tokens":80,"reasoning_output_tokens":0,"total_tokens":280}}}}
{"timestamp":"2026-04-01T10:00:05.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":200,"cached_input_tokens":0,"output_tokens":80,"reasoning_output_tokens":0,"total_tokens":280}}}}
```
（4 条 token_count 中只有 2 次严格递增 → 期望 2 条 message。）

- [ ] **Step 3: no-turn-context.jsonl**

```jsonl
{"timestamp":"2026-04-01T10:00:00.000Z","type":"session_meta","payload":{"id":"test-sess-003","cwd":"/p","originator":"codex_cli"}}
{"timestamp":"2026-04-01T10:00:02.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":40,"reasoning_output_tokens":0,"total_tokens":140}}}}
```

- [ ] **Step 4: multi-model.jsonl**

```jsonl
{"timestamp":"2026-04-01T10:00:00.000Z","type":"session_meta","payload":{"id":"test-sess-004","cwd":"/p","originator":"codex_cli"}}
{"timestamp":"2026-04-01T10:00:01.000Z","type":"turn_context","payload":{"model":"gpt-5-mini"}}
{"timestamp":"2026-04-01T10:00:02.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":40,"reasoning_output_tokens":0,"total_tokens":140}}}}
{"timestamp":"2026-04-01T10:00:10.000Z","type":"turn_context","payload":{"model":"gpt-5"}}
{"timestamp":"2026-04-01T10:00:11.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":300,"cached_input_tokens":50,"output_tokens":120,"reasoning_output_tokens":40,"total_tokens":510}}}}
```

- [ ] **Step 5: 写解析器测试（先全部失败）**

Create `tests/sources-codex-parser.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCodexRollout } from '../src/server/scanner/sources/codex/parser.js';

function load(name: string) {
  return readFileSync(`tests/fixtures/codex/${name}`, 'utf8');
}

describe('parseCodexRollout', () => {
  it('parses normal session into 2 messages, attributes model + originator', () => {
    const out = parseCodexRollout(load('normal.jsonl'));
    expect(out.sessionId).toBe('test-sess-001');
    expect(out.cwdRealPath).toBe('D:/Demo/proj');
    expect(out.originator).toBe('codex_cli');
    expect(out.messages).toHaveLength(2);
    const m1 = out.messages[0];
    expect(m1.model).toBe('gpt-5-codex');
    // 第一条增量 = cumulative 自身：input=1000, cached=200 → input_col=800, cache_read_col=200
    expect(m1.inputTokens).toBe(800);
    expect(m1.cacheReadTokens).toBe(200);
    expect(m1.outputTokens).toBe(300);
    expect(m1.reasoningTokens).toBe(100);
    // 第二条增量 = (1500-1000, 350-200, 600-300, 250-100) = (500,150,300,150) → input_col=350
    const m2 = out.messages[1];
    expect(m2.inputTokens).toBe(350);
    expect(m2.cacheReadTokens).toBe(150);
    expect(m2.outputTokens).toBe(300);
    expect(m2.reasoningTokens).toBe(150);
    // rate limits 取最后一条
    expect(out.rateLimit?.primaryUsedPct).toBeCloseTo(12.0);
    expect(out.rateLimit?.planType).toBe('pro');
  });

  it('drops duplicate token_count events (issue #884)', () => {
    const out = parseCodexRollout(load('duplicate-token-count.jsonl'));
    expect(out.messages).toHaveLength(2);
    const total = out.messages.reduce(
      (a, m) => a + m.inputTokens + m.cacheReadTokens + m.outputTokens + m.reasoningTokens,
      0,
    );
    expect(total).toBe(280);  // 与文件最后一条 cumulative.total_tokens 相等
  });

  it('falls back to gpt-5 when no turn_context exists', () => {
    const out = parseCodexRollout(load('no-turn-context.jsonl'));
    expect(out.messages[0].model).toBe('gpt-5');
  });

  it('attributes each message to the most recent turn_context model', () => {
    const out = parseCodexRollout(load('multi-model.jsonl'));
    expect(out.messages[0].model).toBe('gpt-5-mini');
    expect(out.messages[1].model).toBe('gpt-5');
  });

  it('records originator from session_meta', () => {
    const out = parseCodexRollout(load('duplicate-token-count.jsonl'));
    expect(out.originator).toBe('codex_vscode');
  });
});
```

- [ ] **Step 6: 跑测试确认失败**

Run: `pnpm test tests/sources-codex-parser.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 7: 实现 parser**

Create `src/server/scanner/sources/codex/parser.ts`:
```ts
import type { ParsedMessage, RateLimitSnapshot } from '../../../../shared/types.js';
import { normalizeCwd } from './paths.js';

const PREVIEW_LEN = 200;

export interface CodexFileResult {
  sessionId: string;
  cwdRealPath: string | null;
  originator: string | null;
  messages: ParsedMessage[];
  rateLimit: RateLimitSnapshot | null;
}

export function parseCodexRollout(content: string): CodexFileResult {
  let sessionId = '';
  let cwdRealPath: string | null = null;
  let originator: string | null = null;
  let currentModel: string | null = null;
  let lastAgentText: string | null = null;
  let rateLimit: RateLimitSnapshot | null = null;
  const messages: ParsedMessage[] = [];

  let prev = { input: 0, cached: 0, output: 0, reasoning: 0, total: 0 };

  const lines = content.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }

    if (ev.type === 'session_meta') {
      const p = ev.payload ?? {};
      sessionId = p.id ?? sessionId;
      cwdRealPath = normalizeCwd(p.cwd);
      originator = p.originator ?? null;
      continue;
    }

    if (ev.type === 'turn_context') {
      currentModel = ev.payload?.model ?? currentModel;
      continue;
    }

    if (ev.type === 'event_msg' && ev.payload?.type === 'agent_message') {
      const msg = ev.payload.message;
      if (typeof msg === 'string') lastAgentText = msg.slice(0, PREVIEW_LEN);
      continue;
    }

    if (ev.type !== 'event_msg' || ev.payload?.type !== 'token_count') continue;

    const cur = ev.payload.info?.total_token_usage;
    const rl  = ev.payload.rate_limits;
    const planType = ev.payload.plan_type ?? rl?.plan_type ?? null;

    if (rl) {
      rateLimit = {
        sessionId,
        observedAt: Date.parse(ev.timestamp),
        primaryUsedPct:    rl.primary?.used_percent    ?? null,
        primaryWindowMin:  rl.primary?.window_minutes  ?? null,
        primaryResetsAt:   rl.primary?.resets_at       ?? null,
        secondaryUsedPct:  rl.secondary?.used_percent  ?? null,
        secondaryWindowMin:rl.secondary?.window_minutes?? null,
        secondaryResetsAt: rl.secondary?.resets_at     ?? null,
        planType,
      };
    }

    if (!cur) continue;
    if (cur.total_tokens <= prev.total) continue;  // 重复事件去重

    const dInput     = cur.input_tokens         - prev.input;
    const dCached    = cur.cached_input_tokens  - prev.cached;
    const dOutput    = cur.output_tokens        - prev.output;
    const dReasoning = cur.reasoning_output_tokens - prev.reasoning;

    messages.push({
      messageId: `${sessionId}:${ev.timestamp}`,
      sessionId,
      parentUuid: null,
      role: 'assistant',
      model: currentModel ?? 'gpt-5',
      timestamp: Date.parse(ev.timestamp),
      inputTokens:        Math.max(0, dInput - dCached),
      outputTokens:       Math.max(0, dOutput),
      cacheCreationTokens: 0,
      cacheReadTokens:    Math.max(0, dCached),
      reasoningTokens:    Math.max(0, dReasoning),
      stopReason: null,
      toolNames: [],
      textPreview: lastAgentText,
      source: 'codex',
      originator,
      cwdRealPath,
    });

    prev = {
      input: cur.input_tokens, cached: cur.cached_input_tokens,
      output: cur.output_tokens, reasoning: cur.reasoning_output_tokens,
      total: cur.total_tokens,
    };
  }

  return { sessionId, cwdRealPath, originator, messages, rateLimit };
}
```

- [ ] **Step 8: 跑测试**

Run: `pnpm test tests/sources-codex-parser.test.ts`
Expected: 全 5 条 PASS。

- [ ] **Step 9: 提交**

```bash
git add src/server/scanner/sources/codex/parser.ts tests/fixtures/codex tests/sources-codex-parser.test.ts
git commit -m "feat(codex): rollout parser with cumulative-delta token_count handling"
```

---

## Task 8: Codex scanner（文件枚举 + 写库 + rate_limit upsert）

**Files:**
- Create: `src/server/scanner/sources/codex/index.ts`
- Modify: `src/server/scanner/index.ts`（注册 codexSource）
- Modify: `src/server/scanner/writer.ts`（新增 `upsertRateLimitSnapshot`、`upsertCodexProject`）
- Create: `tests/sources-codex-scanner.test.ts`

- [ ] **Step 1: writer 新增辅助函数**

Append to `src/server/scanner/writer.ts`:
```ts
import type { RateLimitSnapshot } from '../../shared/types.js';

export function upsertCodexProject(
  db: DatabaseType,
  p: { projectDir: string; displayName: string; realPath: string },
): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects (project_dir, display_name, real_path, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_dir) DO UPDATE SET
       display_name = excluded.display_name,
       real_path = excluded.real_path,
       last_seen_at = excluded.last_seen_at`,
  ).run(p.projectDir, p.displayName, p.realPath, now, now);
}

export function upsertRateLimitSnapshot(db: DatabaseType, s: RateLimitSnapshot): void {
  db.prepare(
    `INSERT INTO codex_rate_limit_snapshots
       (session_id, observed_at,
        primary_used_pct, primary_window_min, primary_resets_at,
        secondary_used_pct, secondary_window_min, secondary_resets_at,
        plan_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       observed_at = excluded.observed_at,
       primary_used_pct = excluded.primary_used_pct,
       primary_window_min = excluded.primary_window_min,
       primary_resets_at = excluded.primary_resets_at,
       secondary_used_pct = excluded.secondary_used_pct,
       secondary_window_min = excluded.secondary_window_min,
       secondary_resets_at = excluded.secondary_resets_at,
       plan_type = excluded.plan_type`,
  ).run(
    s.sessionId, s.observedAt,
    s.primaryUsedPct, s.primaryWindowMin, s.primaryResetsAt,
    s.secondaryUsedPct, s.secondaryWindowMin, s.secondaryResetsAt,
    s.planType,
  );
}
```

- [ ] **Step 2: 写 Codex scanner**

Create `src/server/scanner/sources/codex/index.ts`:
```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { ScanSource } from '../types.js';
import type { ScanResult } from '../../../../shared/types.js';
import { defaultCodexHome, syntheticProjectDir } from './paths.js';
import { parseCodexRollout } from './parser.js';
import { getCursor, upsertCursor } from '../../cursor.js';
import { insertMessages, recomputeSession, upsertCodexProject, upsertRateLimitSnapshot } from '../../writer.js';

export const codexSource: ScanSource = {
  id: 'codex',
  defaultRoot: () => join(defaultCodexHome(), 'sessions'),
  scanAll(db: DatabaseType, root: string): ScanResult {
    const t0 = Date.now();
    let scannedFiles = 0;
    let newMessages = 0;

    const files = walkRollouts(root);
    for (const filePath of files) {
      const stat = statSync(filePath);
      const prev = getCursor(db, filePath);
      // Codex 文件只追加；mtime+size 不变 = 无新内容
      if (prev && prev.sizeBytes === stat.size && prev.mtimeMs === stat.mtimeMs) continue;

      const content = readFileSync(filePath, 'utf8');
      const parsed = parseCodexRollout(content);
      if (!parsed.sessionId) {
        scannedFiles++;
        continue;
      }

      // 一律全文重解析；session 主键 IGNORE-on-conflict 避免重复，但要按已存在 messageId 跳过
      const realPath = parsed.cwdRealPath ?? '(unknown)';
      const projectDir = syntheticProjectDir(realPath);
      upsertCodexProject(db, { projectDir, displayName: realPath, realPath });

      const added = insertMessages(db, projectDir, parsed.sessionId, parsed.messages);
      if (added > 0) {
        recomputeSession(db, parsed.sessionId);
        newMessages += added;
      }
      if (parsed.rateLimit) upsertRateLimitSnapshot(db, parsed.rateLimit);

      upsertCursor(db, {
        filePath, projectDir,
        sizeBytes: stat.size, mtimeMs: stat.mtimeMs,
        lastOffset: stat.size,    // Codex 我们整文件重读 → cursor 仅作为"已扫"标记
        lastScannedAt: Date.now(),
      });
      scannedFiles++;
    }

    return { scannedFiles, newMessages, durationMs: Date.now() - t0 };
  },
};

function walkRollouts(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries;
    try { entries = readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) out.push(full);
    }
  }
  return out;
}
```

> 设计注释：Codex 文件不像 Claude JSONL 那样按 byte-offset 增量解析；token_count 是累计型，只能整文件重读。`scan_cursor` 仍用，只是把 cursor 当 "扫描指纹"。文件未变就直接跳过；变了就重读全文，靠 `INSERT OR IGNORE` 按 messageId 去重。

- [ ] **Step 3: 注册到 SOURCES**

Edit `src/server/scanner/index.ts`:
```ts
import { codexSource } from './sources/codex/index.js';
// ...
export const SOURCES: Record<SourceId, ScanSource> = {
  claude: claudeSource,
  codex: codexSource,
};
```

- [ ] **Step 4: 写 scanner 集成测试**

Create `tests/sources-codex-scanner.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/server/db.js';
import { codexSource } from '../src/server/scanner/sources/codex/index.js';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'cx-'));
  const root = join(dir, 'sessions', '2026', '04', '01');
  mkdirSync(root, { recursive: true });
  copyFileSync('tests/fixtures/codex/normal.jsonl', join(root, 'rollout-2026-04-01T10-00-00-test-sess-001.jsonl'));
  copyFileSync('tests/fixtures/codex/duplicate-token-count.jsonl', join(root, 'rollout-2026-04-01T10-00-00-test-sess-002.jsonl'));
  const db = openDb(join(dir, 'usage.db'));
  return { db, sessionsRoot: join(dir, 'sessions'), cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('codexSource.scanAll', () => {
  it('inserts sessions, messages, project, and rate_limit snapshot', () => {
    const { db, sessionsRoot, cleanup } = setup();
    try {
      const r = codexSource.scanAll(db, sessionsRoot);
      expect(r.scannedFiles).toBe(2);
      expect(r.newMessages).toBe(4);  // 2 + 2

      const sess = db.prepare(`SELECT session_id, source, cwd_real_path FROM sessions ORDER BY session_id`).all() as Array<any>;
      expect(sess).toHaveLength(2);
      expect(sess.every(s => s.source === 'codex')).toBe(true);
      expect(sess[0].cwd_real_path).toBe('D:/Demo/proj');

      const projs = db.prepare(`SELECT project_dir, real_path FROM projects`).all() as Array<any>;
      expect(projs.some(p => p.project_dir.startsWith('codex:'))).toBe(true);

      const rl = db.prepare(`SELECT session_id, primary_used_pct, plan_type FROM codex_rate_limit_snapshots`).all() as Array<any>;
      expect(rl.some(x => x.session_id === 'test-sess-001' && x.plan_type === 'pro')).toBe(true);
    } finally { cleanup(); }
  });

  it('is idempotent: re-running scanAll on unchanged files produces no new messages', () => {
    const { db, sessionsRoot, cleanup } = setup();
    try {
      codexSource.scanAll(db, sessionsRoot);
      const r2 = codexSource.scanAll(db, sessionsRoot);
      expect(r2.newMessages).toBe(0);
    } finally { cleanup(); }
  });

  it('regression: SUM tokens equals fixture last cumulative total (issue #884)', () => {
    const { db, sessionsRoot, cleanup } = setup();
    try {
      codexSource.scanAll(db, sessionsRoot);
      // duplicate fixture last cumulative total = 280
      const row = db.prepare(
        `SELECT SUM(input_tokens + output_tokens + cache_read_tokens + reasoning_tokens) as total
         FROM messages WHERE session_id = 'test-sess-002'`,
      ).get() as { total: number };
      expect(row.total).toBe(280);
    } finally { cleanup(); }
  });
});
```

- [ ] **Step 5: 跑测试**

Run: `pnpm test tests/sources-codex-scanner.test.ts`
Expected: 3 PASS。

- [ ] **Step 6: 跑全套确认无回归**

Run: `pnpm test`
Expected: 全 PASS。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat(codex): scanner with rate-limit snapshots and idempotent re-scan"
```

---

## Task 9: CLI `--source` flag

**Files:**
- Modify: `src/server/cli.ts`

- [ ] **Step 1: 改 commander 配置 + dispatcher 调用**

Edit `src/server/cli.ts`：保留 `CLAUDE_PROJECTS` 常量；引入 `defaultCodexHome` 仅供日志；`scan` / `start` 命令加 `--source` option：
```ts
import { join } from 'node:path';
import { homedir } from 'node:os';
import { scanAll } from './scanner/index.js';
import { defaultCodexHome } from './scanner/sources/codex/paths.js';

const CLAUDE_PROJECTS = join(homedir(), '.claude', 'projects');
type SourceArg = 'all' | 'claude' | 'codex';
const VALID_SOURCES: ReadonlySet<SourceArg> = new Set(['all', 'claude', 'codex']);

function parseSource(opt: string | undefined): SourceArg {
  const v = (opt ?? 'all') as SourceArg;
  if (!VALID_SOURCES.has(v)) throw new Error(`--source must be one of: all, claude, codex`);
  return v;
}

program.command('scan')
  .option('--source <s>', 'all | claude | codex', 'all')
  .action(async (opts) => {
    const source = parseSource(opts.source);
    const db = openDb(DB_PATH);
    const t0 = Date.now();
    const r = scanAll(db, CLAUDE_PROJECTS, { source });
    console.log(chalk.green(
      `Scanned ${r.scannedFiles} files (${source}), +${r.newMessages} messages in ${Date.now() - t0}ms`,
    ));
    db.close();
  });

program.command('start')
  .option('-p, --port <port>', 'HTTP port', '47821')
  .option('--no-open', 'Do not auto-open browser')
  .option('--dev', 'Dev mode (no static serve)')
  .option('--source <s>', 'Pre-scan source: all | claude | codex', 'all')
  .action(async (opts) => {
    const source = parseSource(opts.source);
    const db = openDb(DB_PATH);
    console.log(chalk.gray(`Scanning (${source})…  Claude=${CLAUDE_PROJECTS}  Codex=${join(defaultCodexHome(), 'sessions')}`));
    const r = scanAll(db, CLAUDE_PROJECTS, { source });
    console.log(chalk.gray(`  ${r.scannedFiles} files, +${r.newMessages} messages`));
    const webDir = opts.dev ? undefined : resolve(__dirname, '../web');
    const app = await buildApp({ db, projectsRoot: CLAUDE_PROJECTS, webDir });
    const port = await listenWithRetry(app, Number(opts.port));
    const url = `http://localhost:${port}`;
    console.log(chalk.green(`✓ cc-usage-dashboard on ${url}`));
    if (opts.open !== false) open(url).catch(() => {});
  });
```

- [ ] **Step 2: 验证 typecheck + 运行 ccu scan --source codex 手工冒烟**

Run:
```bash
pnpm typecheck
pnpm tsx src/server/cli.ts scan --source codex
```
Expected: typecheck PASS；scan 输出 `Scanned N files (codex), +M messages`，其中 M 为本机 Codex 历史消息数（视用户而定）。

- [ ] **Step 3: 提交**

```bash
git add src/server/cli.ts
git commit -m "feat(cli): --source flag on scan/start (all|claude|codex)"
```

---

## Task 10: HTTP API — sessions 加 source/originator 过滤 + 新 codex 路由

**Files:**
- Modify: `src/server/routes/sessions.ts`
- Create: `src/server/routes/codex.ts`
- Modify: `src/server/app.ts`
- Test: `tests/routes-sessions.test.ts`、新建 `tests/routes-codex.test.ts`

- [ ] **Step 1: sessions route 接受 source/originator query**

Edit `src/server/routes/sessions.ts`：在 `GET /api/sessions` 处理函数里加：
```ts
const source = q.source && ['claude','codex'].includes(q.source) ? q.source : null;
const originator = q.originator ?? null;
const whereSource = source ? `AND s.source = @source` : '';
const whereOriginator = originator
  ? `AND s.session_id IN (SELECT session_id FROM messages WHERE originator = @originator)`
  : '';
// 把它们拼到两段 WHERE 里，并把 source/originator 加入参数对象
```
两个查询（totalRow 和 rows）都补上 `${whereSource} ${whereOriginator}`，参数对象多带 `source`、`originator`。

`GET /api/sessions/:sid` 返回里加 `source` / `cwdRealPath` 两列：
```ts
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
```
messages 查询加 `source, originator, reasoning_tokens as reasoningTokens` 三列。

返回对象额外附带该 session 的 rate_limit（如果有）：
```ts
const rateLimit = db.prepare(
  `SELECT observed_at as observedAt,
          primary_used_pct as primaryUsedPct, primary_window_min as primaryWindowMin, primary_resets_at as primaryResetsAt,
          secondary_used_pct as secondaryUsedPct, secondary_window_min as secondaryWindowMin, secondary_resets_at as secondaryResetsAt,
          plan_type as planType
   FROM codex_rate_limit_snapshots WHERE session_id = ?`
).get(sid) ?? null;
return { session, messages, toolDistribution, rateLimit };
```

- [ ] **Step 2: 新 codex 路由**

Create `src/server/routes/codex.ts`:
```ts
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
```

Edit `src/server/app.ts`:
```ts
import { registerCodex } from './routes/codex.js';
// ...
registerCodex(app, deps.db);
```

- [ ] **Step 3: 测试新增**

Append to `tests/routes-sessions.test.ts`（顶部按已有 helper 组装 db；增加一条 codex session 直接 INSERT）：
```ts
it('filters sessions by source=codex', async () => {
  const { app, db, cleanup } = await setupApp();
  try {
    db.prepare(`INSERT INTO projects (project_dir, display_name, real_path, first_seen_at, last_seen_at)
                VALUES ('codex:abc','/p','/p',0,0)`).run();
    db.prepare(`INSERT INTO sessions (session_id, project_dir, started_at, ended_at, source)
                VALUES ('s-cx','codex:abc',1,2,'codex')`).run();
    const res = await app.inject({ method: 'GET', url: '/api/sessions?source=codex' });
    const body = res.json();
    expect(body.items.some((i: any) => i.sessionId === 's-cx')).toBe(true);
  } finally { await cleanup(); }
});
```

Create `tests/routes-codex.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { setupApp } from './_helpers.js';   // 或直接复制现有 setup 模式

describe('codex routes', () => {
  it('returns null current when no snapshots exist', async () => {
    const { app, cleanup } = await setupApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/codex/rate-limits/current' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ primaryMaxPct: null, secondaryMaxPct: null, observedAt: null });
    } finally { await cleanup(); }
  });

  it('returns aggregate after a snapshot is inserted', async () => {
    const { app, db, cleanup } = await setupApp();
    try {
      db.prepare(`INSERT INTO sessions (session_id, project_dir, started_at, ended_at) VALUES ('s1','p',0,0)`).run();
      db.prepare(`INSERT INTO codex_rate_limit_snapshots
        (session_id, observed_at, primary_used_pct, secondary_used_pct, plan_type)
        VALUES ('s1', 100, 12.5, 22.0, 'pro')`).run();
      const res = await app.inject({ method: 'GET', url: '/api/codex/rate-limits/current' });
      expect(res.json().primaryMaxPct).toBeCloseTo(12.5);
    } finally { await cleanup(); }
  });
});
```

> 若没有 `tests/_helpers.ts`，把 setupApp 内联到 `tests/routes-codex.test.ts`：参考 `tests/routes-sessions.test.ts` 现有的 db 初始化代码。

- [ ] **Step 4: 跑测试**

Run: `pnpm test tests/routes-sessions.test.ts tests/routes-codex.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(api): source/originator filter + /api/codex/rate-limits"
```

---

## Task 11: UI — Sessions 页 source / originator chip + 筛选

**Files:**
- Modify: `src/web/pages/Sessions/List.tsx`
- Modify: `src/web/pages/Sessions/Detail.tsx`

- [ ] **Step 1: List.tsx 顶部筛选栏新增 Source / Originator 多选 + 列展示 chip**

打开 `src/web/pages/Sessions/List.tsx`（先 `Read` 看现有结构），在 filter state 旁加：
```tsx
const [source, setSource] = useState<'all' | 'claude' | 'codex'>('all');
const [originator, setOriginator] = useState<string | null>(null);
```
Query 拼参时把 `source !== 'all'` 时 `&source=${source}` 追加；originator 类似。

在表格添加列：
```tsx
{
  title: 'Source', dataIndex: 'source', width: 90,
  render: (v: string) => v === 'codex'
    ? <Tag color="geekblue">Codex</Tag>
    : <Tag color="purple">Claude</Tag>,
}
```

> List 接口返回里需要带 `source`：检查 routes/sessions.ts 的 `rows` 查询，确保 SELECT 列里加 `s.source as source`。如果上一任务遗漏，回去 `tests/routes-sessions.test.ts` 加断言并补 SQL。

- [ ] **Step 2: Detail.tsx 增加 reasoning 行 + rate-limit 行**

In `src/web/pages/Sessions/Detail.tsx`，KPI 区域追加：
```tsx
{session.source === 'codex' && (
  <KpiCard label="Reasoning tokens" value={session.totalReasoning} />
)}
{rateLimit && (
  <KpiCard
    label="Codex 5h / 7d"
    value={`${rateLimit.primaryUsedPct?.toFixed(1) ?? '-'}% / ${rateLimit.secondaryUsedPct?.toFixed(1) ?? '-'}%`}
    hint={rateLimit.planType ?? undefined}
  />
)}
```

消息列表行增加 reasoning 列（仅当 message.source === 'codex' 显示数值）。

- [ ] **Step 3: 启动 dev、人工冒烟**

Run:
```bash
pnpm dev
```
浏览器 → Sessions 页：源筛选切到 Codex，行 chip 是 "Codex"；点开一条 Codex 会话，能看到 Reasoning + 5h/7d KPI。

> 由于无法在 CI 自动化 UI 测试，此步以手工验证为准。截图存到 `docs/superpowers/specs/2026-05-09-codex-screenshots/` 不强制，随手即可。

- [ ] **Step 4: 提交**

```bash
git add src/web/pages/Sessions
git commit -m "feat(ui): sessions source/originator filter + Codex Reasoning KPI"
```

---

## Task 12: UI — 顶栏 RateLimitBadge

**Files:**
- Create: `src/web/components/RateLimitBadge.tsx`
- Modify: `src/web/App.tsx`（顶栏插入位置 — 先 Read 找已有 ThemeToggle 旁）

- [ ] **Step 1: 组件实现**

Create `src/web/components/RateLimitBadge.tsx`:
```tsx
import { Tag, Tooltip } from 'antd';
import { useQuery } from '@tanstack/react-query';

interface CurrentRateLimit {
  primaryMaxPct: number | null;
  secondaryMaxPct: number | null;
  observedAt: number | null;
}

export function RateLimitBadge() {
  const { data } = useQuery<CurrentRateLimit>({
    queryKey: ['codex-rate-limit-current'],
    queryFn: async () => (await fetch('/api/codex/rate-limits/current')).json(),
    refetchInterval: 60_000,
  });
  if (!data || data.primaryMaxPct == null) return null;
  const p5 = data.primaryMaxPct;
  const p7 = data.secondaryMaxPct ?? 0;
  const colorOf = (v: number) => (v >= 95 ? 'red' : v >= 80 ? 'orange' : 'default');
  return (
    <Tooltip title={`Codex 5h: ${p5.toFixed(1)}% · 7d: ${p7.toFixed(1)}%`}>
      <span style={{ display: 'inline-flex', gap: 4 }}>
        <Tag color={colorOf(p5)}>5h {p5.toFixed(0)}%</Tag>
        <Tag color={colorOf(p7)}>7d {p7.toFixed(0)}%</Tag>
      </span>
    </Tooltip>
  );
}
```

- [ ] **Step 2: App.tsx 顶栏挂上**

Edit `src/web/App.tsx`：把 `<RateLimitBadge />` 放在 `<ThemeToggle />` 左边即可（找 ThemeToggle 的引用位置）。

- [ ] **Step 3: 人工冒烟**

Run: `pnpm dev`
Expected: 当 `codex_rate_limit_snapshots` 有行时顶栏显示两枚 chip；无行时 hidden（组件返回 null）。

- [ ] **Step 4: 提交**

```bash
git add src/web/components/RateLimitBadge.tsx src/web/App.tsx
git commit -m "feat(ui): top-bar RateLimitBadge for Codex 5h/7d quota"
```

---

## Task 13: README + 全量回归

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README 更新**

Edit `README.md`：
- "数据来源" 段落改为列两个：`~/.claude/projects/**/*.jsonl`、`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`（尊重 `CODEX_HOME`）。
- "使用" 段落 `ccu scan` 改为 `ccu scan [--source all|claude|codex]`，对 `ccu start` 加同样旗标。
- "页面" 段落补充：会话页支持 source / originator 过滤；详情页对 Codex 显示 reasoning 与 rate_limits；顶栏新增 Codex 额度徽章。

- [ ] **Step 2: 跑全量测试 + typecheck + build**

Run:
```bash
pnpm test
pnpm typecheck
pnpm build
```
Expected: 全 PASS；`dist/` 生成。

- [ ] **Step 3: 端到端冒烟（用户本机）**

Run:
```bash
node dist/server/cli.js scan
node dist/server/cli.js start --no-open
```
打开 http://localhost:47821：
1. 概览页 byProvider 维度看到 anthropic + openai 两条
2. 会话页筛选 Source = Codex 出现 Codex 会话；点开一条看到 reasoning 行
3. 顶栏额度徽章显示当前最高水位
4. 设置 → 计费规则 看到 "OpenAI" 分组下含 gpt-5、gpt-5-codex 等模型

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: document Codex source, --source flag, and Codex-only UI elements"
```

---

## Self-Review

- ✅ Spec §3 Phase 0 → Tasks 4, 9（scanner 重构 + CLI flag）
- ✅ Spec §4.1 migration 004 → Task 1
- ✅ Spec §4.1 migration 005 → Task 2
- ✅ Spec §4.2 OpenAI provider 与价格 → Task 3
- ✅ Spec §4.3 项目按 real_path → Task 6（syntheticProjectDir）+ Task 8（upsertCodexProject）
- ✅ Spec §5.1 复用 scan_cursor → Task 8（"扫描指纹"模式）
- ✅ Spec §5.2 turn_context 跟踪 + 缺失回退 gpt-5 → Task 7 fixtures + parser
- ✅ Spec §5.3 cumulative-delta 算法 + #884 回归 → Task 7 fixture `duplicate-token-count.jsonl` + Task 8 集成断言
- ✅ Spec §5.4 text_preview from agent_message → Task 7 parser（lastAgentText）
- ✅ Spec §5.5 rate_limits 快照 → Task 8 upsertRateLimitSnapshot + Task 10 API
- ✅ Spec §5.6 cost 计算 reasoning at output rate → Task 3 applyPrice 改造
- ✅ Spec §6 UI 改动：source chip / 筛选 / 详情 reasoning / RateLimitBadge → Tasks 11, 12
- ✅ Spec §6 设置页按 provider 分组：现有 `/api/providers` 与设置页面已支持 provider 维度，Task 3 注入 `openai` 后自动出现，无需额外任务
- ✅ Spec §7 CLI `--source` → Task 9
- ✅ Spec §8 测试 fixtures + 不变量断言 → Task 7 + Task 8

**遗漏检查**：Spec §6 提到"成本页堆叠 byProvider 模式"。当前 `cost` route 返回 `byModel`/`byProject`，未输出 byProvider 桶。补一个**Task 11 后置增量**（保持范围最小）：

### Task 11.5 (lightweight): 成本页 byProvider 堆叠

**Files:** `src/server/routes/cost.ts`, `src/web/pages/Cost/*`

- [ ] **Step 1**: cost.ts 在 buckets 里 join `models` + `providers` 把 byProject 同款写法复制成 byProvider；前端切换器加一个 mode='byProvider'。代码模式与现有 byModel 完全对称（参考 routes-cost.test.ts 现有断言模板）。
- [ ] **Step 2**: 更新 `tests/routes-cost.test.ts` 加 byProvider 断言。
- [ ] **Step 3**: 提交：`feat(cost): byProvider stacking mode`。

> 此任务可视情况推迟，不阻塞 Codex 上线。

---

## 类型一致性检查

- `ParsedMessage` 字段（Task 5 定义）：`source`, `originator`, `cwdRealPath`, `reasoningTokens` — 在 Task 7 parser、Task 8 scanner、Task 10 API、Task 11 UI 全程一致使用。
- `RateLimitSnapshot` 字段（Task 5 定义）：`primaryUsedPct` 等 — Task 7 parser、Task 8 writer、Task 10 API 一致。
- `--source` 枚举：`'all' | 'claude' | 'codex'`，CLI 层（Task 9）与 dispatcher（Task 4）共用同一 union。
- `syntheticProjectDir` 输出 `'codex:' + base64url(realPath)` — Task 6 定义、Task 8 调用、Task 11 UI 不解析（视为 opaque）。
