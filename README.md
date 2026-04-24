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
