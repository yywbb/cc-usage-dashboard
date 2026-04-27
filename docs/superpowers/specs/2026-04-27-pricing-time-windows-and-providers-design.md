# 价格体系：时间窗 + 供应商

设计日期：2026-04-27
状态：草案 · 待用户 review 后转入实现计划

## 动机

现有价格体系是单层 `pricing_overrides(model PK, ...)` 表 —— 每模型一行、无时间维度。两个问题：

1. **价格无法随时间变化**：模型供应商会调价（涨价、促销、阶段性折扣），但当前不管何时的消息一律按"最新价"算，重算后历史成本被覆盖、不可还原。
2. **没有供应商概念**：用户已开始尝试三方 Claude-compatible 厂商（DeepSeek、GLM 等），但所有模型都被当成一类无差别管理，UI 既无法分组、也无法批量管理同供应商的模型。

本次改造：引入 `providers / models / pricing` 三表，价格按 `(model, effective_from)` 时间窗存储，重算自动按消息 timestamp 选窗。供应商作为模型的组织层（不影响价格主键，但用于 UI 分组与新模型默认归属）。

## 目标

- 一个模型可以有 N 条带 `effective_from` 的价格记录，重算与入库都按消息时间戳选命中窗口
- 维护供应商实体（CRUD），每个模型归属一个供应商
- 未注册的新模型自动归到内置 `unknown` 供应商，成本计 0，UI 显式提示
- Dashboard 在 Overview 与 Sessions 上暴露供应商维度

## 非目标

- 同一模型在不同供应商下定不同价（用户已确认本期不需要）
- 重算时按日期范围筛选（保留全量重算）
- 价格自动同步外部数据源
- Cost 页面、Project Detail 页面的 provider 维度改造（数据模型支持，下个迭代再做 UI）

## 数据模型

迁移 `003_provider_pricing.sql` 新建三表，drop 旧表 `pricing_overrides`：

```sql
CREATE TABLE providers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,         -- 'anthropic' | 'deepseek' | 'unknown'
  display_name  TEXT NOT NULL,                -- 'Anthropic'
  is_builtin    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE models (
  model_name    TEXT PRIMARY KEY,
  provider_id   INTEGER NOT NULL REFERENCES providers(id),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE pricing (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  model_name      TEXT NOT NULL REFERENCES models(model_name) ON DELETE CASCADE,
  effective_from  TEXT NOT NULL,              -- 'YYYY-MM-DD' 本地日 0 点切换
  input           REAL NOT NULL,              -- USD per million tokens
  output          REAL NOT NULL,
  cache_create    REAL NOT NULL,
  cache_read      REAL NOT NULL,
  note            TEXT,
  created_at      INTEGER NOT NULL,
  UNIQUE (model_name, effective_from)
);

CREATE INDEX idx_pricing_lookup ON pricing(model_name, effective_from DESC);
```

**种子数据**（迁移内 INSERT）：

- `providers`: `('anthropic', 'Anthropic', 1, ...)`、`('unknown', 'Unknown', 1, ...)`
- `models`: `DEFAULT_PRICING_PER_M` 所有 key → `provider_id` 指向 anthropic

**老数据迁移**：`pricing_overrides` 每行 → `pricing` 一行，`effective_from='1970-01-01'`、`note='迁移自旧规则'`。对应 model 若不在 `models` 表则补登 anthropic（理论上不应发生，所有老 override 都是 Anthropic 模型）。最后 `DROP TABLE pricing_overrides`。

**硬编码 `DEFAULT_PRICING_PER_M` 保留** 为最终兜底：当 DB 里某模型没有任何 pricing 行时回退到内置默认；这样新增 Anthropic 模型无需手工配也能正常算价。

## 价格查找算法

入库与重算共用：

```ts
interface PriceCtx {
  db: Database;
  modelMeta: Map<string, { providerSlug: string }>; // 预加载: 全部 models JOIN providers
  windowsByModel: Map<string, Window[]>;            // 预加载: 按 model 分组、effective_from 升序
  defaults: Map<string, ModelPriceM>;               // DEFAULT_PRICING_PER_M 转 Map
}

function priceFor(ctx: PriceCtx, model: string, messageTimestampMs: number): ModelPriceM | null {
  let meta = ctx.modelMeta.get(model);
  // 1. 模型未登记 → 写 unknown + 同步更新 ctx 缓存（避免同批次重复插入）
  if (!meta) {
    autoCreateUnderUnknown(ctx.db, model);
    meta = { providerSlug: 'unknown' };
    ctx.modelMeta.set(model, meta);
  }
  if (meta.providerSlug === 'unknown') return null;

  // 2. 命中窗口（effective_from <= 消息日期，最新一条）
  const date = toLocalYMD(messageTimestampMs);
  const hit = pickWindow(ctx.windowsByModel.get(model), date);
  if (hit) return hit;

  // 3. 兜底硬编码默认
  return ctx.defaults.get(model) ?? null;
}
```

每个调用入口（批次入库、`/api/recompute-cost`）开始时构造一次 `PriceCtx`：

- `modelMeta`：`SELECT m.model_name, p.slug FROM models m JOIN providers p ON p.id=m.provider_id` 一次性加载
- `windowsByModel`：`SELECT * FROM pricing ORDER BY model_name, effective_from` 一次性加载并 group
- `defaults`：从 `DEFAULT_PRICING_PER_M` 静态构造

`pickWindow()` 在已升序数组上做线性扫（N 通常 <10）或二分，查找 `effective_from <= date` 的最大项。

**关键差异**：移除当前代码里"未知模型 → 当成 Sonnet 算"的隐式 fallback。未知模型一律计 0 + UI 标红，避免成本数字静默错误。

时区：`toLocalYMD` 用 Node 默认时区（用户机器本地），与既有 SQL `date(timestamp/1000,'unixepoch','localtime')` 约定一致。

## API

替换/扩展 `routes/pricing.ts`：

```
GET    /api/providers                # 列表 + 每个 provider 的模型计数
POST   /api/providers                # body: { slug, displayName }
PATCH  /api/providers/:id            # body: { displayName }
DELETE /api/providers/:id            # 仅非 builtin；级联：旗下模型 reassign 到 unknown

GET    /api/models                   # 全量 + provider_slug + usage 聚合 + 当前生效价
PATCH  /api/models/:model            # body: { providerId }（"移到供应商"）
DELETE /api/models/:model            # 删模型 + 其所有 pricing 行（CASCADE）

GET    /api/pricing/:model           # 该模型所有窗口（按 effective_from desc 排）
POST   /api/pricing/:model           # body: { effectiveFrom, input, output, cacheCreate, cacheRead, note? }
PATCH  /api/pricing/:id              # 改某条窗口（model_name 不可改）
DELETE /api/pricing/:id

POST   /api/recompute-cost           # 全量重算，按时间窗
```

校验：
- `slug` 必须 `^[a-z0-9-]{1,32}$`，唯一
- `effective_from` 必须 `^\d{4}-\d{2}-\d{2}$`
- `(model_name, effective_from)` 唯一
- 价格字段非负有限数
- builtin provider 不可删；删非 builtin 时若旗下有模型，全部 reassign 到 unknown（不级联删 model/messages）

`/api/recompute-cost` 返回 `{ updatedSessions, totalCostUsd, unconfiguredCount }` —— `unconfiguredCount` 给前端显示"N 条消息因模型未配置成本计为 0"。

## UI

### Settings → 计费规则

工具栏：`[ 🌐 管理供应商 ]  [ + 新增模型 ]                [ ↻ 重算历史成本 ]`

**主表**（按 provider 分组排序，再按模型名）：

| Provider | Model | 使用量 | 当前价 (input/output/cc/cr) | 操作 |
|---|---|---|---|---|
| Anthropic tag | claude-sonnet-4-6 | 1,234 条 · 12.3M tokens · $123.45 | $3 / $15 / $3.75 / $0.30 | [展开 ▼] [编辑] |
| Unknown ⚠️ | claude-sonnet-4-7 | 12 条 · 0.1M · **$0** | — | [移到供应商 ▾] |

- "当前价" 取最新一条 `pricing` 窗口；无窗口时显示硬编码默认（带 "默认" 灰标）；unknown 行价格列显示 — 并将 cost 列高亮警示色
- 顶部 Alert：检测到未配置模型时列出 + 一键"移到供应商"

**展开行 = 价格历史子表**：

```
价格历史                                          [ + 新增价格调整 ]
───────────────────────────────────────────────────
生效日期      input   output   cc      cr      备注          操作
2026-04-01    $3.00   $15.00   $3.75   $0.30   涨价         [编辑] [删除]
1970-01-01    $3.00   $15.00   $3.75   $0.30   迁移自旧规则  [编辑] [删除]
```

- 新增/编辑窗口弹小 Modal：日期选择器 + 4 个价格 + 备注
- 未来日期允许（"预约调价"），UI 用 dashed 边框标示
- `(model, effective_from)` 重复时报错

**管理供应商 Modal**：列 slug / display_name / 模型数 / 操作；新增、改 display_name、删除（builtin 不可删；非 builtin 删除前 confirm "将把 N 个模型移到 Unknown"）

**移到供应商**：下拉选已有 provider 或 "+ 新建供应商..."

### Overview

- 趋势图原 `按 model / 按 type` 切换扩为 `按 model / 按 type / 按 provider`
- byModel 卡片旁加一个 "供应商分布" `BarList`（tokens / cost 双切换，与 byModel 一致）
- API：`/api/overview` 返回新增 `byProvider: { provider, totalTokens, costUsd }[]` 与 `dailyTrend.byProvider`（与现有 `byModel` 平行）

### Sessions

- 筛选栏增加"供应商"多选，options 来自 `/api/providers`
- API：`/api/sessions` 接受 `providers[]` query 参数，过滤逻辑 = "session 内任意 message 的 model 归属于所选 provider 之一"
- KPI 行不变；列表表格不增加 provider 列（避免拥挤），detail 页面也不在本期增加

## 迁移步骤

1. 写 `migrations/003_provider_pricing.sql`：建三表 + 索引
2. 写 TS 数据迁移函数（在 `openDb` 启动流程里跑，幂等）：
   a. INSERT 内置 providers
   b. INSERT `DEFAULT_PRICING_PER_M` 模型 → anthropic
   c. 把老 `pricing_overrides` 行迁到 `pricing`，effective_from='1970-01-01'，model 不存在则补登 anthropic
   d. DROP `pricing_overrides`
3. `pricing.ts`：保留 `DEFAULT_PRICING_PER_M`，新增 `priceFor()` + `loadWindowsForModels()`，弃用 `loadPriceTable()`
4. `writer.ts` / `admin.ts` 改用 `priceFor()`
5. `routes/pricing.ts`：新 endpoint 集；删旧的
6. 前端 `Settings/Pricing.tsx` 重写；新增 `Settings/ProvidersModal.tsx`、`Settings/PricingHistory.tsx`、`Settings/MoveProviderDropdown.tsx`
7. Overview / Sessions 页面与 hooks 调整
8. 写测试（见下）

## 测试

`vitest`，关键路径：

- **`priceFor()`**：未注册 → unknown + null；注册无窗口 → 兜底默认；多窗口 → 按时间戳命中正确那个；时间戳早于所有窗口 → 兜底默认；硬编码也没 → null
- **时区边界**：`toLocalYMD(ts)` 在本地午夜前后的 timestamp 切日正确
- **迁移**：fixture DB 含老 pricing_overrides → 跑迁移 → 断言 `pricing` 表行存在、`effective_from='1970-01-01'`、老表已 drop、模型已登记到 anthropic
- **重算**：插桩多个模型 + 多个时间窗 + 跨窗消息 → 调 `/api/recompute-cost` → 断言每条消息 cost 用了正确窗口的价；包含 unconfiguredCount 路径
- **API CRUD**：providers / models / pricing 各路径，含 builtin 不可删、删 provider 级联到 unknown
- **Sessions provider 过滤**：构造跨 provider 的 session → 验证 `providers[]` 过滤命中

## Open Questions

无。已与用户对齐：

- 不区分同模型在不同 provider 下不同价（Q1）
- 未注册模型 → unknown + 0 + UI 标红（Q1）
- 时间窗口仅 `effective_from`、按本地日（Q3）
- 重算只做全量、不加日期范围筛选（Q4）
- Dashboard provider 维度本期落到 Overview + Sessions 两处（最后澄清）
