import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Table, Tag } from 'antd';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';

interface SessionListRow {
  sessionId: string; projectDir: string;
  startedAt: number; endedAt: number;
  messageCount: number; totalTokens: number; totalCostUsd: number;
  topTools: string[];
}

export default function SessionsList() {
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const { data, isLoading } = useQuery({
    queryKey: ['sessions', page],
    queryFn: () => api.get<{ total: number; items: SessionListRow[] }>(
      `/api/sessions?limit=${pageSize}&offset=${(page - 1) * pageSize}`
    ),
  });
  return (
    <Table
      loading={isLoading}
      rowKey="sessionId"
      dataSource={data?.items ?? []}
      pagination={{ current: page, pageSize, total: data?.total ?? 0, onChange: setPage }}
      columns={[
        { title: '会话', dataIndex: 'sessionId',
          render: (sid: string) => <Link to={`/sessions/${sid}`}>{sid.slice(0, 8)}…</Link> },
        { title: '开始时间', dataIndex: 'startedAt', render: (v) => new Date(v).toLocaleString() },
        { title: '时长', render: (_, r) => {
            const ms = r.endedAt - r.startedAt;
            const min = Math.round(ms / 60000);
            return `${min} 分`;
          } },
        { title: '消息数', dataIndex: 'messageCount' },
        { title: 'Token', dataIndex: 'totalTokens', render: (v: number) => v.toLocaleString() },
        { title: '成本 ($)', dataIndex: 'totalCostUsd', render: (v: number) => v.toFixed(4) },
        { title: 'Top 工具', dataIndex: 'topTools',
          render: (tools: string[]) => tools.map(t => <Tag key={t}>{t}</Tag>) },
      ]}
    />
  );
}
