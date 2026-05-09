# 计费规则页面 UI/UX 中度优化 — 设计

- 日期：2026-05-09
- 范围：`src/web/pages/Settings/Pricing.tsx` + `src/web/pages/Settings/PricingHistoryTable.tsx`
- 不改动：所有后端 API、`ProvidersModal.tsx` 内部、TanStack Query 缓存键、theme tokens、全局 store
- 目标：重组三区结构，让"哪些模型未配置"、"当前价格是什么"、"何时生效"在不展开任何面板的前提下可读

## 当前痛点回顾

1. 顶部 3 个按钮无主次，全部右对齐挤成一排（`管理供应商` / `新增模型` / `重算历史成本`）
2. 两条 `Alert`（warning + info）永久占位，info 文案长且每次进入都要看一遍
3. 模型表是平铺，没有按供应商分组、无搜索、无筛选；模型多了难以定位
4. "操作"列只有一个无 label 的供应商 `Select`，"转移到另一个供应商"的语义不直观
5. "当前价"列把 `input/output/cacheCreate/cacheRead` 4 个数字用 `/` 串成 `${a}/${b}/${c}/${d}` 一坨，扫读困难
6. 展开的"价格历史"用一层 `<div style={{ background, padding }}>` 包裹，与外层 Card 视觉脱节
7. Unknown 模型只有 ⚠ Tag 没有内联指派入口，处理路径长（先转移 → 再展开 → 再加价）
8. 重算按钮无"上次重算时间"反馈，用户不知道是否最近做过
9. 新增/编辑 Modal 中 4 个价格 InputNumber 用 `Space wrap`、宽度 `140/140/160/160`，视觉错落

## 三区目标布局

```
┌─ KPI 条 ───────────────────────────────────────────────────────────────────┐
│ 供应商 4   模型 12   未配置 1 ⚠   上次重算 5 分钟前 ⓘ        [重算历史成本] │
└──────────────────────────────────────────────────────────────────────────┘

[全部] [Anthropic 5] [DeepSeek 2] [GLM 1] [⚠ Unknown 1]    🔍 搜索   [+ 新增模型] [管理供应商]

┌─ 模型表 ─────────────────────────────────────────────────────────────────┐
│ 模型              Input   Output  CC     CR     价格源         使用量          操作│
│▾ claude-sonnet-4   3.00   15.00   3.75   0.30   ⚡2025-10-15  1.2M·$32.10  转移·编辑│
│  ┌─ 价格历史 ────────────────────────────────────  [+ 新增调价] ─┐         │
│  │ 生效日期        In    Out    CC    CR    备注      操作        │         │
│  │ ⚡2025-10-15    3.00  15.00  3.75  0.30  -        ✎  🗑        │         │
│  │   2024-08-01   1.50  7.50   1.88  0.15  发布      ✎  🗑        │         │
│  └─────────────────────────────────────────────────────────────┘         │
│  claude-opus-4     15.00  75.00  18.75  1.50  默认            820k·$61.40  转移·编辑│
└─────────────────────────────────────────────────────────────────────────┘
```

## A. 顶部 KPI 条

替代原来"右上角 3 按钮排"。

- 容器：横向 `Card`，左侧 4 个微型 KPI（label/value 上下两行），右侧主按钮 `[重算历史成本]`（保留 `ReloadOutlined`，type="primary"）
- 4 个 KPI 数据来源：
  - 供应商：`providers.data?.length`
  - 模型：`models.data?.length`
  - 未配置：`models.data?.filter(r => r.providerSlug === 'unknown').length`，>0 时数字使用 `t.warning` + 小 ⚠ 图标
  - 上次重算：相对时间（`刚刚 / N 分钟前 / N 小时前 / N 天前`），从未重算显示 `—`
- "上次重算" 的持久化：`localStorage` key 为 `cc-usage:lastRecomputeAt`，写入时机为 `recomputeMut.onSuccess`；读取后用 `dayjs().to(dayjs(stored))` 输出
- 该 KPI 旁边带 ⓘ Tooltip，hover 出原 info Alert 的文案：「新数据落库时按消息时间戳查窗口价；修改价格不影响已存入的成本，需要手动「重算历史成本」。」

## B. 供应商 Segmented + 搜索 + 次按钮

KPI 条下方，模型表上方的"次级筛选条"。

- 控件选型：`Segmented`（不是 antd `Tabs`）。一级 Tabs 是 `[显示偏好][计费规则]`，再用 Tabs 会视觉混淆；Segmented 视觉权重更轻
- 选项：
  - `全部`（默认值）
  - 每个 provider — `displayName + (modelCount)` 后缀；建议数据：`{ label: 'Anthropic 5', value: <providerId> }`
  - `⚠ Unknown (N)` — 仅当 `unconfiguredCount > 0` 时出现且置末位；warning 色
- 右侧：
  - `Input.Search`（占位 `搜索模型名`），client-side `String.includes` 匹配 `modelName`
  - `[+ 新增模型]` 次按钮（不再是顶部主按钮）
  - `[管理供应商]` 次按钮
- 过滤是 client-side：先按 segmented 过滤 providerId（或 `slug === 'unknown'`），再按搜索词

## C. Alert 简化

- 删除原 info Alert（其文案搬到 KPI "上次重算" 的 ⓘ Tooltip）
- 保留 warning Alert 但仅在 `unconfigured.length > 0` 时显示，文案精简为：
  > 检测到 {N} 个未配置模型，当前成本计为 0。在「⚠ Unknown」标签内为它们指派供应商并设价。
- 不再列出未配置模型的具体名字（KPI + Unknown Tab 已经能找到它们）

## D. 模型表列重排

列顺序与样式：

| # | 列名 | 宽度 | 对齐 | 渲染 |
|---|------|-----|------|------|
| 1 | 模型 | flex | left | `<strong>{modelName}</strong>`；当 segmented 处于 `全部` 时下方显示一行小字 `{providerDisplayName}` 副标 |
| 2 | Input | 90 | right | `${row.currentPrice?.input?.toFixed(2) ?? '—'}`；tabular-nums；可排序 |
| 3 | Output | 90 | right | 同上，字段 `output` |
| 4 | CC | 90 | right | 同上，字段 `cacheCreate` |
| 5 | CR | 90 | right | 同上，字段 `cacheRead` |
| 6 | 价格源 | 130 | left | `默认` 灰 Tag / `⚡<日期>` 绿 Tag / `未配置` 红字 |
| 7 | 使用量 | 200 | left | `{messageCount} 条 · {fmt(totalTokens)} tk · ${costUsd.toFixed(2)}`，textSecondary |
| 8 | 操作 | 150 | right | 见下 |

操作列：

- 普通行：两个 `Button type="link" size="small"`，`转移` 与 `编辑`
  - `转移`：用 antd `Dropdown` 包裹，菜单项是所有 providers；点击触发 `moveMut.mutate({ model, providerId })`（替代原来的 inline `Select`）
  - `编辑`：调用一个本地 `expandedKeys` setter 把当前 row 加入 expanded 集合（替代点击行首箭头），让"价格历史"面板展开并自然定位到该行下方
- Unknown 行：操作列改为单个 `type="primary" size="small"` 按钮 `指派供应商 ▼`（点击复用同一个 Dropdown 菜单）；"编辑"隐藏（未配置时无价可编）
- 表格内置 `expandable.expandedRowRender = PricingHistoryTable`，但触发器换成"操作-编辑"按钮；行首的展开箭头仍保留（`expandIcon` 默认）以让用户也能直接点开

## E. 嵌入式"价格历史"面板

`PricingHistoryTable` 容器与表头视觉重新打磨：

- 外层 `<div>` 改为：
  - 背景透明（移除原 `var(--cc-bg-subtle)`）
  - `borderLeft: 3px solid {t.primary}`，`paddingLeft: 16, paddingTop: 12, paddingBottom: 12`
  - 头部一行：左 `<strong>价格历史</strong>` + 右 `[+ 新增调价]`
- "生效日期"列：当前生效行加 ⚡ icon + `t.success` 色 + 加粗；待生效行（`v > today`）保持 opacity 0.6
- "操作"列：保留 `EditOutlined` 与 `DeleteOutlined`（带 Popconfirm），间距收紧到 `Space size={2}`
- 表格 `size="small"` 不变；空态文案不变

## F. Modal 表单 2×2 网格

`Pricing.tsx` 的"新增模型"Modal 与 `PricingHistoryTable.tsx` 的"新增/编辑调价"Modal 都做同样改造：

```tsx
<Row gutter={[12, 0]}>
  <Col span={12}>
    <Form.Item label="Input ($/M)" name="input" rules={[{ required: true }]}>
      <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
    </Form.Item>
  </Col>
  <Col span={12}>
    <Form.Item label="Output ($/M)" name="output" rules={[{ required: true }]}>
      <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
    </Form.Item>
  </Col>
  <Col span={12}>
    <Form.Item label="Cache Create ($/M)" name="cacheCreate" rules={[{ required: true }]}>
      <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
    </Form.Item>
  </Col>
  <Col span={12}>
    <Form.Item label="Cache Read ($/M)" name="cacheRead" rules={[{ required: true }]}>
      <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
    </Form.Item>
  </Col>
</Row>
```

替换原 `<Space size={12} wrap>` + 4 个固定宽度 `InputNumber`。模型名、供应商 `Select`、`DatePicker`、备注 `TextArea` 保持单行原状。

## 不会做的（YAGNI）

- 不引入 Drawer 编辑器（与现有 expandable 重复，且非必须）
- 不为 KPI 增加图表/趋势线
- 不做批量移动 Unknown 模型（单行操作已可覆盖目前规模）
- 不为 Unknown Tab 单独写一套页面 — 它仍是 segmented 的一项，复用同一表
- 不改后端、不增加 `lastRecomputeAt` 服务端字段（前端 `localStorage` 已够用）

## 需要触碰的文件

- `src/web/pages/Settings/Pricing.tsx`：顶部 KPI 条、Segmented + 搜索条、Alert 收敛、表格列重排、操作列 Dropdown 化、新增模型 Modal 表单网格化、`localStorage` 上次重算时间读写
- `src/web/pages/Settings/PricingHistoryTable.tsx`：容器样式（左侧色条）、生效日期列样式、Modal 表单网格化
- 不改：`Settings/index.tsx`、`Settings/Preferences.tsx`、`Settings/ProvidersModal.tsx`

## 验收

- 进入"计费规则"，KPI 条 4 项数据正确（含未配置 N、相对时间）
- 切换 Segmented 各 Tab，模型表只展示对应供应商；`⚠ Unknown` Tab 仅在有未配置模型时出现
- 搜索框输入子串过滤生效（与 segmented 联合工作）
- 模型表 4 个价格列均可点击列头排序
- 价格源列显示三种状态：`⚡<日期>` / `默认` / `未配置`
- 普通行点"转移"弹下拉菜单，点中后供应商立即更新；Unknown 行只有"指派供应商"
- 行展开后看到价格历史面板带左侧色条；当前生效窗口带 ⚡
- 新增/编辑 Modal 中 4 个价格输入排成 2×2 等宽
- 重算后 KPI 中"上次重算"立即更新为"刚刚"，刷新页面后仍保留
- 切到"显示偏好"再切回，KPI/选中 Tab/搜索关键字保持不变（state 在组件内即可）
