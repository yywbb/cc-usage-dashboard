# cc-usage-dashboard

本地可视化仪表盘，用来查看 Claude Code 与 OpenAI Codex CLI 的 token 用量、成本、项目排行、会话明细和速率限制信息。

它只读取本机日志文件，并把索引数据库写到本机 SQLite，不需要上传你的会话数据。

## 要求

- Node.js 20 或更高版本
- 本机已有 Claude Code 或 Codex CLI 会话日志

## 安装

全局安装：

```bash
npm install -g cc-usage-dashboard
```

安装后启动仪表盘：

```bash
ccu start
```

也可以不安装，直接临时运行：

```bash
npx cc-usage-dashboard start
```

默认会启动在 <http://localhost:47821>，如果端口被占用会自动向后顺延。

## 常用命令

```bash
ccu start                              # 启动仪表盘，启动前自动增量扫描
ccu start --source codex               # 只扫描 Codex CLI 数据
ccu start --source claude              # 只扫描 Claude Code 数据
ccu start -p 6000                      # 指定端口
ccu start --no-open                    # 不自动打开浏览器
ccu scan [--source all|claude|codex]   # 只扫描数据，不启动网页
ccu recompute-cost                     # 修改计费规则后，重算历史成本
```

## 数据来源

- Claude Code：`~/.claude/projects/**/*.jsonl`
- Codex CLI：`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
- 本地数据库：`~/.cc-usage/usage.db`

Codex CLI 数据路径遵循 `CODEX_HOME` 环境变量覆盖。

## 功能

- **概览**：Token、Cost、Sessions KPI，趋势图，缓存命中率，今日快照，高成本会话
- **项目**：项目排行、项目详情、项目时间线、Top sessions
- **会话**：筛选、排序、会话详情、工具调用分布、消息预览
- **成本**：日 / 周 / 月账单，异常日标记，按项目堆叠，CSV 导出
- **设置**：显示偏好、计费规则、价格历史、监控配置

顶部支持 Source 全局过滤（All / Claude / Codex）、深浅色主题切换。Codex 数据存在时会显示速率限制徽章。

## 计费规则

价格覆盖通过 **设置 -> 计费规则** 写入本地 `pricing` 表，按 provider、model 和 `effective_from` 时间窗口管理每百万 token 美元单价。

修改计费规则后，可以运行：

```bash
ccu recompute-cost
```

这会按当前生效价格回填历史消息成本。
