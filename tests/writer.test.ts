import { describe, it, expect } from 'vitest';
import { openDb } from '../src/server/db.js';
import { upsertProject, insertMessages, recomputeSession } from '../src/server/scanner/writer.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ParsedMessage } from '../src/shared/types.js';

function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-writer-'));
  const db = openDb(join(dir, 'usage.db'));
  return { db, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

const msg = (overrides: Partial<ParsedMessage>): ParsedMessage => ({
  messageId: 'm-1',
  sessionId: 's-1',
  parentUuid: null,
  role: 'assistant',
  model: 'claude-sonnet-4-6',
  timestamp: 1_700_000_000_000,
  inputTokens: 100,
  outputTokens: 200,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  reasoningTokens: 0,
  stopReason: 'end_turn',
  toolNames: ['Read'],
  textPreview: 'hello',
  source: 'claude',
  originator: null,
  cwdRealPath: null,
  ...overrides,
});

describe('writer', () => {
  it('an unknown model gets cost 0 and is auto-created under unknown provider', () => {
    const { db, cleanup } = makeDb();
    try {
      upsertProject(db, { projectDir: '/p', displayName: 'p', realPath: null });
      insertMessages(db, '/p', 's-1', [
        msg({ messageId: 'a', model: 'mystery-model', timestamp: 1 }),
      ]);
      const m = db.prepare(`SELECT cost_usd FROM messages WHERE message_id='a'`).get() as { cost_usd: number };
      expect(m.cost_usd).toBe(0);
      const r = db.prepare(
        `SELECT p.slug FROM models md JOIN providers p ON p.id=md.provider_id
         WHERE md.model_name='mystery-model'`,
      ).get() as { slug: string };
      expect(r.slug).toBe('unknown');
    } finally { cleanup(); }
  });

  it('inserts messages with computed cost and populates sessions on recompute', () => {
    const { db, cleanup } = makeDb();
    try {
      upsertProject(db, { projectDir: '/p', displayName: 'p', realPath: null });
      insertMessages(db, '/p', 's-1', [
        msg({ messageId: 'a', timestamp: 1 }),
        msg({ messageId: 'b', timestamp: 2, inputTokens: 50, outputTokens: 50 }),
      ]);
      recomputeSession(db, 's-1');
      const s = db.prepare('SELECT * FROM sessions WHERE session_id=?').get('s-1') as any;
      expect(s.message_count).toBe(2);
      expect(s.total_input).toBe(150);
      expect(s.total_output).toBe(250);
      expect(s.total_cost_usd).toBeGreaterThan(0);
    } finally { cleanup(); }
  });

  it('is idempotent on re-insert of same message_id', () => {
    const { db, cleanup } = makeDb();
    try {
      upsertProject(db, { projectDir: '/p', displayName: 'p', realPath: null });
      const m = msg({ messageId: 'x' });
      insertMessages(db, '/p', 's-1', [m]);
      insertMessages(db, '/p', 's-1', [m]);
      const n = (db.prepare('SELECT COUNT(*) as n FROM messages WHERE message_id=?').get('x') as any).n;
      expect(n).toBe(1);
    } finally { cleanup(); }
  });
});
