import { Row, Col, Card, Spin, Segmented } from 'antd';
import { ThunderboltOutlined, DollarOutlined, MessageOutlined, ApiOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useOverview } from '../../hooks/useOverview.js';
import { useStore } from '../../store.js';
import KpiCard from '../../components/KpiCard.js';
import BarList from '../../components/BarList.js';
import EmptyState from '../../components/EmptyState.js';
import PageHeader from '../../components/PageHeader.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';
import { echartsThemeName } from '../../theme/echarts.js';
import { api } from '../../api/client.js';
import type { CostResponse, OverviewResponse, RangeKey } from '../../../shared/types.js';
import ReactECharts from 'echarts-for-react';

const RANGE_OPTIONS: { label: string; value: RangeKey }[] = [
  { label: '今天', value: 'today' },
  { label: '本周', value: 'week' },
  { label: '本月', value: 'month' },
  { label: 'YTD', value: 'ytd' },
  { label: '全部', value: 'all' },
];

export default function Overview() {
  const { range, setRange } = useStore();
  const { data, isLoading } = useOverview(range);
  const { mode } = useTheme();
  const t = TOKENS[mode];

  const anomalies = useQuery<CostResponse>({
    queryKey: ['cost', 'day', 'month'],
    queryFn: () => api.get('/api/cost?granularity=day&range=month'),
    staleTime: 60_000,
  });
  const anomalyCount = anomalies.data?.anomalies.length ?? 0;

  return (
    <>
      <PageHeader
        title="概览"
        subtitle="Claude Code token 使用与成本分析"
        extra={
          <Segmented
            options={RANGE_OPTIONS}
            value={range}
            onChange={(v) => setRange(v as RangeKey)}
          />
        }
      />
      {isLoading && <Spin />}
      {data && data.totals.messageCount === 0 && (
        <EmptyState
          title="暂无数据"
          description="点右上角「刷新数据」或在终端里运行 ccu scan"
        />
      )}
      {data && data.totals.messageCount > 0 && (
        <OverviewBody data={data} t={t} mode={mode} anomalyCount={anomalyCount} />
      )}
    </>
  );
}

function OverviewBody({
  data, t, mode, anomalyCount,
}: {
  data: OverviewResponse;
  t: typeof TOKENS['light'];
  mode: 'light' | 'dark';
  anomalyCount: number;
}) {
  const totalTokens = data.totals.inputTokens + data.totals.outputTokens + data.totals.cacheCreate + data.totals.cacheRead;
  // dailyTrend.byModel values are per-model totals of (input+output+cache*) — summing them yields the day total.
  const dayTotal = (d: OverviewResponse['dailyTrend'][number]) =>
    Object.values(d.byModel).reduce((a, v) => a + v, 0);
  const tokenSpark = data.dailyTrend.map(dayTotal);
  const costSpark = data.dailyTrend.map(d => d.costUsd);
  const last = data.dailyTrend[data.dailyTrend.length - 1];
  const todayTokens = last ? dayTotal(last) : 0;
  const todayCost = last ? last.costUsd : 0;
  const topProject = data.byProject[0]?.displayName ?? '—';

  const trendModels = new Set<string>();
  data.dailyTrend.forEach(d => Object.keys(d.byModel).forEach(m => trendModels.add(m)));
  const series = [...trendModels].map(model => ({
    name: model,
    type: 'line',
    stack: 'all',
    areaStyle: { opacity: 0.7 },
    smooth: false,
    data: data.dailyTrend.map(d => d.byModel[model] ?? 0),
  }));

  return (
    <>
      <Row gutter={14} style={{ marginBottom: 18 }}>
        <Col span={6}><KpiCard
          title="总 Token" value={totalTokens}
          icon={<ThunderboltOutlined />}
          sparkline={tokenSpark}
        /></Col>
        <Col span={6}><KpiCard
          title="总成本" value={data.totals.costUsd} precision={2} suffix="$"
          icon={<DollarOutlined />}
          iconBg={mode === 'dark' ? '#3b2e10' : '#fef3c7'} iconColor="#d97706"
          sparkline={costSpark} sparkColor="#d97706"
        /></Col>
        <Col span={6}><KpiCard
          title="会话数" value={data.totals.sessionCount}
          icon={<MessageOutlined />}
          iconBg={mode === 'dark' ? '#10321f' : '#dcfce7'} iconColor="#16a34a"
        /></Col>
        <Col span={6}><KpiCard
          title="缓存命中率" value={data.cacheHitRate * 100} precision={1} suffix="%"
          icon={<ApiOutlined />}
          iconBg={mode === 'dark' ? '#3a1622' : '#ffe4e6'} iconColor="#e11d48"
        /></Col>
      </Row>

      <Row gutter={14} style={{ marginBottom: 18 }}>
        <Col span={16}>
          <Card title="Token 趋势 · 按模型堆叠" extra={<span style={{ fontSize: 11, color: t.textSecondary }}>每日</span>}>
            <ReactECharts
              theme={echartsThemeName(mode)}
              style={{ height: 280 }}
              option={{
                tooltip: { trigger: 'axis' },
                legend: { top: 'bottom' },
                grid: { left: 40, right: 20, top: 20, bottom: 60 },
                xAxis: { type: 'category', data: data.dailyTrend.map(d => d.date) },
                yAxis: { type: 'value', name: 'tokens' },
                series,
              }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card title="今日速览" extra={<span style={{ fontSize: 11, color: t.textSecondary }}>{last?.date ?? ''}</span>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <GlanceLine label="今日 tokens" value={todayTokens.toLocaleString()} t={t} />
              <GlanceLine label="今日成本" value={`$${todayCost.toFixed(2)}`} t={t} />
              <GlanceLine label="最活跃项目" value={topProject} emphasize t={t} />
              <GlanceLine label="本月异常日" value={`${anomalyCount} 日`} danger={anomalyCount > 0} t={t} />
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={14}>
        <Col span={12}>
          <Card title="按项目 · Top 10"
                extra={<span style={{ fontSize: 11, color: t.textSecondary }}>按 token</span>}>
            <BarList items={data.byProject.map(p => ({ label: p.displayName, value: p.tokens }))} />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="按模型 · 用量分布"
                extra={<span style={{ fontSize: 11, color: t.textSecondary }}>按 token</span>}>
            <BarList items={data.byModel.map(m => ({ label: m.model, value: m.tokens }))} />
          </Card>
        </Col>
      </Row>
    </>
  );
}

function GlanceLine({
  label, value, emphasize = false, danger = false, t,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  danger?: boolean;
  t: typeof TOKENS['light'];
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontSize: 12, color: t.textSecondary }}>{label}</span>
      <span style={{
        fontSize: emphasize ? 13 : 16,
        fontWeight: emphasize ? 600 : 700,
        color: danger ? t.danger : (emphasize ? t.primary : t.textPrimary),
        fontVariantNumeric: 'tabular-nums',
      }}>{value}</span>
    </div>
  );
}
