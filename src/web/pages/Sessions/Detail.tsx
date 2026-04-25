import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, Table, Row, Col, Tag, Popover } from 'antd';
import ReactECharts from 'echarts-for-react';
import { api } from '../../api/client.js';
import type { MessageRow } from '../../../shared/types.js';
import PageHeader from '../../components/PageHeader.js';
import KpiCard from '../../components/KpiCard.js';
import TokenBreakdown, { computeCacheHitRate } from '../../components/TokenBreakdown.js';
import { useTheme } from '../../theme/useTheme.js';
import { echartsThemeName, formatCompactNumber } from '../../theme/echarts.js';
import { useFormatTokens } from '../../format.js';

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
  const fmtTokens = useFormatTokens();
  const { data } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api.get<Detail>(`/api/sessions/${sessionId}`),
  });
  if (!data) return null;

  const tokenTotals = data.messages.reduce(
    (acc, m) => ({
      inputTokens: acc.inputTokens + m.inputTokens,
      outputTokens: acc.outputTokens + m.outputTokens,
      cacheCreate: acc.cacheCreate + m.cacheCreate,
      cacheRead: acc.cacheRead + m.cacheRead,
    }),
    { inputTokens: 0, outputTokens: 0, cacheCreate: 0, cacheRead: 0 },
  );
  const totalTokens = tokenTotals.inputTokens + tokenTotals.outputTokens + tokenTotals.cacheCreate + tokenTotals.cacheRead;
  const cacheHitRate = computeCacheHitRate(tokenTotals);
  const durationMin = Math.round((data.session.endedAt - data.session.startedAt) / 60000);

  return (
    <>
      <PageHeader
        title={`会话 ${data.session.sessionId.slice(0, 8)}…`}
        subtitle={new Date(data.session.startedAt).toLocaleString()}
      />

      <Row gutter={14} style={{ marginBottom: 16 }}>
        <Col flex="1 1 0"><KpiCard title="消息数" value={data.session.messageCount} /></Col>
        <Col flex="1 1 0"><KpiCard title="时长" value={durationMin} suffix=" 分" /></Col>
        <Col flex="1 1 0">
          <Popover
            placement="bottomLeft"
            mouseEnterDelay={0.15}
            content={
              <TokenBreakdown totals={tokenTotals} cacheHitRate={cacheHitRate} fmtTokens={fmtTokens} />
            }
          >
            <div style={{ cursor: 'help' }}>
              <KpiCard title="总 Token" value={totalTokens} formatter={fmtTokens} />
            </div>
          </Popover>
        </Col>
        <Col flex="1 1 0">
          <KpiCard title="缓存命中率" value={cacheHitRate * 100} precision={1} suffix="%" />
        </Col>
        <Col flex="1 1 0"><KpiCard title="成本" value={data.session.totalCostUsd} precision={4} suffix="$" /></Col>
      </Row>

      <Row gutter={14} style={{ marginBottom: 16 }}>
        <Col span={16}>
          <Card title="消息时间线 · token 分布">
            <ReactECharts
              theme={echartsThemeName(mode)}
              style={{ height: 280 }}
              option={{
                animation: false,
                tooltip: {
                  trigger: 'axis',
                  axisPointer: { type: 'line' },
                  valueFormatter: (v: unknown) => fmtTokens(Number(v)),
                },
                legend: { top: 'bottom' },
                grid: { left: 50, right: 20, top: 20, bottom: 40 },
                xAxis: { type: 'category', data: data.messages.map((_, i) => i + 1), name: '第 N 条消息' },
                yAxis: {
                  type: 'value',
                  axisLabel: { formatter: (v: number) => formatCompactNumber(v) },
                },
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
                animation: false,
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
          pagination={{
            defaultPageSize: 15,
            pageSizeOptions: [10, 15, 20, 50, 100],
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
          }}
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
            {
              title: 'input', dataIndex: 'inputTokens', align: 'right', width: 80,
              render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTokens(v)}</span>,
            },
            {
              title: 'output', dataIndex: 'outputTokens', align: 'right', width: 80,
              render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTokens(v)}</span>,
            },
            {
              title: 'cache-rd', dataIndex: 'cacheRead', align: 'right', width: 90,
              render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTokens(v)}</span>,
            },
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
