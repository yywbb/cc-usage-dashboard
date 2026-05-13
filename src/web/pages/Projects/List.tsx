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
import { useI18n } from '../../i18n/index.js';

function b64(p: string) { return btoa(p).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

type SortBy = 'cost' | 'tokens' | 'sessions';

export default function ProjectsList() {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const { t: tr } = useI18n();
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

  const sortOptions: { label: string; value: SortBy }[] = [
    { label: tr('projects.sortCost'), value: 'cost' },
    { label: tr('projects.sortToken'), value: 'tokens' },
    { label: tr('projects.sortSessions'), value: 'sessions' },
  ];

  return (
    <>
      <PageHeader
        title={tr('projects.title')}
        subtitle={tr('projects.subtitle', { n: rows.length })}
        extra={<Segmented options={sortOptions} value={sortBy} onChange={(v) => setSortBy(v as SortBy)} />}
      />
      <Row gutter={14} style={{ marginBottom: 16 }}>
        <Col span={6}><KpiCard title={tr('projects.kpiCount')} value={rows.length} /></Col>
        <Col span={6}><KpiCard title={tr('projects.kpiSessions')} value={stats.sessionCount} /></Col>
        <Col span={6}><KpiCard title={tr('projects.kpiTokens')} value={stats.totalTokens} formatter={fmtTokens} /></Col>
        <Col span={6}><KpiCard title={tr('projects.kpiCost')} value={stats.totalCostUsd} precision={2} suffix="$" /></Col>
      </Row>
      <Table<ProjectRow>
        loading={isLoading}
        rowKey="projectDir"
        dataSource={rows}
        pagination={{
          defaultPageSize: 15,
          pageSizeOptions: [10, 15, 20, 50, 100],
          showSizeChanger: true,
          showTotal: (total) => tr('common.totalCount', { n: total }),
        }}
        columns={[
          {
            title: tr('projects.col.project'),
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
          { title: tr('projects.col.sessions'), dataIndex: 'sessionCount', align: 'right', width: 80 },
          {
            title: tr('projects.col.tokens'),
            dataIndex: 'totalTokens',
            align: 'right',
            width: 120,
            render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTokens(v)}</span>,
          },
          {
            title: tr('projects.col.cost'),
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
            title: tr('projects.col.avgPerSession'),
            dataIndex: 'avgTokensPerSession',
            align: 'right',
            width: 110,
            render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTokens(v)}</span>,
          },
          {
            title: tr('projects.col.lastSeen'),
            dataIndex: 'lastSeenAt',
            width: 170,
            render: (v: number) => new Date(v).toLocaleString(),
          },
        ]}
      />
    </>
  );
}
