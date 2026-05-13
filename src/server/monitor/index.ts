import type { DatabaseType } from '../db.js';
import { scanAll } from '../scanner/index.js';
import { loadMonitorConfig } from './storage.js';
import { evaluateRules } from './rules.js';
import { notifyDesktop } from './notify.js';
import type { MonitorAlert } from '../../shared/types.js';

const MIN_INTERVAL_MS = 60_000;

export interface Monitor {
  /** Re-read config from DB and reset the interval timer. Idempotent. */
  reconfigure(): void;
  /** Run scan + rule evaluation immediately (used after config save & on startup). */
  runOnce(): Promise<void>;
  stop(): void;
}

export function createMonitor(db: DatabaseType, projectsRoot: string): Monitor {
  let timer: ReturnType<typeof setInterval> | null = null;
  // Per-rule cooldown — keyed by rule id, value = last fired ms.
  // In-memory only; resets on server restart, which is acceptable: a restart is
  // a meaningful state change and the user would want to see the alert again.
  const lastFired = new Map<string, number>();
  let running = false;

  async function tick(): Promise<void> {
    if (running) return; // skip if a slow tick overlaps the next interval fire
    running = true;
    try {
      const cfg = loadMonitorConfig(db);
      if (!cfg.enabled) return;
      try {
        scanAll(db, projectsRoot, { source: 'all' });
      } catch (err) {
        console.warn('[monitor] scan failed:', (err as Error).message);
        // Continue to rule evaluation against existing data anyway.
      }
      const alerts = evaluateRules(db, cfg);
      const now = Date.now();
      const cooldownMs = Math.max(0, cfg.cooldownMinutes) * 60_000;
      for (const a of alerts) {
        const last = lastFired.get(a.ruleId) ?? 0;
        if (now - last < cooldownMs) continue;
        lastFired.set(a.ruleId, now);
        await notifyDesktop(a satisfies MonitorAlert);
      }
    } finally {
      running = false;
    }
  }

  function reconfigure(): void {
    if (timer) { clearInterval(timer); timer = null; }
    const cfg = loadMonitorConfig(db);
    if (!cfg.enabled) return;
    const intervalMs = Math.max(MIN_INTERVAL_MS, cfg.intervalMinutes * 60_000);
    timer = setInterval(() => { void tick(); }, intervalMs);
  }

  return {
    reconfigure,
    runOnce: tick,
    stop:    () => { if (timer) { clearInterval(timer); timer = null; } },
  };
}
