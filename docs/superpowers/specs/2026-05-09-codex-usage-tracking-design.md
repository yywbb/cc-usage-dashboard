# Codex Usage Tracking — Design

Status: Draft · Date: 2026-05-09 · Owner: scorliss457@gmail.com

## 1. Background

`cc-usage-dashboard` 当前只统计 Claude Code 的 token 用量与成本（数据源 `~/.claude/projects/**/*.jsonl`，索引到 `~/.cc-usage/usage.db`）。OpenAI Codex CLI 在本机另写一份会话日志 `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`，结构与 Claude 不同但同样可解析。本设计把 Codex 纳入同一仪表盘，并按 `real_path` 在项目维度上把两者打通，让用户能直接对比同一仓库下两种代理的开销与行为差异。

## 2. Goals / Non-Goals

**Goals**
- 解析 Codex rollout JSONL，写入既有 SQLite 索引，复用价格/聚合/UI 框架。
- 在概览/项目/会话/成本各页面，使用既有 `byProvider` 维度展示 Anthropic vs OpenAI 对比。
- 同一 `real_path` 上的 Claude 与 Codex 用量在"项目"维度合并展示。
- 暴露 Codex 独有信号：`reasoning_output_tokens`、`rate_limits`（5h primary + 7d secondary）、`originator`（codex_cli / codex_vscode）。

**Non-Goals**
- 不解析 Codex 工具调用细节到子任务级（只取 tool name 列表，与 Claude 解析一致）。
- 不实时打开 Codex API 查询用户余额；rate_limits 只来自 rollout 文件里的快照。
- 不重写既有 Claude scanner / 价格规则 / UI 主框架。
- 不立即做 monorepo 拆分（见 Phase 1）。

## 3. Architecture & Phasing

**目标态**：pnpm workspace
```
packages/
  core/   # DB schema/migrations、pricing、provider 抽象、scanner 框架、shared types、HTTP routes、Web UI
  ccu/    # CLI entry：默认扫 ~/.claude
  cxu/    # CLI entry：默认扫 ~/.codex
```

**分阶段实施**（这份 spec 主要落地 Phase 0；Phase 1 单独再立计划）。

- **Phase 0 — 不动目录结构**
  - 现有 `src/server/scanner/index.ts` 重组为 `src/server/scanner/sources/claude/`，新增 `src/server/scanner/sources/codex/`。
  - 引入 source 接口：
    ```ts
    interface ScanSource {
      readonly id: 'claude' | 'codex';
      defaultRoot(): string;
      scanAll(db: Database, root: string): ScanResult;
    }
    ```
  - 单 CLI `ccu` 通过 `--source claude|codex|all`（默认 `all`）选择性扫描；`ccu start` 启动前默认扫两边。
- **Phase 1 — 拆 monorepo**（后续单独 spec）
  - 把 `src/` 上移成 `packages/core/`、新增 `packages/ccu`、`packages/cxu` 两个 thin wrapper（`bin` 各自指向 core）。纯目录搬迁，无逻辑改动。

**DB 路径**：保持 `~/.cc-usage/usage.db`，不改名（避免老用户迁移）。

## 4. Data Model

### 4.1 Migrations

`004_multi_source.sql`：
```sql
ALTER TABLE messages ADD COLUMN source TEXT;                 -- 'claude' | 'codex'
ALTER TABLE messages ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN originator TEXT;             -- codex_cli / codex_vscode / null

ALTER TABLE sessions ADD COLUMN source TEXT;
ALTER TABLE sessions ADD COLUMN total_reasoning INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN cwd_real_path TEXT;          -- 规范化路径，用于跨 provider 关联

ALTER TABLE projects ADD COLUMN sources TEXT;                -- JSON array, e.g. '["claude","codex"]'

UPDATE messages SET source='claude' WHERE source IS NULL;
UPDATE sessions SET source='claude' WHERE source IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_source ON messages(source, timestamp);
CREATE INDEX IF NOT EXISTS idx_sessions_real_path ON sessions(cwd_real_path);
```

`005_codex_rate_limits.sql`：
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

策略：每个 session 只保留**最新一条快照**（PK 是 `session_id`，扫描时 `INSERT … ON CONFLICT(session_id) DO UPDATE`）。要保留历史轨迹时再独立建轨迹表，不在本期范围。

### 4.2 Provider / Models 种子

- 新增 builtin provider `openai`（`is_builtin=1`）。
- 已有 `syncKnownAnthropicModels` 改名为 `syncKnownModels(db)`，按 model → provider 分组写入。
- 默认价格表新增（`packages/core/src/server/pricing.ts` 中 `DEFAULT_PRICING_PER_M`）：
  ```ts
  // OpenAI defaults — USD per 1,000,000 tokens
  // Anthropic 含 cacheCreate；OpenAI 自动缓存，cacheCreate 恒为 0。
  'gpt-5':            { input: 1.25,  output: 10,   cacheCreate: 0, cacheRead: 0.125 },
  'gpt-5-codex':      { input: 1.25,  output: 10,   cacheCreate: 0, cacheRead: 0.125 },
  'gpt-5.3-codex':    { input: 1.25,  output: 10,   cacheCreate: 0, cacheRead: 0.125 },
  'gpt-5-mini':       { input: 0.25,  output: 2,    cacheCreate: 0, cacheRead: 0.025 },
  'gpt-4.1':          { input: 2,     output: 8,    cacheCreate: 0, cacheRead: 0.50  },
  'o4-mini':          { input: 1.10,  output: 4.40, cacheCreate: 0, cacheRead: 0.275 },
  ```
  实际接入时核对 OpenAI 当下公开价；用户可通过"设置 → 计费规则"覆盖。

### 4.3 Project Unification by `real_path`

不改 `projects.project_dir` 主键（向后兼容），改在查询层按 `real_path` 二次合并：

- Claude 的 project：`real_path = reverseProjectDirName(dirName)`（已有）。
- Codex 没有"项目目录"实体，构造合成 `project_dir = 'codex:' + base64url(realPath)`，与 Claude 命名空间不冲突；`real_path` 来自 `session_meta.payload.cwd` 经 `normalizePath()` 规范化（盘符大写 + 正斜杠）。
- UI 聚合：`GROUP BY real_path` 把同一仓库下的 Claude/Codex 两行合并展示，并在 `sources` 字段标注两边都有数据。

## 5. Codex Scanner

文件位置：`src/server/scanner/sources/codex/`
- `index.ts` — 导出 `ScanSource` 实例
- `parser.ts` — 单文件解析逻辑
- `paths.ts` — `~/.codex` 探测、`normalizePath`

### 5.1 文件枚举与断点续扫

- 入口默认 `process.env.CODEX_HOME ?? path.join(homedir(), '.codex')`，再拼 `sessions`。
- 递归扫所有 `rollout-*.jsonl`，**复用既有 `scan_cursor` 表**（按 file_path）；偏移/mtime 校验逻辑零改动。

### 5.2 解析

每文件一个 session：
- `session_id` ← `session_meta.payload.id`（与文件名 UUID 一致）。
- `cwd` ← `session_meta.payload.cwd`，`originator` ← `session_meta.payload.originator`。
- 维护当前 `model` 状态：每见到 `turn_context`，更新 `currentModel = payload.model`；整文件无 `turn_context` 时按 ccusage 经验回退 `'gpt-5'`。
- 累计 cumulative 状态，**严格单调差分**得到每次 token 增量。

### 5.3 token_count 解析（核心算法）

> 关键坑（ccusage issue #884）：Codex 会发**重复**的 `token_count` 事件——同一 cumulative 出现 2~3 次。`last_token_usage` 在重复事件里也是不变的，**不能直接累加**，否则 2× / 3× 高估。

```ts
let prev = { input: 0, cached: 0, output: 0, reasoning: 0, total: 0 };
for (const ev of fileEvents) {
  if (ev.type === 'turn_context') {
    currentModel = ev.payload.model ?? currentModel;
    continue;
  }
  if (ev.type !== 'event_msg' || ev.payload?.type !== 'token_count') continue;
  const cur = ev.payload.info?.total_token_usage;
  if (!cur) continue;
  if (cur.total_tokens <= prev.total) continue;   // 重复事件，直接丢弃

  const delta = {
    input:     cur.input_tokens         - prev.input,
    cached:    cur.cached_input_tokens  - prev.cached,
    output:    cur.output_tokens        - prev.output,
    reasoning: cur.reasoning_output_tokens - prev.reasoning,
    total:     cur.total_tokens         - prev.total,
  };

  // OpenAI 语义：input_tokens 包含 cached_input_tokens；
  // 我们入库时把"非缓存输入"放到 input_tokens 列、缓存命中放到 cache_read_tokens 列，
  // 与 Anthropic 语义对齐（Anthropic 的 input_tokens 不含 cache_read）。
  emitMessage({
    sessionId,
    timestamp: parseISO(ev.timestamp).getTime(),
    role: 'assistant',
    model: currentModel,
    inputTokens:        delta.input - delta.cached,
    cacheReadTokens:    delta.cached,
    cacheCreationTokens: 0,
    outputTokens:       delta.output,           // 不含 reasoning
    reasoningTokens:    delta.reasoning,
    source: 'codex',
    originator,
    textPreview: lastSeenAgentMessageText?.slice(0, 200) ?? null,
    toolNames: pendingToolCallNames.splice(0),
    messageId: `${sessionId}:${ev.timestamp}`,
    parentUuid: null,
    stopReason: null,
  });
  prev = cur;
}
```

**回归不变量**：扫完一个 session，`SUM(input + cache_read + output + reasoning)` 应等于该文件最后一条 token_count 的 `total_tokens`。集成测试以此为断言。

### 5.4 text_preview / tool_names

- `text_preview`：取该 delta 之前最近一条 `event_msg.payload.type === 'agent_message'` 的 `message` 前 200 字符。
- `tool_names`：扫描 `response_item` 中的工具调用项（`local_shell_call`、`apply_patch`、自定义 MCP 工具），在 emit 时一起带出。具体字段路径在实现时按 fixture 反推（不在本 spec 锁死）。

### 5.5 rate_limits 快照

- 取**该文件最后一条** `token_count.payload.rate_limits` 与 `plan_type`，upsert 进 `codex_rate_limit_snapshots`（按 `session_id` 唯一键覆盖；如未来要历史轨迹再去主键）。

### 5.6 cost 计算

复用 `priceFor()` / `applyPrice()`：
- `cacheCreate=0` 自然不计入。
- `reasoning_tokens` 与 `output_tokens` 走**同一个 output 单价**（OpenAI 计费上 reasoning 与 output 同价）。`applyPrice` 改为：
  ```ts
  return (
    (t.inputTokens          * price.input)       / M +
    (t.outputTokens         * price.output)      / M +
    (t.reasoningTokens ?? 0)* price.output       / M +
    (t.cacheCreationTokens  * price.cacheCreate) / M +
    (t.cacheReadTokens      * price.cacheRead)   / M
  );
  ```
  Claude 数据 `reasoningTokens=0` 不影响结果。

## 6. UI Changes

复用全部既有页面框架；以下是增量。

- **概览**
  - `byProvider` 维度自然多出 `openai`；趋势图新增 stack-by-provider 选项（已有 stack toggle，加一个 key）。
  - 顶栏 KPI 不变；增加 provider 多选筛选条（已存在的 sessions 筛选机制对齐）。
- **项目**
  - 列表行加 `sources` chip（C/X 两色标）。
  - 详情时间线按 source 双色叠加。
- **会话**
  - 筛选栏加 `Source: All / Claude / Codex`；加 `Originator: CLI / VS Code`（仅 source=codex 时可用）。
  - 列表行 `source` chip + 模型名。
  - 详情：Codex session 增加 reasoning tokens 行，并显示该 session 关联的 rate_limits 快照（如有）。
- **成本**：堆叠维度新增 `byProvider` 模式（与 byProject 平级切换）。
- **设置 → 计费规则**：按 provider 分组（Anthropic / OpenAI / Unknown）。
- **额度看板（新）**——仅当 `codex_rate_limit_snapshots` 非空时显示
  - 顶栏小徽章：`5h: NN%` / `7d: NN%`，超 80% 红色、超 95% 闪烁。
  - "设置"或新独立页里画历史 used_pct 折线（如启用了快照保留）。

## 7. CLI

Phase 0：
```
ccu scan                    # 默认 all（claude + codex 都扫）
ccu scan --source claude
ccu scan --source codex
ccu start                   # 启动前 all 增量扫
ccu recompute-cost          # 不变
```

Phase 1（待 monorepo）：`cxu` 等价于 `ccu --source codex` 默认行为。

环境变量：尊重 `CODEX_HOME`（默认 `~/.codex`），与 OpenAI Codex CLI 行为一致。

## 8. Testing

- **Fixture**：在 `tests/fixtures/codex/` 放 5–10 份脱敏 mini rollout JSONL，覆盖：
  - 重复 token_count 去重
  - 缺失 turn_context 回退到 `gpt-5`
  - 跨 turn_context 模型切换
  - 含 reasoning tokens
  - 含完整 rate_limits 段
- **单元测试**（`packages/core/tests/scanner/codex/parser.test.ts`）：
  - 解析单文件 → 断言 message 数、token 总和、model 归属。
  - 重复 token_count 输入下，结果与去重后一致。
- **集成测试**：临时目录跑 `scanAll(db, fixturesRoot)`，断言：
  ```
  SUM(input + cache_read + output + reasoning) [over a session]
    == 该文件最后一条 token_count.total_tokens
  ```
  这正是 ccusage #884 的回归测试。
- **手工验证**：本地 `ccu scan --source codex` 后，对照 Codex CLI 内 `/status` 命令输出的 token / 余额，做一次抽样核对。

## 9. Risks & Mitigations

- **Codex 日志格式漂移**：OpenAI 在 0.x 版本期不保证 schema 稳定。Mitigation：解析时容错（payload 缺字段不崩溃，记录到 `parse_warnings` 计数器），单元测试覆盖最少 3 个 cli_version。
- **token_count 重复事件**：上文已处理。回归不变量必须放进 CI。
- **OpenAI 价格变动**：用户可在设置页覆盖；DEFAULT_PRICING 仅作首启动 fallback。
- **Windows 路径规范化**：`d:\\QC\\code\\...` → `D:/QC/code/...`，盘符大写以匹配 Claude 的 `reverseProjectDirName` 输出格式；测试覆盖大小写盘符两种输入。
- **session 跨日期/跨文件**：Codex 一个 session 通常对应一个文件，无跨文件场景；若未来出现 thread/archive 移动，cursor 逻辑不需变（按 file_path 跟踪）。

## 10. Out of Scope (后续单独立项)

- Phase 1 monorepo 拆分（packages/core + ccu + cxu）。
- Codex archive_sessions 解析（`~/.codex/archived_sessions/`）。
- 多机/远程同步、跨设备聚合。
- 实时观测：rate_limits 推送到桌面通知。
- 解析 Codex MCP 工具调用的 input/output 差异，进而细分工具成本。
