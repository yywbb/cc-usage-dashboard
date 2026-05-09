import { Tag, Tooltip } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useStore } from '../store.js';
import { useTheme } from '../theme/useTheme.js';
import { TOKENS } from '../theme/tokens.js';

interface CurrentRateLimit {
  primaryMaxPct: number | null;
  secondaryMaxPct: number | null;
  observedAt: number | null;
}

const colorOf = (v: number) => (v >= 95 ? 'red' : v >= 80 ? 'orange' : 'default');

/** Two compact tags (5h / 7d) sized to live inside the Overview "今日速览" card. */
export function RateLimitGlance() {
  const sourceFilter = useStore((s) => s.sourceFilter);
  const { mode } = useTheme();
  const t = TOKENS[mode];
  // Codex-only metric — hide entirely when the user has filtered to Claude.
  const enabled = sourceFilter !== 'claude';
  const { data } = useQuery<CurrentRateLimit>({
    queryKey: ['codex-rate-limit-current'],
    queryFn: () => api.get<CurrentRateLimit>('/api/codex/rate-limits/current'),
    refetchInterval: 60_000,
    enabled,
  });
  if (!enabled || !data || data.primaryMaxPct == null) return null;
  const p5 = data.primaryMaxPct;
  const p7 = data.secondaryMaxPct ?? 0;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 12, color: t.textSecondary }}>Codex 限额</span>
      <Tooltip title={`5h: ${p5.toFixed(1)}% · 7d: ${p7.toFixed(1)}%`}>
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <Tag color={colorOf(p5)} style={{ marginInlineEnd: 0 }}>5h {p5.toFixed(0)}%</Tag>
          <Tag color={colorOf(p7)} style={{ marginInlineEnd: 0 }}>7d {p7.toFixed(0)}%</Tag>
        </span>
      </Tooltip>
    </div>
  );
}
