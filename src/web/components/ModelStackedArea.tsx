import ReactECharts from 'echarts-for-react';
import type { OverviewResponse } from '../../shared/types.js';

export default function ModelStackedArea({ dailyTrend }: { dailyTrend: OverviewResponse['dailyTrend'] }) {
  const dates = dailyTrend.map(d => d.date);
  const models = new Set<string>();
  dailyTrend.forEach(d => Object.keys(d.byModel).forEach(m => models.add(m)));
  const series = [...models].map(model => ({
    name: model,
    type: 'line',
    stack: 'all',
    areaStyle: {},
    data: dailyTrend.map(d => d.byModel[model] ?? 0),
  }));

  return (
    <ReactECharts
      style={{ height: 320 }}
      option={{
        tooltip: { trigger: 'axis' },
        legend: { top: 'bottom' },
        grid: { left: 40, right: 20, top: 20, bottom: 60 },
        xAxis: { type: 'category', data: dates },
        yAxis: { type: 'value', name: 'tokens' },
        series,
      }}
    />
  );
}
