import { useTheme } from '../theme/useTheme.js';
import { TOKENS } from '../theme/tokens.js';

export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreate: number;
  cacheRead: number;
}

export function computeCacheHitRate(t: TokenTotals): number {
  const denom = t.inputTokens + t.cacheCreate + t.cacheRead;
  return denom > 0 ? t.cacheRead / denom : 0;
}

export default function TokenBreakdown({
  totals,
  cacheHitRate,
  fmtTokens,
}: {
  totals: TokenTotals;
  cacheHitRate?: number;
  fmtTokens: (n: number) => string;
}) {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const rate = cacheHitRate ?? computeCacheHitRate(totals);
  const total = totals.inputTokens + totals.outputTokens + totals.cacheCreate + totals.cacheRead;

  const rows = [
    { key: 'input',       label: 'Input',        value: totals.inputTokens,  color: t.chartPalette[0] },
    { key: 'output',      label: 'Output',       value: totals.outputTokens, color: t.chartPalette[1] },
    { key: 'cacheCreate', label: 'Cache create', value: totals.cacheCreate,  color: t.chartPalette[2] },
    { key: 'cacheRead',   label: 'Cache read',   value: totals.cacheRead,    color: t.chartPalette[3] },
  ];

  return (
    <div style={{ minWidth: 260, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{
        display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden',
        background: t.border,
      }}>
        {rows.map(r => {
          const pct = total > 0 ? (r.value / total) * 100 : 0;
          return pct > 0 ? <div key={r.key} style={{ width: `${pct}%`, background: r.color }} /> : null;
        })}
      </div>
      {rows.map(r => {
        const pct = total > 0 ? (r.value / total) * 100 : 0;
        return (
          <div key={r.key} style={{
            display: 'grid',
            gridTemplateColumns: '12px 1fr auto auto',
            alignItems: 'center', gap: 8, fontSize: 12,
          }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: r.color, display: 'inline-block' }} />
            <span style={{ color: t.textSecondary }}>{r.label}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: t.textPrimary, fontWeight: 600 }}>
              {fmtTokens(r.value)}
            </span>
            <span style={{
              fontVariantNumeric: 'tabular-nums', color: t.textMuted, minWidth: 44, textAlign: 'right',
            }}>{pct.toFixed(1)}%</span>
          </div>
        );
      })}
      <div style={{
        borderTop: `1px solid ${t.border}`, paddingTop: 8, marginTop: 2,
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        fontSize: 12,
      }}>
        <span style={{ color: t.textSecondary }}>
          缓存命中率
          <span style={{ color: t.textMuted, marginLeft: 4 }}>
            (cache-read ÷ input+cache-create+cache-read)
          </span>
        </span>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: t.textPrimary, fontWeight: 700 }}>
          {(rate * 100).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
