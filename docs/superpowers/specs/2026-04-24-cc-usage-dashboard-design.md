# cc-usage-dashboard — 设计规格

- **日期**: 2026-04-24
- **作者**: qice55
- **状态**: 待实施
- **仓库路径**: `D:/QC/code2/linz/tools/cc-usage-dashboard/`

## 1 · 目标

一个本地可视化工具，监控并分析 Claude Code 的 token 用量与成本。"一站式"覆盖四个视角：

- **概览**：总体 token、成本、缓存命中率、模型构成趋势
- **项目**：按项目排行、钻取某项目的时间线
- **会话**：session 级深入分析，每条消息的 token / 工具调用分布
- **成本**：日 / 周 / 月账单视图、异常日检测

### 数据来源

Claude Code 本地已留存完整数据：

- `~/.claude/projects/<encoded-dir>/*.jsonl` — 每个 session 的完整 transcript。assistant 消息内含 `message.usage` 字段（`input_tokens` / `output_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens`）和 `message.model`
- `~/.claude/stats-cache.json` — 已按天聚合的消息/会话数（不含 token，仅作参考）
- 工具自己维护 `~/.cc-usage/usage.db` 做索引

### 非目标（YAGNI）

- 不做多机汇总（SQLite schema 预留 `source_host` 字段便于扩展）
- 不做实时文件 watch 与 daemon（打开浏览器时触发增量扫描即可）
- 不做 Auth / 多用户（本地工具，绑定 127.0.0.1）
- 不做 E2E 测试（手动验证足够）

## 2 · 架构

```
CLI: ccu [start|scan|recompute-cost|--port]
        │
        ▼
┌───────────────────────────┐    扫描    ┌───────────────────┐
│ Node 服务 (Fastify)        │ ────────► │ ~/.claude/        │
│  - 启动/手动增量扫描        │           │   projects/**/*.jsonl │
│  - REST API (/api/*)       │           │   stats-cache.json    │
│  - 托管 SPA 构建产物        │           └───────────────────┘
└──────────┬────────────────┘
           │
           ├─ SQLite: ~/.cc-usage/usage.db
           │   (messages / sessions / projects / scan_cursor)
           │
           ▼
┌───────────────────────────┐
│ React SPA (Vite build)     │
│  - Overview / Projects     │
│  - Sessions / Cost         │
│  - AntD + ECharts          │
└───────────────────────────┘

浏览器访问 http://localhost:<port>（CLI 自动打开）
```

### 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 形态 | 本地 Web 仪表盘 | 图表丰富、交互灵活，session 钻取需要可视化 |
| 启动 | 全局 CLI `ccu` | 装一次全机器用，不用 cd 到 repo |
| 扫描 | 启动时 + 手动刷新 | 够用；无 daemon 无 watch，避免复杂度 |
| 端口 | 单进程单端口，默认 5173 | Fastify 既提供 API 也托管 SPA，避开双端口 / CORS；`--port` 可覆盖，占用时自增找下一个可用端口 |
| 存储 | `~/.cc-usage/usage.db` | 不污染 `~/.claude/`，也不在工具 repo 里 |
| 增量 | `scan_cursor.last_offset` | jsonl append-only，下次从字节偏移续读 |
| 数据源 | 仅本机 | 多机汇总暂不做，schema 预留扩展点 |

## 3 · 数据模型（SQLite）

### 3.1 表结构

```sql
-- 每个 jsonl 文件的扫描游标，做增量续读
CREATE TABLE scan_cursor (
  file_path       TEXT PRIMARY KEY,
  project_dir     TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  mtime_ms        INTEGER NOT NULL,
  last_offset     INTEGER NOT NULL,   -- 已解析到的字节偏移
  last_scanned_at INTEGER NOT NULL
);

-- 项目维度
CREATE TABLE projects (
  project_dir     TEXT PRIMARY KEY,   -- ~/.claude/projects/<encoded-dir>
  display_name    TEXT NOT NULL,      -- 从目录名反推
  real_path       TEXT,               -- 如 D:/QC/code2/linz/tools/xxx
  first_seen_at   INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL
);

-- 会话维度（物化汇总，查询时不重算）
CREATE TABLE sessions (
  session_id      TEXT PRIMARY KEY,   -- jsonl 文件名（不含扩展名）
  project_dir     TEXT NOT NULL,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER NOT NULL,
  message_count   INTEGER NOT NULL DEFAULT 0,
  total_input     INTEGER NOT NULL DEFAULT 0,
  total_output    INTEGER NOT NULL DEFAULT 0,
  total_cache_create INTEGER NOT NULL DEFAULT 0,
  total_cache_read   INTEGER NOT NULL DEFAULT 0,
  total_cost_usd  REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (project_dir) REFERENCES projects(project_dir)
);

-- 消息级明细（钻取视图的基础）
CREATE TABLE messages (
  message_id            TEXT PRIMARY KEY,  -- msg_01xxx (assistant) / uuid (user)
  session_id            TEXT NOT NULL,
  parent_uuid           TEXT,
  role                  TEXT NOT NULL,      -- 'user' | 'assistant'
  model                 TEXT,               -- 'claude-opus-4-7' | ...
  timestamp             INTEGER NOT NULL,   -- ms epoch
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cost_usd              REAL NOT NULL DEFAULT 0,
  stop_reason           TEXT,
  tool_names            TEXT,               -- JSON array: ['Read','Bash']
  text_preview          TEXT,               -- 前 200 字
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE INDEX idx_messages_session ON messages(session_id, timestamp);
CREATE INDEX idx_messages_day     ON messages(date(timestamp/1000,'unixepoch'));
CREATE INDEX idx_sessions_project ON sessions(project_dir, started_at);
```

### 3.2 设计要点

- **`sessions` 是物化汇总**：每批消息写入后重算对应 session 的 total_*，Overview / Projects 页直接查 sessions，秒级响应
- **`messages` 保存 preview + tool_names 而非全文**：钻取时展示 "这条消息烧了多少 token、调用了什么工具" 足够；全文太大
- **`cost_usd` 在解析时就算好**：价格表变动时通过 `ccu recompute-cost` 子命令批量重算
- **user 消息**：通常无 usage，只存元数据（parent_uuid / timestamp / preview），供钻取展示对话流
- **`scan_cursor.last_offset`**：下次 `fs.createReadStream({ start: last_offset })` 续读

## 4 · 数据管道

### 4.1 扫描流程

```
启动 ccu
  │
  ▼
枚举 ~/.claude/projects/*/*.jsonl
  │
  ▼
每个文件：
  ├─ scan_cursor 无记录        → 全量解析（offset 0）
  ├─ size/mtime 未变           → 跳过
  └─ size/mtime 变化           → 增量解析（从 last_offset 续读）
  │
  ▼
逐行 JSON.parse:
  ├─ role === 'assistant' 且含 usage  → 写 messages 表 + 算 cost
  ├─ role === 'user'                  → 写 messages（仅元数据 + preview）
  └─ 其他（系统 / tool_result）       → 跳过
  │
  ▼
每 1000 条批量 INSERT（事务）
  │
  ▼
扫完后：重算受影响 session 的汇总 → UPDATE sessions
  │
  ▼
更新 scan_cursor.last_offset / size / mtime
```

### 4.2 解析器容错

jsonl 末行可能是半截（Claude Code 正在写入）。`JSON.parse` 失败时：
- break 当前循环
- `last_offset` 停在上一条完整行末尾
- 下次再续读

### 4.3 成本计算

消息级：

```
cost_usd = input_tokens          × price.input
         + output_tokens         × price.output
         + cache_creation_tokens × price.cacheCreate
         + cache_read_tokens     × price.cacheRead
```

价格按 `model` 查表，硬编码在 `src/server/pricing.ts`：

```ts
export const PRICING: Record<string, ModelPrice> = {
  'claude-opus-4-7':   { input: 15/1e6, output: 75/1e6, cacheCreate: 18.75/1e6, cacheRead: 1.50/1e6 },
  'claude-sonnet-4-6': { input: 3/1e6,  output: 15/1e6, cacheCreate: 3.75/1e6,  cacheRead: 0.30/1e6 },
  'claude-haiku-4-5':  { input: 1/1e6,  output: 5/1e6,  cacheCreate: 1.25/1e6,  cacheRead: 0.10/1e6 },
};
```

未知模型兜底按 sonnet 价 + 日志 warn。

**用户 override**：若 `~/.cc-usage/pricing.json` 存在则与硬编码合并覆盖，便于价格变动时不用重装。

### 4.4 工具调用提取

从 assistant 消息的 `content[]` 中筛 `type === 'tool_use'` 的 `name` 字段，聚合成 JSON array 存 `tool_names`。

### 4.5 项目路径反推

Claude Code 用目录名编码真实路径，但规则未公开，需要启发式反推。Windows 常见编码：

- 目录名 `D--QC-code2-linz-tools-genealogy-platform` → `D:/QC/code2/linz/tools/genealogy-platform`
- 规则：首个 `--` → `:/`；其余 `-` → `/`

**兜底**：启发式失败或路径不匹配本机实际目录时，`real_path` 存 null，`display_name` 取目录名原串尾段。UI 展示以 `display_name` 为主，路径只作额外信息展示，不作交互依赖。后期若 Claude Code 公布映射 API 再替换启发式。

### 4.6 触发方式

1. `ccu start`：启动时自动跑一次（阻塞，进度条显示）
2. `POST /api/scan`：前端"刷新"按钮
3. `ccu recompute-cost`：不动消息，只按最新 PRICING 重算 cost_usd

### 4.7 性能预估

- 项目数 10+，session jsonl 通常 0.1–5 MB
- 全量首扫几 MB/秒（Node + better-sqlite3 事务），百万行内 10 秒完成
- 增量扫几乎零成本（只读新增字节）

## 5 · REST API

所有接口在 `/api/*`，JSON 响应。时间统一 ISO 字符串。

```
GET  /api/health                         → { ok, dbSize, lastScanAt }
POST /api/scan                           → { scannedFiles, newMessages, durationMs }
POST /api/recompute-cost                 → { updatedSessions, totalCostUsd }

# Overview
GET  /api/overview?range=today|week|month|ytd|all
  → {
      range: { from, to },
      totals: { inputTokens, outputTokens, cacheCreate, cacheRead, costUsd, messageCount, sessionCount },
      byModel:   [{ model, tokens, costUsd, share }],
      byProject: [{ projectDir, displayName, tokens, costUsd, share }],   // top 10
      dailyTrend: [{ date, inputTokens, outputTokens, costUsd, byModel: {...} }],
      cacheHitRate: number    // cache_read / (input + cache_create + cache_read)
    }

# Projects
GET  /api/projects?sortBy=cost|tokens|sessions&order=desc
  → [{ projectDir, displayName, realPath, sessionCount, totalTokens, totalCostUsd,
       avgTokensPerSession, firstSeenAt, lastSeenAt }]

GET  /api/projects/:projectDirB64/timeline?range=...
  → { daily: [{ date, tokens, costUsd, sessionCount }], topSessions: [...] }

# Sessions
GET  /api/sessions?projectDir=...&from=...&to=...&limit=50&offset=0
  → { total, items: [{ sessionId, projectDir, startedAt, endedAt, messageCount,
                        totalTokens, totalCostUsd, topTools }] }

GET  /api/sessions/:sessionId
  → {
      session: {...},
      messages: [{ messageId, role, model, timestamp, inputTokens, outputTokens,
                   cacheCreate, cacheRead, costUsd, stopReason, toolNames, textPreview }],
      toolDistribution: [{ tool, count, share }]
    }

# Cost
GET  /api/cost?granularity=day|week|month&range=...
  → {
      buckets: [{ bucketKey, costUsd, tokens, byModel: {...}, byProject: [...] }],
      anomalies: [{ date, costUsd, zScore }]    // 日成本 > mean + 2σ
    }
```

### 约定

- **`:projectDirB64` / `projectDir` 查询参数**：原路径含 `/` 和 `:`，统一用 base64url 编码（URL path 段和 query string 都用同一编码规则）
- **分页**：仅 sessions 列表；其他端点返回行数 ≤ 500，一次返回
- **索引利用**：按天聚合走 `idx_messages_day`，按项目走 `idx_sessions_project`，按 session 走 `idx_messages_session`
- **`anomalies`**：简单 z-score（日成本 > 均值 + 2σ），无 ML
- **无 Auth**：绑定 127.0.0.1，不监听外网

## 6 · UI 视图

### 6.1 路由

```
/                         → /overview
/overview                 → Overview
/projects                 → ProjectsTable
/projects/:projectDirB64  → ProjectDetail
/sessions                 → SessionsList
/sessions/:sessionId      → SessionDetail
/cost                     → CostReport
```

### 6.2 Overview（落地页）

- 范围选择：今天 / 本周 / 本月 / YTD / 全部；手动刷新按钮
- KPI 四联卡：总 Token / 总成本 $ / 会话数 / 缓存命中率
- 按模型堆叠折线图（ECharts stacked area，X=日期 Y=tokens series=opus/sonnet/haiku）
- 两栏并排：
  - 按项目 token Top 10 条形图（横向）
  - 按工具调用频次 Top 10 条形图
- 底部：最近 5 个会话表格，点击 → SessionDetail

### 6.3 Projects

- 表格：项目名 / 真实路径 / 会话数 / 总 Token / 总成本 / 平均/会话 / 最近活跃
- 排序：成本 / Token / 会话数
- 点击行 → 项目详情（复用 Overview 组件 + 该项目 session 列表）

### 6.4 Sessions

列表：
- 过滤：项目下拉 + 日期范围 + 最小成本
- 虚拟滚动表格：开始时间 / 项目 / 时长 / 消息数 / Token / 成本 / Top 工具

详情（SessionDetail）：
- 头部：session 元信息 + 总计卡片
- 时间线图（ECharts bar）：每条消息的 token 柱状，颜色分 input/output/cache；hover 显示 preview，点击跳到下方列表对应行
- 消息列表（虚拟滚动）：时间 / role / model / in/out/cache / $ / tools / preview
- 右侧：工具调用分布（饼图） + stop_reason 分布

### 6.5 Cost

- 粒度：日 / 周 / 月；范围：最近 30 / 90 / 全部
- 主图：堆叠柱状图（X=日期 Y=$ series=按项目堆叠），异常日标红点 hover 显示 z-score
- 右侧：按模型饼图 + 按项目饼图
- 底部：账单表（可导出 CSV）

### 6.6 状态管理

- **TanStack Query**：所有 API 响应缓存 + window focus 自动刷新
- **刷新按钮**：调 `POST /api/scan`，loading 态，完成后 invalidate 所有 queries
- **全局范围选择器**：Overview / Cost 共享时间范围，URL query 驱动（`?range=month`）
- **主题**：AntD ConfigProvider，默认跟随系统，可切换黑白
- **空状态**：首次无数据时提示 "运行 ccu scan 或点击刷新"

## 7 · 技术栈

### 后端
- **Fastify** — 快、轻、TS first
- **better-sqlite3** — 同步 API、原生性能，CLI 场景贴合
- **commander** — CLI 参数解析
- **open** — 启动后拉起浏览器
- **chalk + cli-progress** — 扫描进度条
- **tsx** — dev 直跑 TS；prod 用 **tsup** 打包

### 前端
- **React 18 + TypeScript + Vite**
- **AntD v5** — Layout / Menu / Table / DatePicker / Select
- **ECharts** via `echarts-for-react`
- **TanStack Query** — API 数据层
- **React Router v6** — 路由
- **zustand** — 全局少量状态
- **dayjs** — 时间处理

### 打包分发
- tsup 打包后端到 `dist/server/`
- Vite build 打包前端到 `dist/web/`
- `package.json.bin = { "ccu": "dist/server/cli.js" }`
- 支持 `npm i -g .`；后续可 `npm publish`

## 8 · 项目结构

```
cc-usage-dashboard/
├─ package.json              # bin: { "ccu": "dist/server/cli.js" }
├─ tsconfig.json
├─ tsconfig.server.json
├─ README.md
│
├─ src/
│  ├─ server/
│  │  ├─ cli.ts              # commander 入口
│  │  ├─ app.ts              # Fastify 实例
│  │  ├─ db.ts               # better-sqlite3 + migrations runner
│  │  ├─ migrations/         # 001_init.sql …
│  │  ├─ scanner/
│  │  │  ├─ index.ts         # 扫描编排
│  │  │  ├─ parser.ts        # jsonl → parsed record
│  │  │  ├─ writer.ts        # 批量写 messages / sessions
│  │  │  └─ cursor.ts        # scan_cursor 读写
│  │  ├─ pricing.ts          # 价格表 + cost 计算
│  │  ├─ paths.ts            # 路径反推 / base64url
│  │  ├─ routes/
│  │  │  ├─ overview.ts
│  │  │  ├─ projects.ts
│  │  │  ├─ sessions.ts
│  │  │  ├─ cost.ts
│  │  │  └─ admin.ts         # scan / recompute-cost / health
│  │  └─ staticServe.ts      # prod 下托管 dist/web
│  │
│  ├─ shared/
│  │  └─ types.ts            # 前后端共享的 API 类型
│  │
│  └─ web/
│     ├─ main.tsx
│     ├─ App.tsx
│     ├─ routes.tsx
│     ├─ api/                # fetch wrapper
│     ├─ hooks/              # useOverview, useSessions...
│     ├─ pages/
│     │  ├─ Overview/
│     │  ├─ Projects/
│     │  ├─ Sessions/
│     │  └─ Cost/
│     ├─ components/
│     │  ├─ KpiCard.tsx
│     │  ├─ RangePicker.tsx
│     │  ├─ StackedAreaChart.tsx
│     │  └─ ...
│     └─ store.ts            # zustand
│
├─ tests/
│  ├─ scanner.test.ts        # fixture jsonl 解析断言
│  ├─ pricing.test.ts        # cost 计算断言
│  └─ fixtures/              # 裁切过的真实 jsonl 样本（匿名化）
│
└─ scripts/
   ├─ dev.sh                 # 并行 vite + server
   └─ build.sh               # 前后端一起 build
```

## 9 · 测试策略

- **scanner.test.ts** — fixture jsonl 解析断言 message 数 / token 总量（PRICING mock 避免受价格变动影响）
- **pricing.test.ts** — 各模型 × 各字段的 cost 计算，精确到 6 位小数
- **不做 E2E** — 本地工具，UI 手动验证

## 10 · npm scripts

```json
{
  "dev": "concurrently \"npm:dev:server\" \"npm:dev:web\"",
  "dev:server": "tsx watch src/server/cli.ts start --dev",
  "dev:web": "vite",
  "build": "npm run build:web && npm run build:server",
  "build:web": "vite build",
  "build:server": "tsup src/server/cli.ts --format cjs --out-dir dist/server",
  "test": "vitest",
  "start": "node dist/server/cli.js start"
}
```

## 11 · 里程碑切分建议（供后续 writing-plans 参考）

1. **M1 · 脚手架 + 扫描管道**：项目骨架、SQLite schema、jsonl 解析、`ccu scan` 能跑通并落库
2. **M2 · API + 最小前端**：Fastify 路由、Overview 页能看到总 token / 成本
3. **M3 · Projects + Sessions + Cost**：三个页面 + 钻取交互
4. **M4 · CLI 打包 + 全局安装**：tsup 打包、`ccu start` 自动开浏览器、README

每里程碑交付一个可用版本。

## 12 · 未决 / 风险

- **价格表准确性**：硬编码价格需要手动跟官方；长期可考虑从 `https://docs.anthropic.com/en/docs/about-claude/pricing` 抓取（暂不做）
- **第三方 API 提供方**：若用户用 Kimi / DeepSeek / 其他渠道，`model` 字段名可能不在 PRICING 表内 → 兜底按 sonnet，日志 warn
- **Windows 路径反推**：目录名编码规则是 Claude Code 内部实现，可能版本变化；路径反推失败时 fallback 原串，不阻塞数据展示
- **jsonl 半截行 / 破损行**：半截行已在解析器容错（停在上条完整行）；非半截的破损行（JSON 合法但 schema 不符）当前策略会一直停在该 offset → M1 实施时需要加"跳过坏行并记录到 `scan_cursor.errors` 字段 + 日志 warn"的 recover 分支，避免单条坏行永久阻塞增量扫描
