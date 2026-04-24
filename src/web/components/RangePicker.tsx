import { Segmented } from 'antd';
import type { RangeKey } from '../../shared/types.js';

const OPTIONS: { label: string; value: RangeKey }[] = [
  { label: '今天', value: 'today' },
  { label: '本周', value: 'week' },
  { label: '本月', value: 'month' },
  { label: 'YTD', value: 'ytd' },
  { label: '全部', value: 'all' },
];

export default function RangePicker({ value, onChange }: { value: RangeKey; onChange: (v: RangeKey) => void }) {
  return <Segmented options={OPTIONS} value={value} onChange={(v) => onChange(v as RangeKey)} />;
}
