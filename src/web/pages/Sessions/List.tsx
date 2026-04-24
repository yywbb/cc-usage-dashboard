import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Table, Tag, Row, Col, Select, Segmented } from 'antd';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import type { ProjectRow, RangeKey, SessionsListResponse } from '../../../shared/types.js';
import PageHeader from '../../components/PageHeader.js';
import KpiCard from '../../components/KpiCard.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';

const RANGE_OPTIONS: { label: string; value: RangeKey }[] = [
  { label: '今天', value: 'today' }, { label: '本周', value: 'week' },
  { label: '本月', value: 'month' }, { label: 'YTD', value: 'ytd' },
  { label: '全部', value: 'all' },
];

function rangeToFromTo(r: RangeKey): { from?: string; to?: string } {
  const now = new Date();
  const to = now.toISOString();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (r) {
    case 'today': return { from: startOfDay.toISOString(), to };
    case 'week':  return { from: new Date(now.getTime() - 7 * 86400_000).toISOString(), to };
    case 'month': return { from: new Date(now.getTime() - 30 * 86400_000).toISOString(), to };
    case 'ytd':   return { from: new Date(now.getFullYear(), 0, 1).toISOString(), to };
    case 'all':
    default:      return {};
  }
}

function durationTag(ms: number): { color: string; text: string } {
  const min = Math.round(ms / 60000);
  if (min < 10) return { color: 'green',   text: `${min} 分` };
  if (min < 60) return { color: 'default', text: `${min} 分` };
  const hr = (min / 60).toFixed(1);
  return { color: 'orange', text: `${hr} 时` };
}

function hashColor(name: string): string {
  const palette = ['magenta', 'red', 'volcano', 'orange', 'gold', 'lime', 'green', 'cyan', 'blue', 'geekblue', 'purple'];
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return palette[Math.abs(h) % palette.length];
}

export default function SessionsList() {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const [page, setPage] = useState(1);
  const [projectDirs, setProjectDirs] = useState<string[]>([]);
  const [range, setRange] = useState<RangeKey>('all');
  const pageSize = 50;

  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRow[]>('/api/projects?sortBy=cost'),
  });

  const url = useMemo(() => {
    const { from, to } = rangeToFromTo(range);
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String((page - 1) * pageSize),
    });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (projectDirs.length) params.set('projectDir', projectDirs.join(','));
    return `/api/sessions?${params.toString()}`;
  }, [page, pageSize, projectDirs, range]);

  const { data, isLoading } = useQuery({
    queryKey: ['sessions', url],
    queryFn: () => api.get<SessionsListResponse>(url),
  });

  const stats = data?.stats ?? { count: 0, totalCostUsd: 0, avgCostUsd: 0, medianDurationMs: 0 };

  return (
    <>
      <PageHeader
        title="会话"
        subtitle={`共 ${data?.total ?? 0} 条`}
        extra={<Segmented options={RANGE_OPTIONS} value={range} onChange={(v) => { setRange(v as RangeKey); setPage(1); }} />}
      />
      <Row gutter={14} style={{ marginBottom: 16 }}>
        <Col span={6}><KpiCard title="会话数" value={stats.count} /></Col>
        <Col span={6}><KpiCard title="总成本" value={stats.totalCostUsd} precision={2} suffix="$" /></Col>
        <Col span={6}><KpiCard title="平均成本" value={stats.avgCostUsd} precision={4} suffix="$" /></Col>
        <Col span={6}><KpiCard title="中位时长" value={Math.round(stats.medianDurationMs / 60000)} suffix=" 分" /></Col>
      </Row>

      <div style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: t.textSecondary }}>项目</span>
        <Select<string[]>
          mode="multiple"
          allowClear
          style={{ minWidth: 280 }}
          placeholder="全部项目"
          value={projectDirs}
          onChange={(v) => { setProjectDirs(v); setPage(1); }}
          options={(projects.data ?? []).map(p => ({
            label: p.displayName, value: p.projectDir,
          }))}
        />
      </div>

      <Table
        size="small"
        loading={isLoading}
        rowKey="sessionId"
        dataSource={data?.items ?? []}
        pagination={{ current: page, pageSize, total: data?.total ?? 0, onChange: setPage }}
        columns={[
          {
            title: '会话', dataIndex: 'sessionId',
            render: (sid: string) => <Link to={`/sessions/${sid}`}>{sid.slice(0, 8)}…</Link>,
          },
          { title: '开始时间', dataIndex: 'startedAt', width: 170, render: (v) => new Date(v).toLocaleString() },
          {
            title: '时长', width: 90,
            render: (_: unknown, r: { startedAt: number; endedAt: number }) => {
              const { color, text } = durationTag(r.endedAt - r.startedAt);
              return <Tag color={color}>{text}</Tag>;
            },
          },
          { title: '消息数', dataIndex: 'messageCount', align: 'right', width: 80 },
          {
            title: 'Token', dataIndex: 'totalTokens', align: 'right', width: 110,
            render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toLocaleString()}</span>,
          },
          {
            title: '成本 ($)', dataIndex: 'totalCostUsd', align: 'right', width: 110,
            render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toFixed(4)}</span>,
          },
          {
            title: 'Top 工具', dataIndex: 'topTools',
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
        ]}
      />
    </>
  );
}
