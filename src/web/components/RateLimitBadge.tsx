import { Progress, Tooltip } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { InfoCircleOutlined } from '@ant-design/icons';
import { api } from '../api/client.js';
import { useStore } from '../store.js';
import { useTheme } from '../theme/useTheme.js';
import { TOKENS } from '../theme/tokens.js';
import { useI18n } from '../i18n/index.js';

interface CurrentRateLimit {
  primaryMaxPct: number | null;
  secondaryMaxPct: number | null;
  primaryUsedPct: number | null;
  secondaryUsedPct: number | null;
  primaryRemainingPct: number | null;
  secondaryRemainingPct: number | null;
  primaryResetsAt: number | null;
  secondaryResetsAt: number | null;
  observedAt: number | null;
}

function useFmtReset() {
  const { lang } = useI18n();
  const localeTag = lang === 'zh' ? 'zh-CN' : 'en-US';
  return (v: number | null | undefined, compact = false) => {
    if (v == null) return '-';
    const d = new Date(v * 1000);
    return compact
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleString(localeTag, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
  };
}
const remainingFromUsed = (used: number | null | undefined) =>
  used == null ? null : Math.max(0, Math.min(100, 100 - used));
const percentColor = (v: number) => v <= 5 ? '#ef4444' : v <= 20 ? '#f59e0b' : '#22c55e';

/** Two compact tags (5h / 7d) sized to live inside the Overview glance card. */
export function RateLimitGlance() {
  const sourceFilter = useStore((s) => s.sourceFilter);
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const { t: tr } = useI18n();
  const fmtReset = useFmtReset();
  // Codex-only metric — hide entirely when the user has filtered to Claude.
  const enabled = sourceFilter !== 'claude';
  const { data } = useQuery<CurrentRateLimit>({
    queryKey: ['codex-rate-limit-current'],
    queryFn: () => api.get<CurrentRateLimit>('/api/codex/rate-limits/current'),
    refetchInterval: 60_000,
    enabled,
  });
  if (!enabled || !data) return null;
  const used5 = data.primaryUsedPct ?? data.primaryMaxPct;
  const used7 = data.secondaryUsedPct ?? data.secondaryMaxPct;
  const p5 = data.primaryRemainingPct ?? remainingFromUsed(used5);
  const p7 = data.secondaryRemainingPct ?? remainingFromUsed(used7);
  if (p5 == null) return null;
  return (
    <div style={{ marginTop: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: t.textSecondary }}>{tr('rateLimit.balance')}</span>
        <Tooltip title={tr('rateLimit.codexHint')}>
          <InfoCircleOutlined style={{ fontSize: 12, color: t.textMuted }} />
        </Tooltip>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        <QuotaPanel
          title={tr('rateLimit.fiveHourQuota')}
          remaining={p5}
          resetLabel={fmtReset(data.primaryResetsAt, true)}
          t={t}
        />
        <QuotaPanel
          title={tr('rateLimit.weeklyQuota')}
          remaining={p7}
          resetLabel={fmtReset(data.secondaryResetsAt)}
          t={t}
        />
      </div>
    </div>
  );
}

function QuotaPanel({
  title,
  remaining,
  resetLabel,
  t,
}: {
  title: string;
  remaining: number | null;
  resetLabel: string;
  t: typeof TOKENS['light'];
}) {
  const { t: tr } = useI18n();
  const value = remaining ?? 0;
  return (
    <div style={{
      border: `1px solid ${t.border}`,
      borderRadius: 12,
      padding: '12px 14px',
      background: t.cardBg,
      minWidth: 0,
    }}>
      <div style={{ fontSize: 12, color: t.textSecondary, marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 10 }}>
        <span style={{
          fontSize: 24,
          lineHeight: 1,
          fontWeight: 800,
          color: t.textPrimary,
          fontVariantNumeric: 'tabular-nums',
        }}>{value.toFixed(0)}%</span>
        <span style={{ fontSize: 12, color: t.textPrimary }}>{tr('rateLimit.remaining')}</span>
      </div>
      <Progress
        percent={value}
        showInfo={false}
        size="small"
        strokeColor={percentColor(value)}
        trailColor={t.pageBg}
      />
      <div style={{ marginTop: 8, fontSize: 12, color: t.textSecondary }}>
        {tr('rateLimit.resetAt', { value: resetLabel })}
      </div>
    </div>
  );
}
