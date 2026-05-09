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
import { RateLimitBadge } from './components/RateLimitBadge.js';
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
  const { setContainer } = usePageHeader();

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
    { key: '/settings', icon: <SettingOutlined />,   label: <Link to="/settings">设置</Link> },
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
        }}
      >
        <div style={{ padding: '18px 20px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
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
              style={{ background: t.sidebarBg, border: 'none', padding: '10px 8px', flex: 1, overflowY: 'auto' }} />
        <div style={{ padding: '14px 20px', fontSize: 11, color: '#64748b', borderTop: '1px solid #1e293b', flexShrink: 0 }}>
          最近扫描 · {formatRelativeTime(health.data?.lastScanAt ?? null)}
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
            <RateLimitBadge />
            <ThemeToggle />
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              loading={scan.isPending}
              onClick={() => scan.mutate()}
            >刷新数据</Button>
          </div>
        </Layout.Header>
        <Layout.Content style={{ padding: `${SPACING.pageY}px ${SPACING.pageX}px`, background: t.pageBg, overflowY: 'auto', flex: 1 }}>
          <AppRoutes />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
