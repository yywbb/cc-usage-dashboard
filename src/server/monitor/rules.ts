import type { Database as DatabaseType } from 'better-sqlite3';
import type { MonitorAlert, MonitorConfig } from '../../shared/types.js';

interface LatestRateLimit {
  primary:   number | null;
  secondary: number | null;
}

function latestCodexRateLimit(db: DatabaseType): LatestRateLimit {
  const row = db.prepare(
    `SELECT primary_used_pct as primary, secondary_used_pct as secondary
     FROM codex_rate_limit_snapshots
     ORDER BY observed_at DESC
     LIMIT 1`,
  ).get() as LatestRateLimit | undefined;
  return row ?? { primary: null, secondary: null };
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
  rule: { enabled: boolean; thresholdUsd: number },
  ruleId: keyof MonitorConfig['rules'],
): MonitorAlert | null {
  if (!rule.enabled) return null;
  const cost = todayCostUsdBySource(db, source);
  if (cost < rule.thresholdUsd) return null;
  return {
    ruleId,
    title: `今日 ${SOURCE_LABEL[source]} cost 告警`,
    body:  `${SOURCE_LABEL[source]} 今日已消耗 $${cost.toFixed(2)} ≥ 阈值 $${rule.thresholdUsd.toFixed(2)}`,
  };
}

export function evaluateRules(db: DatabaseType, cfg: MonitorConfig): MonitorAlert[] {
  const out: MonitorAlert[] = [];

  if (cfg.rules.codex5h.enabled || cfg.rules.codex7d.enabled) {
    const rl = latestCodexRateLimit(db);
    const r5 = cfg.rules.codex5h;
    if (r5.enabled && rl.primary != null && rl.primary >= r5.thresholdPct) {
      out.push({
        ruleId: 'codex5h',
        title:  'Codex 5h 限额告警',
        body:   `当前 ${rl.primary.toFixed(1)}% ≥ 阈值 ${r5.thresholdPct}%`,
      });
    }
    const r7 = cfg.rules.codex7d;
    if (r7.enabled && rl.secondary != null && rl.secondary >= r7.thresholdPct) {
      out.push({
        ruleId: 'codex7d',
        title:  'Codex 7d 限额告警',
        body:   `当前 ${rl.secondary.toFixed(1)}% ≥ 阈值 ${r7.thresholdPct}%`,
      });
    }
  }

  const claudeAlert = evalTodayCost(db, 'claude', cfg.rules.todayCostClaude, 'todayCostClaude');
  if (claudeAlert) out.push(claudeAlert);
  const codexAlert  = evalTodayCost(db, 'codex',  cfg.rules.todayCostCodex,  'todayCostCodex');
  if (codexAlert)  out.push(codexAlert);

  return out;
}
