import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Segmented, Row, Col, Table, Button } from 'antd';
import ReactECharts from 'echarts-for-react';
import { api } from '../../api/client.js';
import type { CostResponse } from '../../../shared/types.js';

export default function Cost() {
  const [gran, setGran] = useState<'day' | 'week' | 'month'>('day');
  const { data } = useQuery({
    queryKey: ['cost', gran],
    queryFn: () => api.get<CostResponse>(`/api/cost?granularity=${gran}&range=all`),
  });

  const projects = [...new Set((data?.buckets ?? []).flatMap(b => b.byProject.map(p => p.projectDir)))];
  const series = projects.map(pd => ({
    name: pd.split(/[/\\]/).pop() ?? pd,
    type: 'bar',
    stack: 'all',
    data: (data?.buckets ?? []).map(b => b.byProject.find(p => p.projectDir === pd)?.costUsd ?? 0),
  }));

  const anomalyKeys = new Set((data?.anomalies ?? []).map(a => a.date));

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Segmented options={[
          { label: '日', value: 'day' },
          { label: '周', value: 'week' },
          { label: '月', value: 'month' },
        ]} value={gran} onChange={(v) => setGran(v as 'day' | 'week' | 'month')} />
      </div>
      <Row gutter={16}>
        <Col span={18}>
          <Card title="成本堆叠（按项目）">
            <ReactECharts
              style={{ height: 360 }}
              option={{
                tooltip: { trigger: 'axis' },
                legend: { top: 'bottom' },
                xAxis: {
                  type: 'category',
                  data: (data?.buckets ?? []).map(b => b.bucketKey),
                  axisLabel: {
                    formatter: (v: string) => anomalyKeys.has(v) ? `{red|${v}}` : v,
                    rich: { red: { color: '#ff4d4f', fontWeight: 'bold' } },
                  },
                },
                yAxis: { type: 'value', name: '$' },
                series,
              }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card title="异常日（z > 2）">
            <Table
              size="small"
              rowKey="date"
              dataSource={data?.anomalies ?? []}
              pagination={false}
              columns={[
                { title: '日期', dataIndex: 'date' },
                { title: '$', dataIndex: 'costUsd', render: (v: number) => v.toFixed(2) },
                { title: 'z', dataIndex: 'zScore', render: (v: number) => v.toFixed(2) },
              ]}
            />
          </Card>
        </Col>
      </Row>
      <Card title="账单明细" style={{ marginTop: 16 }}
            extra={<Button onClick={() => downloadCsv(data)}>导出 CSV</Button>}>
        <Table
          size="small"
          rowKey="bucketKey"
          dataSource={data?.buckets ?? []}
          pagination={{ pageSize: 30 }}
          columns={[
            { title: '周期', dataIndex: 'bucketKey' },
            { title: '$', dataIndex: 'costUsd', render: (v: number) => v.toFixed(4) },
            { title: 'tokens', dataIndex: 'tokens', render: (v: number) => v.toLocaleString() },
          ]}
        />
      </Card>
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
