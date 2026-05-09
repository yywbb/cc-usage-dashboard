import { Segmented } from 'antd';
import { useStore, type SourceFilter } from '../store.js';

const OPTIONS: { label: string; value: SourceFilter }[] = [
  { label: 'All',    value: 'all' },
  { label: 'Claude', value: 'claude' },
  { label: 'Codex',  value: 'codex' },
];

export default function SourceToggle() {
  const sourceFilter = useStore((s) => s.sourceFilter);
  const setSourceFilter = useStore((s) => s.setSourceFilter);
  return (
    <Segmented
      size="small"
      options={OPTIONS}
      value={sourceFilter}
      onChange={(v) => setSourceFilter(v as SourceFilter)}
    />
  );
}
