import { useEffect, useState } from 'react';
import { Card, Switch, Segmented, InputNumber, Space, Button, Alert, Tag, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';
import type { MonitorAlert, MonitorConfig } from '../../../shared/types.js';

const INTERVAL_OPTIONS = [
  { label: '1 分钟',  value: 1 },
  { label: '5 分钟',  value: 5 },
  { label: '15 分钟', value: 15 },
  { label: '30 分钟', value: 30 },
];

const COOLDOWN_OPTIONS = [
  { label: '15 分钟', value: 15 },
  { label: '1 小时',  value: 60 },
  { label: '4 小时',  value: 240 },
  { label: '24 小时', value: 1440 },
];

const STEP_PRESETS = [
  { label: '临界', value: '90,100', steps: [90, 100] },
  { label: '标准', value: '50,75,90,100', steps: [50, 75, 90, 100] },
  { label: '密集', value: '25,50,75,90,100', steps: [25, 50, 75, 90, 100] },
];

function encodeSteps(steps: number[]): string {
  const key = [...steps].sort((a, b) => a - b).join(',');
  return STEP_PRESETS.some(p => p.value === key) ? key : STEP_PRESETS[1].value;
}

export default function MonitorPane() {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const qc = useQueryClient();

  const settings = useQuery<MonitorConfig>({
    queryKey: ['monitor', 'settings'],
    queryFn:  () => api.get('/api/monitor/settings'),
  });
  const preview = useQuery<{ alerts: MonitorAlert[] }>({
    queryKey: ['monitor', 'preview'],
    queryFn:  () => api.get('/api/monitor/preview'),
    refetchInterval: 30_000,
  });
  const save = useMutation({
    mutationFn: (cfg: MonitorConfig) => api.put<MonitorConfig>('/api/monitor/settings', cfg),
    onSuccess:  (saved) => {
      qc.setQueryData(['monitor', 'settings'], saved);
      qc.invalidateQueries({ queryKey: ['monitor', 'preview'] });
    },
  });

  // Local draft so number inputs feel responsive without firing a PUT per keystroke.
  const [draft, setDraft] = useState<MonitorConfig | null>(null);
  useEffect(() => { if (settings.data) setDraft(settings.data); }, [settings.data]);

  if (!draft) return <Spin />;
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.data);

  const update = (patch: Partial<MonitorConfig>) => setDraft(d => d ? { ...d, ...patch } : d);
  const updateRule = <K extends keyof MonitorConfig['rules']>(
    key: K,
    patch: Partial<MonitorConfig['rules'][K]>,
  ) => setDraft(d => d ? { ...d, rules: { ...d.rules, [key]: { ...d.rules[key], ...patch } } } : d);

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Card>
        <Space direction="vertical" size={18} style={{ width: '100%' }}>
          <Row
            t={t}
            title="启用用量监控"
            desc="后台按设定间隔拉取最新数据并按规则触发系统通知。关闭后,服务进程不会再做后台扫描。"
            control={
              <Switch
                checked={draft.enabled}
                onChange={(v) => update({ enabled: v })}
                checkedChildren="开" unCheckedChildren="关"
              />
            }
          />
          <Row
            t={t}
            title="扫描间隔"
            desc="每隔多久跑一次扫描 + 规则评估。频率越高,越能及时捕到 Codex 限额尖刺,但也会更频繁读取 jsonl 文件。"
            control={
              <Segmented
                options={INTERVAL_OPTIONS}
                value={draft.intervalMinutes}
                onChange={(v) => update({ intervalMinutes: Number(v) })}
                disabled={!draft.enabled}
              />
            }
          />
          <Row
            t={t}
            title="同规则冷却"
            desc="同一条规则触发后,在该时间窗内不会再次发出通知,避免刷屏。"
            control={
              <Segmented
                options={COOLDOWN_OPTIONS}
                value={draft.cooldownMinutes}
                onChange={(v) => update({ cooldownMinutes: Number(v) })}
                disabled={!draft.enabled}
              />
            }
          />
        </Space>
      </Card>

      <Card title="告警规则">
        <Space direction="vertical" size={18} style={{ width: '100%' }}>
          <RuleRow
            t={t}
            title="Codex 5h 限额"
            desc="Codex 当前 5 小时窗口的 used_pct 达到阈值时触发。阈值设 95% 是接近触顶的提前预警。"
            enabled={draft.rules.codex5h.enabled}
            onEnabledChange={(v) => updateRule('codex5h', { enabled: v })}
            value={draft.rules.codex5h.thresholdPct}
            onValueChange={(v) => updateRule('codex5h', { thresholdPct: v })}
            unit="%" min={50} max={100} step={5}
          />
          <RuleRow
            t={t}
            title="Codex 7d 限额"
            desc="Codex 当前 7 天窗口的 used_pct 达到阈值时触发。"
            enabled={draft.rules.codex7d.enabled}
            onEnabledChange={(v) => updateRule('codex7d', { enabled: v })}
            value={draft.rules.codex7d.thresholdPct}
            onValueChange={(v) => updateRule('codex7d', { thresholdPct: v })}
            unit="%" min={50} max={100} step={5}
          />
          <RuleRow
            t={t}
            title="今日 Claude cost 阈值"
            desc="Claude 今日累计成本达到阶梯时触发,只统计 source=claude 的消息。"
            enabled={draft.rules.todayCostClaude.enabled}
            onEnabledChange={(v) => updateRule('todayCostClaude', { enabled: v })}
            value={draft.rules.todayCostClaude.thresholdUsd}
            onValueChange={(v) => updateRule('todayCostClaude', { thresholdUsd: v })}
            unit="$" min={1} max={1000} step={5}
            stepPercents={draft.rules.todayCostClaude.stepPercents}
            onStepPercentsChange={(v) => updateRule('todayCostClaude', { stepPercents: v })}
          />
          <RuleRow
            t={t}
            title="今日 Codex cost 阈值"
            desc="Codex 今日累计成本达到阶梯时触发。Codex 额度通常更宽松,阈值可设高一些。"
            enabled={draft.rules.todayCostCodex.enabled}
            onEnabledChange={(v) => updateRule('todayCostCodex', { enabled: v })}
            value={draft.rules.todayCostCodex.thresholdUsd}
            onValueChange={(v) => updateRule('todayCostCodex', { thresholdUsd: v })}
            unit="$" min={1} max={1000} step={5}
            stepPercents={draft.rules.todayCostCodex.stepPercents}
            onStepPercentsChange={(v) => updateRule('todayCostCodex', { stepPercents: v })}
          />
        </Space>
      </Card>

      <Card
        title="当前会触发"
        extra={
          <span style={{ fontSize: 11, color: t.textSecondary }}>
            按已保存的规则即时评估,不会发出系统通知
          </span>
        }
      >
        {preview.isLoading && <Spin size="small" />}
        {preview.data && preview.data.alerts.length === 0 && (
          <div style={{ fontSize: 12, color: t.textSecondary }}>当前没有命中的规则</div>
        )}
        {preview.data && preview.data.alerts.length > 0 && (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {preview.data.alerts.map(a => (
              <Alert
                key={a.ruleId}
                type="warning"
                showIcon
                message={
                  <span>
                    <Tag color="orange" style={{ marginInlineEnd: 8 }}>{a.ruleId}</Tag>
                    {a.title}
                  </span>
                }
                description={a.body}
              />
            ))}
          </Space>
        )}
      </Card>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button
          onClick={() => settings.data && setDraft(settings.data)}
          disabled={!dirty || save.isPending}
        >
          重置
        </Button>
        <Button
          type="primary"
          loading={save.isPending}
          disabled={!dirty}
          onClick={() => save.mutate(draft)}
        >
          保存
        </Button>
      </div>
    </Space>
  );
}

function Row({
  title, desc, control, t,
}: {
  title: string;
  desc: string;
  control: React.ReactNode;
  t: typeof TOKENS['light'];
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, color: t.textPrimary, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12, color: t.textSecondary }}>{desc}</div>
      </div>
      <div>{control}</div>
    </div>
  );
}

function RuleRow({
  t, title, desc, enabled, onEnabledChange, value, onValueChange, unit, min, max, step,
  stepPercents, onStepPercentsChange,
}: {
  t: typeof TOKENS['light'];
  title: string;
  desc: string;
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  value: number;
  onValueChange: (v: number) => void;
  unit: string;
  min: number;
  max: number;
  step: number;
  stepPercents?: number[];
  onStepPercentsChange?: (v: number[]) => void;
}) {
  const stepValue = stepPercents ? encodeSteps(stepPercents) : undefined;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, color: t.textPrimary, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12, color: t.textSecondary }}>{desc}</div>
        {stepPercents && (
          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 6 }}>
            阶梯: {[...stepPercents].sort((a, b) => a - b).map(v => `${v}%`).join(' / ')}
          </div>
        )}
      </div>
      <Space size={8} align="start">
        <Space direction="vertical" size={6} align="end">
          <InputNumber
            value={value}
            onChange={(v) => onValueChange(Number(v ?? min))}
            min={min} max={max} step={step}
            addonAfter={unit}
            style={{ width: 130 }}
            disabled={!enabled}
          />
          {stepPercents && onStepPercentsChange && (
            <Segmented
              size="small"
              options={STEP_PRESETS.map(p => ({ label: p.label, value: p.value }))}
              value={stepValue}
              disabled={!enabled}
              onChange={(v) => {
                const preset = STEP_PRESETS.find(p => p.value === v) ?? STEP_PRESETS[1];
                onStepPercentsChange(preset.steps);
              }}
            />
          )}
        </Space>
        <Switch
          checked={enabled}
          onChange={onEnabledChange}
          checkedChildren="开" unCheckedChildren="关"
        />
      </Space>
    </div>
  );
}
