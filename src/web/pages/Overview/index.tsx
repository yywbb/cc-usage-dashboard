import { Row, Col, Card, Empty, Spin } from 'antd';
import { useOverview } from '../../hooks/useOverview.js';
import { useStore } from '../../store.js';
import KpiCard from '../../components/KpiCard.js';
import RangePicker from '../../components/RangePicker.js';
import ModelStackedArea from '../../components/ModelStackedArea.js';
import TopBarChart from '../../components/TopBarChart.js';

export default function Overview() {
  const { range, setRange } = useStore();
  const { data, isLoading } = useOverview(range);

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <RangePicker value={range} onChange={setRange} />
      </div>
      {isLoading && <Spin />}
      {data && data.totals.messageCount === 0 && (
        <Empty description="暂无数据，请点右上角「刷新数据」或运行 `ccu scan`" />
      )}
      {data && data.totals.messageCount > 0 && (
        <>
          <Row gutter={16}>
            <Col span={6}><KpiCard title="总 Token" value={
              data.totals.inputTokens + data.totals.outputTokens + data.totals.cacheCreate + data.totals.cacheRead
            } /></Col>
            <Col span={6}><KpiCard title="总成本 ($)" value={data.totals.costUsd} precision={2} /></Col>
            <Col span={6}><KpiCard title="会话数" value={data.totals.sessionCount} /></Col>
            <Col span={6}><KpiCard title="缓存命中率" value={data.cacheHitRate * 100} precision={1} suffix="%" /></Col>
          </Row>
          <Card title="按模型 · token 趋势" style={{ marginTop: 16 }}>
            <ModelStackedArea dailyTrend={data.dailyTrend} />
          </Card>
          <Row gutter={16} style={{ marginTop: 16 }}>
            <Col span={12}>
              <Card>
                <TopBarChart
                  title="按项目 · token Top 10"
                  items={data.byProject.map(p => ({ label: p.displayName, value: p.tokens }))}
                />
              </Card>
            </Col>
            <Col span={12}>
              <Card>
                <TopBarChart
                  title="按模型 · token"
                  items={data.byModel.map(m => ({ label: m.model, value: m.tokens }))}
                />
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}
