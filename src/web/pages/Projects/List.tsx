import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Table, Row, Col, Segmented } from 'antd';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import type { ProjectRow } from '../../../shared/types.js';
import PageHeader from '../../components/PageHeader.js';
import KpiCard from '../../components/KpiCard.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';
import { useFormatTokens } from '../../format.js';
import { useStore } from '../../store.js';

function b64(p: string) { return btoa(p).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

type SortBy = 'cost' | 'tokens' | 'sessions';
const SORT_OPTIONS: { label: string; value: SortBy }[] = [
  { label: '成本', value: 'cost' },
  { label: 'Token', value: 'tokens' },
  { label: '会话数', value: 'sessions' },
];

export default function ProjectsList() {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const fmtTokens = useFormatTokens();
  const [sortBy, setSortBy] = useState<SortBy>('cost');
  const sourceFilter = useStore(s => s.sourceFilter);
  const { data, isLoading } = useQuery({
    queryKey: ['projects', sortBy, sourceFilter],
    queryFn: () => api.get<ProjectRow[]>(`/api/projects?sortBy=${sortBy}${sourceFilter !== 'all' ? `&source=${sourceFilter}` : ''}`),
  });
  const rows = data ?? [];
  const maxCost = Math.max(...rows.map(r => r.totalCostUsd), 0);
  const stats = useMemo(() => rows.reduce(
    (acc, r) => {
      acc.sessionCount += r.sessionCount;
      acc.totalTokens += r.totalTokens;
      acc.totalCostUsd += r.totalCostUsd;
      return acc;
    },
    { sessionCount: 0, totalTokens: 0, totalCostUsd: 0 },
  ), [rows]);

  return (
    <>
      <PageHeader
        title="项目"
        subtitle={`共 ${rows.length} 条`}
        extra={<Segmented options={SORT_OPTIONS} value={sortBy} onChange={(v) => setSortBy(v as SortBy)} />}
      />
      <Row gutter={14} style={{ marginBottom: 16 }}>
        <Col span={6}><KpiCard title="项目数" value={rows.length} /></Col>
        <Col span={6}><KpiCard title="总会话数" value={stats.sessionCount} /></Col>
        <Col span={6}><KpiCard title="总 Token" value={stats.totalTokens} formatter={fmtTokens} /></Col>
        <Col span={6}><KpiCard title="总成本" value={stats.totalCostUsd} precision={2} suffix="$" /></Col>
      </Row>
      <Table<ProjectRow>
        loading={isLoading}
        rowKey="projectDir"
        dataSource={rows}
        pagination={{
          defaultPageSize: 15,
          pageSizeOptions: [10, 15, 20, 50, 100],
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
        }}
        columns={[
          {
            title: '项目',
            dataIndex: 'displayName',
            render: (_, r) => (
              <Link to={`/projects/${b64(r.projectDir)}`} style={{ display: 'block', lineHeight: 1.35 }}>
                <div style={{ fontWeight: 600 }}>{r.displayName}</div>
                {r.realPath && (
                  <div style={{ fontSize: 11, color: t.textMuted }}>{r.realPath}</div>
                )}
              </Link>
            ),
          },
          { title: '会话数', dataIndex: 'sessionCount', align: 'right', width: 80 },
          {
            title: 'Token',
            dataIndex: 'totalTokens',
            align: 'right',
            width: 120,
            render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTokens(v)}</span>,
          },
          {
            title: '成本 ($)',
            dataIndex: 'totalCostUsd',
            align: 'right',
            width: 200,
            render: (v: number) => {
              const pct = maxCost > 0 ? (v / maxCost) * 100 : 0;
              const track = mode === 'dark' ? '#1e293b' : '#f1f5f9';
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                  <div style={{ width: 80, height: 6, background: track, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: t.primary }} />
                  </div>
                  <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 60, textAlign: 'right' }}>{v.toFixed(2)}</span>
                </div>
              );
            },
          },
          {
            title: '平均/会话',
            dataIndex: 'avgTokensPerSession',
            align: 'right',
            width: 110,
            render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTokens(v)}</span>,
          },
          {
            title: '最近活跃',
            dataIndex: 'lastSeenAt',
            width: 170,
            render: (v: number) => new Date(v).toLocaleString(),
          },
        ]}
      />
    </>
  );
}
