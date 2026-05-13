import { Card, Button, Tooltip, Space } from 'antd';
import { ReloadOutlined, WarningFilled, InfoCircleOutlined } from '@ant-design/icons';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';
import { formatRelative } from './lastRecomputeAt.js';
import { useI18n } from '../../i18n/index.js';

interface Props {
  providerCount: number;
  modelCount: number;
  unconfiguredCount: number;
  lastRecomputeAt: string | null;
  isRecomputing: boolean;
  onRecompute: () => void;
}

export default function PricingHeaderBar({
  providerCount, modelCount, unconfiguredCount,
  lastRecomputeAt, isRecomputing, onRecompute,
}: Props) {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const { t: tr } = useI18n();

  return (
    <Card style={{ marginBottom: 12 }} styles={{ body: { padding: '14px 18px' } }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 32, flexWrap: 'wrap' }}>
        <Kpi label={tr('pricing.kpi.providers')} value={providerCount} t={t} />
        <Kpi label={tr('pricing.kpi.models')} value={modelCount} t={t} />
        <Kpi
          label={tr('pricing.kpi.unconfigured')}
          value={unconfiguredCount}
          warn={unconfiguredCount > 0}
          icon={unconfiguredCount > 0 ? <WarningFilled style={{ color: t.warning }} /> : undefined}
          t={t}
        />
        <Kpi
          label={
            <Space size={4}>
              <span>{tr('pricing.kpi.lastRecompute')}</span>
              <Tooltip title={tr('pricing.recomputeHint')}>
                <InfoCircleOutlined style={{ color: t.textMuted, cursor: 'help' }} />
              </Tooltip>
            </Space>
          }
          value={formatRelative(lastRecomputeAt)}
          t={t}
        />
        <div style={{ flex: 1 }} />
        <Button
          type="primary"
          icon={<ReloadOutlined />}
          loading={isRecomputing}
          onClick={onRecompute}
        >{tr('pricing.recomputeBtn')}</Button>
      </div>
    </Card>
  );
}

function Kpi({
  label, value, warn, icon, t,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  warn?: boolean;
  icon?: React.ReactNode;
  t: typeof TOKENS['light'];
}) {
  return (
    <div style={{ minWidth: 110 }}>
      <div style={{ fontSize: 12, color: t.textSecondary, lineHeight: 1.4 }}>{label}</div>
      <div style={{
        fontSize: 18, fontWeight: 600, lineHeight: 1.2, marginTop: 2,
        color: warn ? t.warning : t.textPrimary,
        fontVariantNumeric: 'tabular-nums',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {icon}{value}
      </div>
    </div>
  );
}
