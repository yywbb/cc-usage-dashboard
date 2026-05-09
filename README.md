# cc-usage-dashboard

本地可视化工具，监控 Claude Code 与 OpenAI Codex CLI 的 token 用量与成本。读取 `~/.claude/projects/**/*.jsonl` 与 `~/.codex/sessions/**/rollout-*.jsonl` 并索引到 SQLite，提供仪表盘 UI。

## 安装

```bash
git clone <repo>
cd cc-usage-dashboard
pnpm install
pnpm build
pnpm link --global    # 将 `ccu` 命令链接到全局
```

## 使用

```bash
ccu scan [--source all|claude|codex]       # 全量扫描数据源并写入索引（默认 all）
ccu start [--source all|claude|codex]      # 启动仪表盘（默认 localhost:47821，启动前自动增量扫描）
ccu start -p 6000                          # 指定端口（被占用时会向后顺延，最多重试 20 次）
ccu start --no-open                        # 不自动打开浏览器
ccu recompute-cost                         # 按当前生效价格重算所有消息成本（修改计费规则后使用）
```

## 数据

- 索引数据库：`~/.cc-usage/usage.db`（SQLite，better-sqlite3）
- 数据来源：
  - `~/.claude/projects/**/*.jsonl`（Claude Code 会话日志）
  - `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`（Codex 会话日志，遵循 `CODEX_HOME` 环境变量覆盖）
- 价格覆盖：通过 **设置 → 计费规则** 写入 `pricing` 表（按模型 × `effective_from` 时间窗口管理"每百万 token 美元单价"，按 provider 分组）；改完后跑 `ccu recompute-cost` 回填历史成本

## 页面

- **概览** — KPI 卡（Token / Cost / Sessions，附 sparkline 与环比 delta）；趋势图支持 day/hour 粒度切换、按 model/type 堆叠、双 Y 轴显示缓存命中率；今日快照、Top 10 工具、Top 5 高成本会话
- **项目** — 项目排行（双行项目名 + 迷你成本条）；钻取后看时间线 + KPI + Top sessions
- **会话** — 列表带筛选栏（项目 / 模型 / 日期 / Originator）、可排序列（含 Source 列）、duration tag、KPI 行；详情页含 5 列 KPI、工具调用环形图、可展开消息预览；Codex 会话额外显示 Reasoning 令牌 KPI 与速率限制（5h/7d）
- **成本** — 日 / 周 / 月账单，异常日 markPoint 标记，按项目堆叠（Top 7 + 其他），CSV 导出
- **设置** — 显示偏好（紧凑数字 k/M/B 切换）+ 计费规则（按模型管理单价覆盖）

UI 顶栏支持 Source 全局过滤（All / Claude / Codex，影响概览 / 项目 / 会话 / 成本所有数据页）、深 / 浅色主题切换；偏好持久化到 localStorage。顶栏 Codex 速率限制徽章在有 Codex 数据时显示。

## 开发

```bash
pnpm dev          # 并行：tsx watch 后端 + vite 前端
pnpm test         # vitest
pnpm typecheck    # tsc 严格检查（前后端各一份 config）
pnpm build        # 打包 dist/server + dist/web
```
