import type { Database as DatabaseType } from 'better-sqlite3';
import type { MonitorConfig } from '../../shared/types.js';

const KEY = 'monitor';

export const DEFAULT_MONITOR: MonitorConfig = {
  enabled:         false,
  intervalMinutes: 5,
  cooldownMinutes: 60,
  rules: {
    codex5h:         { enabled: true,  thresholdPct: 95 },
    codex7d:         { enabled: true,  thresholdPct: 95 },
    todayCostClaude: { enabled: false, thresholdUsd: 20 },
    todayCostCodex:  { enabled: false, thresholdUsd: 50 },
  },
};

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
    return {
      ...DEFAULT_MONITOR,
      ...parsed,
      rules: { ...DEFAULT_MONITOR.rules, ...(parsed.rules ?? {}) },
    };
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
