import { useEffect, useState } from 'react';
import { Row, Col, Card, Spin, Segmented, Popover, Space, Table } from 'antd';
import { Link } from 'react-router-dom';
import { ThunderboltOutlined, DollarOutlined, MessageOutlined, ApiOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useOverview } from '../../hooks/useOverview.js';
import { useStore } from '../../store.js';
import KpiCard from '../../components/KpiCard.js';
import BarList from '../../components/BarList.js';
import EmptyState from '../../components/EmptyState.js';
import PageHeader from '../../components/PageHeader.js';
import TokenBreakdown from '../../components/TokenBreakdown.js';
import { RateLimitGlance } from '../../components/RateLimitBadge.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';
import { echartsThemeName, formatCompactNumber } from '../../theme/echarts.js';
import { api } from '../../api/client.js';
import type { CostResponse, OverviewResponse, RangeKey, TrendGranularity } from '../../../shared/types.js';
import { useFormatTokens } from '../../format.js';
import { useI18n } from '../../i18n/index.js';
import type { MessageKey } from '../../i18n/messages.js';
import ReactECharts from 'echarts-for-react';
import type { SourceFilter } from '../../store.js';

export default function Overview() {
  const { range, setRange, sourceFilter } = useStore();
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const { t: tr } = useI18n();

  const allowHour = range === 'today' || range === 'week';
  const defaultGran: TrendGranularity = range === 'today' ? 'hour' : 'day';
  const [granOverride, setGranOverride] = useState<TrendGranularity | null>(null);
  const granularity: TrendGranularity = allowHour ? (granOverride ?? defaultGran) : 'day';
  useEffect(() => { setGranOverride(null); }, [range]);

  const { data, isLoading } = useOverview(range, granularity, sourceFilter);

  const anomalies = useQuery<CostResponse>({
    queryKey: ['cost', 'day', 'month', sourceFilter],
    queryFn: () => api.get(`/api/cost?granularity=day&range=month${sourceFilter !== 'all' ? `&source=${sourceFilter}` : ''}`),
    staleTime: 60_000,
  });
  const anomalyCount = anomalies.data?.anomalies.length ?? 0;

  const rangeOptions: { label: string; value: RangeKey }[] = [
    { label: tr('range.today'), value: 'today' },
    { label: tr('range.week'),  value: 'week' },
    { label: tr('range.month'), value: 'month' },
    { label: tr('range.ytd'),   value: 'ytd' },
    { label: tr('range.all'),   value: 'all' },
  ];

  return (
    <>
      <PageHeader
        title={tr('nav.overview')}
        subtitle={
          sourceFilter === 'claude' ? tr('overview.subtitleClaude')
          : sourceFilter === 'codex'  ? tr('overview.subtitleCodex')
          : tr('overview.subtitleBoth')
        }
        extra={
          <Segmented
            options={rangeOptions}
            value={range}
            onChange={(v) => setRange(v as RangeKey)}
          />
        }
      />
      {isLoading && <Spin />}
      {data && data.totals.messageCount === 0 && (
        <EmptyState
          title={tr('overview.emptyTitle')}
          description={tr('overview.emptyHint')}
        />
      )}
      {data && data.totals.messageCount > 0 && (
        <OverviewBody
          data={data} t={t} mode={mode} anomalyCount={anomalyCount}
          range={range}
          sourceFilter={sourceFilter}
          granularity={granularity} allowHour={allowHour}
          onGranularityChange={(g) => setGranOverride(g)}
        />
      )}
    </>
  );
}

const RANGE_LABEL_KEY: Record<RangeKey, MessageKey | ''> = {
  today: 'overview.delta.today',
  week:  'overview.delta.week',
  month: 'overview.delta.month',
  ytd:   'overview.delta.ytd',
  all:   '',
};

function delta(curr: number, prev: number): number | null {
  if (prev <= 0) return curr > 0 ? Infinity : null;
  return (curr - prev) / prev;
}

function OverviewBody({
  data, t, mode, anomalyCount, range, sourceFilter, granularity, allowHour, onGranularityChange,
}: {
  data: OverviewResponse;
  t: typeof TOKENS['light'];
  mode: 'light' | 'dark';
  anomalyCount: number;
  range: RangeKey;
  sourceFilter: SourceFilter;
  granularity: TrendGranularity;
  allowHour: boolean;
  onGranularityChange: (g: TrendGranularity) => void;
}) {
  const fmtTokens = useFormatTokens();
  const { t: tr } = useI18n();
  const [trendMode, setTrendMode] = useState<'model' | 'type' | 'provider'>('model');
  const totalTokens = data.totals.inputTokens + data.totals.outputTokens + data.totals.cacheCreate + data.totals.cacheRead;
  const prev = data.previous;
  const prevTotalTokens = prev
    ? prev.inputTokens + prev.outputTokens + prev.cacheCreate + prev.cacheRead
    : 0;
  const deltaKey = RANGE_LABEL_KEY[range];
  const deltaLabel = deltaKey ? tr(deltaKey) : '';
  const tokenDelta   = prev ? delta(totalTokens, prevTotalTokens)        : null;
  const costDelta    = prev ? delta(data.totals.costUsd, prev.costUsd)   : null;
  const sessionDelta = prev ? delta(data.totals.sessionCount, prev.sessionCount) : null;
  const hitRateDelta = prev ? delta(data.cacheHitRate, prev.cacheHitRate) : null;
  const responseSuccessDelta = prev ? delta(data.totals.responseSuccessRate, prev.responseSuccessRate) : null;
  // dailyTrend.byModel values are per-model totals of (input+output+cache*) — summing them yields the bucket total.
  const bucketTotal = (d: OverviewResponse['dailyTrend'][number]) =>
    Object.values(d.byModel).reduce((a, v) => a + v, 0);
  const tokenSpark = data.dailyTrend.map(bucketTotal);
  const costSpark = data.dailyTrend.map(d => d.costUsd);
  // Snapshot aggregates whatever buckets share the most-recent date.
  const lastDate = data.dailyTrend.length > 0
    ? data.dailyTrend[data.dailyTrend.length - 1].date.slice(0, 10)
    : '';
  const lastDayBuckets = data.dailyTrend.filter(d => d.date.startsWith(lastDate));
  const todayTokens = lastDayBuckets.reduce((acc, d) => acc + bucketTotal(d), 0);
  const todayCost = lastDayBuckets.reduce((acc, d) => acc + d.costUsd, 0);
  const topProject = data.byProject[0]?.displayName ?? '—';

  const trendModels = new Set<string>();
  data.dailyTrend.forEach(d => Object.keys(d.byModel).forEach(m => trendModels.add(m)));
  const seriesByModel = [...trendModels].map(model => ({
    name: model,
    type: 'line',
    stack: 'all',
    areaStyle: { opacity: 0.7 },
    smooth: false,
    data: data.dailyTrend.map(d => d.byModel[model] ?? 0),
  }));
  const trendProviders = new Set<string>();
  data.dailyTrend.forEach(d => Object.keys(d.byProvider ?? {}).forEach(p => trendProviders.add(p)));
  const seriesByProvider = [...trendProviders].map(slug => ({
    name: slug,
    type: 'line',
    stack: 'all',
    areaStyle: { opacity: 0.7 },
    smooth: false,
    data: data.dailyTrend.map(d => d.byProvider?.[slug] ?? 0),
  }));
  const seriesByType = [
    { name: tr('tokens.input'),       key: 'inputTokens'  as const, color: t.chartPalette[0] },
    { name: tr('tokens.output'),      key: 'outputTokens' as const, color: t.chartPalette[1] },
    { name: tr('tokens.cacheCreate'), key: 'cacheCreate'  as const, color: t.chartPalette[2] },
    { name: tr('tokens.cacheRead'),   key: 'cacheRead'    as const, color: t.chartPalette[3] },
  ].map(s => ({
    name: s.name,
    type: 'line',
    stack: 'all',
    areaStyle: { opacity: 0.7 },
    smooth: false,
    itemStyle: { color: s.color },
    lineStyle: { color: s.color },
    data: data.dailyTrend.map(d => d[s.key] ?? 0),
  }));
  const RATE_SERIES = tr('tokens.cacheHitRate');
  const hitRateData = data.dailyTrend.map(d => {
    const denom = d.inputTokens + d.cacheCreate + d.cacheRead;
    return denom > 0 ? +(d.cacheRead / denom * 100).toFixed(2) : null;
  });
  const validRates = hitRateData.filter((v): v is number => v !== null);
  const rateMin = validRates.length > 0
    ? Math.max(0, Math.floor((Math.min(...validRates) - 2) / 5) * 5)
    : 0;
  const hitRateSeries = {
    name: RATE_SERIES,
    type: 'line',
    yAxisIndex: 1,
    smooth: false,
    symbol: 'circle',
    symbolSize: 4,
    z: 10,
    connectNulls: true,
    itemStyle: { color: t.warning },
    lineStyle: { color: t.warning, width: 2 },
    data: hitRateData,
    tooltip: { valueFormatter: (v: unknown) => v == null ? '—' : `${Number(v).toFixed(1)}%` },
  };
  const series = [
    ...(trendMode === 'type'
      ? seriesByType
      : trendMode === 'provider'
        ? seriesByProvider
        : seriesByModel),
    hitRateSeries,
  ];

  const trendTitle =
    trendMode === 'type'
      ? tr('overview.trend.titleType')
      : trendMode === 'provider'
        ? tr('overview.trend.titleProvider')
        : tr('overview.trend.titleModel');

  return (
    <>
      <Row gutter={14} style={{ marginBottom: 18 }}>
        <Col flex="1 1 0">
          <Popover
            placement="bottomLeft"
            mouseEnterDelay={0.15}
            content={
              <TokenBreakdown
                totals={data.totals}
                cacheHitRate={data.cacheHitRate}
                fmtTokens={fmtTokens}
              />
            }
          >
            <div style={{ cursor: 'help' }}>
              <KpiCard
                title={tr('overview.kpi.totalToken')} value={totalTokens}
                icon={<ThunderboltOutlined />}
                sparkline={tokenSpark}
                formatter={fmtTokens}
                delta={tokenDelta}
                deltaLabel={deltaLabel}
              />
            </div>
          </Popover>
        </Col>
        <Col flex="1 1 0"><KpiCard
          title={tr('overview.kpi.totalCost')} value={data.totals.costUsd} precision={2} suffix="$"
          icon={<DollarOutlined />}
          iconBg={mode === 'dark' ? '#3b2e10' : '#fef3c7'} iconColor="#d97706"
          sparkline={costSpark} sparkColor="#d97706"
          delta={costDelta} deltaLabel={deltaLabel}
        /></Col>
        <Col flex="1 1 0"><KpiCard
          title={tr('overview.kpi.sessionCount')} value={data.totals.sessionCount}
          icon={<MessageOutlined />}
          iconBg={mode === 'dark' ? '#10321f' : '#dcfce7'} iconColor="#16a34a"
          delta={sessionDelta} deltaLabel={deltaLabel}
        /></Col>
        <Col flex="1 1 0"><KpiCard
          title={tr('overview.kpi.responseSuccess')} value={data.totals.responseSuccessRate * 100} precision={1} suffix="%"
          icon={<CheckCircleOutlined />}
          iconBg={mode === 'dark' ? '#12322c' : '#ccfbf1'} iconColor="#0f766e"
          delta={responseSuccessDelta} deltaLabel={deltaLabel}
        /></Col>
        <Col flex="1 1 0"><KpiCard
          title={tr('overview.kpi.cacheHitRate')} value={data.cacheHitRate * 100} precision={1} suffix="%"
          icon={<ApiOutlined />}
          iconBg={mode === 'dark' ? '#3a1622' : '#ffe4e6'} iconColor="#e11d48"
          delta={hitRateDelta} deltaLabel={deltaLabel}
        /></Col>
      </Row>

      <Row gutter={14} style={{ marginBottom: 18 }}>
        <Col span={16} style={{ display: 'flex' }}>
          <Card
            style={{ flex: 1 }}
            title={trendTitle}
            extra={
              <Space size={8}>
                <Segmented
                  size="small"
                  options={[
                    { label: tr('overview.trend.model'), value: 'model' },
                    { label: tr('overview.trend.type'), value: 'type' },
                    { label: tr('overview.trend.provider'), value: 'provider' },
                  ]}
                  value={trendMode}
                  onChange={(v) => setTrendMode(v as 'model' | 'type' | 'provider')}
                />
                {allowHour ? (
                  <Segmented
                    size="small"
                    options={[{ label: tr('overview.trend.day'), value: 'day' }, { label: tr('overview.trend.hour'), value: 'hour' }]}
                    value={granularity}
                    onChange={(v) => onGranularityChange(v as TrendGranularity)}
                  />
                ) : (
                  <span style={{ fontSize: 11, color: t.textSecondary }}>{tr('overview.trend.daily')}</span>
                )}
              </Space>
            }
          >
            <ReactECharts
              key={`trend-${sourceFilter}-${range}-${trendMode}-${granularity}`}
              theme={echartsThemeName(mode)}
              notMerge
              style={{ height: 280 }}
              option={{
                animation: false,
                tooltip: trendMode === 'type'
                  ? {
                      trigger: 'axis',
                      axisPointer: { type: 'line' },
                      formatter: (params: unknown) => {
                        const arr = (Array.isArray(params) ? params : [params]) as Array<{
                          axisValueLabel: string; marker: string; seriesName: string; value: number;
                        }>;
                        if (arr.length === 0) return '';
                        const tokenRows = arr.filter(p => p.seriesName !== RATE_SERIES);
                        const rateRow = arr.find(p => p.seriesName === RATE_SERIES);
                        const head = `<div style="margin-bottom:4px">${arr[0].axisValueLabel}</div>`;
                        const body = tokenRows.map(p =>
                          `<div style="display:flex;justify-content:space-between;gap:16px">
                            <span>${p.marker}${p.seriesName}</span>
                            <strong>${fmtTokens(Number(p.value))}</strong>
                          </div>`
                        ).join('');
                        const foot = rateRow
                          ? `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed ${t.border};display:flex;justify-content:space-between;gap:16px">
                              <span>${rateRow.marker}${RATE_SERIES}</span>
                              <strong>${Number(rateRow.value).toFixed(1)}%</strong>
                            </div>`
                          : '';
                        return head + body + foot;
                      },
                    }
                  : {
                      trigger: 'axis',
                      axisPointer: { type: 'line' },
                      valueFormatter: (v: unknown) => fmtTokens(Number(v)),
                    },
                legend: { top: 'bottom' },
                grid: { left: 50, right: 56, top: 20, bottom: 60 },
                xAxis: {
                  type: 'category',
                  data: data.dailyTrend.map(d => d.date),
                  axisLabel: granularity === 'hour'
                    ? { formatter: (v: string) => v.length >= 16 ? v.slice(11, 16) : v }
                    : undefined,
                },
                yAxis: [
                  {
                    type: 'value',
                    axisLabel: { formatter: (v: number) => formatCompactNumber(v) },
                  },
                  {
                    type: 'value',
                    min: rateMin, max: 100,
                    splitLine: { show: false },
                    axisLabel: { formatter: '{value}%' },
                  },
                ],
                series,
              }}
            />
          </Card>
        </Col>
        <Col span={8} style={{ display: 'flex' }}>
          <Card
            title={tr('overview.glance.title')}
            extra={<span style={{ fontSize: 11, color: t.textSecondary }}>{lastDate}</span>}
            style={{ flex: 1 }}
            bodyStyle={{ height: 'calc(100% - 57px)' }}
          >
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 18 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <GlanceLine label={tr('overview.glance.todayTokens')} value={fmtTokens(todayTokens)} t={t} />
                <GlanceLine label={tr('overview.glance.todayCost')} value={`$${todayCost.toFixed(2)}`} t={t} />
                <GlanceLine label={tr('overview.glance.topProject')} value={topProject} emphasize t={t} />
                <GlanceLine label={tr('overview.glance.anomalyDays')} value={`${anomalyCount} ${tr('overview.glance.dayUnit')}`} danger={anomalyCount > 0} t={t} />
              </div>
              <RateLimitGlance />
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={14} style={{ marginBottom: 18 }}>
        <Col span={6}>
          <Card title={tr('overview.byProject')}
                extra={<span style={{ fontSize: 11, color: t.textSecondary }}>{tr('overview.byToken')}</span>}>
            <BarList
              items={data.byProject.map(p => ({ label: p.displayName, value: p.tokens }))}
              formatter={fmtTokens}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card title={tr('overview.byModel')}
                extra={<span style={{ fontSize: 11, color: t.textSecondary }}>{tr('overview.byToken')}</span>}>
            <BarList
              items={data.byModel.map(m => ({ label: m.model, value: m.tokens }))}
              formatter={fmtTokens}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card title={tr('overview.byProvider')}
                extra={<span style={{ fontSize: 11, color: t.textSecondary }}>{tr('overview.byToken')}</span>}>
            <BarList
              items={data.byProvider.map(p => ({ label: p.providerDisplayName, value: p.tokens }))}
              formatter={fmtTokens}
              emptyText={tr('overview.noProviderData')}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card title={tr('overview.byTool')}
                extra={<span style={{ fontSize: 11, color: t.textSecondary }}>{tr('overview.byCalls')}</span>}>
            <BarList
              items={data.byTool.map(x => ({ label: x.tool, value: x.count }))}
              formatter={(v) => v.toLocaleString()}
              emptyText={tr('overview.noToolData')}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={14}>
        <Col span={24}>
          <Card title={tr('overview.topSessions', { n: data.topSessions.length })}
                extra={<span style={{ fontSize: 11, color: t.textSecondary }}>{tr('overview.topSessionsExtra')}</span>}>
            <Table
              size="small"
              rowKey="sessionId"
              dataSource={data.topSessions}
              pagination={false}
              locale={{ emptyText: tr('overview.noSessionData') }}
              columns={[
                {
                  title: tr('overview.session'), dataIndex: 'sessionId',
                  render: (sid: string) => <Link to={`/sessions/${sid}`}>{sid.slice(0, 8)}…</Link>,
                },
                { title: tr('overview.project'), dataIndex: 'displayName', ellipsis: true },
                { title: tr('overview.startedAt'), dataIndex: 'startedAt', width: 170, render: (v: number) => new Date(v).toLocaleString() },
                { title: tr('overview.messageCount'), dataIndex: 'messageCount', align: 'right', width: 80 },
                {
                  title: tr('overview.token'), dataIndex: 'tokens', align: 'right', width: 110,
                  render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTokens(v)}</span>,
                },
                {
                  title: tr('overview.costCol'), dataIndex: 'costUsd', align: 'right', width: 110,
                  render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toFixed(4)}</span>,
                },
              ]}
            />
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
