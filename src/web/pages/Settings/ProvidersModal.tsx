import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Table, Button, Input, Form, Space, Tag, Popconfirm, message } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { api } from '../../api/client.js';
import { useI18n } from '../../i18n/index.js';

interface Provider {
  id: number; slug: string; displayName: string; isBuiltin: number; modelCount: number;
}

export default function ProvidersModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { t: tr } = useI18n();
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
      message.success(tr('providers.add.success'));
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
      message.success(tr('providers.rename.success'));
      setEditing(prev => { const n = { ...prev }; delete n[v.id]; return n; });
      qc.invalidateQueries({ queryKey: ['providers'] });
      qc.invalidateQueries({ queryKey: ['models'] });
    },
    onError: (e: Error) => message.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: number) => api.delete(`/api/providers/${id}`),
    onSuccess: () => {
      message.success(tr('providers.delete.success'));
      qc.invalidateQueries();
    },
    onError: (e: Error) => message.error(e.message),
  });

  return (
    <>
      <Modal
        title={tr('providers.title')}
        open={open}
        onCancel={onClose}
        footer={null}
        width={680}
        destroyOnClose
      >
        <div style={{ textAlign: 'right', marginBottom: 12 }}>
          <Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>{tr('providers.add')}</Button>
        </div>
        <Table<Provider>
          rowKey="id"
          loading={list.isLoading}
          dataSource={list.data ?? []}
          pagination={false}
          size="small"
          columns={[
            { title: tr('providers.col.slug'), dataIndex: 'slug', width: 130, render: (s, r) => (
              <Space size={6}>
                <code>{s}</code>
                {r.isBuiltin === 1 && <Tag color="default">{tr('providers.builtin')}</Tag>}
              </Space>
            ) },
            {
              title: tr('providers.col.displayName'), dataIndex: 'displayName',
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
            { title: tr('providers.col.modelCount'), dataIndex: 'modelCount', width: 80, align: 'right' },
            {
              title: tr('providers.col.actions'), width: 140, align: 'right',
              render: (_: unknown, row: Provider) => (
                <Space size={6}>
                  {editing[row.id] !== undefined && (
                    <Button size="small" type="primary"
                            onClick={() => renameMut.mutate({ id: row.id, displayName: editing[row.id] })}>
                      {tr('common.save')}
                    </Button>
                  )}
                  {row.isBuiltin === 0 && (
                    <Popconfirm
                      title={tr('providers.deleteTitle', { slug: row.slug })}
                      description={row.modelCount > 0
                        ? tr('providers.deleteWithModels', { n: row.modelCount })
                        : tr('providers.deleteConfirm')}
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
        title={tr('providers.add')}
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
              { required: true, message: tr('providers.slug.required') },
              { pattern: /^[a-z0-9-]{1,32}$/, message: tr('providers.slug.pattern') },
            ]}
            extra={tr('providers.slug.extra')}
          >
            <Input placeholder="deepseek" />
          </Form.Item>
          <Form.Item label={tr('providers.col.displayName')} name="displayName" rules={[{ required: true }]}>
            <Input placeholder="DeepSeek" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
