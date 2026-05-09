import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Segmented, Row, Col, Table, Button, Input, Checkbox, Space } from 'antd';
import { SearchOutlined, DownloadOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { api } from '../../api/client.js';
import type { CostResponse } from '../../../shared/types.js';
import PageHeader from '../../components/PageHeader.js';
import KpiCard from '../../components/KpiCard.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';
import { echartsThemeName } from '../../theme/echarts.js';
import { useFormatTokens } from '../../format.js';
import { useStore } from '../../store.js';

type Granularity = 'day' | 'week' | 'month';

export default function Cost() {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const fmtTokens = useFormatTokens();
  const [gran, setGran] = useState<Granularity>('day');
  const [q, setQ] = useState('');
  type Overlay = 'total' | 'ma' | 'cum';
  const [overlays, setOverlays] = useState<Overlay[]>(['total']);
  const sourceFilter = useStore(s => s.sourceFilter);

  const { data } = useQuery({
    queryKey: ['cost', gran, sourceFilter],
    queryFn: () => api.get<CostResponse>(`/api/cost?granularity=${gran}&range=all${sourceFilter !== 'all' ? `&source=${sourceFilter}` : ''}`),
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

  const TOP_N = 7;
  const projectTotals = new Map<string, number>();
  for (const b of buckets) {
    for (const p of b.byProject) {
      projectTotals.set(p.projectDir, (projectTotals.get(p.projectDir) ?? 0) + p.costUsd);
    }
  }
  const ranked = [...projectTotals.entries()].sort((a, b) => b[1] - a[1]);
  const topProjects = ranked.slice(0, TOP_N).map(([pd]) => pd);
  const otherProjects = new Set(ranked.slice(TOP_N).map(([pd]) => pd));

  const series: Array<Record<string, unknown>> = topProjects.map(pd => ({
    name: shortProjectName(pd),
    type: 'bar',
    stack: 'all',
    data: buckets.map(b => b.byProject.find(p => p.projectDir === pd)?.costUsd ?? 0),
  }));
  if (otherProjects.size > 0) {
    series.push({
      name: `其他(${otherProjects.size})`,
      type: 'bar',
      stack: 'all',
      itemStyle: { color: mode === 'dark' ? '#475569' : '#cbd5e1' },
      data: buckets.map(b =>
        b.byProject.filter(p => otherProjects.has(p.projectDir))
                   .reduce((acc, p) => acc + p.costUsd, 0)
      ),
    });
  }

  const markPointData = anomalies.map(a => ({
    name: 'anomaly',
    value: a.costUsd.toFixed(2),
    xAxis: a.date,
    yAxis: a.costUsd,
    itemStyle: { color: t.danger },
  }));
  if (series.length > 0) {
    series[0].markPoint = {
      symbol: 'pin', symbolSize: 38, label: { fontSize: 10, color: '#fff' },
      data: markPointData,
    };
  }

  const totals = buckets.map(b => b.costUsd);
  const maWindow = gran === 'day' ? 7 : gran === 'week' ? 4 : 3;
  const movingAvg = totals.map((_, i) => {
    const start = Math.max(0, i - maWindow + 1);
    const slice = totals.slice(start, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
  const cumulative: number[] = [];
  totals.reduce((acc, v, i) => { cumulative[i] = acc + v; return cumulative[i]; }, 0);

  const projectLegend = [
    ...topProjects.map(shortProjectName),
    ...(otherProjects.size > 0 ? [`其他(${otherProjects.size})`] : []),
  ];

  const showCum = overlays.includes('cum');
  const STAT_TOTAL = '总额';
  const STAT_MA = `均线(${maWindow})`;
  const STAT_CUM = '累计';
  const totalColor = mode === 'dark' ? '#f472b6' : '#db2777';
  const maColor = mode === 'dark' ? '#fbbf24' : '#d97706';
  const cumColor = mode === 'dark' ? '#5eead4' : '#0d9488';
  if (overlays.includes('total')) {
    series.push({
      name: STAT_TOTAL, type: 'line', smooth: 0.35, z: 5,
      showSymbol: false, symbol: 'circle', symbolSize: 6,
      itemStyle: { color: totalColor, borderColor: '#fff', borderWidth: 1.5 },
      lineStyle: { color: totalColor, width: 2.2, shadowColor: totalColor, shadowBlur: 6 },
      emphasis: { focus: 'series', scale: 1.4 },
      data: totals.map(v => +v.toFixed(2)),
    });
  }
  if (overlays.includes('ma')) {
    series.push({
      name: STAT_MA, type: 'line', smooth: 0.5, z: 6,
      showSymbol: false, symbol: 'none',
      itemStyle: { color: maColor },
      lineStyle: { color: maColor, width: 1.8, type: [6, 4] },
      emphasis: { focus: 'series' },
      data: movingAvg.map(v => +v.toFixed(2)),
    });
  }
  if (showCum) {
    series.push({
      name: STAT_CUM, type: 'line', yAxisIndex: 1, smooth: 0.35, z: 4,
      showSymbol: false, symbol: 'none',
      itemStyle: { color: cumColor },
      lineStyle: { color: cumColor, width: 1.8, opacity: 0.85 },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: cumColor + '55' },
            { offset: 1, color: cumColor + '00' },
          ],
        },
      },
      emphasis: { focus: 'series' },
      data: cumulative.map(v => +v.toFixed(2)),
    });
  }
  const STAT_NAMES = new Set([STAT_TOTAL, STAT_MA, STAT_CUM]);

  const filteredBuckets = (q
    ? buckets.filter(b => b.bucketKey.toLowerCase().includes(q.toLowerCase()))
    : buckets
  ).slice().sort((a, b) => b.bucketKey.localeCompare(a.bucketKey));

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
          <Card
            title="成本堆叠(按项目)"
            extra={
              <Space size={4}>
                <span style={{ fontSize: 11, color: t.textSecondary }}>趋势</span>
                <Checkbox.Group
                  options={[
                    { label: '总额', value: 'total' },
                    { label: '均线', value: 'ma' },
                    { label: '累计', value: 'cum' },
                  ]}
                  value={overlays}
                  onChange={(v) => setOverlays(v as Overlay[])}
                />
              </Space>
            }
          >
            <ReactECharts
              theme={echartsThemeName(mode)}
              style={{ height: 380 }}
              option={{
                animation: false,
                tooltip: {
                  trigger: 'axis',
                  axisPointer: { type: 'line' },
                  formatter: (params: unknown) => {
                    const arr = (Array.isArray(params) ? params : [params]) as Array<{
                      axisValueLabel: string; marker: string; seriesName: string; value: number;
                    }>;
                    if (arr.length === 0) return '';
                    const projectRows = arr
                      .filter(p => !STAT_NAMES.has(p.seriesName) && Number(p.value) > 0)
                      .sort((a, b) => Number(b.value) - Number(a.value));
                    const statRows = arr.filter(p => STAT_NAMES.has(p.seriesName));
                    if (projectRows.length === 0 && statRows.length === 0) return '';
                    const head = `<div style="margin-bottom:4px">${arr[0].axisValueLabel}</div>`;
                    const body = projectRows.map(p =>
                      `<div style="display:flex;justify-content:space-between;gap:16px">
                        <span>${p.marker}${p.seriesName}</span>
                        <strong>$${Number(p.value).toFixed(2)}</strong>
                      </div>`
                    ).join('');
                    const foot = statRows.length > 0
                      ? `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed ${t.border}">${
                          statRows.map(p =>
                            `<div style="display:flex;justify-content:space-between;gap:16px">
                              <span>${p.marker}${p.seriesName}</span>
                              <strong>$${Number(p.value).toFixed(2)}</strong>
                            </div>`
                          ).join('')
                        }</div>`
                      : '';
                    return head + body + foot;
                  },
                },
                legend: {
                  type: 'scroll',
                  bottom: 0,
                  left: 'center',
                  itemWidth: 10,
                  itemHeight: 10,
                  textStyle: { fontSize: 11 },
                  data: projectLegend,
                },
                grid: { left: 50, right: showCum ? 56 : 20, top: 20, bottom: 50 },
                xAxis: {
                  type: 'category',
                  data: buckets.map(b => b.bucketKey),
                  axisLabel: {
                    formatter: (v: string) => anomalyKeys.has(v) ? `{red|${v}}` : v,
                    rich: { red: { color: t.danger, fontWeight: 'bold' } },
                  },
                },
                yAxis: showCum
                  ? [
                      { type: 'value', name: '$' },
                      { type: 'value', name: '累计 $', splitLine: { show: false } },
                    ]
                  : { type: 'value', name: '$' },
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
          pagination={{
            defaultPageSize: 15,
            pageSizeOptions: [10, 15, 20, 50, 100],
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
          }}
          rowClassName={(r) => anomalyKeys.has(r.bucketKey) ? 'cc-anomaly-row' : ''}
          columns={[
            { title: '周期', dataIndex: 'bucketKey' },
            {
              title: '$', dataIndex: 'costUsd', align: 'right', width: 120,
              render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toFixed(4)}</span>,
            },
            {
              title: 'tokens', dataIndex: 'tokens', align: 'right', width: 140,
              render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTokens(v)}</span>,
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

function shortProjectName(projectDir: string): string {
  const tail = projectDir.split(/[/\\]/).pop() ?? projectDir;
  const seg = tail.split('--').filter(Boolean).pop() ?? tail;
  return seg.length > 22 ? seg.slice(0, 21) + '…' : seg;
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
