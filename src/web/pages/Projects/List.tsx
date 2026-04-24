import { useQuery } from '@tanstack/react-query';
import { Table } from 'antd';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import type { ProjectRow } from '../../../shared/types.js';

function b64(p: string) { return btoa(p).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

export default function ProjectsList() {
  const { data, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRow[]>('/api/projects?sortBy=cost'),
  });
  return (
    <Table
      loading={isLoading}
      rowKey="projectDir"
      dataSource={data ?? []}
      columns={[
        { title: '项目', dataIndex: 'displayName',
          render: (_, r) => <Link to={`/projects/${b64(r.projectDir)}`}>{r.displayName}</Link> },
        { title: '真实路径', dataIndex: 'realPath' },
        { title: '会话数', dataIndex: 'sessionCount' },
        { title: 'Token', dataIndex: 'totalTokens', render: (v) => v.toLocaleString() },
        { title: '成本 ($)', dataIndex: 'totalCostUsd', render: (v: number) => v.toFixed(2) },
        { title: '平均/会话', dataIndex: 'avgTokensPerSession', render: (v: number) => Math.round(v).toLocaleString() },
        { title: '最近活跃', dataIndex: 'lastSeenAt', render: (v: number) => new Date(v).toLocaleString() },
      ]}
    />
  );
}
