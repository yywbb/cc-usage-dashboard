import type { DatabaseType } from '../db.js';
import type { CostMonitorRule, MonitorConfig, MonitorRules } from '../../shared/types.js';

const KEY = 'monitor';
export const DEFAULT_COST_STEPS = [50, 75, 90, 100];

export const DEFAULT_MONITOR: MonitorConfig = {
  enabled:         false,
  intervalMinutes: 5,
  cooldownMinutes: 60,
  rules: {
    codex5h:         { enabled: true,  thresholdPct: 95 },
    codex7d:         { enabled: true,  thresholdPct: 95 },
    todayCostClaude: { enabled: false, thresholdUsd: 20, stepPercents: DEFAULT_COST_STEPS },
    todayCostCodex:  { enabled: false, thresholdUsd: 50, stepPercents: DEFAULT_COST_STEPS },
  },
};

export function normalizeCostSteps(value: unknown): number[] {
  const raw = Array.isArray(value) ? value : DEFAULT_COST_STEPS;
  const steps = [...new Set(
    raw
      .map(v => Math.round(Number(v)))
      .filter(v => Number.isFinite(v) && v > 0 && v <= 100),
  )].sort((a, b) => a - b);
  if (!steps.includes(100)) steps.push(100);
  return steps.length > 0 ? steps : DEFAULT_COST_STEPS;
}

function mergeCostRule(defaultRule: CostMonitorRule, incoming: Partial<CostMonitorRule> | undefined): CostMonitorRule {
  return {
    ...defaultRule,
    ...(incoming ?? {}),
    stepPercents: normalizeCostSteps(incoming?.stepPercents ?? defaultRule.stepPercents),
  };
}

type PartialMonitorConfig = Partial<Omit<MonitorConfig, 'rules'>> & {
  rules?: Partial<MonitorRules>;
};

export function mergeMonitorConfig(parsed: PartialMonitorConfig): MonitorConfig {
  const rules = parsed.rules ?? {};
  return {
    ...DEFAULT_MONITOR,
    ...parsed,
    rules: {
      ...DEFAULT_MONITOR.rules,
      ...rules,
      todayCostClaude: mergeCostRule(DEFAULT_MONITOR.rules.todayCostClaude, rules.todayCostClaude),
      todayCostCodex: mergeCostRule(DEFAULT_MONITOR.rules.todayCostCodex, rules.todayCostCodex),
    },
  };
}

/**
 * Load with deep-merge against defaults so a partially-populated row from
 * an older client (e.g. before a new rule was added) still produces a valid
 * config instead of throwing on a missing field.
 */
export function loadMonitorConfig(db: DatabaseType): MonitorConfig {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(KEY) as { value: string } | undefined;
  if (!row) return DEFAULT_MONITOR;
  try {
    const parsed = JSON.parse(row.value) as Partial<MonitorConfig>;
    return mergeMonitorConfig(parsed);
  } catch {
    return DEFAULT_MONITOR;
  }
}

export function saveMonitorConfig(db: DatabaseType, cfg: MonitorConfig): void {
  db.prepare(
    `INSERT INTO app_settings(key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(KEY, JSON.stringify(cfg), Date.now());
}
