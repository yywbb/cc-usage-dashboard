import { Layout, Menu, Button } from 'antd';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import AppRoutes from './routes.js';
import { api } from './api/client.js';

export default function App() {
  const loc = useLocation();
  const qc = useQueryClient();
  const scan = useMutation({
    mutationFn: () => api.post('/api/scan'),
    onSuccess: () => qc.invalidateQueries(),
  });

  const menu = [
    { key: '/overview', label: <Link to="/overview">概览</Link> },
    { key: '/projects', label: <Link to="/projects">项目</Link> },
    { key: '/sessions', label: <Link to="/sessions">会话</Link> },
    { key: '/cost',     label: <Link to="/cost">成本</Link> },
  ];
  const selected = menu.find(m => loc.pathname.startsWith(m.key))?.key ?? '/overview';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider width={180}>
        <div style={{ color: 'white', padding: 16, fontWeight: 600 }}>CC Usage</div>
        <Menu theme="dark" mode="inline" selectedKeys={[selected]} items={menu} />
      </Layout.Sider>
      <Layout>
        <Layout.Header style={{ background: '#fff', padding: '0 16px', display: 'flex', justifyContent: 'flex-end' }}>
          <Button loading={scan.isPending} onClick={() => scan.mutate()}>刷新数据</Button>
        </Layout.Header>
        <Layout.Content style={{ padding: 24, background: '#f5f5f5' }}>
          <AppRoutes />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
