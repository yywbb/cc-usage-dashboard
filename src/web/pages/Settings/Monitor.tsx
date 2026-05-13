import { useEffect, useState } from 'react';
import { Card, Switch, Segmented, InputNumber, Space, Button, Alert, Tag, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useTheme } from '../../theme/useTheme.js';
import { TOKENS } from '../../theme/tokens.js';
import type { MonitorAlert, MonitorConfig } from '../../../shared/types.js';
import { useI18n } from '../../i18n/index.js';

const STEP_PRESETS = [
  { labelKey: 'monitor.preset.critical' as const, value: '90,100', steps: [90, 100] },
  { labelKey: 'monitor.preset.standard' as const, value: '50,75,90,100', steps: [50, 75, 90, 100] },
  { labelKey: 'monitor.preset.dense' as const,    value: '25,50,75,90,100', steps: [25, 50, 75, 90, 100] },
];

function encodeSteps(steps: number[]): string {
  const key = [...steps].sort((a, b) => a - b).join(',');
  return STEP_PRESETS.some(p => p.value === key) ? key : STEP_PRESETS[1].value;
}

export default function MonitorPane() {
  const { mode } = useTheme();
  const t = TOKENS[mode];
  const { t: tr } = useI18n();
  const qc = useQueryClient();

  const intervalOptions = [
    { label: tr('monitor.interval.1m'),  value: 1 },
    { label: tr('monitor.interval.5m'),  value: 5 },
    { label: tr('monitor.interval.15m'), value: 15 },
    { label: tr('monitor.interval.30m'), value: 30 },
  ];

  const cooldownOptions = [
    { label: tr('monitor.cooldown.15m'), value: 15 },
    { label: tr('monitor.cooldown.1h'),  value: 60 },
    { label: tr('monitor.cooldown.4h'),  value: 240 },
    { label: tr('monitor.cooldown.24h'), value: 1440 },
  ];

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
            title={tr('monitor.row.enable.title')}
            desc={tr('monitor.row.enable.desc')}
            control={
              <Switch
                checked={draft.enabled}
                onChange={(v) => update({ enabled: v })}
                checkedChildren={tr('monitor.switch.on')}
                unCheckedChildren={tr('monitor.switch.off')}
              />
            }
          />
          <Row
            t={t}
            title={tr('monitor.row.interval.title')}
            desc={tr('monitor.row.interval.desc')}
            control={
              <Segmented
                options={intervalOptions}
                value={draft.intervalMinutes}
                onChange={(v) => update({ intervalMinutes: Number(v) })}
                disabled={!draft.enabled}
              />
            }
          />
          <Row
            t={t}
            title={tr('monitor.row.cooldown.title')}
            desc={tr('monitor.row.cooldown.desc')}
            control={
              <Segmented
                options={cooldownOptions}
                value={draft.cooldownMinutes}
                onChange={(v) => update({ cooldownMinutes: Number(v) })}
                disabled={!draft.enabled}
              />
            }
          />
        </Space>
      </Card>

      <Card title={tr('monitor.rulesTitle')}>
        <Space direction="vertical" size={18} style={{ width: '100%' }}>
          <RuleRow
            t={t}
            title={tr('monitor.rule.codex5h.title')}
            desc={tr('monitor.rule.codex5h.desc')}
            enabled={draft.rules.codex5h.enabled}
            onEnabledChange={(v) => updateRule('codex5h', { enabled: v })}
            value={draft.rules.codex5h.thresholdPct}
            onValueChange={(v) => updateRule('codex5h', { thresholdPct: v })}
            unit="%" min={50} max={100} step={5}
          />
          <RuleRow
            t={t}
            title={tr('monitor.rule.codex7d.title')}
            desc={tr('monitor.rule.codex7d.desc')}
            enabled={draft.rules.codex7d.enabled}
            onEnabledChange={(v) => updateRule('codex7d', { enabled: v })}
            value={draft.rules.codex7d.thresholdPct}
            onValueChange={(v) => updateRule('codex7d', { thresholdPct: v })}
            unit="%" min={50} max={100} step={5}
          />
          <RuleRow
            t={t}
            title={tr('monitor.rule.todayCostClaude.title')}
            desc={tr('monitor.rule.todayCostClaude.desc')}
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
            title={tr('monitor.rule.todayCostCodex.title')}
            desc={tr('monitor.rule.todayCostCodex.desc')}
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
        title={tr('monitor.preview.title')}
        extra={
          <span style={{ fontSize: 11, color: t.textSecondary }}>
            {tr('monitor.preview.subtitle')}
          </span>
        }
      >
        {preview.isLoading && <Spin size="small" />}
        {preview.data && preview.data.alerts.length === 0 && (
          <div style={{ fontSize: 12, color: t.textSecondary }}>{tr('monitor.preview.none')}</div>
        )}
        {preview.data && preview.data.alerts.length > 0 && (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {preview.data.alerts.map(a => {
              const title = a.titleKey ? tr(a.titleKey, a.vars) : a.title;
              const body  = a.bodyKey  ? tr(a.bodyKey,  a.vars) : a.body;
              return (
                <Alert
                  key={a.ruleId}
                  type="warning"
                  showIcon
                  message={
                    <span>
                      <Tag color="orange" style={{ marginInlineEnd: 8 }}>{a.ruleId}</Tag>
                      {title}
                    </span>
                  }
                  description={body}
                />
              );
            })}
          </Space>
        )}
      </Card>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button
          onClick={() => settings.data && setDraft(settings.data)}
          disabled={!dirty || save.isPending}
        >
          {tr('common.reset')}
        </Button>
        <Button
          type="primary"
          loading={save.isPending}
          disabled={!dirty}
          onClick={() => save.mutate(draft)}
        >
          {tr('common.save')}
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
  const { t: tr } = useI18n();
  const stepValue = stepPercents ? encodeSteps(stepPercents) : undefined;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, color: t.textPrimary, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12, color: t.textSecondary }}>{desc}</div>
        {stepPercents && (
          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 6 }}>
            {tr('monitor.ladder', { value: [...stepPercents].sort((a, b) => a - b).map(v => `${v}%`).join(' / ') })}
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
              options={STEP_PRESETS.map(p => ({ label: tr(p.labelKey), value: p.value }))}
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
          checkedChildren={tr('monitor.switch.on')}
          unCheckedChildren={tr('monitor.switch.off')}
        />
      </Space>
    </div>
  );
}
