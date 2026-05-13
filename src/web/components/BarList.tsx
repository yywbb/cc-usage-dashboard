import { useTheme } from '../theme/useTheme.js';
import { TOKENS } from '../theme/tokens.js';
import { useI18n } from '../i18n/index.js';

export interface BarListItem {
  label: string;
  value: number;
  /** Override palette index for this row's bar colour. */
  colorIndex?: number;
}

export default function BarList({
  items,
  formatter = (v) => v.toLocaleString(),
  emptyText,
}: {
  items: BarListItem[];
  formatter?: (v: number) => string;
  emptyText?: string;
}) {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const { t: tr } = useI18n();
  const empty = emptyText ?? tr('common.empty');
  if (items.length === 0) return <div style={{ color: t.textMuted, fontSize: 12, padding: '12px 0' }}>{empty}</div>;
  const max = Math.max(...items.map(i => i.value), 0);
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const track = mode === 'dark' ? '#1e293b' : '#f1f5f9';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {sorted.map((item, idx) => {
        const pct = max > 0 ? (item.value / max) * 100 : 0;
        const color = t.chartPalette[(item.colorIndex ?? idx) % t.chartPalette.length];
        return (
          <div
            key={item.label}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(100px, 28%) 1fr minmax(56px, 12%)',
              alignItems: 'center',
              gap: 10,
              fontSize: 12,
            }}
          >
            <div
              style={{
                color: t.textPrimary,
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={item.label}
            >
              {item.label}
            </div>
            <div style={{ height: 20, background: track, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4 }} />
            </div>
            <div style={{ textAlign: 'right', color: t.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
              {formatter(item.value)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
