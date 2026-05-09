# Pricing Page UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the Settings → 计费规则 (Pricing) tab into a 3-zone layout (KPI strip / provider Segmented + search / repacked model table with split price columns and inline transfer Dropdown), plus polish the inline price-history panel and modal forms. Frontend-only; no API change.

**Architecture:** Extract two presentational components (`PricingHeaderBar`, `PricingFilters`) and a tiny `lastRecomputeAt` localStorage helper, then refactor `Pricing.tsx` to compose them and apply client-side filtering. Polish `PricingHistoryTable.tsx` container and modal grids in place.

**Tech Stack:** React 18, antd 5 (`Card`, `Segmented`, `Dropdown`, `Tag`, `Tooltip`, `Row/Col`), `@ant-design/icons`, `@tanstack/react-query`, dayjs (with `relativeTime` plugin — new dependency-free extension).

**Spec:** `docs/superpowers/specs/2026-05-09-pricing-page-ui-redesign-design.md`

**File map:**

- Create `src/web/pages/Settings/lastRecomputeAt.ts` — pure helper to read/write the last-recompute timestamp in localStorage and format it as relative time
- Create `src/web/pages/Settings/PricingHeaderBar.tsx` — KPI strip + primary `重算历史成本` button; props are counts + isoString + handlers
- Create `src/web/pages/Settings/PricingFilters.tsx` — `Segmented`(供应商) + `Input.Search` + `[新增模型]` + `[管理供应商]`
- Modify `src/web/pages/Settings/Pricing.tsx` — replace top action bar with the two new components, add filter state, repack table columns, swap inline `Select` for `Dropdown`, simplify Alerts, modal 2×2 grid
- Modify `src/web/pages/Settings/PricingHistoryTable.tsx` — container left-border style, current-window ⚡ marker, modal 2×2 grid
- No backend changes; no other pages

**Verification:**

- After every task: `npm run typecheck` (must pass), then visually verify the affected area in `npm run dev` at `http://localhost:47822/settings`
- Final task: walk the full acceptance list from the spec

---

### Task 1: lastRecomputeAt helper

**Files:**
- Create: `src/web/pages/Settings/lastRecomputeAt.ts`

- [ ] **Step 1: Create the helper module**

Create `src/web/pages/Settings/lastRecomputeAt.ts` with the exact content below. The `dayjs.extend(relativeTime)` call lives in the module's top-level so any importer triggers the plugin once.

```ts
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime.js';
import 'dayjs/locale/zh-cn.js';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const KEY = 'cc-usage:lastRecomputeAt';

export function getLastRecomputeAt(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setLastRecomputeAt(iso: string = new Date().toISOString()): void {
  try {
    localStorage.setItem(KEY, iso);
  } catch {
    // Ignore quota / private-mode errors — purely cosmetic field.
  }
}

export function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const d = dayjs(iso);
  if (!d.isValid()) return '—';
  return d.fromNow();
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes (no new errors).

- [ ] **Step 3: Commit**

```bash
git add src/web/pages/Settings/lastRecomputeAt.ts
git commit -m "feat(pricing): add lastRecomputeAt localStorage helper with relative-time formatter"
```

---

### Task 2: PricingHeaderBar component

**Files:**
- Create: `src/web/pages/Settings/PricingHeaderBar.tsx`

- [ ] **Step 1: Create the component**

Create `src/web/pages/Settings/PricingHeaderBar.tsx` with the content below. This is a stateless presentational component; the parent passes data + handlers.

```tsx
import { Card, Button, Tooltip, Space } from 'antd';
import { ReloadOutlined, WarningFilled, InfoCircleOutlined } from '@ant-design/icons';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';
import { formatRelative } from './lastRecomputeAt.js';

interface Props {
  providerCount: number;
  modelCount: number;
  unconfiguredCount: number;
  lastRecomputeAt: string | null;
  isRecomputing: boolean;
  onRecompute: () => void;
}

const RECOMPUTE_HINT
  = '新数据落库时按消息时间戳查窗口价；修改价格不影响已存入的成本，需要手动「重算历史成本」。';

export default function PricingHeaderBar({
  providerCount, modelCount, unconfiguredCount,
  lastRecomputeAt, isRecomputing, onRecompute,
}: Props) {
  const { mode } = useTheme();
  const t = TOKENS[mode];

  return (
    <Card style={{ marginBottom: 12 }} styles={{ body: { padding: '14px 18px' } }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 32, flexWrap: 'wrap' }}>
        <Kpi label="供应商" value={providerCount} t={t} />
        <Kpi label="模型" value={modelCount} t={t} />
        <Kpi
          label="未配置"
          value={unconfiguredCount}
          warn={unconfiguredCount > 0}
          icon={unconfiguredCount > 0 ? <WarningFilled style={{ color: t.warning }} /> : undefined}
          t={t}
        />
        <Kpi
          label={
            <Space size={4}>
              <span>上次重算</span>
              <Tooltip title={RECOMPUTE_HINT}>
                <InfoCircleOutlined style={{ color: t.textMuted, cursor: 'help' }} />
              </Tooltip>
            </Space>
          }
          value={formatRelative(lastRecomputeAt)}
          t={t}
        />
        <div style={{ flex: 1 }} />
        <Button
          type="primary"
          icon={<ReloadOutlined />}
          loading={isRecomputing}
          onClick={onRecompute}
        >重算历史成本</Button>
      </div>
    </Card>
  );
}

function Kpi({
  label, value, warn, icon, t,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  warn?: boolean;
  icon?: React.ReactNode;
  t: typeof TOKENS['light'];
}) {
  return (
    <div style={{ minWidth: 110 }}>
      <div style={{ fontSize: 12, color: t.textSecondary, lineHeight: 1.4 }}>{label}</div>
      <div style={{
        fontSize: 18, fontWeight: 600, lineHeight: 1.2, marginTop: 2,
        color: warn ? t.warning : t.textPrimary,
        fontVariantNumeric: 'tabular-nums',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {icon}{value}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/web/pages/Settings/PricingHeaderBar.tsx
git commit -m "feat(pricing): add PricingHeaderBar with KPIs and primary recompute action"
```

---

### Task 3: PricingFilters component

**Files:**
- Create: `src/web/pages/Settings/PricingFilters.tsx`

- [ ] **Step 1: Create the component**

Create `src/web/pages/Settings/PricingFilters.tsx`. The Segmented value uses `'all'` for the "全部" option, `'unknown'` for the unknown bucket, and `providerId: number` for each provider. Search is a controlled string. Buttons are passed through.

```tsx
import { Segmented, Input, Button, Space } from 'antd';
import { PlusOutlined, WarningFilled } from '@ant-design/icons';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';

export type ProviderFilter = 'all' | 'unknown' | number;

interface ProviderOption {
  id: number;
  displayName: string;
  modelCount: number;
}

interface Props {
  providers: ProviderOption[];        // excluding the unknown bucket
  unconfiguredCount: number;
  value: ProviderFilter;
  onChange: (v: ProviderFilter) => void;
  search: string;
  onSearchChange: (v: string) => void;
  onAddModel: () => void;
  onManageProviders: () => void;
}

export default function PricingFilters({
  providers, unconfiguredCount, value, onChange,
  search, onSearchChange, onAddModel, onManageProviders,
}: Props) {
  const { mode } = useTheme();
  const t = TOKENS[mode];

  const segmentedOptions: Array<{ label: React.ReactNode; value: ProviderFilter }> = [
    { label: '全部', value: 'all' },
    ...providers.map(p => ({
      label: <span>{p.displayName} <span style={{ color: t.textMuted }}>{p.modelCount}</span></span>,
      value: p.id as ProviderFilter,
    })),
  ];
  if (unconfiguredCount > 0) {
    segmentedOptions.push({
      label: (
        <span style={{ color: t.warning }}>
          <WarningFilled style={{ marginRight: 4 }} />
          Unknown {unconfiguredCount}
        </span>
      ),
      value: 'unknown',
    });
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      marginBottom: 12,
    }}>
      <Segmented
        options={segmentedOptions}
        value={value}
        onChange={(v) => onChange(v as ProviderFilter)}
      />
      <div style={{ flex: 1 }} />
      <Input.Search
        placeholder="搜索模型名"
        allowClear
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        style={{ width: 240 }}
      />
      <Space size={8}>
        <Button icon={<PlusOutlined />} onClick={onAddModel}>新增模型</Button>
        <Button onClick={onManageProviders}>管理供应商</Button>
      </Space>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/web/pages/Settings/PricingFilters.tsx
git commit -m "feat(pricing): add PricingFilters component (Segmented + search + secondary buttons)"
```

---

### Task 4: Refactor Pricing.tsx — top zone + filtering

This task replaces the old top-button bar and Alerts with `PricingHeaderBar` + `PricingFilters`, applies client-side filtering, and persists the last-recompute timestamp. The model-table columns are still the OLD shape — Task 5 repacks them.

**Files:**
- Modify: `src/web/pages/Settings/Pricing.tsx`

- [ ] **Step 1: Replace the top section and add filter state**

Open `src/web/pages/Settings/Pricing.tsx`. Below is the **full new file**; overwrite the existing one. (Table column shape unchanged — that's Task 5.)

```tsx
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Tag, Modal, Form, Input, InputNumber, DatePicker, Select,
  Space, Empty, Alert, message, Row, Col,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { api } from '../../api/client.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';
import ProvidersModal from './ProvidersModal.js';
import PricingHistoryTable from './PricingHistoryTable.js';
import PricingHeaderBar from './PricingHeaderBar.js';
import PricingFilters, { type ProviderFilter } from './PricingFilters.js';
import { getLastRecomputeAt, setLastRecomputeAt } from './lastRecomputeAt.js';

interface Provider {
  id: number; slug: string; displayName: string; isBuiltin: number; modelCount: number;
}

interface ModelPriceM {
  input: number; output: number; cacheCreate: number; cacheRead: number;
}

interface ModelView {
  modelName: string;
  providerId: number;
  providerSlug: string;
  providerDisplayName: string;
  totalTokens: number;
  costUsd: number;
  messageCount: number;
  currentPrice: ModelPriceM | null;
  priceSource: 'window' | 'default' | 'none';
  currentEffectiveFrom: string | null;
}

interface RecomputeResp {
  updatedSessions: number;
  totalCostUsd: number;
  unconfiguredCount: number;
}

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

export default function PricingSettings() {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const qc = useQueryClient();
  const [providersOpen, setProvidersOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState<ProviderFilter>('all');
  const [search, setSearch] = useState('');
  const [lastRecomputeAt, setLastRecomputeAtState] = useState<string | null>(getLastRecomputeAt);
  const [form] = Form.useForm<{
    modelName: string; providerId: number;
    effectiveFrom: Dayjs; input: number; output: number; cacheCreate: number; cacheRead: number;
  }>();

  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.get<Provider[]>('/api/providers'),
  });

  const models = useQuery({
    queryKey: ['models'],
    queryFn: () => api.get<ModelView[]>('/api/models'),
  });

  const moveMut = useMutation({
    mutationFn: (v: { model: string; providerId: number }) =>
      api.patch(`/api/models/${encodeURIComponent(v.model)}`, { providerId: v.providerId }),
    onSuccess: () => {
      message.success('已转移');
      qc.invalidateQueries();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const addMut = useMutation({
    mutationFn: async (v: {
      modelName: string; providerId: number;
      effectiveFrom: string; input: number; output: number; cacheCreate: number; cacheRead: number;
    }) => {
      await api.post('/api/models', { modelName: v.modelName, providerId: v.providerId });
      return api.post(`/api/pricing/${encodeURIComponent(v.modelName)}`, {
        effectiveFrom: v.effectiveFrom,
        input: v.input, output: v.output, cacheCreate: v.cacheCreate, cacheRead: v.cacheRead,
      });
    },
    onSuccess: () => {
      message.success('已新增模型');
      setAddOpen(false); form.resetFields();
      qc.invalidateQueries();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const recomputeMut = useMutation({
    mutationFn: () => api.post<RecomputeResp>('/api/recompute-cost'),
    onSuccess: (r) => {
      const tail = r.unconfiguredCount > 0 ? `（${r.unconfiguredCount} 条因未配置计为 0）` : '';
      message.success(`已重算 ${r.updatedSessions} 个会话，总成本 $${r.totalCostUsd.toFixed(2)}${tail}`);
      const iso = new Date().toISOString();
      setLastRecomputeAt(iso);
      setLastRecomputeAtState(iso);
      qc.invalidateQueries();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const allRows = models.data ?? [];
  const unconfigured = allRows.filter(r => r.providerSlug === 'unknown');
  const providerOptions = (providers.data ?? [])
    .filter(p => p.slug !== 'unknown')
    .map(p => ({ id: p.id, displayName: p.displayName, modelCount: p.modelCount }));

  const rows = useMemo(() => {
    let list = allRows;
    if (filter === 'unknown') {
      list = list.filter(r => r.providerSlug === 'unknown');
    } else if (typeof filter === 'number') {
      list = list.filter(r => r.providerId === filter);
    }
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(r => r.modelName.toLowerCase().includes(q));
    return list;
  }, [allRows, filter, search]);

  return (
    <>
      <PricingHeaderBar
        providerCount={providers.data?.filter(p => p.slug !== 'unknown').length ?? 0}
        modelCount={allRows.length}
        unconfiguredCount={unconfigured.length}
        lastRecomputeAt={lastRecomputeAt}
        isRecomputing={recomputeMut.isPending}
        onRecompute={() => recomputeMut.mutate()}
      />

      <PricingFilters
        providers={providerOptions}
        unconfiguredCount={unconfigured.length}
        value={filter}
        onChange={setFilter}
        search={search}
        onSearchChange={setSearch}
        onAddModel={() => setAddOpen(true)}
        onManageProviders={() => setProvidersOpen(true)}
      />

      {unconfigured.length > 0 && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 12 }}
          message={`检测到 ${unconfigured.length} 个未配置模型，当前成本计为 0。在「⚠ Unknown」标签内为它们指派供应商并设价。`}
        />
      )}

      <Card>
        <Table<ModelView>
          rowKey="modelName"
          loading={models.isLoading}
          dataSource={rows}
          pagination={false}
          size="middle"
          locale={{ emptyText: <Empty description="还没有数据，先去刷新或在「新增模型」中预先配置" /> }}
          expandable={{
            expandedRowRender: (r) => <PricingHistoryTable model={r.modelName} />,
            rowExpandable: (r) => r.providerSlug !== 'unknown',
          }}
          columns={[
            {
              title: '供应商', dataIndex: 'providerSlug', width: 130,
              render: (slug: string, row: ModelView) => slug === 'unknown'
                ? <Tag color="warning">⚠ Unknown</Tag>
                : <Tag color="processing">{row.providerDisplayName}</Tag>,
            },
            {
              title: '模型', dataIndex: 'modelName',
              render: (v: string) => <span style={{ fontWeight: 500, color: t.textPrimary }}>{v}</span>,
            },
            {
              title: '使用量', key: 'usage', width: 280,
              render: (_: unknown, r: ModelView) => (
                <span style={{ color: t.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
                  {r.messageCount.toLocaleString()} 条 · {fmt(r.totalTokens)} tokens · ${r.costUsd.toFixed(2)}
                </span>
              ),
            },
            {
              title: '当前价 (input/output/cc/cr)', key: 'price', width: 280,
              render: (_: unknown, r: ModelView) => {
                if (!r.currentPrice) return <span style={{ color: t.danger }}>未配置</span>;
                const tag = r.priceSource === 'default' ? '默认' : r.currentEffectiveFrom ?? '';
                return (
                  <Space size={6}>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                      ${r.currentPrice.input}/${r.currentPrice.output}/${r.currentPrice.cacheCreate}/${r.currentPrice.cacheRead}
                    </span>
                    <Tag color={r.priceSource === 'default' ? 'default' : 'green'}>{tag}</Tag>
                  </Space>
                );
              },
            },
            {
              title: '操作', key: 'actions', width: 200, align: 'right',
              render: (_: unknown, r: ModelView) => (
                <Space size={6}>
                  <Select<number>
                    size="small"
                    style={{ width: 140 }}
                    disabled={moveMut.isPending}
                    value={r.providerId}
                    onChange={(pid) => moveMut.mutate({ model: r.modelName, providerId: pid })}
                    options={(providers.data ?? []).map(p => ({ label: p.displayName, value: p.id }))}
                  />
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <ProvidersModal open={providersOpen} onClose={() => setProvidersOpen(false)} />

      <Modal
        title="新增模型"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={async () => {
          const v = await form.validateFields();
          addMut.mutate({
            modelName: v.modelName.trim(),
            providerId: v.providerId,
            effectiveFrom: v.effectiveFrom.format('YYYY-MM-DD'),
            input: v.input, output: v.output, cacheCreate: v.cacheCreate, cacheRead: v.cacheRead,
          });
        }}
        confirmLoading={addMut.isPending}
        destroyOnClose
      >
        <Form
          form={form} layout="vertical" preserve={false}
          initialValues={{ effectiveFrom: dayjs(), input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }}
        >
          <Form.Item label="模型名" name="modelName" rules={[
            { required: true },
            { pattern: /^[A-Za-z0-9._-]{1,64}$/, message: '只能包含字母、数字、. _ -' },
          ]}><Input placeholder="例如 deepseek-chat" /></Form.Item>
          <Form.Item label="供应商" name="providerId" rules={[{ required: true }]}>
            <Select options={(providers.data ?? []).map(p => ({ label: p.displayName, value: p.id }))} />
          </Form.Item>
          <Form.Item label="生效日期" name="effectiveFrom" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
          </Form.Item>
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
        </Form>
      </Modal>
    </>
  );
}
```

Notes for the engineer:
- Imports of `PlusOutlined`, `ReloadOutlined` are removed from this file (now used inside the new components). The `Button` import remains — antd auto-tree-shakes.
- `Space wrap` in the modal is replaced by `Row gutter={[12,0]}` + 4 `Col span={12}` (already done above; do not add it again in Task 7).
- Filtering is `useMemo`-cached on `(allRows, filter, search)`.
- `recomputeMut.onSuccess` now writes to `localStorage` (via helper) and updates local state so the KPI re-renders without a refresh.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes. If you see "unused import" complaints for `Button`, `PlusOutlined`, or `ReloadOutlined`, remove them from the import list.

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`
Open `http://localhost:47822/settings`, click `计费规则`. Verify:
- KPI strip shows 4 metrics, "未配置" red+⚠ if any, "上次重算" shows `—` initially
- Segmented `[全部][provider…][⚠ Unknown N]` renders below the strip; only shows `⚠ Unknown` when N>0
- Search box filters the table by model name substring
- Click "重算历史成本" → KPI changes to "刚刚"; refresh page → still shows recent relative time
- Click "管理供应商" / "新增模型" → modals still work

- [ ] **Step 4: Commit**

```bash
git add src/web/pages/Settings/Pricing.tsx
git commit -m "refactor(pricing): replace top action bar with KPI strip + Segmented filters; add search & last-recompute persistence"
```

---

### Task 5: Repack model-table columns + Dropdown ops

This task swaps the table's column shape (split price into 4 columns, add `价格源`, replace inline `Select` with a `Dropdown` action menu) inside `Pricing.tsx`. The container, header, filters, and modals stay as Task 4 left them.

**Files:**
- Modify: `src/web/pages/Settings/Pricing.tsx`

- [ ] **Step 1: Replace the imports block**

In `Pricing.tsx`, add `Button`, `Dropdown`, `Tooltip` to the antd import and add `DownOutlined` from icons. Replace the top of the file's antd / icon imports as below:

```tsx
import {
  Card, Table, Tag, Modal, Form, Input, InputNumber, DatePicker, Select,
  Space, Empty, Alert, message, Row, Col, Dropdown, Button, Tooltip,
} from 'antd';
import { DownOutlined } from '@ant-design/icons';
```

- [ ] **Step 2: Add a price-cell renderer helper near the top of the component**

Inside `PricingSettings()`, immediately after `const t = TOKENS[mode];`, add:

```tsx
const priceCell = (n: number | undefined) =>
  typeof n === 'number'
    ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{n.toFixed(2)}</span>
    : <span style={{ color: t.textMuted }}>—</span>;
```

- [ ] **Step 3: Replace the `columns={[...]}` block on the main `<Table>`**

Inside the model `<Table>` (the one with `rowKey="modelName"`), replace the entire `columns={[...]}` array with the block below. Preserve the rest of the `<Table>` props.

```tsx
columns={[
  {
    title: '模型', dataIndex: 'modelName',
    render: (v: string, row: ModelView) => (
      <div>
        <div style={{ fontWeight: 500, color: t.textPrimary }}>{v}</div>
        {filter === 'all' && (
          <div style={{ fontSize: 12, color: t.textSecondary, marginTop: 2 }}>
            {row.providerSlug === 'unknown'
              ? <Tag color="warning" style={{ marginRight: 0 }}>⚠ Unknown</Tag>
              : row.providerDisplayName}
          </div>
        )}
      </div>
    ),
  },
  {
    title: 'Input', key: 'input', width: 90, align: 'right',
    sorter: (a, b) => (a.currentPrice?.input ?? -1) - (b.currentPrice?.input ?? -1),
    render: (_: unknown, r: ModelView) => priceCell(r.currentPrice?.input),
  },
  {
    title: 'Output', key: 'output', width: 90, align: 'right',
    sorter: (a, b) => (a.currentPrice?.output ?? -1) - (b.currentPrice?.output ?? -1),
    render: (_: unknown, r: ModelView) => priceCell(r.currentPrice?.output),
  },
  {
    title: 'CC', key: 'cc', width: 80, align: 'right',
    sorter: (a, b) => (a.currentPrice?.cacheCreate ?? -1) - (b.currentPrice?.cacheCreate ?? -1),
    render: (_: unknown, r: ModelView) => priceCell(r.currentPrice?.cacheCreate),
  },
  {
    title: 'CR', key: 'cr', width: 80, align: 'right',
    sorter: (a, b) => (a.currentPrice?.cacheRead ?? -1) - (b.currentPrice?.cacheRead ?? -1),
    render: (_: unknown, r: ModelView) => priceCell(r.currentPrice?.cacheRead),
  },
  {
    title: '价格源', key: 'priceSource', width: 130,
    render: (_: unknown, r: ModelView) => {
      if (!r.currentPrice) return <span style={{ color: t.danger }}>未配置</span>;
      if (r.priceSource === 'default') return <Tag>默认</Tag>;
      return (
        <Tag color="green" style={{ fontVariantNumeric: 'tabular-nums' }}>
          ⚡ {r.currentEffectiveFrom ?? ''}
        </Tag>
      );
    },
  },
  {
    title: '使用量', key: 'usage', width: 200,
    render: (_: unknown, r: ModelView) => (
      <span style={{ color: t.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
        {r.messageCount.toLocaleString()} 条 · {fmt(r.totalTokens)} tk · ${r.costUsd.toFixed(2)}
      </span>
    ),
  },
  {
    title: '操作', key: 'actions', width: 150, align: 'right',
    render: (_: unknown, r: ModelView) => {
      const transferItems = (providers.data ?? [])
        .filter(p => p.slug !== 'unknown' && p.id !== r.providerId)
        .map(p => ({ key: String(p.id), label: p.displayName }));

      const onTransfer: NonNullable<React.ComponentProps<typeof Dropdown>['menu']>['onClick'] = ({ key }) => {
        moveMut.mutate({ model: r.modelName, providerId: Number(key) });
      };

      if (r.providerSlug === 'unknown') {
        return (
          <Dropdown
            menu={{ items: transferItems, onClick: onTransfer }}
            trigger={['click']}
            disabled={moveMut.isPending || transferItems.length === 0}
          >
            <Button size="small" type="primary">
              <Space size={4}>指派供应商 <DownOutlined /></Space>
            </Button>
          </Dropdown>
        );
      }

      return (
        <Space size={4}>
          <Dropdown
            menu={{ items: transferItems, onClick: onTransfer }}
            trigger={['click']}
            disabled={moveMut.isPending || transferItems.length === 0}
          >
            <Tooltip title="转移到其他供应商">
              <Button size="small" type="link">转移</Button>
            </Tooltip>
          </Dropdown>
        </Space>
      );
    },
  },
]}
```

Note: The old "供应商" leading column is removed (its info now lives as a sub-line in the `模型` column when on `全部`, and is implicit on per-provider Tabs).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: passes. The `Select` import will now be unused — remove it from the antd import line. Same for `PlusOutlined` if still present.

Updated import line:

```tsx
import {
  Card, Table, Tag, Modal, Form, Input, InputNumber, DatePicker,
  Space, Empty, Alert, message, Row, Col, Dropdown, Button, Tooltip,
} from 'antd';
```

(Keep `Select` only inside the `新增模型` Modal — wait, that one DOES use `Select` for choosing provider. Re-add `Select` to the import. Final correct line:)

```tsx
import {
  Card, Table, Tag, Modal, Form, Input, InputNumber, DatePicker, Select,
  Space, Empty, Alert, message, Row, Col, Dropdown, Button, Tooltip,
} from 'antd';
```

Run typecheck again to confirm clean.

- [ ] **Step 5: Manual verification**

Reload `http://localhost:47822/settings` → `计费规则`. Verify:
- 8 columns: 模型 / Input / Output / CC / CR / 价格源 / 使用量 / 操作
- Numbers right-aligned, 2 decimals, monospace
- Click each price column header → sorts asc/desc; numbers without prices sort to bottom
- 价格源 shows: `⚡ <date>` green / `默认` gray / `未配置` red
- For a normal row: click `转移` → menu lists OTHER providers (excludes current); pick one → row provider updates and message "已转移"
- For an Unknown row: shows primary `指派供应商 ▼`; menu picks one → row moves out of Unknown
- On `全部` Segmented: model column shows provider sub-line; on a provider Tab: sub-line is hidden
- Expanding a row still shows the price-history table (we polish it in Task 6)

- [ ] **Step 6: Commit**

```bash
git add src/web/pages/Settings/Pricing.tsx
git commit -m "refactor(pricing): split price into 4 sortable columns; replace inline Select with transfer Dropdown"
```

---

### Task 6: PricingHistoryTable container + 当前生效 ⚡

**Files:**
- Modify: `src/web/pages/Settings/PricingHistoryTable.tsx`

- [ ] **Step 1: Update imports and component**

Open `src/web/pages/Settings/PricingHistoryTable.tsx`. Add `ThunderboltOutlined` to icon imports and `useTheme` / `TOKENS` for colors. Replace the file's render with the version below (form is `Row/Col 2x2`, container has a left primary border, and current row gets a ⚡ badge).

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Table, Button, InputNumber, DatePicker, Modal, Form, Input,
  Popconfirm, Space, Empty, message, Row, Col, Tag,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { api } from '../../api/client.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';

interface Window {
  id: number;
  effectiveFrom: string;
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  note: string | null;
}

interface PricingHistoryResponse {
  model: string;
  windows: Window[];
  defaultFallback: { input: number; output: number; cacheCreate: number; cacheRead: number } | null;
}

interface FormValues {
  effectiveFrom: Dayjs;
  input: number; output: number; cacheCreate: number; cacheRead: number;
  note?: string;
}

export default function PricingHistoryTable({ model }: { model: string }) {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Window | null>(null);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const { data, isLoading } = useQuery({
    queryKey: ['pricing-history', model],
    queryFn: () => api.get<PricingHistoryResponse>(`/api/pricing/${encodeURIComponent(model)}`),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['pricing-history', model] });
    qc.invalidateQueries({ queryKey: ['models'] });
  };

  const createMut = useMutation({
    mutationFn: (v: FormValues) => api.post(`/api/pricing/${encodeURIComponent(model)}`, {
      effectiveFrom: v.effectiveFrom.format('YYYY-MM-DD'),
      input: v.input, output: v.output, cacheCreate: v.cacheCreate, cacheRead: v.cacheRead,
      note: v.note ?? null,
    }),
    onSuccess: () => { message.success('已添加'); setCreating(false); form.resetFields(); invalidate(); },
    onError: (e: Error) => message.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: (v: FormValues & { id: number }) => api.patch(`/api/pricing/${v.id}`, {
      effectiveFrom: v.effectiveFrom.format('YYYY-MM-DD'),
      input: v.input, output: v.output, cacheCreate: v.cacheCreate, cacheRead: v.cacheRead,
      note: v.note ?? null,
    }),
    onSuccess: () => { message.success('已更新'); setEditing(null); form.resetFields(); invalidate(); },
    onError: (e: Error) => message.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/api/pricing/${id}`),
    onSuccess: () => { message.success('已删除'); invalidate(); },
    onError: (e: Error) => message.error(e.message),
  });

  const today = dayjs().format('YYYY-MM-DD');
  const rows = data?.windows ?? [];

  // Active window = latest window whose effectiveFrom <= today.
  const activeId = rows
    .filter(r => r.effectiveFrom <= today)
    .reduce<number | null>((best, r) => {
      if (best == null) return r.id;
      const bestRow = rows.find(x => x.id === best)!;
      return r.effectiveFrom > bestRow.effectiveFrom ? r.id : best;
    }, null);

  const submit = async () => {
    const v = await form.validateFields();
    if (editing) updateMut.mutate({ ...v, id: editing.id });
    else createMut.mutate(v);
  };

  return (
    <div style={{
      borderLeft: `3px solid ${t.primary}`,
      paddingLeft: 16, paddingTop: 12, paddingBottom: 12, paddingRight: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <strong style={{ color: t.textPrimary }}>价格历史</strong>
        <Button size="small" type="primary" ghost icon={<PlusOutlined />} onClick={() => {
          setEditing(null);
          setCreating(true);
          form.resetFields();
          form.setFieldsValue({ effectiveFrom: dayjs(), input: 0, output: 0, cacheCreate: 0, cacheRead: 0 });
        }}>新增调价</Button>
      </div>

      <Table<Window>
        size="small"
        rowKey="id"
        loading={isLoading}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: <Empty description={data?.defaultFallback ? '尚无窗口，使用内置默认价' : '尚无窗口'} /> }}
        columns={[
          {
            title: '生效日期', dataIndex: 'effectiveFrom', width: 150,
            render: (v: string, row: Window) => {
              const future = v > today;
              const isActive = row.id === activeId;
              return (
                <Space size={6} style={{ fontVariantNumeric: 'tabular-nums', opacity: future ? 0.6 : 1 }}>
                  {isActive && <ThunderboltOutlined style={{ color: t.success }} />}
                  <span style={{ fontWeight: isActive ? 600 : 400, color: isActive ? t.success : undefined }}>
                    {v}
                  </span>
                  {future && <Tag color="default">待生效</Tag>}
                </Space>
              );
            },
          },
          { title: 'Input',  dataIndex: 'input',       width: 90, align: 'right',
            render: (v) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>${v}</span> },
          { title: 'Output', dataIndex: 'output',      width: 90, align: 'right',
            render: (v) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>${v}</span> },
          { title: 'CC',     dataIndex: 'cacheCreate', width: 80, align: 'right',
            render: (v) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>${v}</span> },
          { title: 'CR',     dataIndex: 'cacheRead',   width: 80, align: 'right',
            render: (v) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>${v}</span> },
          { title: '备注',   dataIndex: 'note',
            render: (v: string | null) => v ?? <span style={{ color: t.textMuted }}>—</span> },
          {
            title: '操作', width: 90, align: 'right',
            render: (_: unknown, row: Window) => (
              <Space size={2}>
                <Button size="small" type="text" icon={<EditOutlined />} onClick={() => {
                  setCreating(false);
                  setEditing(row);
                  form.setFieldsValue({
                    effectiveFrom: dayjs(row.effectiveFrom),
                    input: row.input, output: row.output,
                    cacheCreate: row.cacheCreate, cacheRead: row.cacheRead,
                    note: row.note ?? undefined,
                  });
                }} />
                <Popconfirm title="删除该窗口？" onConfirm={() => deleteMut.mutate(row.id)}>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? '编辑价格窗口' : '新增价格调整'}
        open={creating || editing !== null}
        onCancel={() => { setCreating(false); setEditing(null); form.resetFields(); }}
        onOk={submit}
        confirmLoading={createMut.isPending || updateMut.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item label="生效日期" name="effectiveFrom" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
          </Form.Item>
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
          <Form.Item label="备注" name="note">
            <Input.TextArea rows={2} placeholder="可选：说明调价原因或来源链接" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
```

Notes:
- The container's old `var(--cc-bg-subtle)` background is removed; the left primary border replaces it.
- `activeId` is computed locally (latest window with `effectiveFrom <= today`); avoids guessing per-row.
- Action buttons are now `type="text"` for less visual weight in the embedded panel.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Manual verification**

Reload `http://localhost:47822/settings` → `计费规则`. Expand a row that has windows. Verify:
- Container has a left primary-colored vertical bar (3px) and 16px left padding
- The active window row shows ⚡ + green date (bold)
- Future-dated windows show 0.6 opacity + `待生效` tag
- "新增调价" button is primary-ghost in the panel header
- Edit / delete still work end-to-end (add a window, edit it, delete it)
- Modal shows 4 price inputs in a 2×2 grid (equal width)

- [ ] **Step 4: Commit**

```bash
git add src/web/pages/Settings/PricingHistoryTable.tsx
git commit -m "refactor(pricing-history): inline panel with primary left border, ⚡ active marker, 2x2 form grid"
```

---

### Task 7: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Type & lint**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 2: Walk the spec acceptance list**

In `npm run dev` → `http://localhost:47822/settings/计费规则`, walk every bullet from the spec's `## 验收` section:

1. KPI strip shows 4 metrics including correct `未配置` count and `上次重算` relative time
2. Switch through Segmented tabs `全部 / <each provider> / ⚠ Unknown`; verify only matching rows show; `⚠ Unknown` only appears when N>0
3. Search box filters by substring; combines with Segmented filter
4. Click any of `Input / Output / CC / CR` column headers → table sorts; click again → reverse
5. `价格源` column shows three states (`⚡<date>` green / `默认` gray / `未配置` red) on suitable rows
6. Normal row → click `转移` → Dropdown lists OTHER providers; pick one → row moves; success message
7. Unknown row → click `指派供应商 ▼` → same Dropdown; row leaves Unknown
8. Expand any row → embedded history panel has left primary border; current window has ⚡ + green date
9. Click `[+ 新增调价]` in the embedded panel → modal opens with 2×2 price grid
10. Click `[+ 新增模型]` in the filter bar → modal opens; price grid is also 2×2
11. Click `重算历史成本` → after success, `上次重算` flips to "刚刚"; reload page → still shows recent relative time (e.g. "几秒前" / "1 分钟前")
12. Switch tab to `显示偏好` and back → KPI / Segmented selection / search keyword preserved
13. Both light and dark theme look correct (toggle theme via header button)

- [ ] **Step 3: Empty / edge states**

Verify:
- An account with no models at all → table shows `Empty` placeholder; KPI shows `模型 0`
- An account with all models configured → `⚠ Unknown` Segmented option is hidden; warning Alert is hidden; "未配置" KPI is `0` in default color
- Browser without `localStorage` (e.g. private mode) → no console error; "上次重算" stays at `—`

- [ ] **Step 4: Final commit (if any inline fixes were made)**

If any tweaks were needed during verification, commit them with a message like:

```bash
git add -A
git commit -m "fix(pricing): <short description of fix>"
```

If nothing needed adjustment, skip the commit.

---

## Self-Review (already performed by author)

- **Spec coverage:** every section A–F + acceptance bullets maps to a numbered task above
- **Placeholder scan:** no TBD / "implement later" / shorthand "similar to Task N" — every code block is full
- **Type consistency:** `ProviderFilter`, `ModelView`, `Window`, `FormValues`, helper signatures match across tasks; `lastRecomputeAt` getter/setter signatures consistent between Task 1 and Task 4
- **Dependency order:** helpers (Task 1) → presentational pieces (Tasks 2–3) → page wiring (Task 4) → table repack (Task 5) → embedded panel + modal grids (Task 6) → final walk-through (Task 7)
