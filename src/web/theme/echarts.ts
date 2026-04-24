import * as echarts from 'echarts';
import { TOKENS, type Mode } from './tokens.js';

function themeFor(mode: Mode) {
  const t = TOKENS[mode];
  const gridLine = mode === 'dark' ? '#1f2937' : '#eef2f7';
  const axisText = t.textSecondary;
  return {
    color: t.chartPalette,
    backgroundColor: 'transparent',
    textStyle: { color: t.textPrimary, fontFamily: 'inherit' },
    title: { textStyle: { color: t.textPrimary, fontSize: 14, fontWeight: 600 } },
    legend: {
      textStyle: { color: axisText, fontSize: 11 },
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
    },
    tooltip: {
      backgroundColor: t.cardBg,
      borderColor: t.border,
      borderWidth: 1,
      textStyle: { color: t.textPrimary, fontSize: 12 },
      extraCssText: 'box-shadow: 0 4px 16px rgba(15,23,42,.08); border-radius: 8px;',
    },
    categoryAxis: {
      axisLine: { lineStyle: { color: t.border } },
      axisTick: { show: false },
      axisLabel: { color: axisText, fontSize: 11 },
      splitLine: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: axisText, fontSize: 11 },
      splitLine: { lineStyle: { color: gridLine, type: 'dashed' } },
    },
    bar: { itemStyle: { borderRadius: [2, 2, 0, 0] } },
    line: { symbol: 'none', smooth: false },
  };
}

let registered = false;
export function registerEchartsThemes() {
  if (registered) return;
  echarts.registerTheme('ccLight', themeFor('light'));
  echarts.registerTheme('ccDark', themeFor('dark'));
  registered = true;
}

export const echartsThemeName = (mode: Mode) => (mode === 'dark' ? 'ccDark' : 'ccLight');
