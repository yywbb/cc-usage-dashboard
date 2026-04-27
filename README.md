# cc-usage-dashboard

本地可视化工具，监控 Claude Code 的 token 用量与成本。读取 `~/.claude/projects/**/*.jsonl` 并索引到 SQLite，提供仪表盘 UI。

## 安装

```bash
git clone <repo>
cd cc-usage-dashboard
npm install
npm run build
npm link        # 将 `ccu` 命令链接到全局
```

## 使用

```bash
ccu scan                  # 全量扫描 ~/.claude/projects/ 并写入索引
ccu start                 # 启动仪表盘（默认 localhost:47821，启动前自动增量扫描）
ccu start -p 6000         # 指定端口（被占用时会向后顺延，最多重试 20 次）
ccu start --no-open       # 不自动打开浏览器
ccu recompute-cost        # 按当前生效价格重算所有消息成本（修改计费规则后使用）
```

## 数据

- 索引数据库：`~/.cc-usage/usage.db`（SQLite，better-sqlite3）
- 数据来源：`~/.claude/projects/**/*.jsonl`
- 价格覆盖：通过 **设置 → 计费规则** 写入 `pricing_overrides` 表，按"每百万 token 美元单价"配置；改完后跑 `ccu recompute-cost` 回填历史成本

## 页面

- **概览** — KPI 卡（Token / Cost / Sessions，附 sparkline 与环比 delta）；趋势图支持 day/hour 粒度切换、按 model/type 堆叠、双 Y 轴显示缓存命中率；今日快照、Top 10 工具、Top 5 高成本会话
- **项目** — 项目排行（双行项目名 + 迷你成本条）；钻取后看时间线 + KPI + Top sessions
- **会话** — 列表带筛选栏（项目 / 模型 / 日期）、可排序列、duration tag、KPI 行；详情页含 5 列 KPI、工具调用环形图、可展开消息预览
- **成本** — 日 / 周 / 月账单，异常日 markPoint 标记，按项目堆叠（Top 7 + 其他），CSV 导出
- **设置** — 显示偏好（紧凑数字 k/M/B 切换）+ 计费规则（按模型管理单价覆盖）

UI 顶栏支持深 / 浅色主题切换；偏好持久化到 localStorage。

## 开发

```bash
npm run dev        # 并行：tsx watch 后端 + vite 前端
npm test           # vitest
npm run typecheck  # tsc 严格检查（前后端各一份 config）
npm run build      # 打包 dist/server + dist/web
```
