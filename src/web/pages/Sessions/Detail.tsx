import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, Descriptions, Table, Row, Col, Tag } from 'antd';
import ReactECharts from 'echarts-for-react';
import { api } from '../../api/client.js';
import type { MessageRow } from '../../../shared/types.js';

interface Detail {
  session: { sessionId: string; projectDir: string; startedAt: number; endedAt: number; messageCount: number; totalCostUsd: number };
  messages: MessageRow[];
  toolDistribution: { tool: string; count: number; share: number }[];
}

export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { data } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api.get<Detail>(`/api/sessions/${sessionId}`),
  });
  if (!data) return null;

  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <Descriptions column={3} size="small">
          <Descriptions.Item label="Session">{data.session.sessionId}</Descriptions.Item>
          <Descriptions.Item label="开始">{new Date(data.session.startedAt).toLocaleString()}</Descriptions.Item>
          <Descriptions.Item label="成本">${data.session.totalCostUsd.toFixed(4)}</Descriptions.Item>
          <Descriptions.Item label="消息数">{data.session.messageCount}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Row gutter={16}>
        <Col span={18}>
          <Card title="消息时间线 · token 分布">
            <ReactECharts
              style={{ height: 300 }}
              option={{
                tooltip: { trigger: 'axis' },
                legend: { top: 'bottom' },
                xAxis: { type: 'category', data: data.messages.map((_, i) => i + 1), name: '第 N 条消息' },
                yAxis: { type: 'value', name: 'tokens' },
                series: [
                  { name: 'input',  type: 'bar', stack: 't', data: data.messages.map(m => m.inputTokens) },
                  { name: 'output', type: 'bar', stack: 't', data: data.messages.map(m => m.outputTokens) },
                  { name: 'cache-create', type: 'bar', stack: 't', data: data.messages.map(m => m.cacheCreate) },
                  { name: 'cache-read',   type: 'bar', stack: 't', data: data.messages.map(m => m.cacheRead) },
                ],
              }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card title="工具调用分布">
            <ReactECharts
              style={{ height: 300 }}
              option={{
                tooltip: { trigger: 'item' },
                series: [{
                  type: 'pie', radius: '70%',
                  data: data.toolDistribution.map(t => ({ name: t.tool, value: t.count })),
                }],
              }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="消息详情" style={{ marginTop: 16 }}>
        <Table
          size="small"
          rowKey="messageId"
          dataSource={data.messages}
          pagination={{ pageSize: 30 }}
          columns={[
            { title: '时间', dataIndex: 'timestamp', render: (v) => new Date(v).toLocaleTimeString() },
            { title: 'role', dataIndex: 'role' },
            { title: 'model', dataIndex: 'model' },
            { title: 'input', dataIndex: 'inputTokens' },
            { title: 'output', dataIndex: 'outputTokens' },
            { title: 'cache-rd', dataIndex: 'cacheRead' },
            { title: '$', dataIndex: 'costUsd', render: (v: number) => v.toFixed(4) },
            { title: 'tools', dataIndex: 'toolNames',
              render: (tools: string[]) => tools.map(t => <Tag key={t}>{t}</Tag>) },
            { title: 'preview', dataIndex: 'textPreview', ellipsis: true },
          ]}
        />
      </Card>
    </>
  );
}
