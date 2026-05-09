import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Tag, Modal, Form, Input, InputNumber, DatePicker, Select,
  Space, Empty, Alert, message, Row, Col,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { api } from '../../api/client.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';
import ProvidersModal from './ProvidersModal.js';
import PricingHistoryTable from './PricingHistoryTable.js';
import PricingHeaderBar from './PricingHeaderBar.js';
import PricingFilters, { type ProviderFilter } from './PricingFilters.js';
import { getLastRecomputeAt, setLastRecomputeAt } from './lastRecomputeAt.js';

interface Provider {
  id: number; slug: string; displayName: string; isBuiltin: number; modelCount: number;
}

interface ModelPriceM {
  input: number; output: number; cacheCreate: number; cacheRead: number;
}

interface ModelView {
  modelName: string;
  providerId: number;
  providerSlug: string;
  providerDisplayName: string;
  totalTokens: number;
  costUsd: number;
  messageCount: number;
  currentPrice: ModelPriceM | null;
  priceSource: 'window' | 'default' | 'none';
  currentEffectiveFrom: string | null;
}

interface RecomputeResp {
  updatedSessions: number;
  totalCostUsd: number;
  unconfiguredCount: number;
}

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

export default function PricingSettings() {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const qc = useQueryClient();
  const [providersOpen, setProvidersOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState<ProviderFilter>('all');
  const [search, setSearch] = useState('');
  const [lastRecomputeAt, setLastRecomputeAtState] = useState<string | null>(getLastRecomputeAt);
  const [form] = Form.useForm<{
    modelName: string; providerId: number;
    effectiveFrom: Dayjs; input: number; output: number; cacheCreate: number; cacheRead: number;
  }>();

  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.get<Provider[]>('/api/providers'),
  });

  const models = useQuery({
    queryKey: ['models'],
    queryFn: () => api.get<ModelView[]>('/api/models'),
  });

  const moveMut = useMutation({
    mutationFn: (v: { model: string; providerId: number }) =>
      api.patch(`/api/models/${encodeURIComponent(v.model)}`, { providerId: v.providerId }),
    onSuccess: () => {
      message.success('已转移');
      qc.invalidateQueries();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const addMut = useMutation({
    mutationFn: async (v: {
      modelName: string; providerId: number;
      effectiveFrom: string; input: number; output: number; cacheCreate: number; cacheRead: number;
    }) => {
      await api.post('/api/models', { modelName: v.modelName, providerId: v.providerId });
      return api.post(`/api/pricing/${encodeURIComponent(v.modelName)}`, {
        effectiveFrom: v.effectiveFrom,
        input: v.input, output: v.output, cacheCreate: v.cacheCreate, cacheRead: v.cacheRead,
      });
    },
    onSuccess: () => {
      message.success('已新增模型');
      setAddOpen(false); form.resetFields();
      qc.invalidateQueries();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const recomputeMut = useMutation({
    mutationFn: () => api.post<RecomputeResp>('/api/recompute-cost'),
    onSuccess: (r) => {
      const tail = r.unconfiguredCount > 0 ? `（${r.unconfiguredCount} 条因未配置计为 0）` : '';
      message.success(`已重算 ${r.updatedSessions} 个会话，总成本 $${r.totalCostUsd.toFixed(2)}${tail}`);
      const iso = new Date().toISOString();
      setLastRecomputeAt(iso);
      setLastRecomputeAtState(iso);
      qc.invalidateQueries();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const allRows = models.data ?? [];
  const unconfigured = allRows.filter(r => r.providerSlug === 'unknown');
  const providerOptions = (providers.data ?? [])
    .filter(p => p.slug !== 'unknown')
    .map(p => ({ id: p.id, displayName: p.displayName, modelCount: p.modelCount }));

  const rows = useMemo(() => {
    let list = allRows;
    if (filter === 'unknown') {
      list = list.filter(r => r.providerSlug === 'unknown');
    } else if (typeof filter === 'number') {
      list = list.filter(r => r.providerId === filter);
    }
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(r => r.modelName.toLowerCase().includes(q));
    return list;
  }, [allRows, filter, search]);

  return (
    <>
      <PricingHeaderBar
        providerCount={providers.data?.filter(p => p.slug !== 'unknown').length ?? 0}
        modelCount={allRows.length}
        unconfiguredCount={unconfigured.length}
        lastRecomputeAt={lastRecomputeAt}
        isRecomputing={recomputeMut.isPending}
        onRecompute={() => recomputeMut.mutate()}
      />

      <PricingFilters
        providers={providerOptions}
        unconfiguredCount={unconfigured.length}
        value={filter}
        onChange={setFilter}
        search={search}
        onSearchChange={setSearch}
        onAddModel={() => setAddOpen(true)}
        onManageProviders={() => setProvidersOpen(true)}
      />

      {unconfigured.length > 0 && (
        <Alert
          type="warning" showIcon style={{ marginBottom: 12 }}
          message={`检测到 ${unconfigured.length} 个未配置模型，当前成本计为 0。在「⚠ Unknown」标签内为它们指派供应商并设价。`}
        />
      )}

      <Card>
        <Table<ModelView>
          rowKey="modelName"
          loading={models.isLoading}
          dataSource={rows}
          pagination={false}
          size="middle"
          locale={{ emptyText: <Empty description="还没有数据，先去刷新或在「新增模型」中预先配置" /> }}
          expandable={{
            expandedRowRender: (r) => <PricingHistoryTable model={r.modelName} />,
            rowExpandable: (r) => r.providerSlug !== 'unknown',
          }}
          columns={[
            {
              title: '供应商', dataIndex: 'providerSlug', width: 130,
              render: (slug: string, row: ModelView) => slug === 'unknown'
                ? <Tag color="warning">⚠ Unknown</Tag>
                : <Tag color="processing">{row.providerDisplayName}</Tag>,
            },
            {
              title: '模型', dataIndex: 'modelName',
              render: (v: string) => <span style={{ fontWeight: 500, color: t.textPrimary }}>{v}</span>,
            },
            {
              title: '使用量', key: 'usage', width: 280,
              render: (_: unknown, r: ModelView) => (
                <span style={{ color: t.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
                  {r.messageCount.toLocaleString()} 条 · {fmt(r.totalTokens)} tokens · ${r.costUsd.toFixed(2)}
                </span>
              ),
            },
            {
              title: '当前价 (input/output/cc/cr)', key: 'price', width: 280,
              render: (_: unknown, r: ModelView) => {
                if (!r.currentPrice) return <span style={{ color: t.danger }}>未配置</span>;
                const tag = r.priceSource === 'default' ? '默认' : r.currentEffectiveFrom ?? '';
                return (
                  <Space size={6}>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                      ${r.currentPrice.input}/${r.currentPrice.output}/${r.currentPrice.cacheCreate}/${r.currentPrice.cacheRead}
                    </span>
                    <Tag color={r.priceSource === 'default' ? 'default' : 'green'}>{tag}</Tag>
                  </Space>
                );
              },
            },
            {
              title: '操作', key: 'actions', width: 200, align: 'right',
              render: (_: unknown, r: ModelView) => (
                <Space size={6}>
                  <Select<number>
                    size="small"
                    style={{ width: 140 }}
                    disabled={moveMut.isPending}
                    value={r.providerId}
                    onChange={(pid) => moveMut.mutate({ model: r.modelName, providerId: pid })}
                    options={(providers.data ?? []).map(p => ({ label: p.displayName, value: p.id }))}
                  />
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <ProvidersModal open={providersOpen} onClose={() => setProvidersOpen(false)} />

      <Modal
        title="新增模型"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={async () => {
          const v = await form.validateFields();
          addMut.mutate({
            modelName: v.modelName.trim(),
            providerId: v.providerId,
            effectiveFrom: v.effectiveFrom.format('YYYY-MM-DD'),
            input: v.input, output: v.output, cacheCreate: v.cacheCreate, cacheRead: v.cacheRead,
          });
        }}
        confirmLoading={addMut.isPending}
        destroyOnClose
      >
        <Form
          form={form} layout="vertical" preserve={false}
          initialValues={{ effectiveFrom: dayjs(), input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }}
        >
          <Form.Item label="模型名" name="modelName" rules={[
            { required: true },
            { pattern: /^[A-Za-z0-9._-]{1,64}$/, message: '只能包含字母、数字、. _ -' },
          ]}><Input placeholder="例如 deepseek-chat" /></Form.Item>
          <Form.Item label="供应商" name="providerId" rules={[{ required: true }]}>
            <Select options={(providers.data ?? []).map(p => ({ label: p.displayName, value: p.id }))} />
          </Form.Item>
          <Form.Item label="生效日期" name="effectiveFrom" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
          </Form.Item>
          <Row gutter={[12, 0]}>
            <Col span={12}>
              <Form.Item label="Input ($/M)" name="input" rules={[{ required: true }]}>
                <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Output ($/M)" name="output" rules={[{ required: true }]}>
                <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Cache Create ($/M)" name="cacheCreate" rules={[{ required: true }]}>
                <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Cache Read ($/M)" name="cacheRead" rules={[{ required: true }]}>
                <InputNumber min={0} step={0.01} prefix="$" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </>
  );
}
