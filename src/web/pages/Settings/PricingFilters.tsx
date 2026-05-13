import { Segmented, Input, Button, Space } from 'antd';
import { PlusOutlined, WarningFilled } from '@ant-design/icons';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';
import { useI18n } from '../../i18n/index.js';

export type ProviderFilter = 'all' | 'unknown' | number;

interface ProviderOption {
  id: number;
  displayName: string;
  modelCount: number;
}

interface Props {
  providers: ProviderOption[];        // excluding the unknown bucket
  unconfiguredCount: number;
  value: ProviderFilter;
  onChange: (v: ProviderFilter) => void;
  search: string;
  onSearchChange: (v: string) => void;
  onAddModel: () => void;
  onManageProviders: () => void;
}

export default function PricingFilters({
  providers, unconfiguredCount, value, onChange,
  search, onSearchChange, onAddModel, onManageProviders,
}: Props) {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const { t: tr } = useI18n();

  const segmentedOptions: Array<{ label: React.ReactNode; value: ProviderFilter }> = [
    { label: tr('pricing.filter.all'), value: 'all' },
    ...providers.map(p => ({
      label: <span>{p.displayName} <span style={{ color: t.textMuted }}>{p.modelCount}</span></span>,
      value: p.id as ProviderFilter,
    })),
  ];
  if (unconfiguredCount > 0) {
    segmentedOptions.push({
      label: (
        <span style={{ color: t.warning }}>
          <WarningFilled style={{ marginRight: 4 }} />
          {tr('pricing.filter.unknown', { n: unconfiguredCount })}
        </span>
      ),
      value: 'unknown',
    });
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      marginBottom: 12,
    }}>
      <Segmented
        options={segmentedOptions}
        value={value}
        onChange={(v) => onChange(v as ProviderFilter)}
      />
      <div style={{ flex: 1 }} />
      <Input.Search
        placeholder={tr('pricing.searchPlaceholder')}
        allowClear
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        style={{ width: 240 }}
      />
      <Space size={8}>
        <Button icon={<PlusOutlined />} onClick={onAddModel}>{tr('pricing.addModel')}</Button>
        <Button onClick={onManageProviders}>{tr('pricing.manageProviders')}</Button>
      </Space>
    </div>
  );
}
