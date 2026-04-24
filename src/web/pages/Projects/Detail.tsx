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
