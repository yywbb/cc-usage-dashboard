import { Card, Switch, Space, Segmented } from 'antd';
import { useStore } from '../../store.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';
import { formatTokensCompact, formatTokensExact } from '../../format.js';
import { useI18n, type Lang } from '../../i18n/index.js';

export default function Preferences() {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const { t: tr, lang, setLang } = useI18n();
  const compact = useStore(s => s.compactNumbers);
  const setCompact = useStore(s => s.setCompactNumbers);

  const sample = 12_345_678;

  return (
    <Card>
      <Space direction="vertical" size={18} style={{ width: '100%' }}>
        <Row
          title={tr('pref.lang.title')}
          desc={tr('pref.lang.desc')}
          t={t}
          control={
            <Segmented
              value={lang}
              onChange={(v) => setLang(v as Lang)}
              options={[
                { label: tr('pref.lang.zh'), value: 'zh' },
                { label: tr('pref.lang.en'), value: 'en' },
              ]}
            />
          }
        />
        <Row
          title={tr('pref.compact.title')}
          desc={tr('pref.compact.desc', {
            sample: compact ? formatTokensCompact(sample) : formatTokensExact(sample),
          })}
          t={t}
          control={
            <Switch
              checked={compact}
              onChange={setCompact}
              checkedChildren={tr('pref.compact.on')}
              unCheckedChildren={tr('pref.compact.off')}
            />
          }
        />
      </Space>
    </Card>
  );
}

function Row({
  title, desc, control, t,
}: {
  title: string;
  desc: string;
  control: React.ReactNode;
  t: typeof TOKENS['light'];
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, color: t.textPrimary, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12, color: t.textSecondary }}>{desc}</div>
      </div>
      <div>{control}</div>
    </div>
  );
}
