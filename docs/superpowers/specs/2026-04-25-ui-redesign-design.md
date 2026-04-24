# UI 优化设计 · cc-usage-dashboard

Status: Ready for Plan · 2026-04-25

## 1 · 背景

`cc-usage-dashboard` 是本地运行的 Claude Code 使用与成本仪表盘。功能与数据层
(Fastify API、SQLite、扫描器)已跑通,但前端目前全部使用 Ant Design 5 默认样式 +
硬编码行内 style,没有统一主题、色板、页头、空状态和图表主题。本方案在不动路由
和数据模型的前提下重做视觉层,并顺带处理少量信息架构问题(允许对既有 API 做最小
字段扩展,见 §2)。

## 2 · 目标与非目标

### 目标

- 统一视觉语言:一套主题 token、一套图表主题、一个全局壳层(侧栏 + 顶栏)。
- 修掉当前一眼可见的粗糙点:KpiCard 平、Sidebar 只有文字、顶栏只有一个孤按钮、
  TopBarChart 的 Y 轴长文本问题、成本页顶部 Segmented 漂浮。
- 提升 KPI 区域的可扫读性(加 sparkline、图标、等宽数字)。
- 支持 浅色 / 暗色 切换,偏好持久化到 localStorage。
- 舒适 + 紧凑混合密度:KPI/卡片舒适,表格紧凑。

### 非目标

- 不改路由结构、数据模型(SQLite 表结构 / 扫描器)。
- 不引入新组件库。继续用 antd 5 + echarts。
- 不做响应式到移动端(本工具是桌面本地使用)。

### 允许的最小 API 扩展

仅为支撑新的 summary 区块,允许在既有接口上追加字段(不破坏旧返回):

- `/api/sessions`:在返回里加 `stats: { count, totalCost, avgCost, medianDurationMs }`,按当前筛选条件(而非分页)聚合。
- 其余 summary(Overview 今日速览、Cost 页 KPI 行)用现有 `/api/overview` + `/api/cost` 的数据在前端汇总,不新增接口。

## 3 · 视觉方向

选定方向:**A · Modern Clean**(Vercel / Linear 质感)。

主色板(brand + 图表两用):

| 角色 | light | dark |
|---|---|---|
| Primary | `#4f46e5` | `#818cf8` |
| Accent-purple | `#8b5cf6` | `#a78bfa` |
| Accent-cyan | `#06b6d4` | `#22d3ee` |
| Success | `#10b981` | `#34d399` |
| Warning | `#f59e0b` | `#fbbf24` |
| Danger | `#ef4444` | `#f87171` |

背景 / 面板 / 边框:

| 角色 | light | dark |
|---|---|---|
| Page bg | `#f7f8fa` | `#0b1220` |
| Card bg | `#ffffff` | `#111827` |
| Sidebar bg | `#0f172a`(深色,两种主题都保留) | `#0f172a` |
| Border | `#eef2f7` | `#1f2937` |
| Text-primary | `#0f172a` | `#f1f5f9` |
| Text-secondary | `#64748b` | `#94a3b8` |

圆角 / 阴影:

- 卡片圆角 12px,小控件 7-8px。
- 卡片阴影 `0 1px 2px rgba(16,24,40,.04)` + `1px` 边框,不使用大阴影。

字体 / 密度:

- UI:系统默认栈 `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', ...`
- 数字:`font-variant-numeric: tabular-nums`,关键数字(KPI 大数字、表格数值列)启用。
- KPI / Card 区:舒适(antd 默认 + 16-20px 内边距)。
- Table 区:紧凑(`size="small"` 当默认,每页 30-50 行)。

## 4 · 架构

### 4.1 新目录结构

```
src/web/
  theme/
    tokens.ts          // 颜色/间距/圆角常量,两套(light / dark)
    antd-theme.ts      // 映射到 antd ConfigProvider 的 theme.token
    echarts.ts         // 两套 echarts 主题对象(通过 echarts.registerTheme)
    ThemeProvider.tsx  // 包 ConfigProvider + 暴露 { mode, toggle }
  components/
    PageHeader.tsx     // 页标题 + 副标题 + 右侧 extra slot
    KpiCard.tsx        // 升级:支持 sparkline / icon / suffix / precision
    BarList.tsx        // 替代 TopBarChart,横条 + 名字 + 值
    EmptyState.tsx     // 包一层 antd Empty,统一图示和文案
    ThemeToggle.tsx    // 顶栏 🌙 按钮
  pages/...            // 保持不变
  App.tsx              // 消费 ThemeProvider
  main.tsx             // 挂载 ThemeProvider
```

### 4.2 主题切换流程

```
main.tsx
  └─ ThemeProvider
       ├─ useState<'light'|'dark'>  (初值读 localStorage.ccTheme)
       ├─ useEffect: 变化时 localStorage.setItem + document.documentElement.dataset.theme
       ├─ ConfigProvider { theme: { algorithm, token } }   ← antd
       ├─ Context { mode, toggle }                          ← 组件用
       └─ children
            └─ BrowserRouter / QueryClientProvider / App
```

ECharts:在每个 `ReactECharts` 上传 `theme={mode === 'dark' ? 'ccDark' : 'ccLight'}`。
主题对象在 `theme/echarts.ts` 里定义并在 `main.tsx` 启动时 `echarts.registerTheme`
两次。

Sidebar 在两种主题下都保持 `#0f172a` 深色(避免侧栏也翻白导致层级不清)。

### 4.3 全局壳层(App.tsx)

```
Layout
├─ Sider (深色,220px)
│   ├─ Brand (logo 块 + "CC Usage" + "v0.1.0 · local")
│   ├─ Menu (图标 + 文字,使用 @ant-design/icons:
│   │        DashboardOutlined, FolderOutlined, MessageOutlined, DollarOutlined)
│   └─ Footer ("最近扫描 · N 分钟前")  ← 读 /api/health 的 lastScanAt
│          (刻意只展示这一个轻量状态,避免再发 /api/overview 浪费数据)
└─ Layout
    ├─ Header (白色, 14px 内边距)
    │   ├─ PageHeader slot (左: 标题/副标题 —— 由各页面 Portal 写入)
    │   └─ 右侧固定 actions:
    │       ├─ RangePicker (Segmented) ——  仅在支持时间范围的页面显示
    │       ├─ ThemeToggle
    │       └─ 刷新数据按钮
    └─ Content (padding 22-28px)
        └─ <AppRoutes />
```

实现上 Header 的"左侧页头"用 `PageHeader` 组件把标题/副标题通过 React Portal 或
Context 注入到 Header 内,以保留当前每个页面自己组织内容的方式。

## 5 · 页面级改动

### 5.1 概览 (/overview)

布局 (见 mockup):

```
[ 4 x KpiCard                                              ]
[ Trend (2fr)          |  今日速览 (1fr)                   ]
[ BarList 项目 Top10   |  BarList 模型占比                 ]
```

- KpiCard:`{ label, value, icon, sparkline?: number[], suffix?, precision? }`
  - 不做 delta/环比。原因:`/api/overview` 只支持预设 range,没法便宜地拿到对照周期;
    非目标里已说不大改 API,所以 v1 只铺 label + icon + value + 可选 sparkline 的视觉容量。
  - sparkline 仅在有日维度数据的 KPI 上出现:
    - 总 Token:`dailyTrend[].inputTokens + outputTokens + cache*`(现有字段)
    - 总成本:`dailyTrend[].costUsd`(现有字段)
    - 会话数 / 缓存命中率:不渲染 sparkline(dailyTrend 没这两个维度)
- 今日速览卡:4 行小统计(今日 tokens / 今日成本 / 最活跃项目 / 本月异常日数)。
  数据来源全部前端组合,不新增接口:
  - 今日 tokens / 成本:`dailyTrend` 最后一个元素(`inputTokens + outputTokens + cache* ` 与 `costUsd`)
  - 最活跃项目:`byProject[0].displayName`
  - 本月异常日数:并行调用 `/api/cost?granularity=day&range=month`,取 `anomalies.length`
- BarList:替换现有 TopBarChart(echarts 横向柱状)。纯 DOM + CSS,
  无 Y 轴文本截断问题。

### 5.2 项目列表 (/projects)

- 顶部 PageHeader:「项目」+ 副标题「按成本排序」
- Table `size="middle"`,行 hover 加浅色背景
- 项目列:两行渲染 —— 主文本 displayName 粗体,次文本 realPath 12px `text-secondary`
- 成本列:数字 + mini 横条(value / max * 100%,浅色背景 + primary 填充)
- Token 列:`tabular-nums`

### 5.3 项目详情 (/projects/:b64)

- 顶部 PageHeader:项目名 + 返回按钮
- 每日 token 与成本图:应用新 ECharts 主题,双 Y 轴保持
- Top 20 会话表:`size="small"`,成本列加颜色(由浅到深)

### 5.4 会话列表 (/sessions)

- 顶部 PageHeader + KPI summary 一行 4 块(会话数 / 总成本 / 平均成本 / 中位时长)
  - 数据来自 `/api/sessions` 响应里新加的 `stats` 字段(见 §2 允许的最小 API 扩展)。
  - 服务端在拼接分页之前先用 SQL 聚合完整筛选集的统计。
- 顶部筛选栏:项目 Select(多选) + 时间范围 Segmented
  - 本次范围:只做这两个,不加模型/关键字搜索。
  - 筛选参数透传到 `/api/sessions` 的 query 里,服务端据此过滤并聚合 stats。
- Table `size="small"`,时长列改 `Tag`:
  - < 10 分 `green`
  - 10-60 分 `default`
  - \> 60 分 `orange`
- Top 工具列:Tag 的 color 按工具名 hash 决定,超过 3 个显示「+N」

### 5.5 会话详情 (/sessions/:id)

- 顶部:从 `Descriptions` 换成 4 块小 KpiCard(消息数 / 时长 / 总 token / 成本)
- 消息时间线(堆叠 bar):应用新 ECharts 主题
- 工具分布饼图:应用新 ECharts 主题,内圈空、加 label
- 消息详情表:`size="small"`,role/model 列 Tag,tools 截断,preview 点击展开
  - preview 展开方式:**就地展开行**(antd Table `expandable.expandedRowRender`),
    不开 Drawer。理由:上下文是表格里的行,就地展开更连贯。

### 5.6 成本 (/cost)

- 顶部 PageHeader + KPI summary(周期内总成本 / 日均 / 峰值日 / 异常日数)
- 粒度 Segmented 移入 PageHeader 的 extra
- 堆叠柱图应用新 ECharts 主题
- 异常日在堆叠图上加 `markPoint` 标识(红点 + 日期),右侧异常表行高亮红色
- 明细表加搜索(按周期 bucket 文本筛)+ 原有导出 CSV 按钮保留

## 6 · ECharts 主题

在 `theme/echarts.ts` 定义 `ccLight` 和 `ccDark` 两个对象,`echarts.registerTheme`
注册。关键点:

- `color`:主色板 6 色(与 tokens 的图表色一致)
- `backgroundColor`:transparent(跟随卡片)
- `textStyle.color`:主题文本色
- axis 的 `lineStyle` / `splitLine` 浅
- `tooltip`:白底(light)/ 深底(dark),8px 圆角,无边框,带阴影
- `legend`:底部居中,圆形图例,小字号

## 7 · 异常状态与空状态

- Loading:保持 `Spin`,外层加 `minHeight: 240` 的容器避免抖动
- Empty:新建 `EmptyState` 组件,统一 Empty 图示、标题、描述、主按钮(例如
  「点击右上角刷新数据」或「运行 `ccu scan`」)
- Error(query 失败):新建通用 `ErrorState` 组件,显示错误文案 + 重试按钮
  (调用 queryClient.invalidateQueries)

## 8 · 测试

- 视觉回归不做(单人工具,不值当)
- 跑通基本路径:
  - 浅色切暗色,所有图表颜色、卡片底色、文字对比都正常
  - 刷新数据 → query invalidate → KpiCard 的值和 sparkline 都重新渲染
  - 空库状态(messageCount === 0)下各页面 EmptyState 显示正常
- 现有 vitest 测试保持绿

## 9 · 风险与权衡

- **antd theme 切换开销**:切暗色会触发整棵组件树重渲染。对这种规模(百级组件)
  没问题,但需要 `ConfigProvider` 放在尽量高的层级。
- **BarList 替代 echarts 柱状图**:丢失了 echarts 的 tooltip 富信息,但换来布局
  稳定和不截断。权衡倾向后者。需要时后续可以给 BarList 加 antd Tooltip。
- **Sidebar 在 light mode 也深色**:算一个刻意的不对称,视觉上层级更清晰,
  但有些用户会觉得"不统一"。目前选保留深色,如果实现后感觉别扭再回炉。

## 10 · 工作量估计(粗)

- 主题模块(tokens / antd-theme / echarts / ThemeProvider):~2 小时
- 全局壳层重做(Sidebar 图标 + Footer + Header + ThemeToggle):~1 小时
- KpiCard 升级 + BarList 新增 + PageHeader + EmptyState:~2 小时
- 五个页面逐个替换组件 + 应用主题:~3 小时
- 联调、暗色微调、空状态测试:~2 小时

合计约 10 小时,分 3-4 次提交。

## 11 · 分阶段落地

1. **地基**:tokens、antd-theme、echarts 两套主题、ThemeProvider、ThemeToggle。
2. **壳层**:Sidebar(深色 + 图标 + Footer)、Header(PageHeader + 全局 actions)。
3. **组件**:KpiCard、BarList、PageHeader、EmptyState。
4. **页面**:Overview → Projects → Sessions → Session Detail → Cost(顺序按影响面)。
5. **收尾**:暗色模式全页扫一遍、空状态扫一遍、README 截图替换。

每一步结束都可以提交并在浏览器里观察,不会出现长时间不可用的中间态。
