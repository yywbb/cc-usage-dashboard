import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, Table, Row, Col, Tag, Popover } from 'antd';
import type { TableColumnsType } from 'antd';
import ReactECharts from 'echarts-for-react';
import { api } from '../../api/client.js';
import type { MessageRow, SessionRateLimit } from '../../../shared/types.js';
import PageHeader from '../../components/PageHeader.js';
import KpiCard from '../../components/KpiCard.js';
import TokenBreakdown, { computeCacheHitRate } from '../../components/TokenBreakdown.js';
import { useTheme } from '../../theme/useTheme.js';
import { echartsThemeName, formatCompactNumber } from '../../theme/echarts.js';
import { useFormatTokens } from '../../format.js';
import { useI18n } from '../../i18n/index.js';

interface Detail {
  session: {
    sessionId: string; projectDir: string;
    startedAt: number; endedAt: number;
    messageCount: number; totalCostUsd: number;
    source: string | null;
    cwdRealPath: string | null;
    totalReasoning: number;
  };
  messages: MessageRow[];
  toolDistribution: { tool: string; count: number; share: number }[];
  rateLimit: SessionRateLimit | null;
}

function hashColor(name: string): string {
  const palette = ['magenta', 'red', 'volcano', 'orange', 'gold', 'lime', 'green', 'cyan', 'blue', 'geekblue', 'purple'];
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return palette[Math.abs(h) % palette.length];
}

export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { mode } = useTheme();
  const { t: tr } = useI18n();
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
  const isCodex = data.session.source === 'codex';

  const messageColumns: TableColumnsType<MessageRow> = [
    { title: tr('sessions.detail.col.time'), dataIndex: 'timestamp', width: 110, render: (v) => new Date(v).toLocaleTimeString() },
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
    ...(isCodex ? [{
      title: 'reasoning',
      dataIndex: 'reasoningTokens',
      align: 'right' as const,
      width: 90,
      render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTokens(v ?? 0)}</span>,
    }] : []),
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
  ];

  return (
    <>
      <PageHeader
        title={tr('sessions.detail.title', { id: data.session.sessionId.slice(0, 8) })}
        subtitle={new Date(data.session.startedAt).toLocaleString()}
      />

      <Row gutter={14} style={{ marginBottom: 16 }}>
        <Col flex="1 1 0"><KpiCard title={tr('sessions.detail.kpi.messages')} value={data.session.messageCount} /></Col>
        <Col flex="1 1 0"><KpiCard title={tr('sessions.detail.kpi.duration')} value={durationMin} suffix={tr('sessions.detail.kpi.durationUnit')} /></Col>
        <Col flex="1 1 0">
          <Popover
            placement="bottomLeft"
            mouseEnterDelay={0.15}
            content={
              <TokenBreakdown totals={tokenTotals} cacheHitRate={cacheHitRate} fmtTokens={fmtTokens} />
            }
          >
            <div style={{ cursor: 'help' }}>
              <KpiCard title={tr('sessions.detail.kpi.totalToken')} value={totalTokens} formatter={fmtTokens} />
            </div>
          </Popover>
        </Col>
        <Col flex="1 1 0">
          <KpiCard title={tr('sessions.detail.kpi.cacheHit')} value={cacheHitRate * 100} precision={1} suffix="%" />
        </Col>
        <Col flex="1 1 0"><KpiCard title={tr('sessions.detail.kpi.cost')} value={data.session.totalCostUsd} precision={4} suffix="$" /></Col>
        {data.session.source === 'codex' && (
          <Col flex="1 1 0">
            <KpiCard title={tr('sessions.detail.kpi.reasoning')} value={data.session.totalReasoning} formatter={fmtTokens} />
          </Col>
        )}
        {data.rateLimit && (
          <Col flex="1 1 0">
            <KpiCard
              title={tr('sessions.detail.kpi.codex')}
              value={0}
              formatter={() =>
                `${data.rateLimit!.primaryUsedPct?.toFixed(1) ?? '-'}% / ${data.rateLimit!.secondaryUsedPct?.toFixed(1) ?? '-'}%`
              }
            />
          </Col>
        )}
      </Row>

      <Row gutter={14} style={{ marginBottom: 16 }}>
        <Col span={16}>
          <Card title={tr('sessions.detail.timeline')}>
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
                xAxis: { type: 'category', data: data.messages.map((_, i) => i + 1) },
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
          <Card title={tr('sessions.detail.toolPie')}>
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

      <Card title={tr('sessions.detail.messages')}>
        <Table<MessageRow>
          size="small"
          rowKey="messageId"
          dataSource={data.messages}
          pagination={{
            defaultPageSize: 15,
            pageSizeOptions: [10, 15, 20, 50, 100],
            showSizeChanger: true,
            showTotal: (total) => tr('common.totalCount', { n: total }),
          }}
          expandable={{
            expandedRowRender: (r) => (
              <div style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {r.textPreview || <span style={{ opacity: 0.6 }}>{tr('sessions.detail.noPreview')}</span>}
              </div>
            ),
            rowExpandable: (r) => !!r.textPreview,
          }}
          columns={messageColumns}
        />
      </Card>
    </>
  );
}
