import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/server/db.js';
import { evaluateRules } from '../src/server/monitor/rules.js';
import { DEFAULT_MONITOR, mergeMonitorConfig } from '../src/server/monitor/storage.js';

function withDb(fn: (db: ReturnType<typeof openDb>) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-monitor-'));
  const db = openDb(join(dir, 'usage.db'));
  try {
    fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function insertTodayCost(db: ReturnType<typeof openDb>, source: 'claude' | 'codex', costUsd: number) {
  db.prepare(
    `INSERT INTO projects (project_dir, display_name, first_seen_at, last_seen_at)
     VALUES (?, ?, 0, 0)`,
  ).run(`p-${source}`, source);
  db.prepare(
    `INSERT INTO sessions (session_id, project_dir, started_at, ended_at, source)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(`s-${source}`, `p-${source}`, Date.now(), Date.now(), source);
  db.prepare(
    `INSERT INTO messages
       (message_id, session_id, role, model, timestamp,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
        cost_usd, source)
     VALUES (?, ?, 'assistant', ?, ?, 0, 0, 0, 0, ?, ?)`,
  ).run(`m-${source}`, `s-${source}`, source === 'claude' ? 'claude-sonnet-4-6' : 'gpt-5', Date.now(), costUsd, source);
}

describe('monitor cost ladder rules', () => {
  it('fires only the highest reached cost step', () => withDb((db) => {
    insertTodayCost(db, 'claude', 76);
    const cfg = mergeMonitorConfig({
      rules: {
        todayCostClaude: { enabled: true, thresholdUsd: 100, stepPercents: [50, 75, 90, 100] },
        todayCostCodex: { enabled: false, thresholdUsd: 100, stepPercents: [50, 75, 90, 100] },
        codex5h: { enabled: false, thresholdPct: 95 },
        codex7d: { enabled: false, thresholdPct: 95 },
      },
    });

    const alerts = evaluateRules(db, cfg);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].ruleId).toBe('todayCostClaude:75');
    expect(alerts[0].body).toContain('75%');
  }));

  it('keeps old cost configs compatible by adding default steps', () => {
    const cfg = mergeMonitorConfig({
      rules: {
        todayCostClaude: { enabled: true, thresholdUsd: 42 } as any,
      },
    });

    expect(cfg.rules.todayCostClaude.stepPercents).toEqual([50, 75, 90, 100]);
    expect(cfg.rules.todayCostCodex.stepPercents).toEqual(DEFAULT_MONITOR.rules.todayCostCodex.stepPercents);
  });
});
