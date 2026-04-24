import ReactECharts from 'echarts-for-react';

export default function TopBarChart({ title, items }: {
  title: string;
  items: { label: string; value: number }[];
}) {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  return (
    <ReactECharts
      style={{ height: 320 }}
      option={{
        title: { text: title, textStyle: { fontSize: 14 } },
        tooltip: {},
        grid: { left: 120, right: 20, top: 40, bottom: 30 },
        xAxis: { type: 'value' },
        yAxis: { type: 'category', data: sorted.map(i => i.label).reverse() },
        series: [{ type: 'bar', data: sorted.map(i => i.value).reverse() }],
      }}
    />
  );
}
