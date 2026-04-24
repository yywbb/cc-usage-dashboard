import { Card, Statistic } from 'antd';

export default function KpiCard({ title, value, suffix, precision = 0 }:
  { title: string; value: number; suffix?: string; precision?: number }) {
  return (
    <Card>
      <Statistic title={title} value={value} suffix={suffix} precision={precision} />
    </Card>
  );
}
