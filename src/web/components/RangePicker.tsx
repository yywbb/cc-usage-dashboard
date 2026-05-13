import { Segmented } from 'antd';
import type { RangeKey } from '../../shared/types.js';
import { useI18n } from '../i18n/index.js';

export default function RangePicker({ value, onChange }: { value: RangeKey; onChange: (v: RangeKey) => void }) {
  const { t } = useI18n();
  const options: { label: string; value: RangeKey }[] = [
    { label: t('range.today'), value: 'today' },
    { label: t('range.week'),  value: 'week' },
    { label: t('range.month'), value: 'month' },
    { label: t('range.ytd'),   value: 'ytd' },
    { label: t('range.all'),   value: 'all' },
  ];
  return <Segmented options={options} value={value} onChange={(v) => onChange(v as RangeKey)} />;
}
