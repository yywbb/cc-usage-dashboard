import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Button, InputNumber, Input, Space, Tag, Popconfirm, Modal,
  Form, Alert, Empty, message,
} from 'antd';
import { PlusOutlined, ReloadOutlined, DeleteOutlined, RollbackOutlined } from '@ant-design/icons';
import { api } from '../../api/client.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';

interface ModelPriceM {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

type ModelSource = 'default' | 'override' | 'custom' | 'unconfigured';

interface ModelView {
  model: string;
  price: ModelPriceM;
  source: ModelSource;
  usage: { messages: number; totalTokens: number; costUsd: number };
}

interface PricingResponse {
  defaults: Record<string, ModelPriceM>;
  overrides: Record<string, ModelPriceM>;
  effective: Record<string, ModelPriceM>;
  fallbackModel: string;
  models: ModelView[];
}

interface RecomputeResp {
  updatedSessions: number;
  totalCostUsd: number;
}

const PRICE_FIELDS: Array<keyof ModelPriceM> = ['input', 'output', 'cacheCreate', 'cacheRead'];

const SOURCE_TAG: Record<ModelSource, { color: string; label: string }> = {
  default:      { color: 'default',     label: '默认' },
  override:     { color: 'processing',  label: '已覆盖' },
  custom:       { color: 'purple',      label: '自定义' },
  unconfigured: { color: 'warning',     label: '未配置' },
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function PricingSettings() {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, ModelPriceM>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [form] = Form.useForm<{ model: string } & ModelPriceM>();

  const { data, isLoading } = useQuery({
    queryKey: ['pricing'],
    queryFn: () => api.get<PricingResponse>('/api/pricing'),
  });

  const rows = data?.models ?? [];
  const fallbackModel = data?.fallbackModel ?? 'claude-sonnet-4-6';
  const unconfiguredCount = rows.filter(r => r.source === 'unconfigured').length;

  const saveMut = useMutation({
    mutationFn: (args: { model: string; price: ModelPriceM }) =>
      api.put(`/api/pricing/${encodeURIComponent(args.model)}`, args.price),
    onSuccess: (_d, vars) => {
      message.success(`已保存 ${vars.model}`);
      setDraft(prev => {
        const next = { ...prev };
        delete next[vars.model];
        return next;
      });
      qc.invalidateQueries({ queryKey: ['pricing'] });
    },
    onError: (e: Error) => message.error(e.message),
  });

  const resetMut = useMutation({
    mutationFn: (model: string) =>
      api.delete(`/api/pricing/${encodeURIComponent(model)}`),
    onSuccess: (_d, model) => {
      message.success(`${model} 已恢复默认`);
      setDraft(prev => {
        const next = { ...prev };
        delete next[model];
        return next;
      });
      qc.invalidateQueries({ queryKey: ['pricing'] });
    },
    onError: (e: Error) => message.error(e.message),
  });

  const recomputeMut = useMutation({
    mutationFn: () => api.post<RecomputeResp>('/api/recompute-cost'),
    onSuccess: (r) => {
      message.success(`已重算 ${r.updatedSessions} 个会话，总成本 $${r.totalCostUsd.toFixed(2)}`);
      qc.invalidateQueries();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const startEdit = (row: ModelView) => {
    setDraft(prev => ({ ...prev, [row.model]: { ...row.price } }));
  };

  const updateDraft = (model: string, field: keyof ModelPriceM, val: number | null) => {
    if (val == null || !Number.isFinite(val) || val < 0) return;
    setDraft(prev => ({ ...prev, [model]: { ...prev[model], [field]: val } }));
  };

  const cancelDraft = (model: string) => {
    setDraft(prev => {
      const next = { ...prev };
      delete next[model];
      return next;
    });
  };

  const PriceCell = ({ row, field }: { row: ModelView; field: keyof ModelPriceM }) => {
    const editing = row.model in draft;
    const value = editing ? draft[row.model][field] : row.price[field];
    if (!editing) {
      const muted = row.source === 'unconfigured';
      return (
        <span style={{
          color: muted ? t.textMuted : t.textPrimary,
          fontVariantNumeric: 'tabular-nums',
        }}>${value}</span>
      );
    }
    return (
      <InputNumber
        size="small"
        min={0}
        step={0.01}
        value={value}
        onChange={(v) => updateDraft(row.model, field, v as number | null)}
        prefix="$"
        style={{ width: 100 }}
      />
    );
  };

  const columns = [
    {
      title: '模型',
      dataIndex: 'model',
      key: 'model',
      render: (model: string, row: ModelView) => {
        const tag = SOURCE_TAG[row.source];
        return (
          <Space size={6}>
            <span style={{ color: t.textPrimary, fontWeight: 500 }}>{model}</span>
            <Tag color={tag.color}>{tag.label}</Tag>
          </Space>
        );
      },
    },
    {
      title: '使用量',
      key: 'usage',
      render: (_: unknown, r: ModelView) => (
        <span style={{ color: t.textSecondary, fontVariantNumeric: 'tabular-nums' }}>
          {r.usage.messages.toLocaleString()} 条 · {formatTokens(r.usage.totalTokens)} tokens · ${r.usage.costUsd.toFixed(2)}
        </span>
      ),
    },
    { title: 'Input ($/M)',        key: 'input',       render: (_: unknown, r: ModelView) => <PriceCell row={r} field="input" /> },
    { title: 'Output ($/M)',       key: 'output',      render: (_: unknown, r: ModelView) => <PriceCell row={r} field="output" /> },
    { title: 'Cache Create ($/M)', key: 'cacheCreate', render: (_: unknown, r: ModelView) => <PriceCell row={r} field="cacheCreate" /> },
    { title: 'Cache Read ($/M)',   key: 'cacheRead',   render: (_: unknown, r: ModelView) => <PriceCell row={r} field="cacheRead" /> },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      render: (_: unknown, row: ModelView) => {
        const editing = row.model in draft;
        if (editing) {
          return (
            <Space>
              <Button
                type="primary"
                size="small"
                loading={saveMut.isPending && saveMut.variables?.model === row.model}
                onClick={() => saveMut.mutate({ model: row.model, price: draft[row.model] })}
              >保存</Button>
              <Button size="small" onClick={() => cancelDraft(row.model)}>取消</Button>
            </Space>
          );
        }
        return (
          <Space>
            <Button size="small" onClick={() => startEdit(row)}>
              {row.source === 'unconfigured' ? '设置价格' : '编辑'}
            </Button>
            {row.source === 'override' && (
              <Popconfirm
                title="恢复默认？"
                description="将删除该模型的覆盖配置"
                onConfirm={() => resetMut.mutate(row.model)}
              >
                <Button size="small" icon={<RollbackOutlined />}>恢复</Button>
              </Popconfirm>
            )}
            {row.source === 'custom' && (
              <Popconfirm
                title="删除自定义模型？"
                onConfirm={() => resetMut.mutate(row.model)}
              >
                <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  const handleAdd = async () => {
    const v = await form.validateFields();
    saveMut.mutate(
      {
        model: v.model.trim(),
        price: { input: v.input, output: v.output, cacheCreate: v.cacheCreate, cacheRead: v.cacheRead },
      },
      { onSuccess: () => { setAddOpen(false); form.resetFields(); } },
    );
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
        <Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>新增模型</Button>
        <Button
          type="primary"
          icon={<ReloadOutlined />}
          loading={recomputeMut.isPending}
          onClick={() => recomputeMut.mutate()}
        >重算历史成本</Button>
      </div>

      {unconfiguredCount > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`检测到 ${unconfiguredCount} 个模型未配置价格，当前回退到 ${fallbackModel} 的默认费率，建议手动设置。`}
        />
      )}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="新数据落库时自动使用当前规则；修改规则不影响已存入的成本，需要手动「重算历史成本」。"
      />

      <Card>
        <Table
          rowKey="model"
          loading={isLoading}
          dataSource={rows}
          columns={columns as never}
          pagination={false}
          size="middle"
          locale={{
            emptyText: <Empty description="还没有使用记录，先去刷新数据，或点「新增模型」预先配置价格" />,
          }}
        />
      </Card>

      <Modal
        title="新增模型计费"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={handleAdd}
        confirmLoading={saveMut.isPending}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          preserve={false}
          initialValues={{ input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }}
        >
          <Form.Item
            label="模型名"
            name="model"
            rules={[
              { required: true, message: '请输入模型名' },
              { pattern: /^[A-Za-z0-9._-]{1,64}$/, message: '只能包含字母、数字、. _ -，最长 64 字符' },
            ]}
          >
            <Input placeholder="例如 claude-sonnet-4-7" />
          </Form.Item>
          <Space size={12} wrap>
            {PRICE_FIELDS.map((f) => (
              <Form.Item
                key={f}
                label={`${f === 'cacheCreate' ? 'Cache Create' : f === 'cacheRead' ? 'Cache Read' : f.charAt(0).toUpperCase() + f.slice(1)} ($/M)`}
                name={f}
                rules={[{ required: true }]}
              >
                <InputNumber min={0} step={0.01} style={{ width: 160 }} prefix="$" />
              </Form.Item>
            ))}
          </Space>
        </Form>
      </Modal>
    </>
  );
}
