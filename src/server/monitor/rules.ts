import type { DatabaseType } from '../db.js';
import type { CostMonitorRule, MonitorAlert, MonitorConfig } from '../../shared/types.js';

interface LatestRateLimit {
  primaryPct:   number | null;
  secondaryPct: number | null;
}

function latestCodexRateLimit(db: DatabaseType): LatestRateLimit {
  // `primary` / `secondary` are SQLite reserved words and can't be used as
  // bare column aliases — quote-or-rename. Going with renamed aliases.
  const row = db.prepare(
    `SELECT primary_used_pct   as primaryPct,
            secondary_used_pct as secondaryPct
     FROM codex_rate_limit_snapshots
     ORDER BY observed_at DESC
     LIMIT 1`,
  ).get() as LatestRateLimit | undefined;
  return row ?? { primaryPct: null, secondaryPct: null };
}

function todayCostUsdBySource(db: DatabaseType, source: 'claude' | 'codex'): number {
  const row = db.prepare(
    `SELECT COALESCE(SUM(cost_usd), 0) as cost
     FROM messages
     WHERE source = ?
       AND date(timestamp/1000, 'unixepoch', 'localtime')
         = date('now', 'localtime')`,
  ).get(source) as { cost: number };
  return row.cost;
}

const SOURCE_LABEL: Record<'claude' | 'codex', string> = {
  claude: 'Claude',
  codex:  'Codex',
};

function evalTodayCost(
  db: DatabaseType,
  source: 'claude' | 'codex',
  rule: CostMonitorRule,
  ruleId: keyof MonitorConfig['rules'],
): MonitorAlert | null {
  if (!rule.enabled) return null;
  if (rule.thresholdUsd <= 0) return null;
  const cost = todayCostUsdBySource(db, source);
  const usedPct = (cost / rule.thresholdUsd) * 100;
  const reachedStep = [...rule.stepPercents]
    .sort((a, b) => b - a)
    .find(step => usedPct >= step);
  if (reachedStep === undefined) return null;
  const stepUsd = rule.thresholdUsd * reachedStep / 100;
  const final = reachedStep >= 100;
  const label = SOURCE_LABEL[source];
  const vars = {
    source: label,
    cost:      cost.toFixed(2),
    threshold: rule.thresholdUsd.toFixed(2),
    pct:       usedPct.toFixed(1),
    step:      reachedStep,
    stepUsd:   stepUsd.toFixed(2),
  };
  return {
    ruleId: `${ruleId}:${reachedStep}`,
    title: `今日 ${label} cost ${final ? '阈值告警' : '阶梯提醒'}`,
    body:  `${label} 今日已消耗 $${cost.toFixed(2)} / $${rule.thresholdUsd.toFixed(2)} (${usedPct.toFixed(1)}%), 已达到 ${reachedStep}% 阶梯 ($${stepUsd.toFixed(2)})`,
    titleKey: final ? 'monitor.alert.todayCost.threshold' : 'monitor.alert.todayCost.ladder',
    bodyKey:  'monitor.alert.todayCost.body',
    vars,
  };
}

export function evaluateRules(db: DatabaseType, cfg: MonitorConfig): MonitorAlert[] {
  const out: MonitorAlert[] = [];

  if (cfg.rules.codex5h.enabled || cfg.rules.codex7d.enabled) {
    const rl = latestCodexRateLimit(db);
    const r5 = cfg.rules.codex5h;
    if (r5.enabled && rl.primaryPct != null && rl.primaryPct >= r5.thresholdPct) {
      out.push({
        ruleId: 'codex5h',
        title:  'Codex 5h 限额告警',
        body:   `当前 ${rl.primaryPct.toFixed(1)}% ≥ 阈值 ${r5.thresholdPct}%`,
        titleKey: 'monitor.alert.codex5h.title',
        bodyKey:  'monitor.alert.codexRate.body',
        vars:     { actual: rl.primaryPct.toFixed(1), threshold: r5.thresholdPct },
      });
    }
    const r7 = cfg.rules.codex7d;
    if (r7.enabled && rl.secondaryPct != null && rl.secondaryPct >= r7.thresholdPct) {
      out.push({
        ruleId: 'codex7d',
        title:  'Codex 7d 限额告警',
        body:   `当前 ${rl.secondaryPct.toFixed(1)}% ≥ 阈值 ${r7.thresholdPct}%`,
        titleKey: 'monitor.alert.codex7d.title',
        bodyKey:  'monitor.alert.codexRate.body',
        vars:     { actual: rl.secondaryPct.toFixed(1), threshold: r7.thresholdPct },
      });
    }
  }

  const claudeAlert = evalTodayCost(db, 'claude', cfg.rules.todayCostClaude, 'todayCostClaude');
  if (claudeAlert) out.push(claudeAlert);
  const codexAlert  = evalTodayCost(db, 'codex',  cfg.rules.todayCostCodex,  'todayCostCodex');
  if (codexAlert)  out.push(codexAlert);

  return out;
}
