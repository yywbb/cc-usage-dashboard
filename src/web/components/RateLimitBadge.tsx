import { Tag, Tooltip } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

interface CurrentRateLimit {
  primaryMaxPct: number | null;
  secondaryMaxPct: number | null;
  observedAt: number | null;
}

export function RateLimitBadge() {
  const { data } = useQuery<CurrentRateLimit>({
    queryKey: ['codex-rate-limit-current'],
    queryFn: () => api.get<CurrentRateLimit>('/api/codex/rate-limits/current'),
    refetchInterval: 60_000,
  });
  if (!data || data.primaryMaxPct == null) return null;
  const p5 = data.primaryMaxPct;
  const p7 = data.secondaryMaxPct ?? 0;
  const colorOf = (v: number) => (v >= 95 ? 'red' : v >= 80 ? 'orange' : 'default');
  return (
    <Tooltip title={`Codex 5h: ${p5.toFixed(1)}% · 7d: ${p7.toFixed(1)}%`}>
      <span style={{ display: 'inline-flex', gap: 4 }}>
        <Tag color={colorOf(p5)}>5h {p5.toFixed(0)}%</Tag>
        <Tag color={colorOf(p7)}>7d {p7.toFixed(0)}%</Tag>
      </span>
    </Tooltip>
  );
}
