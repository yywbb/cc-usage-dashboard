import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, Table, Button, Row, Col, Popover } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { api } from '../../api/client.js';
import PageHeader from '../../components/PageHeader.js';
import KpiCard from '../../components/KpiCard.js';
import TokenBreakdown from '../../components/TokenBreakdown.js';
import { useTheme } from '../../theme/useTheme.js';
import { echartsThemeName, formatCompactNumber } from '../../theme/echarts.js';
import { useFormatTokens } from '../../format.js';
import { useStore } from '../../store.js';

interface Timeline {
  daily: Array<{ date: string; tokens: number; costUsd: number; sessionCount: number }>;
  topSessions: Array<{ sessionId: string; totalCostUsd: number; totalTokens: number; messageCount: number; startedAt: number; endedAt: number }>;
  totals: {
    inputTokens: number; outputTokens: number;
    cacheCreate: number; cacheRead: number;
    costUsd: number; messageCount: number; sessionCount: number;
    cacheHitRate: number;
  };
}

function decodeB64(b64: string): string {
  return atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
}

export default function ProjectDetail() {
  const { b64 } = useParams<{ b64: string }>();
  const nav = useNavigate();
  const { mode } = useTheme();
  const fmtTokens = useFormatTokens();
  const sourceFilter = useStore(s => s.sourceFilter);
  const { data } = useQuery({
    queryKey: ['projectTimeline', b64, sourceFilter],
    queryFn: () => api.get<Timeline>(`/api/projects/${b64}/timeline?range=all${sourceFilter !== 'all' ? `&source=${sourceFilter}` : ''}`),
  });

  const projectName = b64 ? decodeB64(b64).split(/[/\\]/).pop() ?? b64 : '';

  return (
    <>
      <PageHeader
        title={projectName}
        subtitle="项目时间线"
        extra={<Button icon={<ArrowLeftOutlined />} onClick={() => nav('/projects')}>返回</Button>}
      />
      {data?.totals && (() => {
        const tot = data.totals;
        const totalTokens = tot.inputTokens + tot.outputTokens + tot.cacheCreate + tot.cacheRead;
        return (
          <Row gutter={14} style={{ marginBottom: 16 }}>
            <Col flex="1 1 0"><KpiCard title="会话数" value={tot.sessionCount} /></Col>
            <Col flex="1 1 0"><KpiCard title="消息数" value={tot.messageCount} formatter={fmtTokens} /></Col>
            <Col flex="1 1 0">
              <Popover
                placement="bottomLeft"
                mouseEnterDelay={0.15}
                content={
                  <TokenBreakdown totals={tot} cacheHitRate={tot.cacheHitRate} fmtTokens={fmtTokens} />
                }
              >
                <div style={{ cursor: 'help' }}>
                  <KpiCard title="总 Token" value={totalTokens} formatter={fmtTokens} />
                </div>
              </Popover>
            </Col>
            <Col flex="1 1 0">
              <KpiCard title="缓存命中率" value={tot.cacheHitRate * 100} precision={1} suffix="%" />
            </Col>
            <Col flex="1 1 0"><KpiCard title="总成本" value={tot.costUsd} precision={2} suffix="$" /></Col>
          </Row>
        );
      })()}
      <Card title="每日 token 与成本" style={{ marginBottom: 16 }}>
        <ReactECharts
          theme={echartsThemeName(mode)}
          style={{ height: 320 }}
          option={{
            animation: false,
            tooltip: { trigger: 'axis', axisPointer: { type: 'line' } },
            legend: { top: 'bottom' },
            grid: { left: 50, right: 50, top: 20, bottom: 60 },
            xAxis: { type: 'category', data: data?.daily.map(d => d.date) ?? [] },
            yAxis: [
              {
                type: 'value',
                axisLabel: { formatter: (v: number) => formatCompactNumber(v) },
              },
              { type: 'value' },
            ],
            series: [
              {
                name: 'tokens', type: 'bar',
                data: data?.daily.map(d => d.tokens) ?? [],
                tooltip: { valueFormatter: (v: unknown) => fmtTokens(Number(v)) },
              },
              {
                name: '$', type: 'line', yAxisIndex: 1,
                data: data?.daily.map(d => d.costUsd) ?? [],
                tooltip: { valueFormatter: (v: unknown) => `$${Number(v).toFixed(2)}` },
              },
            ],
          }}
        />
      </Card>
      <Card title="Top 20 会话(按成本)">
        <Table
          size="small"
          rowKey="sessionId"
          dataSource={data?.topSessions ?? []}
          pagination={{
            defaultPageSize: 15,
            pageSizeOptions: [10, 15, 20, 50, 100],
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
          }}
          columns={[
            {
              title: '会话', dataIndex: 'sessionId',
              render: (sid) => <Link to={`/sessions/${sid}`}>{sid.slice(0, 8)}…</Link>,
            },
            { title: '开始时间', dataIndex: 'startedAt', render: (v) => new Date(v).toLocaleString() },
            { title: '消息数', dataIndex: 'messageCount', align: 'right', width: 80 },
            {
              title: 'Token', dataIndex: 'totalTokens', align: 'right', width: 120,
              render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTokens(v)}</span>,
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
