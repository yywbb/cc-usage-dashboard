import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Segmented, Row, Col, Table, Button, Input } from 'antd';
import { SearchOutlined, DownloadOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { api } from '../../api/client.js';
import type { CostResponse } from '../../../shared/types.js';
import PageHeader from '../../components/PageHeader.js';
import KpiCard from '../../components/KpiCard.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';
import { echartsThemeName } from '../../theme/echarts.js';

type Granularity = 'day' | 'week' | 'month';

export default function Cost() {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const [gran, setGran] = useState<Granularity>('day');
  const [q, setQ] = useState('');

  const { data } = useQuery({
    queryKey: ['cost', gran],
    queryFn: () => api.get<CostResponse>(`/api/cost?granularity=${gran}&range=all`),
  });

  const buckets = data?.buckets ?? [];
  const anomalies = data?.anomalies ?? [];
  const anomalyKeys = useMemo(() => new Set(anomalies.map(a => a.date)), [anomalies]);

  const totalCost = buckets.reduce((a, b) => a + b.costUsd, 0);
  const avgCost = buckets.length ? totalCost / buckets.length : 0;
  const peakBucket = buckets.reduce<null | { bucketKey: string; costUsd: number }>(
    (acc, b) => (acc && acc.costUsd >= b.costUsd) ? acc : b, null
  );
  const peakCost = peakBucket?.costUsd ?? 0;

  const projects = [...new Set(buckets.flatMap(b => b.byProject.map(p => p.projectDir)))];
  const series = projects.map(pd => ({
    name: pd.split(/[/\\]/).pop() ?? pd,
    type: 'bar',
    stack: 'all',
    data: buckets.map(b => b.byProject.find(p => p.projectDir === pd)?.costUsd ?? 0),
  }));

  const markPointData = anomalies.map(a => ({
    name: 'anomaly',
    value: a.costUsd.toFixed(2),
    xAxis: a.date,
    yAxis: a.costUsd,
    itemStyle: { color: t.danger },
  }));
  if (series.length > 0) {
    (series[0] as Record<string, unknown>).markPoint = {
      symbol: 'pin', symbolSize: 38, label: { fontSize: 10, color: '#fff' },
      data: markPointData,
    };
  }

  const filteredBuckets = q
    ? buckets.filter(b => b.bucketKey.toLowerCase().includes(q.toLowerCase()))
    : buckets;

  return (
    <>
      <PageHeader
        title="成本"
        subtitle="周期聚合 + z-score 异常检测"
        extra={
          <Segmented
            options={[
              { label: '日', value: 'day' },
              { label: '周', value: 'week' },
              { label: '月', value: 'month' },
            ]}
            value={gran}
            onChange={(v) => setGran(v as Granularity)}
          />
        }
      />

      <Row gutter={14} style={{ marginBottom: 16 }}>
        <Col span={6}><KpiCard title="周期总成本" value={totalCost} precision={2} suffix="$" /></Col>
        <Col span={6}><KpiCard title="周期均值"   value={avgCost} precision={2} suffix="$" /></Col>
        <Col span={6}><KpiCard title="峰值"       value={peakCost} precision={2} suffix="$" /></Col>
        <Col span={6}><KpiCard title="异常周期"   value={anomalies.length} suffix=" 个" /></Col>
      </Row>

      <Row gutter={14}>
        <Col span={18}>
          <Card title="成本堆叠(按项目)">
            <ReactECharts
              theme={echartsThemeName(mode)}
              style={{ height: 380 }}
              option={{
                tooltip: { trigger: 'axis' },
                legend: { top: 'bottom' },
                grid: { left: 50, right: 20, top: 30, bottom: 60 },
                xAxis: {
                  type: 'category',
                  data: buckets.map(b => b.bucketKey),
                  axisLabel: {
                    formatter: (v: string) => anomalyKeys.has(v) ? `{red|${v}}` : v,
                    rich: { red: { color: t.danger, fontWeight: 'bold' } },
                  },
                },
                yAxis: { type: 'value', name: '$' },
                series,
              }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card title={`异常周期(z > 2) · ${anomalies.length}`}>
            <Table
              size="small"
              rowKey="date"
              dataSource={anomalies}
              pagination={false}
              rowClassName={() => 'cc-anomaly-row'}
              columns={[
                { title: '日期', dataIndex: 'date' },
                { title: '$',    dataIndex: 'costUsd', align: 'right', render: (v: number) => v.toFixed(2) },
                { title: 'z',    dataIndex: 'zScore',  align: 'right', render: (v: number) => v.toFixed(2) },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Card
        title="账单明细"
        style={{ marginTop: 16 }}
        extra={
          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              prefix={<SearchOutlined />}
              placeholder="按周期搜索"
              allowClear
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ width: 180 }}
            />
            <Button icon={<DownloadOutlined />} onClick={() => downloadCsv(data)}>导出 CSV</Button>
          </div>
        }
      >
        <Table
          size="small"
          rowKey="bucketKey"
          dataSource={filteredBuckets}
          pagination={{ pageSize: 30 }}
          rowClassName={(r) => anomalyKeys.has(r.bucketKey) ? 'cc-anomaly-row' : ''}
          columns={[
            { title: '周期', dataIndex: 'bucketKey' },
            {
              title: '$', dataIndex: 'costUsd', align: 'right', width: 120,
              render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toFixed(4)}</span>,
            },
            {
              title: 'tokens', dataIndex: 'tokens', align: 'right', width: 140,
              render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toLocaleString()}</span>,
            },
          ]}
        />
      </Card>

      <style>{`
        .cc-anomaly-row td {
          background: ${mode === 'dark' ? 'rgba(239,68,68,0.08)' : '#fef2f2'} !important;
          color: ${t.danger} !important;
          font-weight: 600;
        }
      `}</style>
    </>
  );
}

function downloadCsv(data: CostResponse | undefined) {
  if (!data) return;
  const rows = [['bucket', 'costUsd', 'tokens'], ...data.buckets.map(b => [b.bucketKey, b.costUsd, b.tokens])];
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cc-usage-cost.csv';
  a.click();
}
