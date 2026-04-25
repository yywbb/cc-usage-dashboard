import { Card, Switch, Space } from 'antd';
import { useStore } from '../../store.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';
import { formatTokensCompact, formatTokensExact } from '../../format.js';

export default function Preferences() {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const compact = useStore(s => s.compactNumbers);
  const setCompact = useStore(s => s.setCompactNumbers);

  const sample = 12_345_678;

  return (
    <Card>
      <Space direction="vertical" size={18} style={{ width: '100%' }}>
        <Row
          title="紧凑数字显示"
          desc={`Token 与同类大数字默认转换为 k / M / B 单位,便于扫读。关闭后显示完整千分位数字。例如 ${
            compact ? formatTokensCompact(sample) : formatTokensExact(sample)
          }。`}
          t={t}
          control={
            <Switch
              checked={compact}
              onChange={setCompact}
              checkedChildren="紧凑"
              unCheckedChildren="完整"
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
