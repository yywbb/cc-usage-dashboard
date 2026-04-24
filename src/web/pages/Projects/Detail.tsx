import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, Table } from 'antd';
import ReactECharts from 'echarts-for-react';
import { api } from '../../api/client.js';

interface Timeline {
  daily: Array<{ date: string; tokens: number; costUsd: number; sessionCount: number }>;
  topSessions: Array<{ sessionId: string; totalCostUsd: number; totalTokens: number; messageCount: number; startedAt: number; endedAt: number }>;
}

export default function ProjectDetail() {
  const { b64 } = useParams<{ b64: string }>();
  const { data } = useQuery({
    queryKey: ['projectTimeline', b64],
    queryFn: () => api.get<Timeline>(`/api/projects/${b64}/timeline?range=all`),
  });
  return (
    <>
      <Card title="每日 token 与成本" style={{ marginBottom: 16 }}>
        <ReactECharts
          style={{ height: 320 }}
          option={{
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: data?.daily.map(d => d.date) ?? [] },
            yAxis: [{ type: 'value', name: 'tokens' }, { type: 'value', name: '$' }],
            series: [
              { name: 'tokens', type: 'bar', data: data?.daily.map(d => d.tokens) ?? [] },
              { name: '$', type: 'line', yAxisIndex: 1, data: data?.daily.map(d => d.costUsd) ?? [] },
            ],
            legend: { top: 'bottom' },
          }}
        />
      </Card>
      <Card title="Top 20 会话（按成本）">
        <Table
          rowKey="sessionId"
          dataSource={data?.topSessions ?? []}
          pagination={{ pageSize: 20 }}
          columns={[
            { title: '会话', dataIndex: 'sessionId',
              render: (sid) => <Link to={`/sessions/${sid}`}>{sid.slice(0, 8)}…</Link> },
            { title: '开始时间', dataIndex: 'startedAt', render: (v) => new Date(v).toLocaleString() },
            { title: '消息数', dataIndex: 'messageCount' },
            { title: 'Token', dataIndex: 'totalTokens', render: (v: number) => v.toLocaleString() },
            { title: '成本 ($)', dataIndex: 'totalCostUsd', render: (v: number) => v.toFixed(4) },
          ]}
        />
      </Card>
    </>
  );
}
