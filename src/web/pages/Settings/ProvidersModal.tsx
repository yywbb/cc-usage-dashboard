import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Table, Button, Input, Form, Space, Tag, Popconfirm, message } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { api } from '../../api/client.js';

interface Provider {
  id: number; slug: string; displayName: string; isBuiltin: number; modelCount: number;
}

export default function ProvidersModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [form] = Form.useForm<{ slug: string; displayName: string }>();
  const [editing, setEditing] = useState<Record<number, string>>({});

  const list = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.get<Provider[]>('/api/providers'),
    enabled: open,
  });

  const addMut = useMutation({
    mutationFn: (v: { slug: string; displayName: string }) => api.post<Provider>('/api/providers', v),
    onSuccess: () => {
      message.success('已新增供应商');
      setAddOpen(false); form.resetFields();
      qc.invalidateQueries({ queryKey: ['providers'] });
      qc.invalidateQueries({ queryKey: ['models'] });
    },
    onError: (e: Error) => message.error(e.message),
  });

  const renameMut = useMutation({
    mutationFn: (v: { id: number; displayName: string }) =>
      api.patch(`/api/providers/${v.id}`, { displayName: v.displayName }),
    onSuccess: (_d, v) => {
      message.success('已更新');
      setEditing(prev => { const n = { ...prev }; delete n[v.id]; return n; });
      qc.invalidateQueries({ queryKey: ['providers'] });
      qc.invalidateQueries({ queryKey: ['models'] });
    },
    onError: (e: Error) => message.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: number) => api.delete(`/api/providers/${id}`),
    onSuccess: () => {
      message.success('已删除供应商，旗下模型已转移到 Unknown，建议重算成本');
      qc.invalidateQueries();
    },
    onError: (e: Error) => message.error(e.message),
  });

  return (
    <>
      <Modal
        title="管理供应商"
        open={open}
        onCancel={onClose}
        footer={null}
        width={680}
        destroyOnClose
      >
        <div style={{ textAlign: 'right', marginBottom: 12 }}>
          <Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>新增供应商</Button>
        </div>
        <Table<Provider>
          rowKey="id"
          loading={list.isLoading}
          dataSource={list.data ?? []}
          pagination={false}
          size="small"
          columns={[
            { title: 'Slug', dataIndex: 'slug', width: 130, render: (s, r) => (
              <Space size={6}>
                <code>{s}</code>
                {r.isBuiltin === 1 && <Tag color="default">内置</Tag>}
              </Space>
            ) },
            {
              title: '显示名', dataIndex: 'displayName',
              render: (v: string, row: Provider) => editing[row.id] !== undefined ? (
                <Input
                  size="small"
                  value={editing[row.id]}
                  onChange={(e) => setEditing(prev => ({ ...prev, [row.id]: e.target.value }))}
                  onPressEnter={() => renameMut.mutate({ id: row.id, displayName: editing[row.id] })}
                  style={{ width: 200 }}
                />
              ) : (
                <span style={{ cursor: 'pointer' }}
                      onClick={() => setEditing(prev => ({ ...prev, [row.id]: v }))}>
                  {v}
                </span>
              ),
            },
            { title: '模型数', dataIndex: 'modelCount', width: 80, align: 'right' },
            {
              title: '操作', width: 140, align: 'right',
              render: (_: unknown, row: Provider) => (
                <Space size={6}>
                  {editing[row.id] !== undefined && (
                    <Button size="small" type="primary"
                            onClick={() => renameMut.mutate({ id: row.id, displayName: editing[row.id] })}>
                      保存
                    </Button>
                  )}
                  {row.isBuiltin === 0 && (
                    <Popconfirm
                      title={`删除 ${row.slug}？`}
                      description={row.modelCount > 0
                        ? `该供应商下有 ${row.modelCount} 个模型，删除后会转移到 Unknown。`
                        : '确认删除？'}
                      onConfirm={() => delMut.mutate(row.id)}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        title="新增供应商"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={async () => {
          const v = await form.validateFields();
          addMut.mutate(v);
        }}
        confirmLoading={addMut.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            label="Slug"
            name="slug"
            rules={[
              { required: true, message: '请输入 slug' },
              { pattern: /^[a-z0-9-]{1,32}$/, message: '只能小写字母、数字与连字符' },
            ]}
            extra="用于内部标识，例如 deepseek、glm。最长 32 字符。"
          >
            <Input placeholder="deepseek" />
          </Form.Item>
          <Form.Item label="显示名" name="displayName" rules={[{ required: true }]}>
            <Input placeholder="DeepSeek" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
