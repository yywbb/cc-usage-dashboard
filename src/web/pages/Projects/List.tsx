import { useQuery } from '@tanstack/react-query';
import { Table } from 'antd';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import type { ProjectRow } from '../../../shared/types.js';
import PageHeader from '../../components/PageHeader.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';
import { useFormatTokens } from '../../format.js';

function b64(p: string) { return btoa(p).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

export default function ProjectsList() {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const fmtTokens = useFormatTokens();
  const { data, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRow[]>('/api/projects?sortBy=cost'),
  });
  const maxCost = Math.max(...(data ?? []).map(r => r.totalCostUsd), 0);

  return (
    <>
      <PageHeader title="项目" subtitle="按成本排序" />
      <Table<ProjectRow>
        loading={isLoading}
        rowKey="projectDir"
        dataSource={data ?? []}
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
