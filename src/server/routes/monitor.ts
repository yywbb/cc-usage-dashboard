import type { FastifyInstance } from 'fastify';
import type { DatabaseType } from '../db.js';
import type { MonitorConfig } from '../../shared/types.js';
import { loadMonitorConfig, saveMonitorConfig, mergeMonitorConfig, normalizeCostSteps } from '../monitor/storage.js';
import { evaluateRules } from '../monitor/rules.js';
import type { Monitor } from '../monitor/index.js';

export interface MonitorDeps {
  db:       DatabaseType;
  monitor?: Monitor;
}

function clampConfig(cfg: MonitorConfig): MonitorConfig {
  return {
    ...cfg,
    // Bound the interval/cooldown so a misconfigured payload can't peg the CPU
    // or disable cooldowns entirely.
    intervalMinutes: Math.min(1440, Math.max(1, Math.round(cfg.intervalMinutes))),
    cooldownMinutes: Math.min(1440, Math.max(1, Math.round(cfg.cooldownMinutes))),
    rules: {
      ...cfg.rules,
      todayCostClaude: {
        ...cfg.rules.todayCostClaude,
        thresholdUsd: Math.max(0, cfg.rules.todayCostClaude.thresholdUsd),
        stepPercents: normalizeCostSteps(cfg.rules.todayCostClaude.stepPercents),
      },
      todayCostCodex: {
        ...cfg.rules.todayCostCodex,
        thresholdUsd: Math.max(0, cfg.rules.todayCostCodex.thresholdUsd),
        stepPercents: normalizeCostSteps(cfg.rules.todayCostCodex.stepPercents),
      },
    },
  };
}

export function registerMonitor(app: FastifyInstance, deps: MonitorDeps) {
  app.get('/api/monitor/settings', async () => loadMonitorConfig(deps.db));

  app.put('/api/monitor/settings', async (req) => {
    const incoming = req.body as Partial<MonitorConfig>;
    const merged = clampConfig(mergeMonitorConfig(incoming));
    saveMonitorConfig(deps.db, merged);
    deps.monitor?.reconfigure();
    return merged;
  });

  /** Evaluate the current rule set against the DB without firing notifications. */
  app.get('/api/monitor/preview', async () => {
    const cfg = loadMonitorConfig(deps.db);
    return { alerts: evaluateRules(deps.db, cfg) };
  });
}
