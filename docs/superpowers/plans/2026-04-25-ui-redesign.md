# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repaint the cc-usage-dashboard frontend with the "A · Modern Clean" theme, light/dark toggle, page headers, sparkline-capable KPI cards, bar-list charts, and five restyled pages — without breaking routes or existing data contracts.

**Architecture:** New `src/web/theme/` module centralises tokens, antd theme, and two echarts themes. A `ThemeProvider` wires antd + context; `ThemeToggle` flips the mode and persists to `localStorage.ccTheme`. A `PageHeader` component + context lets each page publish title/subtitle into the global app bar, while `KpiCard`, `BarList`, `EmptyState` are shared presentation components. One minimal server change extends `/api/sessions` with filtered `stats` aggregates. Pages are restyled in isolation, one per task.

**Tech Stack:** React 18, Ant Design 5, ECharts 5 (via `echarts-for-react`), React Router 6, @tanstack/react-query, Zustand, Vite. Server side uses Fastify 5 + better-sqlite3 11 + Vitest.

**Spec:** `docs/superpowers/specs/2026-04-25-ui-redesign-design.md`

---

## File Plan

**New files:**

- `src/web/theme/tokens.ts` — colour/spacing/radius constants, two modes.
- `src/web/theme/antd-theme.ts` — maps tokens onto antd `ConfigProvider` `theme`.
- `src/web/theme/echarts.ts` — `ccLight` / `ccDark` echarts theme objects + `registerEchartsThemes()`.
- `src/web/theme/ThemeProvider.tsx` — provider with `useState` + context + antd `ConfigProvider`.
- `src/web/theme/useTheme.ts` — `useTheme()` hook returning `{ mode, toggle }`.
- `src/web/components/PageHeaderContext.tsx` — context storing the current page's title/subtitle/extra, set by each page, consumed by the app header.
- `src/web/components/PageHeader.tsx` — declarative component each page renders to push its title into context.
- `src/web/components/BarList.tsx` — horizontal bar list with label, progress bar, value.
- `src/web/components/EmptyState.tsx` — styled `Empty` wrapper with title, description, primary action.
- `src/web/components/ThemeToggle.tsx` — moon/sun icon button using `useTheme()`.

**Modified files:**

- `src/web/main.tsx` — mount `ThemeProvider`, call `registerEchartsThemes()`.
- `src/web/App.tsx` — rebuild shell: icon sidebar + brand + footer, header with PageHeader slot + global actions.
- `src/web/components/KpiCard.tsx` — add `icon`, `sparkline`, `suffix`, `precision` props.
- `src/web/pages/Overview/index.tsx` — new layout: 4 KpiCards, trend + today-glance row, two BarLists.
- `src/web/pages/Projects/List.tsx` — PageHeader + two-line project cell + mini-bar cost column.
- `src/web/pages/Projects/Detail.tsx` — PageHeader with back button + new echarts theme.
- `src/web/pages/Sessions/List.tsx` — PageHeader + stats row + filter bar + duration tag + tool truncation.
- `src/web/pages/Sessions/Detail.tsx` — KpiCard row replacing `Descriptions` + expandable preview rows.
- `src/web/pages/Cost/index.tsx` — PageHeader + KPI row + anomaly markPoint + bucket search.
- `src/server/routes/sessions.ts` — accept comma-separated `projectDir`, add `stats` to response.
- `src/shared/types.ts` — add `SessionsListResponse` type with `stats` field.

**Deleted files:**

- `src/web/components/TopBarChart.tsx` — replaced by BarList. Deleted in Task 17 after its last consumer switches.

---

## Task 1: Theme Tokens

**Files:**
- Create: `src/web/theme/tokens.ts`

- [ ] **Step 1: Write `src/web/theme/tokens.ts`**

```ts
export type Mode = 'light' | 'dark';

interface Tokens {
  primary: string;
  primaryHover: string;
  purple: string;
  cyan: string;
  success: string;
  warning: string;
  danger: string;
  pageBg: string;
  cardBg: string;
  sidebarBg: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  chartPalette: string[];
}

export const TOKENS: Record<Mode, Tokens> = {
  light: {
    primary: '#4f46e5',
    primaryHover: '#4338ca',
    purple: '#8b5cf6',
    cyan: '#06b6d4',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    pageBg: '#f7f8fa',
    cardBg: '#ffffff',
    sidebarBg: '#0f172a',
    border: '#eef2f7',
    textPrimary: '#0f172a',
    textSecondary: '#64748b',
    textMuted: '#94a3b8',
    chartPalette: ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'],
  },
  dark: {
    primary: '#818cf8',
    primaryHover: '#a5b4fc',
    purple: '#a78bfa',
    cyan: '#22d3ee',
    success: '#34d399',
    warning: '#fbbf24',
    danger: '#f87171',
    pageBg: '#0b1220',
    cardBg: '#111827',
    sidebarBg: '#0f172a',
    border: '#1f2937',
    textPrimary: '#f1f5f9',
    textSecondary: '#94a3b8',
    textMuted: '#64748b',
    chartPalette: ['#818cf8', '#a78bfa', '#22d3ee', '#34d399', '#fbbf24', '#f87171'],
  },
};

export const RADIUS = { card: 12, control: 8 } as const;
export const SPACING = { cardPad: 18, pageX: 28, pageY: 22 } as const;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors touching theme folder).

- [ ] **Step 3: Commit**

```bash
git add src/web/theme/tokens.ts
git commit -m "feat(theme): tokens for light/dark mode"
```

---

## Task 2: ECharts Themes

**Files:**
- Create: `src/web/theme/echarts.ts`

- [ ] **Step 1: Write `src/web/theme/echarts.ts`**

```ts
import * as echarts from 'echarts';
import { TOKENS, type Mode } from './tokens.js';

function themeFor(mode: Mode) {
  const t = TOKENS[mode];
  const gridLine = mode === 'dark' ? '#1f2937' : '#eef2f7';
  const axisText = t.textSecondary;
  return {
    color: t.chartPalette,
    backgroundColor: 'transparent',
    textStyle: { color: t.textPrimary, fontFamily: 'inherit' },
    title: { textStyle: { color: t.textPrimary, fontSize: 14, fontWeight: 600 } },
    legend: {
      textStyle: { color: axisText, fontSize: 11 },
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
    },
    tooltip: {
      backgroundColor: t.cardBg,
      borderColor: t.border,
      borderWidth: 1,
      textStyle: { color: t.textPrimary, fontSize: 12 },
      extraCssText: 'box-shadow: 0 4px 16px rgba(15,23,42,.08); border-radius: 8px;',
    },
    categoryAxis: {
      axisLine: { lineStyle: { color: t.border } },
      axisTick: { show: false },
      axisLabel: { color: axisText, fontSize: 11 },
      splitLine: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: axisText, fontSize: 11 },
      splitLine: { lineStyle: { color: gridLine, type: 'dashed' } },
    },
    bar: { itemStyle: { borderRadius: [2, 2, 0, 0] } },
    line: { symbol: 'none', smooth: false },
  };
}

let registered = false;
export function registerEchartsThemes() {
  if (registered) return;
  echarts.registerTheme('ccLight', themeFor('light'));
  echarts.registerTheme('ccDark', themeFor('dark'));
  registered = true;
}

export const echartsThemeName = (mode: Mode) => (mode === 'dark' ? 'ccDark' : 'ccLight');
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/web/theme/echarts.ts
git commit -m "feat(theme): register ccLight/ccDark echarts themes"
```

---

## Task 3: Theme Context + Provider

**Files:**
- Create: `src/web/theme/useTheme.ts`
- Create: `src/web/theme/ThemeProvider.tsx`

- [ ] **Step 1: Write `src/web/theme/useTheme.ts`**

```ts
import { createContext, useContext } from 'react';
import type { Mode } from './tokens.js';

export interface ThemeCtx {
  mode: Mode;
  toggle: () => void;
}

export const ThemeContext = createContext<ThemeCtx | null>(null);

export function useTheme(): ThemeCtx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
```

- [ ] **Step 2: Write `src/web/theme/ThemeProvider.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { ThemeContext } from './useTheme.js';
import { TOKENS, RADIUS, type Mode } from './tokens.js';

const STORAGE_KEY = 'ccTheme';

function readStoredMode(): Mode {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  return raw === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(() => readStoredMode());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
    document.documentElement.dataset.theme = mode;
    document.body.style.background = TOKENS[mode].pageBg;
    document.body.style.color = TOKENS[mode].textPrimary;
  }, [mode]);

  const toggle = useCallback(() => setMode(m => (m === 'light' ? 'dark' : 'light')), []);

  const ctx = useMemo(() => ({ mode, toggle }), [mode, toggle]);
  const t = TOKENS[mode];

  return (
    <ThemeContext.Provider value={ctx}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: {
            colorPrimary: t.primary,
            colorSuccess: t.success,
            colorWarning: t.warning,
            colorError: t.danger,
            colorBgLayout: t.pageBg,
            colorBgContainer: t.cardBg,
            colorBorder: t.border,
            colorBorderSecondary: t.border,
            colorText: t.textPrimary,
            colorTextSecondary: t.textSecondary,
            borderRadius: RADIUS.control,
            borderRadiusLG: RADIUS.card,
            fontFamily: `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif`,
          },
          components: {
            Card: { borderRadiusLG: RADIUS.card, paddingLG: 18 },
            Table: { headerBg: t.pageBg, rowHoverBg: t.pageBg },
            Layout: { siderBg: t.sidebarBg, headerBg: t.cardBg, bodyBg: t.pageBg },
            Menu: { darkItemBg: t.sidebarBg, darkSubMenuItemBg: t.sidebarBg },
          },
        }}
      >
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/web/theme/useTheme.ts src/web/theme/ThemeProvider.tsx
git commit -m "feat(theme): ThemeProvider with antd ConfigProvider integration"
```

---

## Task 4: Wire ThemeProvider into main.tsx

**Files:**
- Modify: `src/web/main.tsx`

- [ ] **Step 1: Replace `src/web/main.tsx` contents**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.js';
import { ThemeProvider } from './theme/ThemeProvider.js';
import { registerEchartsThemes } from './theme/echarts.js';

registerEchartsThemes();

const qc = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 30_000 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>
);
```

- [ ] **Step 2: Run dev server and open the site**

Run: `npm run dev:web` (keep other terminal running `npm run dev:server`)
Expected: Site still loads at `http://localhost:5173` (or whatever Vite picks). Nothing visually changed yet — sidebar still uses default antd layout, but antd tokens are now themeable.

- [ ] **Step 3: Commit**

```bash
git add src/web/main.tsx
git commit -m "feat(theme): mount ThemeProvider, register echarts themes on boot"
```

---

## Task 5: ThemeToggle Component

**Files:**
- Create: `src/web/components/ThemeToggle.tsx`

- [ ] **Step 1: Write `src/web/components/ThemeToggle.tsx`**

```tsx
import { Button, Tooltip } from 'antd';
import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import { useTheme } from '../theme/useTheme.js';

export default function ThemeToggle() {
  const { mode, toggle } = useTheme();
  const label = mode === 'dark' ? '切到浅色' : '切到暗色';
  return (
    <Tooltip title={label} placement="bottom">
      <Button
        type="text"
        shape="circle"
        icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
        onClick={toggle}
        aria-label={label}
      />
    </Tooltip>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/web/components/ThemeToggle.tsx
git commit -m "feat(components): ThemeToggle button"
```

---

## Task 6: PageHeader Context + Component

**Files:**
- Create: `src/web/components/PageHeaderContext.tsx`
- Create: `src/web/components/PageHeader.tsx`

- [ ] **Step 1: Write `src/web/components/PageHeaderContext.tsx`**

```tsx
import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

export interface PageHeaderState {
  title: string;
  subtitle?: string;
  extra?: ReactNode;
}

interface Ctx {
  state: PageHeaderState | null;
  set: (s: PageHeaderState | null) => void;
}

const PageHeaderCtx = createContext<Ctx | null>(null);

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PageHeaderState | null>(null);
  const set = useCallback((s: PageHeaderState | null) => setState(s), []);
  const value = useMemo(() => ({ state, set }), [state, set]);
  return <PageHeaderCtx.Provider value={value}>{children}</PageHeaderCtx.Provider>;
}

export function usePageHeader(): Ctx {
  const ctx = useContext(PageHeaderCtx);
  if (!ctx) throw new Error('usePageHeader must be used inside <PageHeaderProvider>');
  return ctx;
}
```

- [ ] **Step 2: Write `src/web/components/PageHeader.tsx`**

```tsx
import { useEffect, type ReactNode } from 'react';
import { usePageHeader } from './PageHeaderContext.js';

export default function PageHeader({
  title, subtitle, extra,
}: { title: string; subtitle?: string; extra?: ReactNode }) {
  const { set } = usePageHeader();
  useEffect(() => {
    set({ title, subtitle, extra });
    return () => set(null);
  }, [title, subtitle, extra, set]);
  return null;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/web/components/PageHeaderContext.tsx src/web/components/PageHeader.tsx
git commit -m "feat(components): PageHeader with context-driven slot"
```

---

## Task 7: BarList Component

**Files:**
- Create: `src/web/components/BarList.tsx`

- [ ] **Step 1: Write `src/web/components/BarList.tsx`**

```tsx
import { useTheme } from '../theme/useTheme.js';
import { TOKENS } from '../theme/tokens.js';

export interface BarListItem {
  label: string;
  value: number;
  /** Override palette index for this row's bar colour. */
  colorIndex?: number;
}

export default function BarList({
  items,
  formatter = (v) => v.toLocaleString(),
  emptyText = '暂无数据',
}: {
  items: BarListItem[];
  formatter?: (v: number) => string;
  emptyText?: string;
}) {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  if (items.length === 0) return <div style={{ color: t.textMuted, fontSize: 12, padding: '12px 0' }}>{emptyText}</div>;
  const max = Math.max(...items.map(i => i.value), 0);
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const track = mode === 'dark' ? '#1e293b' : '#f1f5f9';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {sorted.map((item, idx) => {
        const pct = max > 0 ? (item.value / max) * 100 : 0;
        const color = t.chartPalette[(item.colorIndex ?? idx) % t.chartPalette.length];
        return (
          <div
            key={item.label}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(100px, 28%) 1fr minmax(56px, 12%)',
              alignItems: 'center',
              gap: 10,
              fontSize: 12,
            }}
          >
            <div
              style={{
                color: t.textPrimary,
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={item.label}
            >
              {item.label}
            </div>
            <div style={{ height: 20, background: track, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4 }} />
            </div>
            <div style={{ textAlign: 'right', color: t.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
              {formatter(item.value)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/web/components/BarList.tsx
git commit -m "feat(components): BarList (DOM-based horizontal bar chart)"
```

---

## Task 8: EmptyState Component

**Files:**
- Create: `src/web/components/EmptyState.tsx`

- [ ] **Step 1: Write `src/web/components/EmptyState.tsx`**

```tsx
import { Empty, Button } from 'antd';
import type { ReactNode } from 'react';

export default function EmptyState({
  title, description, actionText, onAction, image,
}: {
  title?: string;
  description?: ReactNode;
  actionText?: string;
  onAction?: () => void;
  image?: ReactNode;
}) {
  return (
    <div style={{ padding: '60px 0', display: 'flex', justifyContent: 'center' }}>
      <Empty
        image={image ?? Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <div>
            {title && <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>}
            {description && <div style={{ fontSize: 12, opacity: 0.75 }}>{description}</div>}
          </div>
        }
      >
        {actionText && onAction && (
          <Button type="primary" onClick={onAction}>{actionText}</Button>
        )}
      </Empty>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/web/components/EmptyState.tsx
git commit -m "feat(components): EmptyState wrapper"
```

---

## Task 9: Upgrade KpiCard

**Files:**
- Modify: `src/web/components/KpiCard.tsx`

- [ ] **Step 1: Replace `src/web/components/KpiCard.tsx` contents**

```tsx
import { Card } from 'antd';
import type { ReactNode } from 'react';
import { useTheme } from '../theme/useTheme.js';
import { TOKENS } from '../theme/tokens.js';

export default function KpiCard({
  title,
  value,
  suffix,
  precision = 0,
  icon,
  iconBg,
  iconColor,
  sparkline,
  sparkColor,
}: {
  title: string;
  value: number;
  suffix?: string;
  precision?: number;
  icon?: ReactNode;
  iconBg?: string;
  iconColor?: string;
  sparkline?: number[];
  sparkColor?: string;
}) {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const formatted = value.toLocaleString(undefined, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });

  return (
    <Card styles={{ body: { padding: 18, position: 'relative', overflow: 'hidden' } }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: t.textSecondary }}>
          {title}
        </div>
        {icon && (
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13,
            background: iconBg ?? (mode === 'dark' ? '#1e293b' : '#eef2ff'),
            color: iconColor ?? t.primary,
          }}>{icon}</div>
        )}
      </div>

      <div style={{
        fontSize: 24, fontWeight: 700, color: t.textPrimary,
        fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.5px', lineHeight: 1.2,
      }}>
        {formatted}{suffix && <span style={{ fontSize: 16, color: t.textMuted, marginLeft: 2 }}>{suffix}</span>}
      </div>

      {sparkline && sparkline.length > 1 && (
        <Sparkline data={sparkline} color={sparkColor ?? t.primary} />
      )}
    </Card>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1);
  return (
    <div style={{
      position: 'absolute', right: 14, bottom: 14,
      display: 'flex', alignItems: 'flex-end', gap: 2, height: 22, opacity: 0.55,
    }}>
      {data.map((v, i) => (
        <div
          key={i}
          style={{
            width: 3,
            height: `${Math.max(2, (v / max) * 22)}px`,
            background: color,
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (Existing callers only pass `title, value, suffix, precision` which still work.)

- [ ] **Step 3: Commit**

```bash
git add src/web/components/KpiCard.tsx
git commit -m "feat(components): KpiCard with icon + sparkline"
```

---

## Task 10: New App Shell

**Files:**
- Modify: `src/web/App.tsx`
- Modify: `src/web/main.tsx` (wrap with PageHeaderProvider)

- [ ] **Step 1: Replace `src/web/App.tsx` contents**

```tsx
import { Layout, Menu, Button, Space } from 'antd';
import {
  DashboardOutlined, FolderOutlined, MessageOutlined, DollarOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AppRoutes from './routes.js';
import { api } from './api/client.js';
import ThemeToggle from './components/ThemeToggle.js';
import { usePageHeader } from './components/PageHeaderContext.js';
import { useTheme } from './theme/useTheme.js';
import { TOKENS, SPACING } from './theme/tokens.js';

function formatRelativeTime(ts: number | null): string {
  if (!ts) return '未扫描';
  const diffMs = Date.now() - ts;
  const min = Math.round(diffMs / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  return `${Math.round(hr / 24)} 天前`;
}

export default function App() {
  const loc = useLocation();
  const qc = useQueryClient();
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const { state: page } = usePageHeader();

  const scan = useMutation({
    mutationFn: () => api.post('/api/scan'),
    onSuccess: () => qc.invalidateQueries(),
  });
  const health = useQuery<{ ok: boolean; lastScanAt: number | null }>({
    queryKey: ['health'],
    queryFn: () => api.get('/api/health'),
    refetchInterval: 30_000,
  });

  const menu = [
    { key: '/overview', icon: <DashboardOutlined />, label: <Link to="/overview">概览</Link> },
    { key: '/projects', icon: <FolderOutlined />,    label: <Link to="/projects">项目</Link> },
    { key: '/sessions', icon: <MessageOutlined />,   label: <Link to="/sessions">会话</Link> },
    { key: '/cost',     icon: <DollarOutlined />,    label: <Link to="/cost">成本</Link> },
  ];
  const selected = menu.find(m => loc.pathname.startsWith(m.key))?.key ?? '/overview';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider width={220} style={{ background: t.sidebarBg }}>
        <div style={{ padding: '18px 20px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: 14,
          }}>C</div>
          <div>
            <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 14, letterSpacing: 0.5 }}>CC Usage</div>
            <div style={{ color: '#64748b', fontSize: 10 }}>v0.1.0 · local</div>
          </div>
        </div>
        <Menu theme="dark" mode="inline" selectedKeys={[selected]} items={menu}
              style={{ background: t.sidebarBg, border: 'none', padding: '10px 8px' }} />
        <div style={{ padding: '14px 20px', fontSize: 11, color: '#64748b', borderTop: '1px solid #1e293b', marginTop: 12 }}>
          最近扫描 · {formatRelativeTime(health.data?.lastScanAt ?? null)}
        </div>
      </Layout.Sider>

      <Layout>
        <Layout.Header style={{
          background: t.cardBg, padding: `0 ${SPACING.pageX}px`, height: 64,
          borderBottom: `1px solid ${t.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: t.textPrimary, lineHeight: 1.2 }}>
              {page?.title ?? ''}
            </div>
            {page?.subtitle && (
              <div style={{ fontSize: 12, color: t.textSecondary, marginTop: 2 }}>{page.subtitle}</div>
            )}
          </div>
          <Space size={8}>
            {page?.extra}
            <ThemeToggle />
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              loading={scan.isPending}
              onClick={() => scan.mutate()}
            >刷新数据</Button>
          </Space>
        </Layout.Header>
        <Layout.Content style={{ padding: `${SPACING.pageY}px ${SPACING.pageX}px`, background: t.pageBg }}>
          <AppRoutes />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
```

- [ ] **Step 2: Update `src/web/main.tsx` to wrap with PageHeaderProvider**

Open `src/web/main.tsx` and change the render block from:

```tsx
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
```

to:

```tsx
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <PageHeaderProvider>
            <App />
          </PageHeaderProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
```

And add this import near the other imports:

```tsx
import { PageHeaderProvider } from './components/PageHeaderContext.js';
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Manual check**

Run: `npm run dev` (one terminal runs both dev:server + dev:web via `concurrently`)
Open: whatever URL Vite prints.
Expected:
- Sidebar is dark, has a gradient "C" logo, "CC Usage" brand, "v0.1.0 · local" subtitle.
- Menu items show icons + text.
- Sidebar footer shows "最近扫描 · N 分钟前" (or "未扫描" if empty).
- Header is white, shows empty title for now (pages don't push yet), moon icon + primary "刷新数据".
- Clicking moon flips whole UI to dark: sidebar stays the same dark, page bg turns `#0b1220`.
- Refresh page: mode preference persists.

- [ ] **Step 5: Commit**

```bash
git add src/web/App.tsx src/web/main.tsx
git commit -m "feat(shell): icon sidebar + PageHeader slot + ThemeToggle in header"
```

---

## Task 11: Server — /api/sessions stats + multi projectDir

**Files:**
- Modify: `src/server/routes/sessions.ts`
- Modify: `src/shared/types.ts`
- Modify: `tests/routes-sessions.test.ts`

- [ ] **Step 1: Add the new response type**

Append to `src/shared/types.ts`:

```ts
export interface SessionsListStats {
  count: number;
  totalCostUsd: number;
  avgCostUsd: number;
  medianDurationMs: number;
}

export interface SessionsListResponse {
  total: number;
  items: SessionRow[];
  stats: SessionsListStats;
}
```

- [ ] **Step 2: Write a failing test for the new `stats` field**

Append these tests inside the existing `describe('/api/sessions', ...)` block in `tests/routes-sessions.test.ts`:

```ts
  it('returns filter-wide stats alongside paginated items', async () => {
    const { app, cleanup } = await seeded();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/sessions?limit=10&offset=0' });
      const body = res.json();
      expect(body.stats).toBeDefined();
      expect(body.stats.count).toBe(1);
      expect(body.stats.totalCostUsd).toBeGreaterThanOrEqual(0);
      expect(body.stats.avgCostUsd).toBeCloseTo(body.stats.totalCostUsd / body.stats.count, 6);
      expect(body.stats.medianDurationMs).toBeGreaterThanOrEqual(0);
    } finally { await cleanup(); }
  });

  it('filters by multiple projectDir values (comma separated)', async () => {
    const { app, cleanup } = await seeded();
    try {
      const projRes = await app.inject({ method: 'GET', url: '/api/projects' });
      const projects = projRes.json() as Array<{ projectDir: string }>;
      const realDir = projects[0].projectDir;

      const hitRes = await app.inject({
        method: 'GET',
        url: `/api/sessions?projectDir=${encodeURIComponent(realDir)},${encodeURIComponent('/nonexistent/path')}`,
      });
      expect(hitRes.json().total).toBe(1);

      const missRes = await app.inject({
        method: 'GET',
        url: `/api/sessions?projectDir=${encodeURIComponent('/nonexistent/path')}`,
      });
      expect(missRes.json().total).toBe(0);
    } finally { await cleanup(); }
  });
```

- [ ] **Step 3: Run the test to confirm failure**

Run: `npm test -- routes-sessions`
Expected: FAIL — "returns filter-wide stats" fails because `body.stats` is undefined.

- [ ] **Step 4: Replace `src/server/routes/sessions.ts` contents**

```ts
import type { FastifyInstance } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function registerSessions(app: FastifyInstance, db: DatabaseType) {
  // projectDir query string accepts a comma-separated list of RAW project_dir values
  // (as returned by /api/projects), not base64-encoded. project_dir strings come from
  // folder names and never contain commas in practice.
  app.get('/api/sessions', async (req) => {
    const q = req.query as {
      projectDir?: string; from?: string; to?: string; limit?: string; offset?: string;
    };
    const projectDirs = q.projectDir
      ? q.projectDir.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const from = q.from ? new Date(q.from).getTime() : 0;
    const to = q.to ? new Date(q.to).getTime() : Date.now();
    const limit = Number(q.limit ?? 50);
    const offset = Number(q.offset ?? 0);

    const projPlaceholders = projectDirs.map((_, i) => `@p${i}`).join(',');
    const whereProj = projectDirs.length ? `AND s.project_dir IN (${projPlaceholders})` : '';
    const projParams: Record<string, string> = {};
    projectDirs.forEach((p, i) => (projParams[`p${i}`] = p));

    const totalRow = db.prepare(
      `SELECT COUNT(*) as n FROM sessions s
       WHERE s.started_at BETWEEN @from AND @to ${whereProj}`
    ).get({ from, to, ...projParams }) as { n: number };
    const total = totalRow.n;

    const rows = db.prepare(
      `SELECT s.session_id as sessionId, s.project_dir as projectDir,
              s.started_at as startedAt, s.ended_at as endedAt,
              s.message_count as messageCount,
              s.total_input + s.total_output + s.total_cache_create + s.total_cache_read as totalTokens,
              s.total_cost_usd as totalCostUsd
       FROM sessions s
       WHERE s.started_at BETWEEN @from AND @to ${whereProj}
       ORDER BY s.started_at DESC LIMIT @limit OFFSET @offset`
    ).all({ from, to, limit, offset, ...projParams }) as Array<{
      sessionId: string; projectDir: string; startedAt: number; endedAt: number;
      messageCount: number; totalTokens: number; totalCostUsd: number;
    }>;

    const items = rows.map(r => {
      const tools = db.prepare(
        `SELECT tool_names FROM messages WHERE session_id = ? AND tool_names IS NOT NULL AND tool_names != '[]'`
      ).all(r.sessionId) as Array<{ tool_names: string }>;
      const counts = new Map<string, number>();
      for (const t of tools) {
        for (const name of JSON.parse(t.tool_names) as string[]) {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
      const topTools = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
      return { ...r, topTools };
    });

    const statRows = db.prepare(
      `SELECT s.total_cost_usd as cost, s.ended_at - s.started_at as durMs
       FROM sessions s
       WHERE s.started_at BETWEEN @from AND @to ${whereProj}`
    ).all({ from, to, ...projParams }) as Array<{ cost: number; durMs: number }>;

    const totalCostUsd = statRows.reduce((a, r) => a + (r.cost ?? 0), 0);
    const count = statRows.length;
    const avgCostUsd = count > 0 ? totalCostUsd / count : 0;
    const durations = statRows.map(r => Math.max(0, r.durMs ?? 0)).sort((a, b) => a - b);
    const medianDurationMs = median(durations);

    return {
      total,
      items,
      stats: { count, totalCostUsd, avgCostUsd, medianDurationMs },
    };
  });

  app.get('/api/sessions/:sid', async (req, reply) => {
    const { sid } = req.params as { sid: string };
    const session = db.prepare(
      `SELECT session_id as sessionId, project_dir as projectDir,
              started_at as startedAt, ended_at as endedAt,
              message_count as messageCount,
              total_input as totalInput, total_output as totalOutput,
              total_cache_create as totalCacheCreate, total_cache_read as totalCacheRead,
              total_cost_usd as totalCostUsd
       FROM sessions WHERE session_id = ?`
    ).get(sid) as Record<string, unknown> | undefined;
    if (!session) return reply.code(404).send({ error: 'not found' });

    const messages = (db.prepare(
      `SELECT message_id as messageId, role, model, timestamp,
              input_tokens as inputTokens, output_tokens as outputTokens,
              cache_creation_tokens as cacheCreate, cache_read_tokens as cacheRead,
              cost_usd as costUsd, stop_reason as stopReason,
              tool_names as toolNames, text_preview as textPreview
       FROM messages WHERE session_id = ? ORDER BY timestamp`
    ).all(sid) as Array<Record<string, unknown> & { toolNames: string | null }>).map(m => ({
      ...m,
      toolNames: m.toolNames ? JSON.parse(m.toolNames) : [],
    }));

    const counts = new Map<string, number>();
    for (const m of messages) for (const t of m.toolNames as string[]) counts.set(t, (counts.get(t) ?? 0) + 1);
    const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
    const toolDistribution = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tool, count]) => ({ tool, count, share: count / total }));

    return { session, messages, toolDistribution };
  });
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -- routes-sessions`
Expected: ALL PASS (original 2 + 2 new).

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/sessions.ts src/shared/types.ts tests/routes-sessions.test.ts
git commit -m "feat(api): /api/sessions returns filter-wide stats; supports multi projectDir"
```

---

## Task 12: Overview Page Redesign

**Files:**
- Modify: `src/web/pages/Overview/index.tsx`

- [ ] **Step 1: Replace `src/web/pages/Overview/index.tsx` contents**

```tsx
import { Row, Col, Card, Spin, Segmented } from 'antd';
import { ThunderboltOutlined, DollarOutlined, MessageOutlined, ApiOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useOverview } from '../../hooks/useOverview.js';
import { useStore } from '../../store.js';
import KpiCard from '../../components/KpiCard.js';
import BarList from '../../components/BarList.js';
import EmptyState from '../../components/EmptyState.js';
import PageHeader from '../../components/PageHeader.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';
import { echartsThemeName } from '../../theme/echarts.js';
import { api } from '../../api/client.js';
import type { CostResponse, OverviewResponse, RangeKey } from '../../../shared/types.js';
import ReactECharts from 'echarts-for-react';

const RANGE_OPTIONS: { label: string; value: RangeKey }[] = [
  { label: '今天', value: 'today' },
  { label: '本周', value: 'week' },
  { label: '本月', value: 'month' },
  { label: 'YTD', value: 'ytd' },
  { label: '全部', value: 'all' },
];

export default function Overview() {
  const { range, setRange } = useStore();
  const { data, isLoading } = useOverview(range);
  const { mode } = useTheme();
  const t = TOKENS[mode];

  const anomalies = useQuery<CostResponse>({
    queryKey: ['cost', 'day', 'month'],
    queryFn: () => api.get('/api/cost?granularity=day&range=month'),
    staleTime: 60_000,
  });
  const anomalyCount = anomalies.data?.anomalies.length ?? 0;

  return (
    <>
      <PageHeader
        title="概览"
        subtitle="Claude Code token 使用与成本分析"
        extra={
          <Segmented
            options={RANGE_OPTIONS}
            value={range}
            onChange={(v) => setRange(v as RangeKey)}
          />
        }
      />
      {isLoading && <Spin />}
      {data && data.totals.messageCount === 0 && (
        <EmptyState
          title="暂无数据"
          description="点右上角「刷新数据」或在终端里运行 ccu scan"
        />
      )}
      {data && data.totals.messageCount > 0 && (
        <OverviewBody data={data} t={t} mode={mode} anomalyCount={anomalyCount} />
      )}
    </>
  );
}

function OverviewBody({
  data, t, mode, anomalyCount,
}: {
  data: OverviewResponse;
  t: typeof TOKENS['light'];
  mode: 'light' | 'dark';
  anomalyCount: number;
}) {
  const totalTokens = data.totals.inputTokens + data.totals.outputTokens + data.totals.cacheCreate + data.totals.cacheRead;
  // dailyTrend.byModel values are per-model totals of (input+output+cache*) — summing them yields the day total.
  const dayTotal = (d: OverviewResponse['dailyTrend'][number]) =>
    Object.values(d.byModel).reduce((a, v) => a + v, 0);
  const tokenSpark = data.dailyTrend.map(dayTotal);
  const costSpark = data.dailyTrend.map(d => d.costUsd);
  const last = data.dailyTrend[data.dailyTrend.length - 1];
  const todayTokens = last ? dayTotal(last) : 0;
  const todayCost = last ? last.costUsd : 0;
  const topProject = data.byProject[0]?.displayName ?? '—';

  const trendModels = new Set<string>();
  data.dailyTrend.forEach(d => Object.keys(d.byModel).forEach(m => trendModels.add(m)));
  const series = [...trendModels].map(model => ({
    name: model,
    type: 'line',
    stack: 'all',
    areaStyle: { opacity: 0.7 },
    smooth: false,
    data: data.dailyTrend.map(d => d.byModel[model] ?? 0),
  }));

  return (
    <>
      <Row gutter={14} style={{ marginBottom: 18 }}>
        <Col span={6}><KpiCard
          title="总 Token" value={totalTokens}
          icon={<ThunderboltOutlined />}
          sparkline={tokenSpark}
        /></Col>
        <Col span={6}><KpiCard
          title="总成本" value={data.totals.costUsd} precision={2} suffix="$"
          icon={<DollarOutlined />}
          iconBg={mode === 'dark' ? '#3b2e10' : '#fef3c7'} iconColor="#d97706"
          sparkline={costSpark} sparkColor="#d97706"
        /></Col>
        <Col span={6}><KpiCard
          title="会话数" value={data.totals.sessionCount}
          icon={<MessageOutlined />}
          iconBg={mode === 'dark' ? '#10321f' : '#dcfce7'} iconColor="#16a34a"
        /></Col>
        <Col span={6}><KpiCard
          title="缓存命中率" value={data.cacheHitRate * 100} precision={1} suffix="%"
          icon={<ApiOutlined />}
          iconBg={mode === 'dark' ? '#3a1622' : '#ffe4e6'} iconColor="#e11d48"
        /></Col>
      </Row>

      <Row gutter={14} style={{ marginBottom: 18 }}>
        <Col span={16}>
          <Card title="Token 趋势 · 按模型堆叠" extra={<span style={{ fontSize: 11, color: t.textSecondary }}>每日</span>}>
            <ReactECharts
              theme={echartsThemeName(mode)}
              style={{ height: 280 }}
              option={{
                tooltip: { trigger: 'axis' },
                legend: { top: 'bottom' },
                grid: { left: 40, right: 20, top: 20, bottom: 60 },
                xAxis: { type: 'category', data: data.dailyTrend.map(d => d.date) },
                yAxis: { type: 'value', name: 'tokens' },
                series,
              }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card title="今日速览" extra={<span style={{ fontSize: 11, color: t.textSecondary }}>{last?.date ?? ''}</span>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <GlanceLine label="今日 tokens" value={todayTokens.toLocaleString()} t={t} />
              <GlanceLine label="今日成本" value={`$${todayCost.toFixed(2)}`} t={t} />
              <GlanceLine label="最活跃项目" value={topProject} emphasize t={t} />
              <GlanceLine label="本月异常日" value={`${anomalyCount} 日`} danger={anomalyCount > 0} t={t} />
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={14}>
        <Col span={12}>
          <Card title="按项目 · Top 10"
                extra={<span style={{ fontSize: 11, color: t.textSecondary }}>按 token</span>}>
            <BarList items={data.byProject.map(p => ({ label: p.displayName, value: p.tokens }))} />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="按模型 · 用量分布"
                extra={<span style={{ fontSize: 11, color: t.textSecondary }}>按 token</span>}>
            <BarList items={data.byModel.map(m => ({ label: m.model, value: m.tokens }))} />
          </Card>
        </Col>
      </Row>
    </>
  );
}

function GlanceLine({
  label, value, emphasize = false, danger = false, t,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  danger?: boolean;
  t: typeof TOKENS['light'];
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontSize: 12, color: t.textSecondary }}>{label}</span>
      <span style={{
        fontSize: emphasize ? 13 : 16,
        fontWeight: emphasize ? 600 : 700,
        color: danger ? t.danger : (emphasize ? t.primary : t.textPrimary),
        fontVariantNumeric: 'tabular-nums',
      }}>{value}</span>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual check**

Run dev (`npm run dev`), open browser.
Expected:
- Header shows "概览 / Claude Code token 使用与成本分析" + Segmented + toggle + refresh.
- Four KPI cards render with icons and sparkline on Token + Cost.
- Middle row: stacked area on the left (applies `ccLight`/`ccDark` theme), glance card on the right with 4 lines.
- Bottom row: two BarList cards, no y-axis truncation.
- Empty state still works if DB empty.

- [ ] **Step 4: Commit**

```bash
git add src/web/pages/Overview/index.tsx
git commit -m "feat(overview): new layout with KPI icons/sparklines, today-glance, BarLists"
```

---

## Task 13: Projects List Restyle

**Files:**
- Modify: `src/web/pages/Projects/List.tsx`

- [ ] **Step 1: Replace `src/web/pages/Projects/List.tsx` contents**

```tsx
import { useQuery } from '@tanstack/react-query';
import { Table } from 'antd';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import type { ProjectRow } from '../../../shared/types.js';
import PageHeader from '../../components/PageHeader.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';

function b64(p: string) { return btoa(p).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

export default function ProjectsList() {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const { data, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRow[]>('/api/projects?sortBy=cost'),
  });
  const maxCost = Math.max(...(data ?? []).map(r => r.totalCostUsd), 0);

  return (
    <>
      <PageHeader title="项目" subtitle="按成本排序" />
      <Table<ProjectRow>
        loading={isLoading}
        rowKey="projectDir"
        dataSource={data ?? []}
        pagination={{ pageSize: 30, showSizeChanger: false }}
        columns={[
          {
            title: '项目',
            dataIndex: 'displayName',
            render: (_, r) => (
              <Link to={`/projects/${b64(r.projectDir)}`} style={{ display: 'block', lineHeight: 1.35 }}>
                <div style={{ fontWeight: 600 }}>{r.displayName}</div>
                {r.realPath && (
                  <div style={{ fontSize: 11, color: t.textMuted }}>{r.realPath}</div>
                )}
              </Link>
            ),
          },
          { title: '会话数', dataIndex: 'sessionCount', align: 'right', width: 80 },
          {
            title: 'Token',
            dataIndex: 'totalTokens',
            align: 'right',
            width: 120,
            render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toLocaleString()}</span>,
          },
          {
            title: '成本 ($)',
            dataIndex: 'totalCostUsd',
            align: 'right',
            width: 200,
            render: (v: number) => {
              const pct = maxCost > 0 ? (v / maxCost) * 100 : 0;
              const track = mode === 'dark' ? '#1e293b' : '#f1f5f9';
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                  <div style={{ width: 80, height: 6, background: track, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: t.primary }} />
                  </div>
                  <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 60, textAlign: 'right' }}>{v.toFixed(2)}</span>
                </div>
              );
            },
          },
          {
            title: '平均/会话',
            dataIndex: 'avgTokensPerSession',
            align: 'right',
            width: 110,
            render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(v).toLocaleString()}</span>,
          },
          {
            title: '最近活跃',
            dataIndex: 'lastSeenAt',
            width: 170,
            render: (v: number) => new Date(v).toLocaleString(),
          },
        ]}
      />
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual check**

Navigate to `/projects` in browser.
Expected:
- Header shows "项目 / 按成本排序".
- Table: project cell is two lines (name bold + realPath small), token column right-aligned with tabular-nums, cost column has mini horizontal bar + number.

- [ ] **Step 4: Commit**

```bash
git add src/web/pages/Projects/List.tsx
git commit -m "feat(projects): two-line name cell + mini cost bar + PageHeader"
```

---

## Task 14: Project Detail Restyle

**Files:**
- Modify: `src/web/pages/Projects/Detail.tsx`

- [ ] **Step 1: Replace `src/web/pages/Projects/Detail.tsx` contents**

```tsx
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, Table, Button } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { api } from '../../api/client.js';
import PageHeader from '../../components/PageHeader.js';
import { useTheme } from '../../theme/useTheme.js';
import { echartsThemeName } from '../../theme/echarts.js';

interface Timeline {
  daily: Array<{ date: string; tokens: number; costUsd: number; sessionCount: number }>;
  topSessions: Array<{ sessionId: string; totalCostUsd: number; totalTokens: number; messageCount: number; startedAt: number; endedAt: number }>;
}

function decodeB64(b64: string): string {
  return atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
}

export default function ProjectDetail() {
  const { b64 } = useParams<{ b64: string }>();
  const nav = useNavigate();
  const { mode } = useTheme();
  const { data } = useQuery({
    queryKey: ['projectTimeline', b64],
    queryFn: () => api.get<Timeline>(`/api/projects/${b64}/timeline?range=all`),
  });

  const projectName = b64 ? decodeB64(b64).split(/[/\\]/).pop() ?? b64 : '';

  return (
    <>
      <PageHeader
        title={projectName}
        subtitle="项目时间线"
        extra={<Button icon={<ArrowLeftOutlined />} onClick={() => nav('/projects')}>返回</Button>}
      />
      <Card title="每日 token 与成本" style={{ marginBottom: 16 }}>
        <ReactECharts
          theme={echartsThemeName(mode)}
          style={{ height: 320 }}
          option={{
            tooltip: { trigger: 'axis' },
            legend: { top: 'bottom' },
            grid: { left: 50, right: 50, top: 20, bottom: 60 },
            xAxis: { type: 'category', data: data?.daily.map(d => d.date) ?? [] },
            yAxis: [{ type: 'value', name: 'tokens' }, { type: 'value', name: '$' }],
            series: [
              { name: 'tokens', type: 'bar', data: data?.daily.map(d => d.tokens) ?? [] },
              { name: '$',     type: 'line', yAxisIndex: 1, data: data?.daily.map(d => d.costUsd) ?? [] },
            ],
          }}
        />
      </Card>
      <Card title="Top 20 会话(按成本)">
        <Table
          size="small"
          rowKey="sessionId"
          dataSource={data?.topSessions ?? []}
          pagination={{ pageSize: 20 }}
          columns={[
            {
              title: '会话', dataIndex: 'sessionId',
              render: (sid) => <Link to={`/sessions/${sid}`}>{sid.slice(0, 8)}…</Link>,
            },
            { title: '开始时间', dataIndex: 'startedAt', render: (v) => new Date(v).toLocaleString() },
            { title: '消息数', dataIndex: 'messageCount', align: 'right', width: 80 },
            {
              title: 'Token', dataIndex: 'totalTokens', align: 'right', width: 120,
              render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toLocaleString()}</span>,
            },
            {
              title: '成本 ($)', dataIndex: 'totalCostUsd', align: 'right', width: 110,
              render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toFixed(4)}</span>,
            },
          ]}
        />
      </Card>
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual check**

Navigate to any project detail.
Expected: PageHeader with project name and "返回" button; chart applies theme; Top sessions table compact, numeric columns right-aligned.

- [ ] **Step 4: Commit**

```bash
git add src/web/pages/Projects/Detail.tsx
git commit -m "feat(project-detail): PageHeader + themed chart + compact top-sessions table"
```

---

## Task 15: Sessions List — Stats + Filters + Duration Tag

**Files:**
- Modify: `src/web/pages/Sessions/List.tsx`

- [ ] **Step 1: Replace `src/web/pages/Sessions/List.tsx` contents**

```tsx
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Table, Tag, Row, Col, Select, Segmented } from 'antd';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import type { ProjectRow, RangeKey, SessionsListResponse } from '../../../shared/types.js';
import PageHeader from '../../components/PageHeader.js';
import KpiCard from '../../components/KpiCard.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';

const RANGE_OPTIONS: { label: string; value: RangeKey }[] = [
  { label: '今天', value: 'today' }, { label: '本周', value: 'week' },
  { label: '本月', value: 'month' }, { label: 'YTD', value: 'ytd' },
  { label: '全部', value: 'all' },
];

function rangeToFromTo(r: RangeKey): { from?: string; to?: string } {
  const now = new Date();
  const to = now.toISOString();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (r) {
    case 'today': return { from: startOfDay.toISOString(), to };
    case 'week':  return { from: new Date(now.getTime() - 7 * 86400_000).toISOString(), to };
    case 'month': return { from: new Date(now.getTime() - 30 * 86400_000).toISOString(), to };
    case 'ytd':   return { from: new Date(now.getFullYear(), 0, 1).toISOString(), to };
    case 'all':
    default:      return {};
  }
}

function durationTag(ms: number): { color: string; text: string } {
  const min = Math.round(ms / 60000);
  if (min < 10) return { color: 'green',   text: `${min} 分` };
  if (min < 60) return { color: 'default', text: `${min} 分` };
  const hr = (min / 60).toFixed(1);
  return { color: 'orange', text: `${hr} 时` };
}

function hashColor(name: string): string {
  const palette = ['magenta', 'red', 'volcano', 'orange', 'gold', 'lime', 'green', 'cyan', 'blue', 'geekblue', 'purple'];
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return palette[Math.abs(h) % palette.length];
}

export default function SessionsList() {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const [page, setPage] = useState(1);
  const [projectDirs, setProjectDirs] = useState<string[]>([]);
  const [range, setRange] = useState<RangeKey>('all');
  const pageSize = 50;

  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRow[]>('/api/projects?sortBy=cost'),
  });

  const url = useMemo(() => {
    const { from, to } = rangeToFromTo(range);
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String((page - 1) * pageSize),
    });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (projectDirs.length) params.set('projectDir', projectDirs.join(','));
    return `/api/sessions?${params.toString()}`;
  }, [page, pageSize, projectDirs, range]);

  const { data, isLoading } = useQuery({
    queryKey: ['sessions', url],
    queryFn: () => api.get<SessionsListResponse>(url),
  });

  const stats = data?.stats ?? { count: 0, totalCostUsd: 0, avgCostUsd: 0, medianDurationMs: 0 };

  return (
    <>
      <PageHeader
        title="会话"
        subtitle={`共 ${data?.total ?? 0} 条`}
        extra={<Segmented options={RANGE_OPTIONS} value={range} onChange={(v) => { setRange(v as RangeKey); setPage(1); }} />}
      />
      <Row gutter={14} style={{ marginBottom: 16 }}>
        <Col span={6}><KpiCard title="会话数" value={stats.count} /></Col>
        <Col span={6}><KpiCard title="总成本" value={stats.totalCostUsd} precision={2} suffix="$" /></Col>
        <Col span={6}><KpiCard title="平均成本" value={stats.avgCostUsd} precision={4} suffix="$" /></Col>
        <Col span={6}><KpiCard title="中位时长" value={Math.round(stats.medianDurationMs / 60000)} suffix=" 分" /></Col>
      </Row>

      <div style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: t.textSecondary }}>项目</span>
        <Select<string[]>
          mode="multiple"
          allowClear
          style={{ minWidth: 280 }}
          placeholder="全部项目"
          value={projectDirs}
          onChange={(v) => { setProjectDirs(v); setPage(1); }}
          options={(projects.data ?? []).map(p => ({
            label: p.displayName, value: p.projectDir,
          }))}
        />
      </div>

      <Table
        size="small"
        loading={isLoading}
        rowKey="sessionId"
        dataSource={data?.items ?? []}
        pagination={{ current: page, pageSize, total: data?.total ?? 0, onChange: setPage }}
        columns={[
          {
            title: '会话', dataIndex: 'sessionId',
            render: (sid: string) => <Link to={`/sessions/${sid}`}>{sid.slice(0, 8)}…</Link>,
          },
          { title: '开始时间', dataIndex: 'startedAt', width: 170, render: (v) => new Date(v).toLocaleString() },
          {
            title: '时长', width: 90,
            render: (_: unknown, r: { startedAt: number; endedAt: number }) => {
              const { color, text } = durationTag(r.endedAt - r.startedAt);
              return <Tag color={color}>{text}</Tag>;
            },
          },
          { title: '消息数', dataIndex: 'messageCount', align: 'right', width: 80 },
          {
            title: 'Token', dataIndex: 'totalTokens', align: 'right', width: 110,
            render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toLocaleString()}</span>,
          },
          {
            title: '成本 ($)', dataIndex: 'totalCostUsd', align: 'right', width: 110,
            render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toFixed(4)}</span>,
          },
          {
            title: 'Top 工具', dataIndex: 'topTools',
            render: (tools: string[]) => {
              const shown = tools.slice(0, 3);
              const rest = tools.length - shown.length;
              return (
                <>
                  {shown.map(t => <Tag key={t} color={hashColor(t)}>{t}</Tag>)}
                  {rest > 0 && <Tag>+{rest}</Tag>}
                </>
              );
            },
          },
        ]}
      />
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual check**

Navigate to `/sessions`.
Expected:
- PageHeader "会话 / 共 N 条" + range Segmented.
- Four KPI cards show count / total cost / avg cost / median duration, matching current filter.
- Project multi-select below KPIs filters the table + updates stats.
- Duration column renders coloured Tags (green/default/orange by bucket).
- Top tools max 3, overflow "+N" tag.

- [ ] **Step 4: Commit**

```bash
git add src/web/pages/Sessions/List.tsx
git commit -m "feat(sessions): filter bar, stats KPIs, duration tag, tool truncation"
```

---

## Task 16: Session Detail — KPI Row + Expand Preview

**Files:**
- Modify: `src/web/pages/Sessions/Detail.tsx`

- [ ] **Step 1: Replace `src/web/pages/Sessions/Detail.tsx` contents**

```tsx
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, Table, Row, Col, Tag } from 'antd';
import ReactECharts from 'echarts-for-react';
import { api } from '../../api/client.js';
import type { MessageRow } from '../../../shared/types.js';
import PageHeader from '../../components/PageHeader.js';
import KpiCard from '../../components/KpiCard.js';
import { useTheme } from '../../theme/useTheme.js';
import { echartsThemeName } from '../../theme/echarts.js';

interface Detail {
  session: {
    sessionId: string; projectDir: string;
    startedAt: number; endedAt: number;
    messageCount: number; totalCostUsd: number;
  };
  messages: MessageRow[];
  toolDistribution: { tool: string; count: number; share: number }[];
}

function hashColor(name: string): string {
  const palette = ['magenta', 'red', 'volcano', 'orange', 'gold', 'lime', 'green', 'cyan', 'blue', 'geekblue', 'purple'];
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return palette[Math.abs(h) % palette.length];
}

export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { mode } = useTheme();
  const { data } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api.get<Detail>(`/api/sessions/${sessionId}`),
  });
  if (!data) return null;

  const totalTokens = data.messages.reduce(
    (a, m) => a + m.inputTokens + m.outputTokens + m.cacheCreate + m.cacheRead, 0
  );
  const durationMin = Math.round((data.session.endedAt - data.session.startedAt) / 60000);

  return (
    <>
      <PageHeader
        title={`会话 ${data.session.sessionId.slice(0, 8)}…`}
        subtitle={new Date(data.session.startedAt).toLocaleString()}
      />

      <Row gutter={14} style={{ marginBottom: 16 }}>
        <Col span={6}><KpiCard title="消息数" value={data.session.messageCount} /></Col>
        <Col span={6}><KpiCard title="时长" value={durationMin} suffix=" 分" /></Col>
        <Col span={6}><KpiCard title="总 Token" value={totalTokens} /></Col>
        <Col span={6}><KpiCard title="成本" value={data.session.totalCostUsd} precision={4} suffix="$" /></Col>
      </Row>

      <Row gutter={14} style={{ marginBottom: 16 }}>
        <Col span={16}>
          <Card title="消息时间线 · token 分布">
            <ReactECharts
              theme={echartsThemeName(mode)}
              style={{ height: 280 }}
              option={{
                tooltip: { trigger: 'axis' },
                legend: { top: 'bottom' },
                grid: { left: 50, right: 20, top: 20, bottom: 40 },
                xAxis: { type: 'category', data: data.messages.map((_, i) => i + 1), name: '第 N 条消息' },
                yAxis: { type: 'value', name: 'tokens' },
                series: [
                  { name: 'input',        type: 'bar', stack: 't', data: data.messages.map(m => m.inputTokens) },
                  { name: 'output',       type: 'bar', stack: 't', data: data.messages.map(m => m.outputTokens) },
                  { name: 'cache-create', type: 'bar', stack: 't', data: data.messages.map(m => m.cacheCreate) },
                  { name: 'cache-read',   type: 'bar', stack: 't', data: data.messages.map(m => m.cacheRead) },
                ],
              }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card title="工具调用分布">
            <ReactECharts
              theme={echartsThemeName(mode)}
              style={{ height: 280 }}
              option={{
                tooltip: { trigger: 'item' },
                legend: { bottom: 0, itemWidth: 8, itemHeight: 8 },
                series: [{
                  type: 'pie', radius: ['40%', '70%'], avoidLabelOverlap: true,
                  label: { show: false }, labelLine: { show: false },
                  data: data.toolDistribution.map(t => ({ name: t.tool, value: t.count })),
                }],
              }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="消息详情">
        <Table<MessageRow>
          size="small"
          rowKey="messageId"
          dataSource={data.messages}
          pagination={{ pageSize: 30 }}
          expandable={{
            expandedRowRender: (r) => (
              <div style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {r.textPreview || <span style={{ opacity: 0.6 }}>(无文本预览)</span>}
              </div>
            ),
            rowExpandable: (r) => !!r.textPreview,
          }}
          columns={[
            { title: '时间', dataIndex: 'timestamp', width: 110, render: (v) => new Date(v).toLocaleTimeString() },
            {
              title: 'role', dataIndex: 'role', width: 90,
              render: (r: string) => <Tag color={r === 'assistant' ? 'blue' : 'default'}>{r}</Tag>,
            },
            {
              title: 'model', dataIndex: 'model', width: 160,
              render: (m: string | null) => m ? <Tag color="geekblue">{m}</Tag> : null,
            },
            { title: 'input',   dataIndex: 'inputTokens',  align: 'right', width: 80 },
            { title: 'output',  dataIndex: 'outputTokens', align: 'right', width: 80 },
            { title: 'cache-rd', dataIndex: 'cacheRead',   align: 'right', width: 90 },
            {
              title: '$', dataIndex: 'costUsd', align: 'right', width: 90,
              render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toFixed(4)}</span>,
            },
            {
              title: 'tools', dataIndex: 'toolNames',
              render: (tools: string[]) => {
                const shown = tools.slice(0, 3);
                const rest = tools.length - shown.length;
                return (
                  <>
                    {shown.map(t => <Tag key={t} color={hashColor(t)}>{t}</Tag>)}
                    {rest > 0 && <Tag>+{rest}</Tag>}
                  </>
                );
              },
            },
            { title: 'preview', dataIndex: 'textPreview', ellipsis: true },
          ]}
        />
      </Card>
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual check**

Navigate to any session detail.
Expected: PageHeader; 4 KpiCards instead of Descriptions; themed charts; table rows are expandable only when `textPreview` exists; expanding shows full text with pre-wrap.

- [ ] **Step 4: Commit**

```bash
git add src/web/pages/Sessions/Detail.tsx
git commit -m "feat(session-detail): KPI row, donut tool pie, expandable preview rows"
```

---

## Task 17: Cost Page — KPI Row + MarkPoint + Search; delete TopBarChart

**Files:**
- Modify: `src/web/pages/Cost/index.tsx`
- Delete: `src/web/components/TopBarChart.tsx`

- [ ] **Step 1: Confirm TopBarChart no longer has consumers**

Run: `grep -rn "TopBarChart" src/`
Expected: only its own file. (If anything else still references it, STOP and re-check Overview.)

- [ ] **Step 2: Replace `src/web/pages/Cost/index.tsx` contents**

```tsx
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Segmented, Row, Col, Table, Button, Input } from 'antd';
import { SearchOutlined, DownloadOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { api } from '../../api/client.js';
import type { CostResponse } from '../../../shared/types.js';
import PageHeader from '../../components/PageHeader.js';
import KpiCard from '../../components/KpiCard.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';
import { echartsThemeName } from '../../theme/echarts.js';

type Granularity = 'day' | 'week' | 'month';

export default function Cost() {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const [gran, setGran] = useState<Granularity>('day');
  const [q, setQ] = useState('');

  const { data } = useQuery({
    queryKey: ['cost', gran],
    queryFn: () => api.get<CostResponse>(`/api/cost?granularity=${gran}&range=all`),
  });

  const buckets = data?.buckets ?? [];
  const anomalies = data?.anomalies ?? [];
  const anomalyKeys = useMemo(() => new Set(anomalies.map(a => a.date)), [anomalies]);

  const totalCost = buckets.reduce((a, b) => a + b.costUsd, 0);
  const avgCost = buckets.length ? totalCost / buckets.length : 0;
  const peakBucket = buckets.reduce<null | { bucketKey: string; costUsd: number }>(
    (acc, b) => (acc && acc.costUsd >= b.costUsd) ? acc : b, null
  );
  const peakCost = peakBucket?.costUsd ?? 0;

  const projects = [...new Set(buckets.flatMap(b => b.byProject.map(p => p.projectDir)))];
  const series = projects.map(pd => ({
    name: pd.split(/[/\\]/).pop() ?? pd,
    type: 'bar',
    stack: 'all',
    data: buckets.map(b => b.byProject.find(p => p.projectDir === pd)?.costUsd ?? 0),
  }));

  const markPointData = anomalies.map(a => ({
    name: 'anomaly',
    value: a.costUsd.toFixed(2),
    xAxis: a.date,
    yAxis: a.costUsd,
    itemStyle: { color: t.danger },
  }));
  if (series.length > 0) {
    (series[0] as Record<string, unknown>).markPoint = {
      symbol: 'pin', symbolSize: 38, label: { fontSize: 10, color: '#fff' },
      data: markPointData,
    };
  }

  const filteredBuckets = q
    ? buckets.filter(b => b.bucketKey.toLowerCase().includes(q.toLowerCase()))
    : buckets;

  return (
    <>
      <PageHeader
        title="成本"
        subtitle="周期聚合 + z-score 异常检测"
        extra={
          <Segmented
            options={[
              { label: '日', value: 'day' },
              { label: '周', value: 'week' },
              { label: '月', value: 'month' },
            ]}
            value={gran}
            onChange={(v) => setGran(v as Granularity)}
          />
        }
      />

      <Row gutter={14} style={{ marginBottom: 16 }}>
        <Col span={6}><KpiCard title="周期总成本" value={totalCost} precision={2} suffix="$" /></Col>
        <Col span={6}><KpiCard title="周期均值"   value={avgCost} precision={2} suffix="$" /></Col>
        <Col span={6}><KpiCard title="峰值"       value={peakCost} precision={2} suffix="$" /></Col>
        <Col span={6}><KpiCard title="异常周期"   value={anomalies.length} suffix=" 个" /></Col>
      </Row>

      <Row gutter={14}>
        <Col span={18}>
          <Card title="成本堆叠(按项目)">
            <ReactECharts
              theme={echartsThemeName(mode)}
              style={{ height: 380 }}
              option={{
                tooltip: { trigger: 'axis' },
                legend: { top: 'bottom' },
                grid: { left: 50, right: 20, top: 30, bottom: 60 },
                xAxis: {
                  type: 'category',
                  data: buckets.map(b => b.bucketKey),
                  axisLabel: {
                    formatter: (v: string) => anomalyKeys.has(v) ? `{red|${v}}` : v,
                    rich: { red: { color: t.danger, fontWeight: 'bold' } },
                  },
                },
                yAxis: { type: 'value', name: '$' },
                series,
              }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card title={`异常周期(z > 2) · ${anomalies.length}`}>
            <Table
              size="small"
              rowKey="date"
              dataSource={anomalies}
              pagination={false}
              rowClassName={() => 'cc-anomaly-row'}
              columns={[
                { title: '日期', dataIndex: 'date' },
                { title: '$',    dataIndex: 'costUsd', align: 'right', render: (v: number) => v.toFixed(2) },
                { title: 'z',    dataIndex: 'zScore',  align: 'right', render: (v: number) => v.toFixed(2) },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Card
        title="账单明细"
        style={{ marginTop: 16 }}
        extra={
          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              prefix={<SearchOutlined />}
              placeholder="按周期搜索"
              allowClear
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ width: 180 }}
            />
            <Button icon={<DownloadOutlined />} onClick={() => downloadCsv(data)}>导出 CSV</Button>
          </div>
        }
      >
        <Table
          size="small"
          rowKey="bucketKey"
          dataSource={filteredBuckets}
          pagination={{ pageSize: 30 }}
          rowClassName={(r) => anomalyKeys.has(r.bucketKey) ? 'cc-anomaly-row' : ''}
          columns={[
            { title: '周期', dataIndex: 'bucketKey' },
            {
              title: '$', dataIndex: 'costUsd', align: 'right', width: 120,
              render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toFixed(4)}</span>,
            },
            {
              title: 'tokens', dataIndex: 'tokens', align: 'right', width: 140,
              render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toLocaleString()}</span>,
            },
          ]}
        />
      </Card>

      <style>{`
        .cc-anomaly-row td {
          background: ${mode === 'dark' ? 'rgba(239,68,68,0.08)' : '#fef2f2'} !important;
          color: ${t.danger} !important;
          font-weight: 600;
        }
      `}</style>
    </>
  );
}

function downloadCsv(data: CostResponse | undefined) {
  if (!data) return;
  const rows = [['bucket', 'costUsd', 'tokens'], ...data.buckets.map(b => [b.bucketKey, b.costUsd, b.tokens])];
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cc-usage-cost.csv';
  a.click();
}
```

- [ ] **Step 3: Delete `src/web/components/TopBarChart.tsx`**

Run: `git rm src/web/components/TopBarChart.tsx`

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Manual check**

Navigate to `/cost`.
Expected:
- PageHeader "成本 / 周期聚合 + z-score 异常检测" + granularity Segmented.
- Four KPI cards above the chart.
- Stacked bar chart has red pin markPoints on anomaly dates.
- Right anomaly table has red highlighted rows.
- Bucket details table has search input that filters by bucketKey text; anomaly rows are highlighted red.

- [ ] **Step 6: Commit**

```bash
git add src/web/pages/Cost/index.tsx
git commit -m "feat(cost): KPI row, anomaly markPoint, search, themed chart; remove TopBarChart"
```

---

## Task 18: Full-App Smoke Check

**Files:** (read-only)

- [ ] **Step 1: Run full dev server**

Run: `npm run dev`
Open the site.

- [ ] **Step 2: Golden path walk — light mode**

Check:
- [ ] `/overview` renders header, KPIs, trend chart, today-glance, two BarLists.
- [ ] Clicking time range Segmented updates KPIs + chart.
- [ ] `/projects` renders table with two-line project cell + mini cost bar.
- [ ] Click a project → detail page renders with back button, theme-aware chart.
- [ ] `/sessions` renders stats KPIs + project multi-select + range Segmented. Selecting a project reduces counts correctly.
- [ ] Click a session → detail page renders 4 KPIs + two themed charts + expandable preview rows.
- [ ] `/cost` renders KPIs + stacked chart with red markPoints + highlighted anomaly rows + search.
- [ ] Top-right "刷新数据" triggers spinner and refreshes data.
- [ ] Sidebar footer "最近扫描 · X 分钟前" updates after refresh.

- [ ] **Step 3: Golden path walk — dark mode**

Click the moon icon.
Check:
- [ ] Page bg and cards darken.
- [ ] Sidebar stays dark (unchanged).
- [ ] All chart colours, axis labels, tooltips are readable.
- [ ] KpiCard icons still contrast against their tinted backgrounds.
- [ ] Anomaly row red highlighting still readable in dark.
- [ ] Refresh page: dark mode persists.

- [ ] **Step 4: Empty-state walk**

Point `CC_DB` at a throwaway empty DB (or rename the existing one temporarily) and boot.
Check:
- [ ] `/overview` shows EmptyState "暂无数据" with hint.
- [ ] `/sessions` stats read 0/0/0/0.
- [ ] `/cost` renders with empty charts (no error).

Restore the original DB after the check.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: all green (includes Task 11's new session stats tests).

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Build production bundle**

Run: `npm run build`
Expected: Vite build and tsup build both succeed. No unused-import warnings that we introduced.

- [ ] **Step 7: Commit any drift-fix edits discovered in steps 2-6**

If anything in steps 2-6 required a fix, commit it now with a focused message like `fix(overview): correct sparkline null-guard`. If no fixes needed, skip this step.

- [ ] **Step 8: Final commit — README screenshot refresh (optional)**

If the repo's README contains a screenshot that now looks outdated, capture a new one and replace, then:

```bash
git add README.md docs/screenshots
git commit -m "docs: refresh screenshots for redesigned UI"
```

Otherwise skip.

---

## Self-Review Notes

- Spec §3 (tokens, radius, density) → Task 1.
- Spec §4.1 (directory) → Tasks 1-9.
- Spec §4.2 (theme flow) → Tasks 3, 4, plus echarts via Task 2.
- Spec §4.3 (shell) → Task 10.
- Spec §5.1 (Overview) → Task 12 (KPI sparkline scoped to dailyTrend fields, today glance uses `/api/cost` month query as spec dictates).
- Spec §5.2 (Projects list) → Task 13.
- Spec §5.3 (Project detail) → Task 14.
- Spec §5.4 (Sessions list) → Task 15 + Task 11 server-side.
- Spec §5.5 (Session detail) → Task 16.
- Spec §5.6 (Cost) → Task 17.
- Spec §6 (echarts theme) → Task 2.
- Spec §7 (empty/error states) → Task 8 + used in Task 12. Error state component is listed in the spec but v1 scope only uses EmptyState (error states deferred; consumer pages still show react-query's default on failure — this is a conscious scope cut, not a placeholder).
- Spec §8 (testing) → Task 11 adds vitest coverage; Task 18 does the manual walkthrough.
- Non-goal "no data model change" → respected (only field additions to existing endpoints).

All task code blocks are self-contained; types are consistent (`SessionsListResponse`, `SessionsListStats`, `Mode`, `ThemeCtx`, `PageHeaderState`) and match across server, shared types, and consumers.
