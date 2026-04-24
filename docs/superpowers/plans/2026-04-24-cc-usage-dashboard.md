# cc-usage-dashboard 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本地可视化 Claude Code token 用量与成本分析工具，全局 CLI `ccu` 启动 Web 仪表盘。

**Architecture:** Node (Fastify) + SQLite（better-sqlite3）扫描 `~/.claude/projects/**/*.jsonl` 索引消息级 token 与成本；同进程托管 React SPA，浏览器访问 `localhost:5173` 查看 Overview / Projects / Sessions / Cost 四视图。

**Tech Stack:** TypeScript, Fastify, better-sqlite3, commander, React 18 + Vite, Ant Design v5, ECharts, TanStack Query, React Router v6, zustand, Vitest (test), tsup (bundle).

**Spec:** `docs/superpowers/specs/2026-04-24-cc-usage-dashboard-design.md`

---

## 文件结构（目标形态）

```
cc-usage-dashboard/
├─ package.json
├─ tsconfig.json               # 前端（bundler）
├─ tsconfig.server.json        # 后端（node）
├─ vite.config.ts
├─ vitest.config.ts
├─ tsup.config.ts
├─ .gitignore
├─ README.md
├─ index.html                  # Vite entry
├─ src/
│  ├─ server/
│  │  ├─ cli.ts                # commander 入口 (`ccu start|scan|recompute-cost`)
│  │  ├─ app.ts                # Fastify 实例工厂
│  │  ├─ db.ts                 # better-sqlite3 连接 + migration runner
│  │  ├─ migrations/001_init.sql
│  │  ├─ pricing.ts            # 模型价格表 + cost 计算
│  │  ├─ paths.ts              # base64url + 目录名反推真实路径
│  │  ├─ scanner/
│  │  │  ├─ parser.ts          # 一行 jsonl → normalized ParsedMessage
│  │  │  ├─ writer.ts          # 批量写 messages + 重算 sessions
│  │  │  ├─ cursor.ts          # scan_cursor CRUD
│  │  │  └─ index.ts           # 扫描编排（全量 / 增量）
│  │  ├─ routes/
│  │  │  ├─ admin.ts           # /api/health /api/scan /api/recompute-cost
│  │  │  ├─ overview.ts        # /api/overview
│  │  │  ├─ projects.ts        # /api/projects, /api/projects/:b64/timeline
│  │  │  ├─ sessions.ts        # /api/sessions, /api/sessions/:id
│  │  │  └─ cost.ts            # /api/cost
│  │  └─ staticServe.ts        # prod 下托管 dist/web
│  ├─ shared/
│  │  └─ types.ts              # 前后端共享 API 类型
│  └─ web/
│     ├─ main.tsx
│     ├─ App.tsx
│     ├─ routes.tsx
│     ├─ store.ts              # zustand（范围、主题）
│     ├─ api/client.ts         # fetch + TanStack Query hooks
│     ├─ hooks/useOverview.ts
│     ├─ components/
│     │  ├─ KpiCard.tsx
│     │  ├─ RangePicker.tsx
│     │  ├─ ModelStackedArea.tsx
│     │  ├─ TopBarChart.tsx
│     │  └─ AnomalyBarChart.tsx
│     └─ pages/
│        ├─ Overview/index.tsx
│        ├─ Projects/List.tsx
│        ├─ Projects/Detail.tsx
│        ├─ Sessions/List.tsx
│        ├─ Sessions/Detail.tsx
│        └─ Cost/index.tsx
├─ tests/
│  ├─ fixtures/
│  │  ├─ session-opus.jsonl    # 裁切真实 jsonl（匿名化）
│  │  └─ session-sonnet.jsonl
│  ├─ pricing.test.ts
│  ├─ paths.test.ts
│  ├─ parser.test.ts
│  ├─ cursor.test.ts
│  ├─ writer.test.ts
│  ├─ scanner.test.ts
│  └─ routes.test.ts
└─ scripts/
   └─ make-fixtures.ts         # 从本机真实 jsonl 裁切出 fixtures
```

---

## M1 · 脚手架 + 扫描管道

目标：跑 `npm run scan`（稍后改为 `ccu scan`）把本机所有 jsonl 解析到 SQLite，命令行能打印汇总。

### Task 1: 初始化 package.json 与基础配置

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `tsconfig.json`
- Create: `tsconfig.server.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "cc-usage-dashboard",
  "version": "0.1.0",
  "description": "Local dashboard for Claude Code token usage & cost analysis",
  "type": "module",
  "bin": { "ccu": "dist/server/cli.js" },
  "scripts": {
    "dev": "concurrently \"npm:dev:server\" \"npm:dev:web\"",
    "dev:server": "tsx watch src/server/cli.ts start --dev",
    "dev:web": "vite",
    "scan": "tsx src/server/cli.ts scan",
    "build": "npm run build:web && npm run build:server",
    "build:web": "vite build",
    "build:server": "tsup src/server/cli.ts --format esm --out-dir dist/server --clean",
    "test": "vitest run",
    "test:watch": "vitest",
    "start": "node dist/server/cli.js start",
    "typecheck": "tsc -p tsconfig.server.json --noEmit && tsc --noEmit"
  },
  "dependencies": {
    "fastify": "^5.0.0",
    "@fastify/static": "^8.0.0",
    "better-sqlite3": "^11.0.0",
    "commander": "^12.0.0",
    "open": "^10.0.0",
    "chalk": "^5.3.0",
    "cli-progress": "^3.12.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/cli-progress": "^3.11.0",
    "typescript": "^5.5.0",
    "tsx": "^4.19.0",
    "tsup": "^8.3.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0",
    "concurrently": "^9.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0",
    "@tanstack/react-query": "^5.56.0",
    "antd": "^5.21.0",
    "@ant-design/icons": "^5.5.0",
    "echarts": "^5.5.0",
    "echarts-for-react": "^3.0.0",
    "zustand": "^5.0.0",
    "dayjs": "^1.11.0"
  }
}
```

- [ ] **Step 2: 写 .gitignore**

```
node_modules
dist
.env
.env.local
*.log
.DS_Store
Thumbs.db
coverage
.vite
```

- [ ] **Step 3: 写 tsconfig.server.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/server/**/*", "src/shared/**/*", "tests/**/*"]
}
```

- [ ] **Step 4: 写 tsconfig.json（前端）**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["src/web/**/*", "src/shared/**/*"]
}
```

- [ ] **Step 5: 写 vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
  },
});
```

- [ ] **Step 6: 安装依赖**

Run: `npm install`
Expected: 完成，无 ERR（peer warnings 可忽略）

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: 初始化 package.json 与 tsconfig"
```

---

### Task 2: SQLite schema 与 DB 连接

**Files:**
- Create: `src/server/migrations/001_init.sql`
- Create: `src/server/db.ts`
- Test: `tests/db.test.ts`

- [ ] **Step 1: 写 migration**

`src/server/migrations/001_init.sql`:

```sql
CREATE TABLE IF NOT EXISTS scan_cursor (
  file_path       TEXT PRIMARY KEY,
  project_dir     TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  mtime_ms        INTEGER NOT NULL,
  last_offset     INTEGER NOT NULL,
  last_scanned_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  project_dir     TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  real_path       TEXT,
  first_seen_at   INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id         TEXT PRIMARY KEY,
  project_dir        TEXT NOT NULL,
  started_at         INTEGER NOT NULL,
  ended_at           INTEGER NOT NULL,
  message_count      INTEGER NOT NULL DEFAULT 0,
  total_input        INTEGER NOT NULL DEFAULT 0,
  total_output       INTEGER NOT NULL DEFAULT 0,
  total_cache_create INTEGER NOT NULL DEFAULT 0,
  total_cache_read   INTEGER NOT NULL DEFAULT 0,
  total_cost_usd     REAL    NOT NULL DEFAULT 0,
  FOREIGN KEY (project_dir) REFERENCES projects(project_dir)
);

CREATE TABLE IF NOT EXISTS messages (
  message_id            TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL,
  parent_uuid           TEXT,
  role                  TEXT NOT NULL,
  model                 TEXT,
  timestamp             INTEGER NOT NULL,
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cost_usd              REAL    NOT NULL DEFAULT 0,
  stop_reason           TEXT,
  tool_names            TEXT,
  text_preview          TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_session
  ON messages(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_day
  ON messages(date(timestamp/1000,'unixepoch'));
CREATE INDEX IF NOT EXISTS idx_sessions_project
  ON sessions(project_dir, started_at);
```

- [ ] **Step 2: 写失败测试**

`tests/db.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openDb } from '../src/server/db.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

describe('openDb', () => {
  it('creates schema from migrations when db is new', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-db-'));
    try {
      const db = openDb(join(dir, 'usage.db'));
      const tables = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
      ).all() as { name: string }[];
      const names = tables.map(t => t.name);
      expect(names).toContain('scan_cursor');
      expect(names).toContain('projects');
      expect(names).toContain('sessions');
      expect(names).toContain('messages');
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is idempotent: reopening does not throw', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-db-'));
    try {
      const p = join(dir, 'usage.db');
      openDb(p).close();
      const db = openDb(p);
      expect(() => db.prepare('SELECT 1').get()).not.toThrow();
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run 测试，确认失败**

Run: `npm test -- tests/db.test.ts`
Expected: FAIL, "Cannot find module ../src/server/db.js"

- [ ] **Step 4: 实现 db.ts**

`src/server/db.ts`:

```ts
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

export function openDb(dbPath: string): DatabaseType {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

function applyMigrations(db: DatabaseType): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     )`
  );
  const applied = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as { name: string }[])
      .map(r => r.name)
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations(name, applied_at) VALUES (?, ?)')
        .run(f, Date.now());
    });
    tx();
  }
}
```

- [ ] **Step 5: Run 测试，确认通过**

Run: `npm test -- tests/db.test.ts`
Expected: 2 passed

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: SQLite schema + migration runner"
```

---

### Task 3: 路径反推 paths.ts

**Files:**
- Create: `src/server/paths.ts`
- Test: `tests/paths.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/paths.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reverseProjectDirName, encodeProjectDir, decodeProjectDir } from '../src/server/paths.js';

describe('reverseProjectDirName', () => {
  it('reverses typical Windows encoding', () => {
    expect(reverseProjectDirName('D--QC-code2-linz-tools-genealogy-platform'))
      .toBe('D:/QC/code2/linz/tools/genealogy-platform');
  });

  it('reverses nested path', () => {
    expect(reverseProjectDirName('C--Users-EDY--workspace'))
      .toBe('C:/Users/EDY/workspace');
  });

  it('returns null when no drive-letter pattern matches', () => {
    expect(reverseProjectDirName('plain-name-no-drive')).toBeNull();
  });
});

describe('encode/decode projectDir b64url', () => {
  it('round-trips', () => {
    const orig = 'D:/QC/code2/linz/tools/genealogy-platform';
    expect(decodeProjectDir(encodeProjectDir(orig))).toBe(orig);
  });
  it('is url-safe', () => {
    const b64 = encodeProjectDir('D:/QC/code2/linz/tools/genealogy-platform');
    expect(b64).not.toMatch(/[+/=]/);
  });
});
```

- [ ] **Step 2: Run，确认失败**

Run: `npm test -- tests/paths.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 paths.ts**

`src/server/paths.ts`:

```ts
export function reverseProjectDirName(dirName: string): string | null {
  const m = dirName.match(/^([A-Za-z])--(.+)$/);
  if (!m) return null;
  const drive = m[1].toUpperCase();
  const rest = m[2].replace(/-/g, '/');
  return `${drive}:/${rest}`;
}

export function encodeProjectDir(p: string): string {
  return Buffer.from(p, 'utf8').toString('base64url');
}

export function decodeProjectDir(b64: string): string {
  return Buffer.from(b64, 'base64url').toString('utf8');
}
```

- [ ] **Step 4: Run，确认通过**

Run: `npm test -- tests/paths.test.ts`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 项目路径反推与 base64url 编解码"
```

---

### Task 4: 价格表与成本计算 pricing.ts

**Files:**
- Create: `src/server/pricing.ts`
- Test: `tests/pricing.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/pricing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeCostUsd, PRICING } from '../src/server/pricing.js';

describe('computeCostUsd', () => {
  it('computes sonnet cost for mixed token types', () => {
    const cost = computeCostUsd('claude-sonnet-4-6', {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
    // 1M input * $3 + 100k output * $15/1M = 3 + 1.5 = 4.5
    expect(cost).toBeCloseTo(4.5, 6);
  });

  it('computes opus cost including cache', () => {
    const cost = computeCostUsd('claude-opus-4-7', {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
    });
    // 1M cacheCreate * $18.75 + 1M cacheRead * $1.50 = 20.25
    expect(cost).toBeCloseTo(20.25, 6);
  });

  it('falls back to sonnet pricing for unknown model', () => {
    const known = computeCostUsd('claude-sonnet-4-6', {
      inputTokens: 10_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
    });
    const unknown = computeCostUsd('foo-model-xyz', {
      inputTokens: 10_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
    });
    expect(unknown).toBeCloseTo(known, 6);
  });

  it('has required models in PRICING', () => {
    expect(PRICING['claude-opus-4-7']).toBeDefined();
    expect(PRICING['claude-sonnet-4-6']).toBeDefined();
    expect(PRICING['claude-haiku-4-5']).toBeDefined();
  });
});
```

- [ ] **Step 2: Run，确认失败**

Run: `npm test -- tests/pricing.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 pricing.ts**

`src/server/pricing.ts`:

```ts
export interface ModelPrice {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

const M = 1_000_000;

export const PRICING: Record<string, ModelPrice> = {
  'claude-opus-4-7':   { input: 15/M, output: 75/M, cacheCreate: 18.75/M, cacheRead: 1.50/M },
  'claude-sonnet-4-6': { input:  3/M, output: 15/M, cacheCreate:  3.75/M, cacheRead: 0.30/M },
  'claude-haiku-4-5':  { input:  1/M, output:  5/M, cacheCreate:  1.25/M, cacheRead: 0.10/M },
};

const FALLBACK_MODEL = 'claude-sonnet-4-6';

export function computeCostUsd(model: string, tokens: TokenCounts): number {
  const price = PRICING[model] ?? PRICING[FALLBACK_MODEL];
  return (
    tokens.inputTokens          * price.input       +
    tokens.outputTokens         * price.output      +
    tokens.cacheCreationTokens  * price.cacheCreate +
    tokens.cacheReadTokens      * price.cacheRead
  );
}
```

- [ ] **Step 4: Run，确认通过**

Run: `npm test -- tests/pricing.test.ts`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 模型价格表 + 成本计算"
```

---

### Task 5: 共享类型 shared/types.ts

**Files:**
- Create: `src/shared/types.ts`

- [ ] **Step 1: 写类型**

`src/shared/types.ts`:

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
  stopReason: string | null;
  toolNames: string[];
  textPreview: string | null;
}

export interface ScanResult {
  scannedFiles: number;
  newMessages: number;
  durationMs: number;
}

export interface OverviewResponse {
  range: { from: string; to: string };
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheCreate: number;
    cacheRead: number;
    costUsd: number;
    messageCount: number;
    sessionCount: number;
  };
  byModel: Array<{ model: string; tokens: number; costUsd: number; share: number }>;
  byProject: Array<{ projectDir: string; displayName: string; tokens: number; costUsd: number; share: number }>;
  dailyTrend: Array<{ date: string; inputTokens: number; outputTokens: number; costUsd: number; byModel: Record<string, number> }>;
  cacheHitRate: number;
}

export interface ProjectRow {
  projectDir: string;
  displayName: string;
  realPath: string | null;
  sessionCount: number;
  totalTokens: number;
  totalCostUsd: number;
  avgTokensPerSession: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface SessionRow {
  sessionId: string;
  projectDir: string;
  startedAt: number;
  endedAt: number;
  messageCount: number;
  totalTokens: number;
  totalCostUsd: number;
  topTools: string[];
}

export interface MessageRow {
  messageId: string;
  role: 'user' | 'assistant';
  model: string | null;
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreate: number;
  cacheRead: number;
  costUsd: number;
  stopReason: string | null;
  toolNames: string[];
  textPreview: string | null;
}

export interface CostBucket {
  bucketKey: string;
  costUsd: number;
  tokens: number;
  byModel: Record<string, number>;
  byProject: Array<{ projectDir: string; costUsd: number }>;
}

export interface CostResponse {
  buckets: CostBucket[];
  anomalies: Array<{ date: string; costUsd: number; zScore: number }>;
}

export type RangeKey = 'today' | 'week' | 'month' | 'ytd' | 'all';
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.server.json --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: 前后端共享 API 类型"
```

---

### Task 6: jsonl 解析器 scanner/parser.ts

**Files:**
- Create: `src/server/scanner/parser.ts`
- Create: `tests/fixtures/session-sample.jsonl`
- Test: `tests/parser.test.ts`

- [ ] **Step 1: 准备 fixture**

`tests/fixtures/session-sample.jsonl` — 三行 JSON（用单行）：

```
{"uuid":"u-1","sessionId":"sess-1","parentUuid":null,"timestamp":"2026-04-20T10:00:00.000Z","message":{"role":"user","content":[{"type":"text","text":"帮我写个排序算法"}]}}
{"uuid":"a-1","sessionId":"sess-1","parentUuid":"u-1","timestamp":"2026-04-20T10:00:05.000Z","message":{"id":"msg_01abc","role":"assistant","model":"claude-sonnet-4-6","stop_reason":"end_turn","content":[{"type":"text","text":"好的，我来写冒泡排序..."},{"type":"tool_use","name":"Write","input":{}}],"usage":{"input_tokens":100,"output_tokens":200,"cache_creation_input_tokens":50,"cache_read_input_tokens":1000}}}
{"uuid":"a-2","sessionId":"sess-1","parentUuid":"a-1","timestamp":"2026-04-20T10:00:10.000Z","message":{"id":"msg_01def","role":"assistant","model":"claude-sonnet-4-6","stop_reason":"tool_use","content":[{"type":"tool_use","name":"Bash"}],"usage":{"input_tokens":5,"output_tokens":10,"cache_creation_input_tokens":0,"cache_read_input_tokens":1150}}}
```

- [ ] **Step 2: 写失败测试**

`tests/parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseJsonlLine } from '../src/server/scanner/parser.js';

const lines = readFileSync('tests/fixtures/session-sample.jsonl', 'utf8')
  .split('\n').filter(Boolean);

describe('parseJsonlLine', () => {
  it('parses user message with preview', () => {
    const r = parseJsonlLine(lines[0], 'sess-1');
    expect(r).not.toBeNull();
    expect(r!.role).toBe('user');
    expect(r!.textPreview).toContain('排序');
    expect(r!.inputTokens).toBe(0);
  });

  it('parses assistant message with usage and tool_names', () => {
    const r = parseJsonlLine(lines[1], 'sess-1');
    expect(r).not.toBeNull();
    expect(r!.role).toBe('assistant');
    expect(r!.model).toBe('claude-sonnet-4-6');
    expect(r!.inputTokens).toBe(100);
    expect(r!.outputTokens).toBe(200);
    expect(r!.cacheCreationTokens).toBe(50);
    expect(r!.cacheReadTokens).toBe(1000);
    expect(r!.stopReason).toBe('end_turn');
    expect(r!.toolNames).toEqual(['Write']);
    expect(r!.textPreview).toContain('冒泡');
  });

  it('returns null on invalid JSON', () => {
    expect(parseJsonlLine('{not-json', 'sess-1')).toBeNull();
  });

  it('returns null on JSON without expected shape', () => {
    expect(parseJsonlLine('{"random":"thing"}', 'sess-1')).toBeNull();
  });
});
```

- [ ] **Step 3: Run，确认失败**

Run: `npm test -- tests/parser.test.ts`
Expected: FAIL

- [ ] **Step 4: 实现 parser.ts**

`src/server/scanner/parser.ts`:

```ts
import type { ParsedMessage } from '../../shared/types.js';

const PREVIEW_LEN = 200;

export function parseJsonlLine(line: string, sessionId: string): ParsedMessage | null {
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || !obj.message || typeof obj.message !== 'object') {
    return null;
  }
  const m = obj.message;
  const role = m.role;
  if (role !== 'user' && role !== 'assistant') return null;

  const timestamp = obj.timestamp
    ? new Date(obj.timestamp).getTime()
    : Date.now();

  const usage = m.usage ?? {};
  const content = Array.isArray(m.content) ? m.content : [];
  const toolNames: string[] = content
    .filter((c: any) => c && c.type === 'tool_use' && typeof c.name === 'string')
    .map((c: any) => c.name);

  let textPreview: string | null = null;
  for (const c of content) {
    if (c && c.type === 'text' && typeof c.text === 'string') {
      textPreview = c.text.slice(0, PREVIEW_LEN);
      break;
    }
  }
  if (!textPreview && role === 'user' && typeof m.content === 'string') {
    textPreview = m.content.slice(0, PREVIEW_LEN);
  }

  const messageId: string = m.id ?? obj.uuid ?? `${sessionId}:${timestamp}`;

  return {
    messageId,
    sessionId,
    parentUuid: obj.parentUuid ?? null,
    role,
    model: m.model ?? null,
    timestamp,
    inputTokens: Number(usage.input_tokens) || 0,
    outputTokens: Number(usage.output_tokens) || 0,
    cacheCreationTokens: Number(usage.cache_creation_input_tokens) || 0,
    cacheReadTokens: Number(usage.cache_read_input_tokens) || 0,
    stopReason: m.stop_reason ?? null,
    toolNames,
    textPreview,
  };
}
```

- [ ] **Step 5: Run，确认通过**

Run: `npm test -- tests/parser.test.ts`
Expected: 4 passed

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: jsonl 单行解析器"
```

---

### Task 7: scan_cursor 读写 scanner/cursor.ts

**Files:**
- Create: `src/server/scanner/cursor.ts`
- Test: `tests/cursor.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/cursor.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/server/db.js';
import { getCursor, upsertCursor, allCursors } from '../src/server/scanner/cursor.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-cursor-'));
  const db = openDb(join(dir, 'usage.db'));
  return { db, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('scan_cursor CRUD', () => {
  it('returns null for unknown file', () => {
    const { db, cleanup } = makeDb();
    try {
      expect(getCursor(db, '/a/b.jsonl')).toBeNull();
    } finally { cleanup(); }
  });

  it('upserts and reads back', () => {
    const { db, cleanup } = makeDb();
    try {
      upsertCursor(db, {
        filePath: '/a/b.jsonl', projectDir: '/a', sizeBytes: 100, mtimeMs: 1,
        lastOffset: 50, lastScannedAt: 123,
      });
      const r = getCursor(db, '/a/b.jsonl');
      expect(r?.lastOffset).toBe(50);
      expect(r?.sizeBytes).toBe(100);
    } finally { cleanup(); }
  });

  it('allCursors lists entries for a project_dir', () => {
    const { db, cleanup } = makeDb();
    try {
      upsertCursor(db, { filePath: '/a/1.jsonl', projectDir: '/a', sizeBytes: 10, mtimeMs: 1, lastOffset: 10, lastScannedAt: 1 });
      upsertCursor(db, { filePath: '/a/2.jsonl', projectDir: '/a', sizeBytes: 20, mtimeMs: 2, lastOffset: 20, lastScannedAt: 2 });
      upsertCursor(db, { filePath: '/b/3.jsonl', projectDir: '/b', sizeBytes: 30, mtimeMs: 3, lastOffset: 30, lastScannedAt: 3 });
      expect(allCursors(db, '/a')).toHaveLength(2);
      expect(allCursors(db, '/b')).toHaveLength(1);
    } finally { cleanup(); }
  });
});
```

- [ ] **Step 2: Run，确认失败**

Run: `npm test -- tests/cursor.test.ts`

- [ ] **Step 3: 实现 cursor.ts**

`src/server/scanner/cursor.ts`:

```ts
import type { Database as DatabaseType } from 'better-sqlite3';

export interface CursorRow {
  filePath: string;
  projectDir: string;
  sizeBytes: number;
  mtimeMs: number;
  lastOffset: number;
  lastScannedAt: number;
}

export function getCursor(db: DatabaseType, filePath: string): CursorRow | null {
  const r = db.prepare(
    `SELECT file_path as filePath, project_dir as projectDir,
            size_bytes as sizeBytes, mtime_ms as mtimeMs,
            last_offset as lastOffset, last_scanned_at as lastScannedAt
     FROM scan_cursor WHERE file_path = ?`
  ).get(filePath) as CursorRow | undefined;
  return r ?? null;
}

export function upsertCursor(db: DatabaseType, c: CursorRow): void {
  db.prepare(
    `INSERT INTO scan_cursor
       (file_path, project_dir, size_bytes, mtime_ms, last_offset, last_scanned_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET
       project_dir = excluded.project_dir,
       size_bytes = excluded.size_bytes,
       mtime_ms = excluded.mtime_ms,
       last_offset = excluded.last_offset,
       last_scanned_at = excluded.last_scanned_at`
  ).run(c.filePath, c.projectDir, c.sizeBytes, c.mtimeMs, c.lastOffset, c.lastScannedAt);
}

export function allCursors(db: DatabaseType, projectDir: string): CursorRow[] {
  return db.prepare(
    `SELECT file_path as filePath, project_dir as projectDir,
            size_bytes as sizeBytes, mtime_ms as mtimeMs,
            last_offset as lastOffset, last_scanned_at as lastScannedAt
     FROM scan_cursor WHERE project_dir = ?`
  ).all(projectDir) as CursorRow[];
}
```

- [ ] **Step 4: Run，确认通过**

Run: `npm test -- tests/cursor.test.ts`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: scan_cursor 增量游标读写"
```

---

### Task 8: 批量写入与汇总 scanner/writer.ts

**Files:**
- Create: `src/server/scanner/writer.ts`
- Test: `tests/writer.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/writer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openDb } from '../src/server/db.js';
import { upsertProject, insertMessages, recomputeSession } from '../src/server/scanner/writer.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ParsedMessage } from '../src/shared/types.js';

function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-writer-'));
  const db = openDb(join(dir, 'usage.db'));
  return { db, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

const msg = (overrides: Partial<ParsedMessage>): ParsedMessage => ({
  messageId: 'm-1',
  sessionId: 's-1',
  parentUuid: null,
  role: 'assistant',
  model: 'claude-sonnet-4-6',
  timestamp: 1_700_000_000_000,
  inputTokens: 100,
  outputTokens: 200,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  stopReason: 'end_turn',
  toolNames: ['Read'],
  textPreview: 'hello',
  ...overrides,
});

describe('writer', () => {
  it('inserts messages with computed cost and populates sessions on recompute', () => {
    const { db, cleanup } = makeDb();
    try {
      upsertProject(db, { projectDir: '/p', displayName: 'p', realPath: null });
      insertMessages(db, '/p', 's-1', [
        msg({ messageId: 'a', timestamp: 1 }),
        msg({ messageId: 'b', timestamp: 2, inputTokens: 50, outputTokens: 50 }),
      ]);
      recomputeSession(db, 's-1');
      const s = db.prepare('SELECT * FROM sessions WHERE session_id=?').get('s-1') as any;
      expect(s.message_count).toBe(2);
      expect(s.total_input).toBe(150);
      expect(s.total_output).toBe(250);
      expect(s.total_cost_usd).toBeGreaterThan(0);
    } finally { cleanup(); }
  });

  it('is idempotent on re-insert of same message_id', () => {
    const { db, cleanup } = makeDb();
    try {
      upsertProject(db, { projectDir: '/p', displayName: 'p', realPath: null });
      const m = msg({ messageId: 'x' });
      insertMessages(db, '/p', 's-1', [m]);
      insertMessages(db, '/p', 's-1', [m]);
      const n = (db.prepare('SELECT COUNT(*) as n FROM messages WHERE message_id=?').get('x') as any).n;
      expect(n).toBe(1);
    } finally { cleanup(); }
  });
});
```

- [ ] **Step 2: Run，确认失败**

Run: `npm test -- tests/writer.test.ts`

- [ ] **Step 3: 实现 writer.ts**

`src/server/scanner/writer.ts`:

```ts
import type { Database as DatabaseType } from 'better-sqlite3';
import type { ParsedMessage } from '../../shared/types.js';
import { computeCostUsd } from '../pricing.js';

export function upsertProject(
  db: DatabaseType,
  p: { projectDir: string; displayName: string; realPath: string | null }
): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects (project_dir, display_name, real_path, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_dir) DO UPDATE SET
       display_name = excluded.display_name,
       real_path = COALESCE(excluded.real_path, projects.real_path),
       last_seen_at = excluded.last_seen_at`
  ).run(p.projectDir, p.displayName, p.realPath, now, now);
}

export function insertMessages(
  db: DatabaseType,
  projectDir: string,
  sessionId: string,
  msgs: ParsedMessage[]
): number {
  if (msgs.length === 0) return 0;
  ensureSession(db, sessionId, projectDir);
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO messages
       (message_id, session_id, parent_uuid, role, model, timestamp,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
        cost_usd, stop_reason, tool_names, text_preview)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction((rows: ParsedMessage[]) => {
    let inserted = 0;
    for (const m of rows) {
      const cost = m.model
        ? computeCostUsd(m.model, {
            inputTokens: m.inputTokens,
            outputTokens: m.outputTokens,
            cacheCreationTokens: m.cacheCreationTokens,
            cacheReadTokens: m.cacheReadTokens,
          })
        : 0;
      const r = stmt.run(
        m.messageId, m.sessionId, m.parentUuid, m.role, m.model, m.timestamp,
        m.inputTokens, m.outputTokens, m.cacheCreationTokens, m.cacheReadTokens,
        cost, m.stopReason, JSON.stringify(m.toolNames), m.textPreview
      );
      if (r.changes > 0) inserted++;
    }
    return inserted;
  });
  return tx(msgs);
}

function ensureSession(db: DatabaseType, sessionId: string, projectDir: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO sessions
       (session_id, project_dir, started_at, ended_at,
        message_count, total_input, total_output, total_cache_create, total_cache_read, total_cost_usd)
     VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, 0)`
  ).run(sessionId, projectDir);
}

export function recomputeSession(db: DatabaseType, sessionId: string): void {
  const agg = db.prepare(
    `SELECT COUNT(*) as c,
            COALESCE(MIN(timestamp), 0) as started,
            COALESCE(MAX(timestamp), 0) as ended,
            COALESCE(SUM(input_tokens), 0) as in_,
            COALESCE(SUM(output_tokens), 0) as out_,
            COALESCE(SUM(cache_creation_tokens), 0) as cc,
            COALESCE(SUM(cache_read_tokens), 0) as cr,
            COALESCE(SUM(cost_usd), 0) as cost
     FROM messages WHERE session_id = ?`
  ).get(sessionId) as any;

  db.prepare(
    `UPDATE sessions SET
       started_at = ?, ended_at = ?,
       message_count = ?, total_input = ?, total_output = ?,
       total_cache_create = ?, total_cache_read = ?, total_cost_usd = ?
     WHERE session_id = ?`
  ).run(agg.started, agg.ended, agg.c, agg.in_, agg.out_, agg.cc, agg.cr, agg.cost, sessionId);
}
```

- [ ] **Step 4: Run，确认通过**

Run: `npm test -- tests/writer.test.ts`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 消息批量写入 + session 汇总重算"
```

---

### Task 9: 扫描编排 scanner/index.ts

**Files:**
- Create: `src/server/scanner/index.ts`
- Test: `tests/scanner.test.ts`

- [ ] **Step 1: 准备 fixture 目录**

Shell 命令（一次性）:

```bash
mkdir -p tests/fixtures/projects/D--test-proj
cp tests/fixtures/session-sample.jsonl tests/fixtures/projects/D--test-proj/sess-1.jsonl
```

- [ ] **Step 2: 写失败测试**

`tests/scanner.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openDb } from '../src/server/db.js';
import { scanAll } from '../src/server/scanner/index.js';
import { mkdtempSync, rmSync, copyFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-scan-'));
  const projectsRoot = join(dir, 'projects');
  const projDir = join(projectsRoot, 'D--test-proj');
  mkdirSync(projDir, { recursive: true });
  copyFileSync('tests/fixtures/session-sample.jsonl', join(projDir, 'sess-1.jsonl'));
  const db = openDb(join(dir, 'usage.db'));
  return {
    db, projectsRoot, projDir,
    cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); }
  };
}

describe('scanAll', () => {
  it('full scan creates project, session, messages', () => {
    const { db, projectsRoot, cleanup } = setup();
    try {
      const result = scanAll(db, projectsRoot);
      expect(result.scannedFiles).toBe(1);
      expect(result.newMessages).toBe(3);
      const sessions = db.prepare('SELECT * FROM sessions').all() as any[];
      expect(sessions).toHaveLength(1);
      expect(sessions[0].message_count).toBe(3);
      const projects = db.prepare('SELECT * FROM projects').all() as any[];
      expect(projects).toHaveLength(1);
      expect(projects[0].real_path).toBe('D:/test/proj');
    } finally { cleanup(); }
  });

  it('incremental scan reads only appended bytes', () => {
    const { db, projectsRoot, projDir, cleanup } = setup();
    try {
      scanAll(db, projectsRoot);
      const before = (db.prepare('SELECT COUNT(*) as n FROM messages').get() as any).n;
      const extraLine = JSON.stringify({
        uuid: 'a-3', sessionId: 'sess-1', parentUuid: 'a-2',
        timestamp: '2026-04-20T10:00:20.000Z',
        message: {
          id: 'msg_01xyz', role: 'assistant', model: 'claude-sonnet-4-6',
          stop_reason: 'end_turn', content: [],
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }
      }) + '\n';
      appendFileSync(join(projDir, 'sess-1.jsonl'), extraLine);
      const second = scanAll(db, projectsRoot);
      expect(second.newMessages).toBe(1);
      const after = (db.prepare('SELECT COUNT(*) as n FROM messages').get() as any).n;
      expect(after).toBe(before + 1);
    } finally { cleanup(); }
  });

  it('skips file when size & mtime unchanged', () => {
    const { db, projectsRoot, cleanup } = setup();
    try {
      scanAll(db, projectsRoot);
      const second = scanAll(db, projectsRoot);
      expect(second.newMessages).toBe(0);
    } finally { cleanup(); }
  });
});
```

- [ ] **Step 3: Run，确认失败**

Run: `npm test -- tests/scanner.test.ts`

- [ ] **Step 4: 实现 scanner/index.ts**

`src/server/scanner/index.ts`:

```ts
import type { Database as DatabaseType } from 'better-sqlite3';
import { readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseJsonlLine } from './parser.js';
import { insertMessages, upsertProject, recomputeSession } from './writer.js';
import { getCursor, upsertCursor } from './cursor.js';
import { reverseProjectDirName } from '../paths.js';
import type { ParsedMessage, ScanResult } from '../../shared/types.js';

const CHUNK_SIZE = 256 * 1024;
const BATCH_SIZE = 1000;

export function scanAll(db: DatabaseType, projectsRoot: string): ScanResult {
  const start = Date.now();
  let scannedFiles = 0;
  let newMessages = 0;

  const projectDirs = readdirSync(projectsRoot, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({ dirName: d.name, fullPath: join(projectsRoot, d.name) }));

  for (const { dirName, fullPath } of projectDirs) {
    upsertProject(db, {
      projectDir: fullPath,
      displayName: dirName,
      realPath: reverseProjectDirName(dirName),
    });

    const jsonlFiles = readdirSync(fullPath, { withFileTypes: true })
      .filter(d => d.isFile() && d.name.endsWith('.jsonl'));

    for (const f of jsonlFiles) {
      const filePath = join(fullPath, f.name);
      const sessionId = basename(f.name, '.jsonl');
      const added = scanOne(db, filePath, fullPath, sessionId);
      if (added > 0) {
        recomputeSession(db, sessionId);
        newMessages += added;
      }
      scannedFiles++;
    }
  }

  return { scannedFiles, newMessages, durationMs: Date.now() - start };
}

function scanOne(
  db: DatabaseType,
  filePath: string,
  projectDir: string,
  sessionId: string,
): number {
  const stat = statSync(filePath);
  const prev = getCursor(db, filePath);
  if (prev && prev.sizeBytes === stat.size && prev.mtimeMs === stat.mtimeMs) {
    return 0;
  }
  const startOffset = prev && stat.size >= prev.sizeBytes ? prev.lastOffset : 0;
  const { messages, endOffset } = readFromOffset(filePath, startOffset, sessionId);

  let inserted = 0;
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    inserted += insertMessages(db, projectDir, sessionId, messages.slice(i, i + BATCH_SIZE));
  }

  upsertCursor(db, {
    filePath, projectDir,
    sizeBytes: stat.size, mtimeMs: stat.mtimeMs,
    lastOffset: endOffset,
    lastScannedAt: Date.now(),
  });
  return inserted;
}

function readFromOffset(
  filePath: string,
  startOffset: number,
  sessionId: string,
): { messages: ParsedMessage[]; endOffset: number } {
  const fd = openSync(filePath, 'r');
  const messages: ParsedMessage[] = [];
  let offset = startOffset;
  let lastCompleteEnd = startOffset;
  let buffer = '';
  const chunk = Buffer.alloc(CHUNK_SIZE);

  try {
    while (true) {
      const bytes = readSync(fd, chunk, 0, CHUNK_SIZE, offset);
      if (bytes <= 0) break;
      buffer += chunk.subarray(0, bytes).toString('utf8');
      offset += bytes;

      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim().length === 0) {
          lastCompleteEnd += nl + 1;
          continue;
        }
        const parsed = parseJsonlLine(line, sessionId);
        if (parsed) messages.push(parsed);
        lastCompleteEnd += nl + 1;
      }
    }
  } finally {
    closeSync(fd);
  }
  return { messages, endOffset: lastCompleteEnd };
}
```

- [ ] **Step 5: Run，确认通过**

Run: `npm test -- tests/scanner.test.ts`
Expected: 3 passed

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: 扫描编排（全量 + 增量 + 半截行容错）"
```

---

### Task 10: CLI 骨架 + `ccu scan`

**Files:**
- Create: `src/server/cli.ts`

- [ ] **Step 1: 实现 cli.ts**

`src/server/cli.ts`:

```ts
#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { openDb } from './db.js';
import { scanAll } from './scanner/index.js';

const CLAUDE_PROJECTS = join(homedir(), '.claude', 'projects');
const DB_PATH = join(homedir(), '.cc-usage', 'usage.db');

const program = new Command();
program.name('ccu').description('Claude Code usage dashboard').version('0.1.0');

program.command('scan')
  .description('Scan ~/.claude/projects/ and index messages into SQLite')
  .action(async () => {
    if (!existsSync(CLAUDE_PROJECTS)) {
      console.error(chalk.red(`Not found: ${CLAUDE_PROJECTS}`));
      process.exit(1);
    }
    const db = openDb(DB_PATH);
    const t0 = Date.now();
    const r = scanAll(db, CLAUDE_PROJECTS);
    const total = (db.prepare('SELECT COUNT(*) as n FROM messages').get() as any).n;
    console.log(chalk.green(
      `Scanned ${r.scannedFiles} files, +${r.newMessages} messages in ${Date.now() - t0}ms. Total: ${total}`
    ));
    db.close();
  });

program.parseAsync();
```

- [ ] **Step 2: 跑一次真实扫描**

Run: `npm run scan`
Expected (示例)：
```
Scanned 47 files, +12345 messages in 3521ms. Total: 12345
```

- [ ] **Step 3: 手动抽查 DB**

Run:
```bash
npx better-sqlite3-cli ~/.cc-usage/usage.db "SELECT display_name, real_path FROM projects ORDER BY last_seen_at DESC LIMIT 5"
```
或者直接在 Node REPL 里 `openDb` 查 `SELECT COUNT(*) FROM messages`。

Expected：能看到本机项目列表，message 数量 > 0。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: CLI 骨架与 ccu scan 子命令"
```

**M1 完成标志**：`npm run scan` 能把本机 ~/.claude/projects/ 索引到 SQLite，再跑一次是增量零成本。

---

## M2 · API + 最小前端（Overview）

### Task 11: Fastify app + health/admin 路由

**Files:**
- Create: `src/server/app.ts`
- Create: `src/server/routes/admin.ts`
- Test: `tests/routes-admin.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/routes-admin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { openDb } from '../src/server/db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-app-'));
  const db = openDb(join(dir, 'usage.db'));
  const app = buildApp({ db, projectsRoot: 'tests/fixtures/projects' });
  return { app, cleanup: async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('admin routes', () => {
  it('GET /api/health returns ok', async () => {
    const { app, cleanup } = makeApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true });
    } finally { await cleanup(); }
  });

  it('POST /api/scan triggers a scan', async () => {
    const { app, cleanup } = makeApp();
    try {
      const res = await app.inject({ method: 'POST', url: '/api/scan' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty('scannedFiles');
    } finally { await cleanup(); }
  });
});
```

- [ ] **Step 2: Run，确认失败**

Run: `npm test -- tests/routes-admin.test.ts`

- [ ] **Step 3: 实现 admin.ts**

`src/server/routes/admin.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';
import { scanAll } from '../scanner/index.js';
import { computeCostUsd } from '../pricing.js';
import { recomputeSession } from '../scanner/writer.js';

export interface AdminDeps {
  db: DatabaseType;
  projectsRoot: string;
}

export async function registerAdmin(app: FastifyInstance, deps: AdminDeps) {
  app.get('/api/health', async () => {
    const lastScanAt = (deps.db.prepare(
      'SELECT MAX(last_scanned_at) as t FROM scan_cursor'
    ).get() as any).t ?? null;
    return { ok: true, lastScanAt };
  });

  app.post('/api/scan', async () => scanAll(deps.db, deps.projectsRoot));

  app.post('/api/recompute-cost', async () => {
    const rows = deps.db.prepare(
      `SELECT message_id, model, input_tokens, output_tokens,
              cache_creation_tokens, cache_read_tokens
       FROM messages WHERE model IS NOT NULL`
    ).all() as any[];
    const stmt = deps.db.prepare('UPDATE messages SET cost_usd = ? WHERE message_id = ?');
    const tx = deps.db.transaction(() => {
      for (const r of rows) {
        const cost = computeCostUsd(r.model, {
          inputTokens: r.input_tokens,
          outputTokens: r.output_tokens,
          cacheCreationTokens: r.cache_creation_tokens,
          cacheReadTokens: r.cache_read_tokens,
        });
        stmt.run(cost, r.message_id);
      }
    });
    tx();
    const sids = deps.db.prepare('SELECT session_id FROM sessions').all() as any[];
    for (const { session_id } of sids) recomputeSession(deps.db, session_id);
    const total = (deps.db.prepare(
      'SELECT COALESCE(SUM(total_cost_usd),0) as t FROM sessions'
    ).get() as any).t;
    return { updatedSessions: sids.length, totalCostUsd: total };
  });
}
```

- [ ] **Step 4: 实现 app.ts**

`src/server/app.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';
import { registerAdmin } from './routes/admin.js';

export interface AppDeps {
  db: DatabaseType;
  projectsRoot: string;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  registerAdmin(app, deps);
  return app;
}
```

- [ ] **Step 5: Run 测试**

Run: `npm test -- tests/routes-admin.test.ts`
Expected: 2 passed

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: Fastify app + admin 路由（health/scan/recompute）"
```

---

### Task 12: Overview API

**Files:**
- Create: `src/server/routes/overview.ts`
- Modify: `src/server/app.ts`
- Test: `tests/routes-overview.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/routes-overview.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { openDb } from '../src/server/db.js';
import { scanAll } from '../src/server/scanner/index.js';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function seeded() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-ov-'));
  const projectsRoot = join(dir, 'projects');
  const proj = join(projectsRoot, 'D--test-proj');
  mkdirSync(proj, { recursive: true });
  copyFileSync('tests/fixtures/session-sample.jsonl', join(proj, 'sess-1.jsonl'));
  const db = openDb(join(dir, 'usage.db'));
  scanAll(db, projectsRoot);
  const app = buildApp({ db, projectsRoot });
  return { app, cleanup: async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('/api/overview', () => {
  it('returns totals and byModel', async () => {
    const { app, cleanup } = seeded();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/overview?range=all' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totals.messageCount).toBeGreaterThan(0);
      expect(body.totals.sessionCount).toBe(1);
      expect(body.byModel.length).toBeGreaterThan(0);
      expect(body.byProject.length).toBe(1);
      expect(typeof body.cacheHitRate).toBe('number');
    } finally { await cleanup(); }
  });
});
```

- [ ] **Step 2: Run，确认失败**

Run: `npm test -- tests/routes-overview.test.ts`

- [ ] **Step 3: 实现 overview.ts**

`src/server/routes/overview.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { OverviewResponse, RangeKey } from '../../shared/types.js';

export function registerOverview(app: FastifyInstance, db: DatabaseType) {
  app.get('/api/overview', async (req) => {
    const q = req.query as { range?: RangeKey };
    const range = resolveRange(q.range ?? 'all');
    return computeOverview(db, range);
  });
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

function computeOverview(db: DatabaseType, r: { from: number; to: number }): OverviewResponse {
  const totals = db.prepare(
    `SELECT COALESCE(SUM(input_tokens),0) as i,
            COALESCE(SUM(output_tokens),0) as o,
            COALESCE(SUM(cache_creation_tokens),0) as cc,
            COALESCE(SUM(cache_read_tokens),0) as cr,
            COALESCE(SUM(cost_usd),0) as cost,
            COUNT(*) as mc,
            COUNT(DISTINCT session_id) as sc
     FROM messages WHERE timestamp BETWEEN ? AND ?`
  ).get(r.from, r.to) as any;

  const byModel = (db.prepare(
    `SELECT model,
            COALESCE(SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens),0) as tokens,
            COALESCE(SUM(cost_usd),0) as costUsd
     FROM messages
     WHERE model IS NOT NULL AND timestamp BETWEEN ? AND ?
     GROUP BY model ORDER BY tokens DESC`
  ).all(r.from, r.to) as any[]);
  const totalTokens = byModel.reduce((a, x) => a + x.tokens, 0) || 1;
  const byModelOut = byModel.map(m => ({
    model: m.model, tokens: m.tokens, costUsd: m.costUsd, share: m.tokens / totalTokens
  }));

  const byProject = (db.prepare(
    `SELECT m.session_id, s.project_dir, p.display_name as displayName,
            SUM(m.input_tokens + m.output_tokens + m.cache_creation_tokens + m.cache_read_tokens) as tokens,
            SUM(m.cost_usd) as costUsd
     FROM messages m
     JOIN sessions s ON s.session_id = m.session_id
     JOIN projects p ON p.project_dir = s.project_dir
     WHERE m.timestamp BETWEEN ? AND ?
     GROUP BY s.project_dir
     ORDER BY tokens DESC LIMIT 10`
  ).all(r.from, r.to) as any[]).map(x => ({
    projectDir: x.project_dir, displayName: x.displayName,
    tokens: x.tokens, costUsd: x.costUsd,
    share: x.tokens / totalTokens,
  }));

  const dailyRaw = db.prepare(
    `SELECT date(timestamp/1000,'unixepoch') as d, model,
            SUM(input_tokens) as i, SUM(output_tokens) as o,
            SUM(cost_usd) as cost,
            SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens) as tot
     FROM messages WHERE timestamp BETWEEN ? AND ?
     GROUP BY d, model ORDER BY d`
  ).all(r.from, r.to) as any[];
  const dailyMap = new Map<string, any>();
  for (const row of dailyRaw) {
    let b = dailyMap.get(row.d);
    if (!b) {
      b = { date: row.d, inputTokens: 0, outputTokens: 0, costUsd: 0, byModel: {} as Record<string, number> };
      dailyMap.set(row.d, b);
    }
    b.inputTokens += row.i;
    b.outputTokens += row.o;
    b.costUsd += row.cost;
    b.byModel[row.model ?? 'unknown'] = (b.byModel[row.model ?? 'unknown'] ?? 0) + row.tot;
  }
  const dailyTrend = [...dailyMap.values()];

  const cacheDenominator = totals.i + totals.cc + totals.cr;
  const cacheHitRate = cacheDenominator > 0 ? totals.cr / cacheDenominator : 0;

  return {
    range: { from: new Date(r.from).toISOString(), to: new Date(r.to).toISOString() },
    totals: {
      inputTokens: totals.i, outputTokens: totals.o,
      cacheCreate: totals.cc, cacheRead: totals.cr,
      costUsd: totals.cost, messageCount: totals.mc, sessionCount: totals.sc,
    },
    byModel: byModelOut,
    byProject,
    dailyTrend,
    cacheHitRate,
  };
}
```

- [ ] **Step 4: 挂到 app.ts**

Modify `src/server/app.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';
import { registerAdmin } from './routes/admin.js';
import { registerOverview } from './routes/overview.js';

export interface AppDeps {
  db: DatabaseType;
  projectsRoot: string;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  registerAdmin(app, deps);
  registerOverview(app, deps.db);
  return app;
}
```

- [ ] **Step 5: Run 测试**

Run: `npm test -- tests/routes-overview.test.ts`
Expected: passed

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: /api/overview 概览聚合接口"
```

---

### Task 13: `ccu start` 命令 + 自动开浏览器

**Files:**
- Modify: `src/server/cli.ts`

- [ ] **Step 1: 扩展 cli.ts**

完整替换 `src/server/cli.ts`:

```ts
#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import open from 'open';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { openDb } from './db.js';
import { scanAll } from './scanner/index.js';
import { buildApp } from './app.js';

const CLAUDE_PROJECTS = join(homedir(), '.claude', 'projects');
const DB_PATH = join(homedir(), '.cc-usage', 'usage.db');

const program = new Command();
program.name('ccu').description('Claude Code usage dashboard').version('0.1.0');

program.command('scan').action(async () => {
  if (!existsSync(CLAUDE_PROJECTS)) {
    console.error(chalk.red(`Not found: ${CLAUDE_PROJECTS}`));
    process.exit(1);
  }
  const db = openDb(DB_PATH);
  const t0 = Date.now();
  const r = scanAll(db, CLAUDE_PROJECTS);
  console.log(chalk.green(
    `Scanned ${r.scannedFiles} files, +${r.newMessages} messages in ${Date.now() - t0}ms`
  ));
  db.close();
});

program.command('start')
  .option('-p, --port <port>', 'HTTP port', '5173')
  .option('--no-open', 'Do not auto-open browser')
  .option('--dev', 'Dev mode (no static serve)')
  .action(async (opts) => {
    const db = openDb(DB_PATH);
    if (existsSync(CLAUDE_PROJECTS)) {
      console.log(chalk.gray('Scanning…'));
      const r = scanAll(db, CLAUDE_PROJECTS);
      console.log(chalk.gray(`  ${r.scannedFiles} files, +${r.newMessages} messages`));
    }
    const app = buildApp({ db, projectsRoot: CLAUDE_PROJECTS });
    const port = await listenWithRetry(app, Number(opts.port));
    const url = `http://localhost:${port}`;
    console.log(chalk.green(`✓ cc-usage-dashboard on ${url}`));
    if (opts.open !== false) open(url).catch(() => {});
  });

program.command('recompute-cost').action(async () => {
  const db = openDb(DB_PATH);
  const app = buildApp({ db, projectsRoot: CLAUDE_PROJECTS });
  const res = await app.inject({ method: 'POST', url: '/api/recompute-cost' });
  console.log(chalk.green(`✓ ${res.body}`));
  await app.close();
  db.close();
});

async function listenWithRetry(app: any, desiredPort: number): Promise<number> {
  let port = desiredPort;
  for (let i = 0; i < 20; i++) {
    try {
      await app.listen({ port, host: '127.0.0.1' });
      return port;
    } catch (e: any) {
      if (e.code !== 'EADDRINUSE') throw e;
      port++;
    }
  }
  throw new Error(`Cannot find free port in range ${desiredPort}..${desiredPort + 20}`);
}

program.parseAsync();
```

- [ ] **Step 2: 本地跑一次**

Run: `npx tsx src/server/cli.ts start --no-open`
Expected (stderr 里看到)：`✓ cc-usage-dashboard on http://localhost:5173`

另一个终端：
```bash
curl http://localhost:5173/api/health
curl "http://localhost:5173/api/overview?range=all"
```
Expected: JSON 响应。

停掉服务（Ctrl+C）。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: ccu start 启动服务 + 自动开浏览器 + 端口重试"
```

---

### Task 14: Vite + React 脚手架

**Files:**
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `src/web/main.tsx`
- Create: `src/web/App.tsx`
- Create: `src/web/routes.tsx`
- Create: `src/web/store.ts`
- Create: `src/web/api/client.ts`

- [ ] **Step 1: 写 vite.config.ts**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: '.',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { '/api': 'http://localhost:5173' },
  },
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
  },
});
```

- [ ] **Step 2: 写 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CC Usage Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/web/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: 写 main.tsx**

`src/web/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App.js';

const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 30_000 } } });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ConfigProvider>
  </React.StrictMode>
);
```

- [ ] **Step 4: 写 App.tsx**

`src/web/App.tsx`:

```tsx
import { Layout, Menu, Button } from 'antd';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import AppRoutes from './routes.js';
import { api } from './api/client.js';

export default function App() {
  const loc = useLocation();
  const qc = useQueryClient();
  const scan = useMutation({
    mutationFn: () => api.post('/api/scan'),
    onSuccess: () => qc.invalidateQueries(),
  });

  const menu = [
    { key: '/overview', label: <Link to="/overview">概览</Link> },
    { key: '/projects', label: <Link to="/projects">项目</Link> },
    { key: '/sessions', label: <Link to="/sessions">会话</Link> },
    { key: '/cost',     label: <Link to="/cost">成本</Link> },
  ];
  const selected = menu.find(m => loc.pathname.startsWith(m.key))?.key ?? '/overview';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider width={180}>
        <div style={{ color: 'white', padding: 16, fontWeight: 600 }}>CC Usage</div>
        <Menu theme="dark" mode="inline" selectedKeys={[selected]} items={menu} />
      </Layout.Sider>
      <Layout>
        <Layout.Header style={{ background: '#fff', padding: '0 16px', display: 'flex', justifyContent: 'flex-end' }}>
          <Button loading={scan.isPending} onClick={() => scan.mutate()}>刷新数据</Button>
        </Layout.Header>
        <Layout.Content style={{ padding: 24, background: '#f5f5f5' }}>
          <AppRoutes />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
```

- [ ] **Step 5: 写 routes.tsx**

`src/web/routes.tsx`:

```tsx
import { Navigate, Route, Routes } from 'react-router-dom';
import Overview from './pages/Overview/index.js';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/overview" replace />} />
      <Route path="/overview" element={<Overview />} />
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}
```

- [ ] **Step 6: 写 api/client.ts**

`src/web/api/client.ts`:

```ts
async function request<T>(method: string, url: string): Promise<T> {
  const res = await fetch(url, { method });
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`);
  return res.json();
}
export const api = {
  get:  <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string) => request<T>('POST', url),
};
```

- [ ] **Step 7: 写 store.ts（空壳，后面用）**

`src/web/store.ts`:

```ts
import { create } from 'zustand';
import type { RangeKey } from '../shared/types.js';

interface StoreState {
  range: RangeKey;
  setRange: (r: RangeKey) => void;
}

export const useStore = create<StoreState>((set) => ({
  range: 'month',
  setRange: (range) => set({ range }),
}));
```

- [ ] **Step 8: 建一个占位 Overview 页**

`src/web/pages/Overview/index.tsx`:

```tsx
export default function Overview() {
  return <div>Overview (placeholder)</div>;
}
```

- [ ] **Step 9: 跑起来**

Run (两个终端):
- T1: `npx tsx src/server/cli.ts start --dev --no-open`
- T2: `npm run dev:web`

浏览器打开 `http://localhost:5174/overview`
Expected: 左侧菜单显示"概览/项目/会话/成本"，主内容 "Overview (placeholder)"。

停掉。

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: Vite + React + AntD 脚手架与路由骨架"
```

---

### Task 15: Overview 页实现

**Files:**
- Modify: `src/web/pages/Overview/index.tsx`
- Create: `src/web/components/KpiCard.tsx`
- Create: `src/web/components/RangePicker.tsx`
- Create: `src/web/components/ModelStackedArea.tsx`
- Create: `src/web/components/TopBarChart.tsx`
- Create: `src/web/hooks/useOverview.ts`

- [ ] **Step 1: useOverview hook**

`src/web/hooks/useOverview.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import type { OverviewResponse, RangeKey } from '../../shared/types.js';

export function useOverview(range: RangeKey) {
  return useQuery({
    queryKey: ['overview', range],
    queryFn: () => api.get<OverviewResponse>(`/api/overview?range=${range}`),
  });
}
```

- [ ] **Step 2: KpiCard**

`src/web/components/KpiCard.tsx`:

```tsx
import { Card, Statistic } from 'antd';

export default function KpiCard({ title, value, suffix, precision = 0 }:
  { title: string; value: number; suffix?: string; precision?: number }) {
  return (
    <Card>
      <Statistic title={title} value={value} suffix={suffix} precision={precision} />
    </Card>
  );
}
```

- [ ] **Step 3: RangePicker**

`src/web/components/RangePicker.tsx`:

```tsx
import { Segmented } from 'antd';
import type { RangeKey } from '../../shared/types.js';

const OPTIONS: { label: string; value: RangeKey }[] = [
  { label: '今天', value: 'today' },
  { label: '本周', value: 'week' },
  { label: '本月', value: 'month' },
  { label: 'YTD', value: 'ytd' },
  { label: '全部', value: 'all' },
];

export default function RangePicker({ value, onChange }: { value: RangeKey; onChange: (v: RangeKey) => void }) {
  return <Segmented options={OPTIONS} value={value} onChange={(v) => onChange(v as RangeKey)} />;
}
```

- [ ] **Step 4: ModelStackedArea**

`src/web/components/ModelStackedArea.tsx`:

```tsx
import ReactECharts from 'echarts-for-react';
import type { OverviewResponse } from '../../shared/types.js';

export default function ModelStackedArea({ dailyTrend }: { dailyTrend: OverviewResponse['dailyTrend'] }) {
  const dates = dailyTrend.map(d => d.date);
  const models = new Set<string>();
  dailyTrend.forEach(d => Object.keys(d.byModel).forEach(m => models.add(m)));
  const series = [...models].map(model => ({
    name: model,
    type: 'line',
    stack: 'all',
    areaStyle: {},
    data: dailyTrend.map(d => d.byModel[model] ?? 0),
  }));

  return (
    <ReactECharts
      style={{ height: 320 }}
      option={{
        tooltip: { trigger: 'axis' },
        legend: { top: 'bottom' },
        grid: { left: 40, right: 20, top: 20, bottom: 60 },
        xAxis: { type: 'category', data: dates },
        yAxis: { type: 'value', name: 'tokens' },
        series,
      }}
    />
  );
}
```

- [ ] **Step 5: TopBarChart**

`src/web/components/TopBarChart.tsx`:

```tsx
import ReactECharts from 'echarts-for-react';

export default function TopBarChart({ title, items }: {
  title: string;
  items: { label: string; value: number }[];
}) {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  return (
    <ReactECharts
      style={{ height: 320 }}
      option={{
        title: { text: title, textStyle: { fontSize: 14 } },
        tooltip: {},
        grid: { left: 120, right: 20, top: 40, bottom: 30 },
        xAxis: { type: 'value' },
        yAxis: { type: 'category', data: sorted.map(i => i.label).reverse() },
        series: [{ type: 'bar', data: sorted.map(i => i.value).reverse() }],
      }}
    />
  );
}
```

- [ ] **Step 6: Overview 页主体**

完整覆盖 `src/web/pages/Overview/index.tsx`:

```tsx
import { Row, Col, Card, Empty, Spin } from 'antd';
import { useOverview } from '../../hooks/useOverview.js';
import { useStore } from '../../store.js';
import KpiCard from '../../components/KpiCard.js';
import RangePicker from '../../components/RangePicker.js';
import ModelStackedArea from '../../components/ModelStackedArea.js';
import TopBarChart from '../../components/TopBarChart.js';

export default function Overview() {
  const { range, setRange } = useStore();
  const { data, isLoading } = useOverview(range);

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <RangePicker value={range} onChange={setRange} />
      </div>
      {isLoading && <Spin />}
      {data && data.totals.messageCount === 0 && (
        <Empty description="暂无数据，请点右上角「刷新数据」或运行 `ccu scan`" />
      )}
      {data && data.totals.messageCount > 0 && (
        <>
          <Row gutter={16}>
            <Col span={6}><KpiCard title="总 Token" value={
              data.totals.inputTokens + data.totals.outputTokens + data.totals.cacheCreate + data.totals.cacheRead
            } /></Col>
            <Col span={6}><KpiCard title="总成本 ($)" value={data.totals.costUsd} precision={2} /></Col>
            <Col span={6}><KpiCard title="会话数" value={data.totals.sessionCount} /></Col>
            <Col span={6}><KpiCard title="缓存命中率" value={data.cacheHitRate * 100} precision={1} suffix="%" /></Col>
          </Row>
          <Card title="按模型 · token 趋势" style={{ marginTop: 16 }}>
            <ModelStackedArea dailyTrend={data.dailyTrend} />
          </Card>
          <Row gutter={16} style={{ marginTop: 16 }}>
            <Col span={12}>
              <Card>
                <TopBarChart
                  title="按项目 · token Top 10"
                  items={data.byProject.map(p => ({ label: p.displayName, value: p.tokens }))}
                />
              </Card>
            </Col>
            <Col span={12}>
              <Card>
                <TopBarChart
                  title="按模型 · token"
                  items={data.byModel.map(m => ({ label: m.model, value: m.tokens }))}
                />
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 7: 本地验证**

两个终端（同上）。浏览器 `http://localhost:5174/overview`。
Expected：能看到 KPI、趋势图、两个条形图。点右上"刷新数据"，loading 后数据更新。

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: Overview 页 · KPI/趋势/项目&模型 Top10"
```

**M2 完成标志**：浏览器访问 localhost:5174/overview 能看到完整 Overview 页与真实数据。

---

## M3 · Projects + Sessions + Cost

### Task 16: Projects API

**Files:**
- Create: `src/server/routes/projects.ts`
- Modify: `src/server/app.ts`
- Test: `tests/routes-projects.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/routes-projects.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { openDb } from '../src/server/db.js';
import { scanAll } from '../src/server/scanner/index.js';
import { encodeProjectDir } from '../src/server/paths.js';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function seeded() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-proj-'));
  const projectsRoot = join(dir, 'projects');
  const proj = join(projectsRoot, 'D--test-proj');
  mkdirSync(proj, { recursive: true });
  copyFileSync('tests/fixtures/session-sample.jsonl', join(proj, 'sess-1.jsonl'));
  const db = openDb(join(dir, 'usage.db'));
  scanAll(db, projectsRoot);
  const app = buildApp({ db, projectsRoot });
  return { app, proj, cleanup: async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('/api/projects', () => {
  it('lists projects sorted by cost desc', async () => {
    const { app, cleanup } = seeded();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/projects?sortBy=cost' });
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body[0].sessionCount).toBe(1);
    } finally { await cleanup(); }
  });

  it('returns timeline for a project', async () => {
    const { app, proj, cleanup } = seeded();
    try {
      const b64 = encodeProjectDir(proj);
      const res = await app.inject({ method: 'GET', url: `/api/projects/${b64}/timeline?range=all` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('daily');
      expect(body).toHaveProperty('topSessions');
    } finally { await cleanup(); }
  });
});
```

- [ ] **Step 2: Run，确认失败**

Run: `npm test -- tests/routes-projects.test.ts`

- [ ] **Step 3: 实现 projects.ts**

`src/server/routes/projects.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';
import { decodeProjectDir } from '../paths.js';
import type { ProjectRow } from '../../shared/types.js';

export function registerProjects(app: FastifyInstance, db: DatabaseType) {
  app.get('/api/projects', async (req) => {
    const q = req.query as { sortBy?: 'cost' | 'tokens' | 'sessions'; order?: 'asc' | 'desc' };
    const sortBy = q.sortBy ?? 'cost';
    const order = q.order === 'asc' ? 'ASC' : 'DESC';
    const sortCol = {
      cost: 'total_cost_usd',
      tokens: 'total_tokens',
      sessions: 'session_count',
    }[sortBy];
    const rows = db.prepare(
      `SELECT p.project_dir as projectDir, p.display_name as displayName, p.real_path as realPath,
              COUNT(s.session_id) as session_count,
              COALESCE(SUM(s.total_input + s.total_output + s.total_cache_create + s.total_cache_read),0) as total_tokens,
              COALESCE(SUM(s.total_cost_usd),0) as total_cost_usd,
              p.first_seen_at as firstSeenAt, p.last_seen_at as lastSeenAt
       FROM projects p
       LEFT JOIN sessions s ON s.project_dir = p.project_dir
       GROUP BY p.project_dir
       ORDER BY ${sortCol} ${order}`
    ).all() as any[];
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
    const projectDir = decodeProjectDir(b64);
    const daily = db.prepare(
      `SELECT date(m.timestamp/1000,'unixepoch') as date,
              SUM(m.input_tokens + m.output_tokens + m.cache_creation_tokens + m.cache_read_tokens) as tokens,
              SUM(m.cost_usd) as costUsd,
              COUNT(DISTINCT m.session_id) as sessionCount
       FROM messages m
       JOIN sessions s ON s.session_id = m.session_id
       WHERE s.project_dir = ?
       GROUP BY date ORDER BY date`
    ).all(projectDir);
    const topSessions = db.prepare(
      `SELECT session_id as sessionId, total_cost_usd as totalCostUsd,
              total_input + total_output + total_cache_create + total_cache_read as totalTokens,
              message_count as messageCount, started_at as startedAt, ended_at as endedAt
       FROM sessions WHERE project_dir = ?
       ORDER BY total_cost_usd DESC LIMIT 20`
    ).all(projectDir);
    return { daily, topSessions };
  });
}
```

- [ ] **Step 4: 挂到 app.ts**

在 `src/server/app.ts` 的 `buildApp` 里加：
```ts
import { registerProjects } from './routes/projects.js';
// ...
  registerProjects(app, deps.db);
```

- [ ] **Step 5: Run 测试**

Run: `npm test -- tests/routes-projects.test.ts`
Expected: 2 passed

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: /api/projects 列表与 timeline"
```

---

### Task 17: Projects 前端页

**Files:**
- Create: `src/web/pages/Projects/List.tsx`
- Create: `src/web/pages/Projects/Detail.tsx`
- Modify: `src/web/routes.tsx`

- [ ] **Step 1: List.tsx**

```tsx
import { useQuery } from '@tanstack/react-query';
import { Table } from 'antd';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import type { ProjectRow } from '../../../shared/types.js';

function b64(p: string) { return btoa(p).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

export default function ProjectsList() {
  const { data, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRow[]>('/api/projects?sortBy=cost'),
  });
  return (
    <Table
      loading={isLoading}
      rowKey="projectDir"
      dataSource={data ?? []}
      columns={[
        { title: '项目', dataIndex: 'displayName',
          render: (_, r) => <Link to={`/projects/${b64(r.projectDir)}`}>{r.displayName}</Link> },
        { title: '真实路径', dataIndex: 'realPath' },
        { title: '会话数', dataIndex: 'sessionCount' },
        { title: 'Token', dataIndex: 'totalTokens', render: (v) => v.toLocaleString() },
        { title: '成本 ($)', dataIndex: 'totalCostUsd', render: (v: number) => v.toFixed(2) },
        { title: '平均/会话', dataIndex: 'avgTokensPerSession', render: (v: number) => Math.round(v).toLocaleString() },
        { title: '最近活跃', dataIndex: 'lastSeenAt', render: (v: number) => new Date(v).toLocaleString() },
      ]}
    />
  );
}
```

- [ ] **Step 2: Detail.tsx**

```tsx
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, Table, Descriptions } from 'antd';
import ReactECharts from 'echarts-for-react';
import { api } from '../../api/client.js';

interface Timeline {
  daily: Array<{ date: string; tokens: number; costUsd: number; sessionCount: number }>;
  topSessions: Array<{ sessionId: string; totalCostUsd: number; totalTokens: number; messageCount: number; startedAt: number; endedAt: number }>;
}

export default function ProjectDetail() {
  const { b64 } = useParams<{ b64: string }>();
  const { data } = useQuery({
    queryKey: ['projectTimeline', b64],
    queryFn: () => api.get<Timeline>(`/api/projects/${b64}/timeline?range=all`),
  });
  return (
    <>
      <Card title="每日 token 与成本" style={{ marginBottom: 16 }}>
        <ReactECharts
          style={{ height: 320 }}
          option={{
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: data?.daily.map(d => d.date) ?? [] },
            yAxis: [{ type: 'value', name: 'tokens' }, { type: 'value', name: '$' }],
            series: [
              { name: 'tokens', type: 'bar', data: data?.daily.map(d => d.tokens) ?? [] },
              { name: '$', type: 'line', yAxisIndex: 1, data: data?.daily.map(d => d.costUsd) ?? [] },
            ],
            legend: { top: 'bottom' },
          }}
        />
      </Card>
      <Card title="Top 20 会话（按成本）">
        <Table
          rowKey="sessionId"
          dataSource={data?.topSessions ?? []}
          pagination={{ pageSize: 20 }}
          columns={[
            { title: '会话', dataIndex: 'sessionId',
              render: (sid) => <Link to={`/sessions/${sid}`}>{sid.slice(0, 8)}…</Link> },
            { title: '开始时间', dataIndex: 'startedAt', render: (v) => new Date(v).toLocaleString() },
            { title: '消息数', dataIndex: 'messageCount' },
            { title: 'Token', dataIndex: 'totalTokens', render: (v: number) => v.toLocaleString() },
            { title: '成本 ($)', dataIndex: 'totalCostUsd', render: (v: number) => v.toFixed(4) },
          ]}
        />
      </Card>
    </>
  );
}
```

- [ ] **Step 3: 挂路由**

Modify `src/web/routes.tsx`:

```tsx
import { Navigate, Route, Routes } from 'react-router-dom';
import Overview from './pages/Overview/index.js';
import ProjectsList from './pages/Projects/List.js';
import ProjectDetail from './pages/Projects/Detail.js';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/overview" replace />} />
      <Route path="/overview" element={<Overview />} />
      <Route path="/projects" element={<ProjectsList />} />
      <Route path="/projects/:b64" element={<ProjectDetail />} />
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}
```

- [ ] **Step 4: 浏览器验证**

点左侧"项目"，列表显示；点一个项目 → 详情页显示柱状图+折线+Top 会话表。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: Projects 列表与详情页（时间线 + Top 会话）"
```

---

### Task 18: Sessions API

**Files:**
- Create: `src/server/routes/sessions.ts`
- Modify: `src/server/app.ts`
- Test: `tests/routes-sessions.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/routes-sessions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { openDb } from '../src/server/db.js';
import { scanAll } from '../src/server/scanner/index.js';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function seeded() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-sess-'));
  const projectsRoot = join(dir, 'projects');
  const proj = join(projectsRoot, 'D--test-proj');
  mkdirSync(proj, { recursive: true });
  copyFileSync('tests/fixtures/session-sample.jsonl', join(proj, 'sess-1.jsonl'));
  const db = openDb(join(dir, 'usage.db'));
  scanAll(db, projectsRoot);
  const app = buildApp({ db, projectsRoot });
  return { app, cleanup: async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('/api/sessions', () => {
  it('lists sessions with pagination', async () => {
    const { app, cleanup } = seeded();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/sessions?limit=10&offset=0' });
      const body = res.json();
      expect(body.total).toBe(1);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].topTools).toEqual(expect.arrayContaining(['Write']));
    } finally { await cleanup(); }
  });

  it('returns session detail with messages and toolDistribution', async () => {
    const { app, cleanup } = seeded();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/sessions/sess-1' });
      const body = res.json();
      expect(body.session.sessionId).toBe('sess-1');
      expect(body.messages.length).toBeGreaterThan(0);
      expect(body.toolDistribution.length).toBeGreaterThan(0);
    } finally { await cleanup(); }
  });
});
```

- [ ] **Step 2: Run，确认失败**

- [ ] **Step 3: 实现 sessions.ts**

`src/server/routes/sessions.ts`:

```ts
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
```

- [ ] **Step 4: 挂到 app.ts**

```ts
import { registerSessions } from './routes/sessions.js';
// ...
  registerSessions(app, deps.db);
```

- [ ] **Step 5: Run 测试**

Run: `npm test -- tests/routes-sessions.test.ts`
Expected: 2 passed

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: /api/sessions 列表与详情（含 topTools / toolDistribution）"
```

---

### Task 19: Sessions 前端页

**Files:**
- Create: `src/web/pages/Sessions/List.tsx`
- Create: `src/web/pages/Sessions/Detail.tsx`
- Modify: `src/web/routes.tsx`

- [ ] **Step 1: Sessions/List.tsx**

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Table, Tag } from 'antd';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';

interface SessionListRow {
  sessionId: string; projectDir: string;
  startedAt: number; endedAt: number;
  messageCount: number; totalTokens: number; totalCostUsd: number;
  topTools: string[];
}

export default function SessionsList() {
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const { data, isLoading } = useQuery({
    queryKey: ['sessions', page],
    queryFn: () => api.get<{ total: number; items: SessionListRow[] }>(
      `/api/sessions?limit=${pageSize}&offset=${(page - 1) * pageSize}`
    ),
  });
  return (
    <Table
      loading={isLoading}
      rowKey="sessionId"
      dataSource={data?.items ?? []}
      pagination={{ current: page, pageSize, total: data?.total ?? 0, onChange: setPage }}
      columns={[
        { title: '会话', dataIndex: 'sessionId',
          render: (sid: string) => <Link to={`/sessions/${sid}`}>{sid.slice(0, 8)}…</Link> },
        { title: '开始时间', dataIndex: 'startedAt', render: (v) => new Date(v).toLocaleString() },
        { title: '时长', render: (_, r) => {
            const ms = r.endedAt - r.startedAt;
            const min = Math.round(ms / 60000);
            return `${min} 分`;
          } },
        { title: '消息数', dataIndex: 'messageCount' },
        { title: 'Token', dataIndex: 'totalTokens', render: (v: number) => v.toLocaleString() },
        { title: '成本 ($)', dataIndex: 'totalCostUsd', render: (v: number) => v.toFixed(4) },
        { title: 'Top 工具', dataIndex: 'topTools',
          render: (tools: string[]) => tools.map(t => <Tag key={t}>{t}</Tag>) },
      ]}
    />
  );
}
```

- [ ] **Step 2: Sessions/Detail.tsx**

```tsx
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, Descriptions, Table, Row, Col, Tag } from 'antd';
import ReactECharts from 'echarts-for-react';
import { api } from '../../api/client.js';
import type { MessageRow } from '../../../shared/types.js';

interface Detail {
  session: { sessionId: string; projectDir: string; startedAt: number; endedAt: number; messageCount: number; totalCostUsd: number };
  messages: MessageRow[];
  toolDistribution: { tool: string; count: number; share: number }[];
}

export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { data } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api.get<Detail>(`/api/sessions/${sessionId}`),
  });
  if (!data) return null;

  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <Descriptions column={3} size="small">
          <Descriptions.Item label="Session">{data.session.sessionId}</Descriptions.Item>
          <Descriptions.Item label="开始">{new Date(data.session.startedAt).toLocaleString()}</Descriptions.Item>
          <Descriptions.Item label="成本">${data.session.totalCostUsd.toFixed(4)}</Descriptions.Item>
          <Descriptions.Item label="消息数">{data.session.messageCount}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Row gutter={16}>
        <Col span={18}>
          <Card title="消息时间线 · token 分布">
            <ReactECharts
              style={{ height: 300 }}
              option={{
                tooltip: { trigger: 'axis' },
                legend: { top: 'bottom' },
                xAxis: { type: 'category', data: data.messages.map((_, i) => i + 1), name: '第 N 条消息' },
                yAxis: { type: 'value', name: 'tokens' },
                series: [
                  { name: 'input',  type: 'bar', stack: 't', data: data.messages.map(m => m.inputTokens) },
                  { name: 'output', type: 'bar', stack: 't', data: data.messages.map(m => m.outputTokens) },
                  { name: 'cache-create', type: 'bar', stack: 't', data: data.messages.map(m => m.cacheCreate) },
                  { name: 'cache-read',   type: 'bar', stack: 't', data: data.messages.map(m => m.cacheRead) },
                ],
              }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card title="工具调用分布">
            <ReactECharts
              style={{ height: 300 }}
              option={{
                tooltip: { trigger: 'item' },
                series: [{
                  type: 'pie', radius: '70%',
                  data: data.toolDistribution.map(t => ({ name: t.tool, value: t.count })),
                }],
              }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="消息详情" style={{ marginTop: 16 }}>
        <Table
          size="small"
          rowKey="messageId"
          dataSource={data.messages}
          pagination={{ pageSize: 30 }}
          columns={[
            { title: '时间', dataIndex: 'timestamp', render: (v) => new Date(v).toLocaleTimeString() },
            { title: 'role', dataIndex: 'role' },
            { title: 'model', dataIndex: 'model' },
            { title: 'input', dataIndex: 'inputTokens' },
            { title: 'output', dataIndex: 'outputTokens' },
            { title: 'cache-rd', dataIndex: 'cacheRead' },
            { title: '$', dataIndex: 'costUsd', render: (v: number) => v.toFixed(4) },
            { title: 'tools', dataIndex: 'toolNames',
              render: (tools: string[]) => tools.map(t => <Tag key={t}>{t}</Tag>) },
            { title: 'preview', dataIndex: 'textPreview', ellipsis: true },
          ]}
        />
      </Card>
    </>
  );
}
```

- [ ] **Step 3: 挂路由**

Modify `src/web/routes.tsx`:

```tsx
import { Navigate, Route, Routes } from 'react-router-dom';
import Overview from './pages/Overview/index.js';
import ProjectsList from './pages/Projects/List.js';
import ProjectDetail from './pages/Projects/Detail.js';
import SessionsList from './pages/Sessions/List.js';
import SessionDetail from './pages/Sessions/Detail.js';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/overview" replace />} />
      <Route path="/overview" element={<Overview />} />
      <Route path="/projects" element={<ProjectsList />} />
      <Route path="/projects/:b64" element={<ProjectDetail />} />
      <Route path="/sessions" element={<SessionsList />} />
      <Route path="/sessions/:sessionId" element={<SessionDetail />} />
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}
```

- [ ] **Step 4: 浏览器验证**

点"会话" → 列表；点一条 → 详情（时间线柱状、工具饼图、消息表）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: Sessions 列表与详情（时间线 + 工具分布 + 消息表）"
```

---

### Task 20: Cost API（含异常检测）

**Files:**
- Create: `src/server/routes/cost.ts`
- Modify: `src/server/app.ts`
- Test: `tests/routes-cost.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/routes-cost.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { openDb } from '../src/server/db.js';
import { scanAll } from '../src/server/scanner/index.js';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function seeded() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-cost-'));
  const projectsRoot = join(dir, 'projects');
  const proj = join(projectsRoot, 'D--test-proj');
  mkdirSync(proj, { recursive: true });
  copyFileSync('tests/fixtures/session-sample.jsonl', join(proj, 'sess-1.jsonl'));
  const db = openDb(join(dir, 'usage.db'));
  scanAll(db, projectsRoot);
  const app = buildApp({ db, projectsRoot });
  return { app, cleanup: async () => { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('/api/cost', () => {
  it('returns daily buckets with byModel/byProject breakdown', async () => {
    const { app, cleanup } = seeded();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/cost?granularity=day&range=all' });
      const body = res.json();
      expect(Array.isArray(body.buckets)).toBe(true);
      expect(Array.isArray(body.anomalies)).toBe(true);
      expect(body.buckets[0]).toHaveProperty('bucketKey');
      expect(body.buckets[0]).toHaveProperty('costUsd');
    } finally { await cleanup(); }
  });
});
```

- [ ] **Step 2: 实现 cost.ts**

`src/server/routes/cost.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { CostResponse } from '../../shared/types.js';

export function registerCost(app: FastifyInstance, db: DatabaseType) {
  app.get('/api/cost', async (req): Promise<CostResponse> => {
    const q = req.query as { granularity?: 'day' | 'week' | 'month'; range?: string };
    const granularity = q.granularity ?? 'day';
    const bucketExpr = {
      day:   `date(m.timestamp/1000,'unixepoch')`,
      week:  `strftime('%Y-W%W', m.timestamp/1000,'unixepoch')`,
      month: `strftime('%Y-%m',  m.timestamp/1000,'unixepoch')`,
    }[granularity];

    const rows = db.prepare(
      `SELECT ${bucketExpr} as bucketKey, m.model,
              s.project_dir as projectDir, p.display_name as displayName,
              SUM(m.input_tokens + m.output_tokens + m.cache_creation_tokens + m.cache_read_tokens) as tokens,
              SUM(m.cost_usd) as costUsd
       FROM messages m
       JOIN sessions s ON s.session_id = m.session_id
       JOIN projects p ON p.project_dir = s.project_dir
       GROUP BY bucketKey, m.model, s.project_dir
       ORDER BY bucketKey`
    ).all() as any[];

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
```

- [ ] **Step 3: 挂到 app.ts**

```ts
import { registerCost } from './routes/cost.js';
// ...
  registerCost(app, deps.db);
```

- [ ] **Step 4: Run 测试**

Run: `npm test -- tests/routes-cost.test.ts`
Expected: passed

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: /api/cost 账单分桶 + z-score 异常检测"
```

---

### Task 21: Cost 前端页

**Files:**
- Create: `src/web/pages/Cost/index.tsx`
- Modify: `src/web/routes.tsx`

- [ ] **Step 1: Cost 页**

`src/web/pages/Cost/index.tsx`:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Segmented, Row, Col, Table, Button } from 'antd';
import ReactECharts from 'echarts-for-react';
import { api } from '../../api/client.js';
import type { CostResponse } from '../../../shared/types.js';

export default function Cost() {
  const [gran, setGran] = useState<'day' | 'week' | 'month'>('day');
  const { data } = useQuery({
    queryKey: ['cost', gran],
    queryFn: () => api.get<CostResponse>(`/api/cost?granularity=${gran}&range=all`),
  });

  const projects = [...new Set((data?.buckets ?? []).flatMap(b => b.byProject.map(p => p.projectDir)))];
  const series = projects.map(pd => ({
    name: pd.split(/[/\\]/).pop() ?? pd,
    type: 'bar',
    stack: 'all',
    data: (data?.buckets ?? []).map(b => b.byProject.find(p => p.projectDir === pd)?.costUsd ?? 0),
  }));

  const anomalyKeys = new Set((data?.anomalies ?? []).map(a => a.date));

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Segmented options={[
          { label: '日', value: 'day' },
          { label: '周', value: 'week' },
          { label: '月', value: 'month' },
        ]} value={gran} onChange={(v) => setGran(v as 'day' | 'week' | 'month')} />
      </div>
      <Row gutter={16}>
        <Col span={18}>
          <Card title="成本堆叠（按项目）">
            <ReactECharts
              style={{ height: 360 }}
              option={{
                tooltip: { trigger: 'axis' },
                legend: { top: 'bottom' },
                xAxis: {
                  type: 'category',
                  data: (data?.buckets ?? []).map(b => b.bucketKey),
                  axisLabel: {
                    formatter: (v: string) => anomalyKeys.has(v) ? `{red|${v}}` : v,
                    rich: { red: { color: '#ff4d4f', fontWeight: 'bold' } },
                  },
                },
                yAxis: { type: 'value', name: '$' },
                series,
              }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card title="异常日（z > 2）">
            <Table
              size="small"
              rowKey="date"
              dataSource={data?.anomalies ?? []}
              pagination={false}
              columns={[
                { title: '日期', dataIndex: 'date' },
                { title: '$', dataIndex: 'costUsd', render: (v: number) => v.toFixed(2) },
                { title: 'z', dataIndex: 'zScore', render: (v: number) => v.toFixed(2) },
              ]}
            />
          </Card>
        </Col>
      </Row>
      <Card title="账单明细" style={{ marginTop: 16 }}
            extra={<Button onClick={() => downloadCsv(data)}>导出 CSV</Button>}>
        <Table
          size="small"
          rowKey="bucketKey"
          dataSource={data?.buckets ?? []}
          pagination={{ pageSize: 30 }}
          columns={[
            { title: '周期', dataIndex: 'bucketKey' },
            { title: '$', dataIndex: 'costUsd', render: (v: number) => v.toFixed(4) },
            { title: 'tokens', dataIndex: 'tokens', render: (v: number) => v.toLocaleString() },
          ]}
        />
      </Card>
    </>
  );
}

function downloadCsv(data: CostResponse | undefined) {
  if (!data) return;
  const rows = [['bucket', 'costUsd', 'tokens'], ...data.buckets.map(b => [b.bucketKey, b.costUsd, b.tokens])];
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cc-usage-cost.csv';
  a.click();
}
```

- [ ] **Step 2: 挂路由**

Modify `src/web/routes.tsx`，在 `Route` 列表里加：

```tsx
import Cost from './pages/Cost/index.js';
// ...
      <Route path="/cost" element={<Cost />} />
```

- [ ] **Step 3: 浏览器验证**

"成本" 页：堆叠柱状图显示日成本，异常日 x 轴标签红色；右上异常表；底部明细表，"导出 CSV"下载。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: Cost 页（堆叠柱状 + 异常标红 + CSV 导出）"
```

**M3 完成标志**：四个视图全部可用，从 Overview 能点到 Projects / Sessions / Cost，钻取链路闭环。

---

## M4 · CLI 打包与全局安装

### Task 22: tsup 配置 + 静态托管

**Files:**
- Create: `tsup.config.ts`
- Create: `src/server/staticServe.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/cli.ts`

- [ ] **Step 1: 写 tsup.config.ts**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server/cli.ts'],
  format: ['esm'],
  outDir: 'dist/server',
  clean: true,
  target: 'node20',
  shims: true,
  sourcemap: true,
  noExternal: [],
  external: ['better-sqlite3'],
  async onSuccess() {
    const { cpSync, mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    mkdirSync(join('dist', 'server', 'migrations'), { recursive: true });
    cpSync('src/server/migrations', join('dist', 'server', 'migrations'), { recursive: true });
  },
});
```

- [ ] **Step 2: 写 staticServe.ts**

`src/server/staticServe.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export async function registerStatic(app: FastifyInstance, webDir: string) {
  if (!existsSync(webDir)) return;
  await app.register(fastifyStatic, { root: webDir, prefix: '/' });
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}
```

- [ ] **Step 3: 修改 app.ts**

完整替换：

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';
import { registerAdmin } from './routes/admin.js';
import { registerOverview } from './routes/overview.js';
import { registerProjects } from './routes/projects.js';
import { registerSessions } from './routes/sessions.js';
import { registerCost } from './routes/cost.js';
import { registerStatic } from './staticServe.js';

export interface AppDeps {
  db: DatabaseType;
  projectsRoot: string;
  webDir?: string;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerAdmin(app, deps);
  registerOverview(app, deps.db);
  registerProjects(app, deps.db);
  registerSessions(app, deps.db);
  registerCost(app, deps.db);
  if (deps.webDir) await registerStatic(app, deps.webDir);
  return app;
}
```

**注意**：`buildApp` 由同步改成异步，调用处需要 `await`。

- [ ] **Step 4: 修改测试文件调用**

Modify `tests/routes-admin.test.ts` 和其他测试：`const app = buildApp(...)` → `const app = await buildApp(...)`。

- [ ] **Step 5: 修改 cli.ts**

关键片段（`start` action 内）：

```ts
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));

// start action 内：
const webDir = resolve(__dirname, '../web');
const app = await buildApp({ db, projectsRoot: CLAUDE_PROJECTS, webDir });
```

（dev 模式不传 `webDir`，用 Vite proxy；prod 传 `dist/web` 路径，也就是 `dist/server/../web`）

- [ ] **Step 6: Run 所有测试**

Run: `npm test`
Expected: all passed（更新 async 后）

- [ ] **Step 7: build**

Run: `npm run build`
Expected: `dist/server/cli.js` + `dist/web/index.html` 生成

- [ ] **Step 8: 本地起 prod 模式**

Run: `node dist/server/cli.js start --no-open`

浏览器 `http://localhost:5173` — 不是通过 Vite proxy，直接由 Fastify 托管前端。Expected：所有页面正常。

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: tsup 打包 + Fastify 托管前端 + buildApp 改为 async"
```

---

### Task 23: 全局安装 + 烟囱测试

**Files:**
- 无新增

- [ ] **Step 1: 全局链接**

Run (仓库根目录):
```bash
npm link
```

- [ ] **Step 2: 在任意目录执行**

Run:
```bash
cd ~
ccu --version
ccu scan
ccu start --no-open
```

Expected: 打印版本号、扫描成功、起服务在 localhost:5173。

- [ ] **Step 3: 写 README**

`README.md`:

```markdown
# cc-usage-dashboard

本地可视化工具，监控 Claude Code 的 token 用量与成本。

## 安装

```bash
git clone <repo>
cd cc-usage-dashboard
npm install
npm run build
npm link
```

## 使用

```bash
ccu scan          # 扫描 ~/.claude/projects/ 并索引
ccu start         # 启动仪表盘（默认 localhost:5173，自动打开浏览器）
ccu start --port 6000 --no-open
ccu recompute-cost  # 按最新价格表重算所有消息成本
```

## 数据

- 索引数据库：`~/.cc-usage/usage.db`（SQLite）
- 数据来源：`~/.claude/projects/**/*.jsonl`
- 价格覆盖：若 `~/.cc-usage/pricing.json` 存在，会合并覆盖内置价格表（暂未实现，后续版本）

## 页面

- **概览**：整体 token 与成本趋势、缓存命中率
- **项目**：按项目排行，钻取项目时间线
- **会话**：会话列表与详情（消息级 token 时间线、工具调用分布）
- **成本**：日 / 周 / 月账单，异常日检测，CSV 导出

## 开发

```bash
npm run dev       # 并行跑 server (tsx watch) + web (vite)
npm test          # vitest
npm run build     # 打包前后端到 dist/
```
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: README 安装与使用说明"
```

**M4 完成标志**：`npm link` 后任意目录 `ccu start` 能起服务、打开浏览器、看到真实数据。

---

## Self-Review（作者自查）

- [x] Spec 每一节都有对应 task：数据模型 → T2；管道 → T6-T9；API → T11-T12/T16/T18/T20；UI → T14-T15/T17/T19/T21；CLI 打包 → T22-T23
- [x] 价格表 / 路径反推 / 半截行容错均在实现里
- [x] 所有 logic-heavy 任务走 TDD（先写测试 → 确认失败 → 实现 → 通过 → commit）
- [x] 脚手架类任务（T1/T14）不强制 TDD，改为 typecheck + 本地运行验证
- [x] 每个任务末尾有 commit 步骤，commit message 中文
- [x] 类型命名在 Task 5 统一定义后，在后续 task 里一致使用（ParsedMessage / OverviewResponse 等）
- [x] `buildApp` 在 Task 11 同步 → Task 22 改 async，受影响的测试在 T22 Step 4 说明要改
- [x] Task 22 依赖 `@fastify/static`，已在 Task 1 依赖里列出
