import { Card } from 'antd';
import type { ReactNode } from 'react';
import { useTheme } from '../theme/useTheme.js';
import { TOKENS } from '../theme/tokens.js';

export default function KpiCard({
  title,
  value,
  suffix,
  precision = 0,
  icon,
  iconBg,
  iconColor,
  sparkline,
  sparkColor,
  formatter,
  delta,
  deltaLabel,
}: {
  title: string;
  value: number;
  suffix?: string;
  precision?: number;
  icon?: ReactNode;
  iconBg?: string;
  iconColor?: string;
  sparkline?: number[];
  sparkColor?: string;
  formatter?: (v: number) => string;
  /** Fractional change vs previous period, e.g. 0.123 = +12.3%. */
  delta?: number | null;
  deltaLabel?: string;
}) {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const formatted = formatter
    ? formatter(value)
    : value.toLocaleString(undefined, {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      });

  return (
    <Card styles={{ body: { padding: 18, position: 'relative', overflow: 'hidden' } }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: t.textSecondary }}>
          {title}
        </div>
        {icon && (
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13,
            background: iconBg ?? (mode === 'dark' ? '#1e293b' : '#eef2ff'),
            color: iconColor ?? t.primary,
          }}>{icon}</div>
        )}
      </div>

      <div style={{
        fontSize: 24, fontWeight: 700, color: t.textPrimary,
        fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.5px', lineHeight: 1.2,
      }}>
        {formatted}{suffix && <span style={{ fontSize: 16, color: t.textMuted, marginLeft: 2 }}>{suffix}</span>}
      </div>

      {delta !== undefined && delta !== null && (
        <div style={{ marginTop: 6, fontSize: 11, fontVariantNumeric: 'tabular-nums', display: 'flex', gap: 4, alignItems: 'baseline' }}>
          <span style={{
            color: !Number.isFinite(delta) || delta === 0 ? t.textMuted : (delta > 0 ? t.success : t.danger),
            fontWeight: 600,
          }}>
            {!Number.isFinite(delta)
              ? '—'
              : `${delta > 0 ? '↑' : delta < 0 ? '↓' : ''} ${Math.abs(delta * 100).toFixed(1)}%`}
          </span>
          {deltaLabel && <span style={{ color: t.textMuted }}>{deltaLabel}</span>}
        </div>
      )}

      {sparkline && sparkline.length > 1 && (
        <Sparkline data={sparkline} color={sparkColor ?? t.primary} />
      )}
    </Card>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1);
  return (
    <div style={{
      position: 'absolute', right: 14, bottom: 14,
      display: 'flex', alignItems: 'flex-end', gap: 2, height: 22, opacity: 0.55,
    }}>
      {data.map((v, i) => (
        <div
          key={i}
          style={{
            width: 3,
            height: `${Math.max(2, (v / max) * 22)}px`,
            background: color,
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
}
