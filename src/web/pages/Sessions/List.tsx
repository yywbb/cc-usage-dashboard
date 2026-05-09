import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Table, Tag, Row, Col, Select, Segmented } from 'antd';
import type { TableProps } from 'antd';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import type { ProjectRow, RangeKey, SessionsListResponse } from '../../../shared/types.js';
import PageHeader from '../../components/PageHeader.js';
import KpiCard from '../../components/KpiCard.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';
import { useFormatTokens } from '../../format.js';
import { useStore } from '../../store.js';

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

function b64(p: string) { return btoa(p).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

function hashColor(name: string): string {
  const palette = ['magenta', 'red', 'volcano', 'orange', 'gold', 'lime', 'green', 'cyan', 'blue', 'geekblue', 'purple'];
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return palette[Math.abs(h) % palette.length];
}

const ORIGINATOR_OPTIONS = [
  { value: 'codex_cli', label: 'CLI' },
  { value: 'codex_vscode', label: 'VS Code' },
];

export default function SessionsList() {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const fmtTokens = useFormatTokens();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [projectDirs, setProjectDirs] = useState<string[]>([]);
  const [providerSlugs, setProviderSlugs] = useState<string[]>([]);
  const [range, setRange] = useState<RangeKey>('all');
  type SortBy = 'startedAt' | 'duration' | 'messageCount' | 'totalTokens' | 'totalCostUsd';
  const [sortBy, setSortBy] = useState<SortBy>('startedAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const sourceFilter = useStore(s => s.sourceFilter);
  const [originator, setOriginator] = useState<string | null>(null);

  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRow[]>('/api/projects?sortBy=cost'),
  });

  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.get<Array<{ slug: string; displayName: string }>>('/api/providers'),
  });

  const url = useMemo(() => {
    const { from, to } = rangeToFromTo(range);
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String((page - 1) * pageSize),
      sortBy,
      sortOrder,
    });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (projectDirs.length) params.set('projectDir', projectDirs.join(','));
    if (providerSlugs.length) params.set('providers', providerSlugs.join(','));
    if (sourceFilter !== 'all') params.set('source', sourceFilter);
    if (originator) params.set('originator', originator);
    return `/api/sessions?${params.toString()}`;
  }, [page, pageSize, projectDirs, providerSlugs, range, sortBy, sortOrder, sourceFilter, originator]);

  const { data, isLoading } = useQuery({
    queryKey: ['sessions', url],
    queryFn: () => api.get<SessionsListResponse>(url),
  });

  const stats = data?.stats ?? { count: 0, totalCostUsd: 0, avgCostUsd: 0, medianDurationMs: 0 };
  const projectByDir = useMemo(() => {
    const m = new Map<string, ProjectRow>();
    for (const p of projects.data ?? []) m.set(p.projectDir, p);
    return m;
  }, [projects.data]);

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

      <div style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
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
        <span style={{ fontSize: 12, color: t.textSecondary }}>供应商</span>
        <Select<string[]>
          mode="multiple"
          allowClear
          style={{ minWidth: 200 }}
          placeholder="全部供应商"
          value={providerSlugs}
          onChange={(v) => { setProviderSlugs(v); setPage(1); }}
          options={(providers.data ?? []).map(p => ({
            label: p.displayName, value: p.slug,
          }))}
        />
        <span style={{ fontSize: 12, color: t.textSecondary }}>发起方</span>
        <Select
          allowClear
          style={{ minWidth: 130 }}
          placeholder="全部"
          value={originator}
          onChange={(v) => { setOriginator(v ?? null); setPage(1); }}
          options={ORIGINATOR_OPTIONS}
        />
      </div>

      <Table<SessionsListResponse['items'][number]>
        size="small"
        loading={isLoading}
        rowKey="sessionId"
        tableLayout="fixed"
        dataSource={data?.items ?? []}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          pageSizeOptions: [10, 15, 20, 50, 100],
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
        }}
        onChange={((pag, _filters, sorter) => {
          if (pag.current && pag.current !== page) setPage(pag.current);
          if (pag.pageSize && pag.pageSize !== pageSize) setPageSize(pag.pageSize);
          const s = Array.isArray(sorter) ? sorter[0] : sorter;
          const field = (s?.columnKey ?? s?.field) as SortBy | undefined;
          if (s?.order && field) {
            const order = s.order === 'ascend' ? 'asc' : 'desc';
            if (field !== sortBy || order !== sortOrder) {
              setSortBy(field);
              setSortOrder(order);
              setPage(1);
            }
          } else if (!s?.order && (sortBy !== 'startedAt' || sortOrder !== 'desc')) {
            setSortBy('startedAt');
            setSortOrder('desc');
            setPage(1);
          }
        }) as TableProps<SessionsListResponse['items'][number]>['onChange']}
        columns={[
          {
            title: '会话', dataIndex: 'sessionId', width: 120,
            render: (sid: string) => <Link to={`/sessions/${sid}`}>{sid.slice(0, 8)}…</Link>,
          },
          {
            title: '项目', dataIndex: 'projectDir', width: 200,
            render: (dir: string) => {
              const p = projectByDir.get(dir);
              const name = p?.displayName ?? dir.split(/[\\/]/).pop() ?? dir;
              return (
                <Link to={`/projects/${b64(dir)}`} title={dir}
                      style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                  {name}
                </Link>
              );
            },
          },
          {
            title: 'Source', dataIndex: 'source', width: 90,
            render: (v: string | null) => v === 'codex'
              ? <Tag color="geekblue">Codex</Tag>
              : <Tag color="purple">Claude</Tag>,
          },
          {
            title: '开始时间', dataIndex: 'startedAt', key: 'startedAt', width: 170,
            sorter: true, sortOrder: sortBy === 'startedAt' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
            render: (v) => new Date(v).toLocaleString(),
          },
          {
            title: '时长', key: 'duration', width: 95,
            sorter: true, sortOrder: sortBy === 'duration' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
            render: (_: unknown, r: { startedAt: number; endedAt: number }) => {
              const { color, text } = durationTag(r.endedAt - r.startedAt);
              return <Tag color={color}>{text}</Tag>;
            },
          },
          {
            title: '消息数', dataIndex: 'messageCount', key: 'messageCount', align: 'right', width: 95,
            sorter: true, sortOrder: sortBy === 'messageCount' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
          },
          {
            title: 'Token', dataIndex: 'totalTokens', key: 'totalTokens', align: 'right', width: 115,
            sorter: true, sortOrder: sortBy === 'totalTokens' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
            render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTokens(v)}</span>,
          },
          {
            title: '成本 ($)', dataIndex: 'totalCostUsd', key: 'totalCostUsd', align: 'right', width: 115,
            sorter: true, sortOrder: sortBy === 'totalCostUsd' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
            render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toFixed(4)}</span>,
          },
          {
            title: 'Top 工具', dataIndex: 'topTools', width: 240,
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
