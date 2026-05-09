import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Table, Button, InputNumber, DatePicker, Modal, Form, Input,
  Popconfirm, Space, Empty, message, Row, Col, Tag,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, EditOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { api } from '../../api/client.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';

interface Window {
  id: number;
  effectiveFrom: string;
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  note: string | null;
}

interface PricingHistoryResponse {
  model: string;
  windows: Window[];
  defaultFallback: { input: number; output: number; cacheCreate: number; cacheRead: number } | null;
}

interface FormValues {
  effectiveFrom: Dayjs;
  input: number; output: number; cacheCreate: number; cacheRead: number;
  note?: string;
}

export default function PricingHistoryTable({ model }: { model: string }) {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Window | null>(null);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const { data, isLoading } = useQuery({
    queryKey: ['pricing-history', model],
    queryFn: () => api.get<PricingHistoryResponse>(`/api/pricing/${encodeURIComponent(model)}`),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['pricing-history', model] });
    qc.invalidateQueries({ queryKey: ['models'] });
  };

  const createMut = useMutation({
    mutationFn: (v: FormValues) => api.post(`/api/pricing/${encodeURIComponent(model)}`, {
      effectiveFrom: v.effectiveFrom.format('YYYY-MM-DD'),
      input: v.input, output: v.output, cacheCreate: v.cacheCreate, cacheRead: v.cacheRead,
      note: v.note ?? null,
    }),
    onSuccess: () => { message.success('已添加'); setCreating(false); form.resetFields(); invalidate(); },
    onError: (e: Error) => message.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: (v: FormValues & { id: number }) => api.patch(`/api/pricing/${v.id}`, {
      effectiveFrom: v.effectiveFrom.format('YYYY-MM-DD'),
      input: v.input, output: v.output, cacheCreate: v.cacheCreate, cacheRead: v.cacheRead,
      note: v.note ?? null,
    }),
    onSuccess: () => { message.success('已更新'); setEditing(null); form.resetFields(); invalidate(); },
    onError: (e: Error) => message.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/api/pricing/${id}`),
    onSuccess: () => { message.success('已删除'); invalidate(); },
    onError: (e: Error) => message.error(e.message),
  });

  const today = dayjs().format('YYYY-MM-DD');
  const rows = data?.windows ?? [];

  // Active window = latest window whose effectiveFrom <= today.
  const activeId = rows
    .filter(r => r.effectiveFrom <= today)
    .reduce<number | null>((best, r) => {
      if (best == null) return r.id;
      const bestRow = rows.find(x => x.id === best)!;
      return r.effectiveFrom > bestRow.effectiveFrom ? r.id : best;
    }, null);

  const submit = async () => {
    const v = await form.validateFields();
    if (editing) updateMut.mutate({ ...v, id: editing.id });
    else createMut.mutate(v);
  };

  return (
    <div style={{
      borderLeft: `3px solid ${t.primary}`,
      paddingLeft: 16, paddingTop: 12, paddingBottom: 12, paddingRight: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <strong style={{ color: t.textPrimary }}>价格历史</strong>
        <Button size="small" type="primary" ghost icon={<PlusOutlined />} onClick={() => {
          setEditing(null);
          setCreating(true);
          form.resetFields();
          form.setFieldsValue({ effectiveFrom: dayjs(), input: 0, output: 0, cacheCreate: 0, cacheRead: 0 });
        }}>新增调价</Button>
      </div>

      <Table<Window>
        size="small"
        rowKey="id"
        loading={isLoading}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: <Empty description={data?.defaultFallback ? '尚无窗口，使用内置默认价' : '尚无窗口'} /> }}
        columns={[
          {
            title: '生效日期', dataIndex: 'effectiveFrom', width: 150,
            render: (v: string, row: Window) => {
              const future = v > today;
              const isActive = row.id === activeId;
              return (
                <Space size={6} style={{ fontVariantNumeric: 'tabular-nums', opacity: future ? 0.6 : 1 }}>
                  {isActive && <ThunderboltOutlined style={{ color: t.success }} />}
                  <span style={{ fontWeight: isActive ? 600 : 400, color: isActive ? t.success : undefined }}>
                    {v}
                  </span>
                  {future && <Tag color="default">待生效</Tag>}
                </Space>
              );
            },
          },
          { title: 'Input',  dataIndex: 'input',       width: 90, align: 'right',
            render: (v) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>${v}</span> },
          { title: 'Output', dataIndex: 'output',      width: 90, align: 'right',
            render: (v) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>${v}</span> },
          { title: 'CC',     dataIndex: 'cacheCreate', width: 80, align: 'right',
            render: (v) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>${v}</span> },
          { title: 'CR',     dataIndex: 'cacheRead',   width: 80, align: 'right',
            render: (v) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>${v}</span> },
          { title: '备注',   dataIndex: 'note',
            render: (v: string | null) => v ?? <span style={{ color: t.textMuted }}>—</span> },
          {
            title: '操作', width: 90, align: 'right',
            render: (_: unknown, row: Window) => (
              <Space size={2}>
                <Button size="small" type="text" icon={<EditOutlined />} onClick={() => {
                  setCreating(false);
                  setEditing(row);
                  form.setFieldsValue({
                    effectiveFrom: dayjs(row.effectiveFrom),
                    input: row.input, output: row.output,
                    cacheCreate: row.cacheCreate, cacheRead: row.cacheRead,
                    note: row.note ?? undefined,
                  });
                }} />
                <Popconfirm title="删除该窗口？" onConfirm={() => deleteMut.mutate(row.id)}>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? '编辑价格窗口' : '新增价格调整'}
        open={creating || editing !== null}
        onCancel={() => { setCreating(false); setEditing(null); form.resetFields(); }}
        onOk={submit}
        confirmLoading={createMut.isPending || updateMut.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
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
          <Form.Item label="备注" name="note">
            <Input.TextArea rows={2} placeholder="可选：说明调价原因或来源链接" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
