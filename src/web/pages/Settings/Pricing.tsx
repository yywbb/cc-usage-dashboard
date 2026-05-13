import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Tag, Modal, Form, Input, InputNumber, DatePicker, Select,
  Space, Empty, Alert, message, Row, Col, Dropdown, Button, Tooltip,
} from 'antd';
import { DownOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { api } from '../../api/client.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';
import ProvidersModal from './ProvidersModal.js';
import PricingHistoryTable from './PricingHistoryTable.js';
import PricingHeaderBar from './PricingHeaderBar.js';
import PricingFilters, { type ProviderFilter } from './PricingFilters.js';
import { getLastRecomputeAt, setLastRecomputeAt } from './lastRecomputeAt.js';
import { useI18n } from '../../i18n/index.js';

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
  const { t: tr } = useI18n();

  const priceCell = (n: number | undefined) =>
    typeof n === 'number'
      ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{n.toFixed(2)}</span>
      : <span style={{ color: t.textMuted }}>—</span>;

  const qc = useQueryClient();
  const [providersOpen, setProvidersOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState<ProviderFilter>('all');
  const [search, setSearch] = useState('');
  const [expandedRowKeys, setExpandedRowKeys] = useState<React.Key[]>([]);
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
      message.success(tr('pricing.move.success'));
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
      message.success(tr('pricing.add.success'));
      setAddOpen(false); form.resetFields();
      qc.invalidateQueries();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const recomputeMut = useMutation({
    mutationFn: () => api.post<RecomputeResp>('/api/recompute-cost'),
    onSuccess: (r) => {
      const tail = r.unconfiguredCount > 0 ? tr('pricing.recompute.tail', { n: r.unconfiguredCount }) : '';
      message.success(tr('pricing.recompute.success', {
        sessions: r.updatedSessions,
        total: r.totalCostUsd.toFixed(2),
        tail,
      }));
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
          message={tr('pricing.unconfiguredWarn', { n: unconfigured.length })}
        />
      )}

      <Card>
        <Table<ModelView>
          rowKey="modelName"
          loading={models.isLoading}
          dataSource={rows}
          pagination={false}
          size="middle"
          locale={{ emptyText: <Empty description={tr('pricing.empty')} /> }}
          expandable={{
            expandedRowRender: (r) => <PricingHistoryTable model={r.modelName} />,
            rowExpandable: (r) => r.providerSlug !== 'unknown',
            expandedRowKeys,
            onExpandedRowsChange: (keys) => setExpandedRowKeys([...keys]),
          }}
          columns={[
            {
              title: tr('pricing.col.model'), dataIndex: 'modelName',
              render: (v: string, row: ModelView) => (
                <div>
                  <div style={{ fontWeight: 500, color: t.textPrimary }}>{v}</div>
                  {filter === 'all' && (
                    <div style={{ fontSize: 12, color: t.textSecondary, marginTop: 2 }}>
                      {row.providerSlug === 'unknown'
                        ? <Tag color="warning" style={{ marginRight: 0 }}>⚠ Unknown</Tag>
                        : row.providerDisplayName}
                    </div>
                  )}
                </div>
              ),
            },
            {
              title: 'Input', key: 'input', width: 90, align: 'right',
              sorter: (a, b) => (a.currentPrice?.input ?? -1) - (b.currentPrice?.input ?? -1),
              render: (_: unknown, r: ModelView) => priceCell(r.currentPrice?.input),
            },
            {
              title: 'Output', key: 'output', width: 90, align: 'right',
              sorter: (a, b) => (a.currentPrice?.output ?? -1) - (b.currentPrice?.output ?? -1),
              render: (_: unknown, r: ModelView) => priceCell(r.currentPrice?.output),
            },
            {
              title: 'CC', key: 'cc', width: 80, align: 'right',
              sorter: (a, b) => (a.currentPrice?.cacheCreate ?? -1) - (b.currentPrice?.cacheCreate ?? -1),
              render: (_: unknown, r: ModelView) => priceCell(r.currentPrice?.cacheCreate),
            },
            {
              title: 'CR', key: 'cr', width: 80, align: 'right',
              sorter: (a, b) => (a.currentPrice?.cacheRead ?? -1) - (b.currentPrice?.cacheRead ?? -1),
              render: (_: unknown, r: ModelView) => priceCell(r.currentPrice?.cacheRead),
            },
            {
              title: tr('pricing.col.priceSource'), key: 'priceSource', width: 130,
              render: (_: unknown, r: ModelView) => {
                if (!r.currentPrice || r.priceSource === 'none') return <span style={{ color: t.danger }}>{tr('pricing.col.unconfigured')}</span>;
                if (r.priceSource === 'default') return <Tag>{tr('pricing.tag.default')}</Tag>;
                return (
                  <Tag color="green" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    ⚡ {r.currentEffectiveFrom ?? ''}
                  </Tag>
                );
              },
            },
            {
              title: tr('pricing.col.usage'), key: 'usage', width: 200,
              render: (_: unknown, r: ModelView) => (
                <span style={{ color: t.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
                  {tr('pricing.usageDesc', {
                    messages: r.messageCount.toLocaleString(),
                    tokens: fmt(r.totalTokens),
                    cost: r.costUsd.toFixed(2),
                  })}
                </span>
              ),
            },
            {
              title: tr('pricing.col.actions'), key: 'actions', width: 150, align: 'right',
              render: (_: unknown, r: ModelView) => {
                const transferItems = (providers.data ?? [])
                  .filter(p => p.slug !== 'unknown' && p.id !== r.providerId)
                  .map(p => ({ key: String(p.id), label: p.displayName }));

                const onTransfer: NonNullable<React.ComponentProps<typeof Dropdown>['menu']>['onClick'] = ({ key }) => {
                  moveMut.mutate({ model: r.modelName, providerId: Number(key) });
                };

                if (r.providerSlug === 'unknown') {
                  return (
                    <Dropdown
                      menu={{ items: transferItems, onClick: onTransfer }}
                      trigger={['click']}
                      disabled={moveMut.isPending || transferItems.length === 0}
                    >
                      <Button size="small" type="primary">
                        <Space size={4}>{tr('pricing.assignProvider')} <DownOutlined /></Space>
                      </Button>
                    </Dropdown>
                  );
                }

                return (
                  <Space size={4}>
                    <Dropdown
                      menu={{ items: transferItems, onClick: onTransfer }}
                      trigger={['click']}
                      disabled={moveMut.isPending || transferItems.length === 0}
                    >
                      <Tooltip title={tr('pricing.transferTooltip')}>
                        <Button size="small" type="link">{tr('pricing.transfer')}</Button>
                      </Tooltip>
                    </Dropdown>
                    <Button
                      size="small"
                      type="link"
                      onClick={() => {
                        setExpandedRowKeys((prev) =>
                          prev.includes(r.modelName) ? prev : [...prev, r.modelName],
                        );
                      }}
                    >{tr('pricing.edit')}</Button>
                  </Space>
                );
              },
            },
          ]}
        />
      </Card>

      <ProvidersModal open={providersOpen} onClose={() => setProvidersOpen(false)} />

      <Modal
        title={tr('pricing.modal.add')}
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
          <Form.Item label={tr('pricing.modal.modelName')} name="modelName" rules={[
            { required: true },
            { pattern: /^[A-Za-z0-9._-]{1,64}$/, message: tr('pricing.modal.modelNamePattern') },
          ]}><Input placeholder={tr('pricing.modal.modelNamePlaceholder')} /></Form.Item>
          <Form.Item label={tr('pricing.modal.provider')} name="providerId" rules={[{ required: true }]}>
            <Select options={(providers.data ?? []).map(p => ({ label: p.displayName, value: p.id }))} />
          </Form.Item>
          <Form.Item label={tr('pricing.modal.effectiveFrom')} name="effectiveFrom" rules={[{ required: true }]}>
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
