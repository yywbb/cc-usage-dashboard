import { Layout, Menu, Button } from 'antd';
import {
  DashboardOutlined, FolderOutlined, MessageOutlined, DollarOutlined, ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AppRoutes from './routes.js';
import { api } from './api/client.js';
import ThemeToggle from './components/ThemeToggle.js';
import LanguageToggle from './components/LanguageToggle.js';
import SourceToggle from './components/SourceToggle.js';
import { usePageHeader } from './components/PageHeaderContext.js';
import { useTheme } from './theme/useTheme.js';
import { TOKENS, SPACING } from './theme/tokens.js';
import { useI18n } from './i18n/index.js';

function useFormatRelativeTime() {
  const { t } = useI18n();
  return (ts: number | null): string => {
    if (!ts) return t('app.scanNever');
    const diffMs = Date.now() - ts;
    const min = Math.round(diffMs / 60000);
    if (min < 1) return t('app.justNow');
    if (min < 60) return t('app.minAgo', { n: min });
    const hr = Math.round(min / 60);
    if (hr < 24) return t('app.hourAgo', { n: hr });
    return t('app.dayAgo', { n: Math.round(hr / 24) });
  };
}

export default function App() {
  const loc = useLocation();
  const qc = useQueryClient();
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const { t: tr } = useI18n();
  const { setContainer } = usePageHeader();
  const formatRelativeTime = useFormatRelativeTime();

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
    { key: '/overview', icon: <DashboardOutlined />, label: <Link to="/overview">{tr('nav.overview')}</Link> },
    { key: '/projects', icon: <FolderOutlined />,    label: <Link to="/projects">{tr('nav.projects')}</Link> },
    { key: '/sessions', icon: <MessageOutlined />,   label: <Link to="/sessions">{tr('nav.sessions')}</Link> },
    { key: '/cost',     icon: <DollarOutlined />,    label: <Link to="/cost">{tr('nav.cost')}</Link> },
    { key: '/settings', icon: <SettingOutlined />,   label: <Link to="/settings">{tr('nav.settings')}</Link> },
  ];
  const selected = menu.find(m => loc.pathname.startsWith(m.key))?.key ?? '/overview';

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      <Layout.Sider
        width={220}
        style={{
          background: t.sidebarBg,
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          borderRight: `1px solid ${t.sidebarBorder}`,
        }}
      >
        <div style={{ padding: '18px 20px', borderBottom: `1px solid ${t.sidebarBorder}`, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: 14,
          }}>C</div>
          <div>
            <div style={{ color: t.sidebarText, fontWeight: 700, fontSize: 14, letterSpacing: 0.5 }}>{tr('app.appName')}</div>
            <div style={{ color: t.sidebarMuted, fontSize: 10 }}>v{__APP_VERSION__} · {tr('app.localTag')}</div>
          </div>
        </div>
        <Menu theme={t.sidebarMenuTheme} mode="inline" selectedKeys={[selected]} items={menu}
              style={{ background: t.sidebarBg, border: 'none', padding: '10px 8px', flex: 1, overflowY: 'auto' }} />
        <div style={{ padding: '14px 20px', fontSize: 11, color: t.sidebarMuted, borderTop: `1px solid ${t.sidebarBorder}`, flexShrink: 0 }}>
          {tr('app.lastScan', { value: formatRelativeTime(health.data?.lastScanAt ?? null) })}
        </div>
      </Layout.Sider>

      <Layout style={{ height: '100vh', overflow: 'hidden' }}>
        <Layout.Header style={{
          background: t.cardBg, padding: `0 ${SPACING.pageX}px`, height: 72, lineHeight: '72px',
          borderBottom: `1px solid ${t.border}`,
          display: 'flex', alignItems: 'center', gap: 24,
          flexShrink: 0,
        }}>
          <div ref={setContainer} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 24 }} />
          <div style={{ width: 1, height: 24, background: t.border }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SourceToggle />
            <LanguageToggle />
            <ThemeToggle />
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              loading={scan.isPending}
              onClick={() => scan.mutate()}
            >{tr('app.refresh')}</Button>
          </div>
        </Layout.Header>
        <Layout.Content style={{ padding: `${SPACING.pageY}px ${SPACING.pageX}px`, background: t.pageBg, overflowY: 'auto', flex: 1 }}>
          <AppRoutes />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
