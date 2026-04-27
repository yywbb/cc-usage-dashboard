import { describe, it, expect } from 'vitest';
import {
  loadPriceCtx, priceFor, applyPrice, pickWindow, toLocalYMD,
  DEFAULT_PRICING_PER_M, type Window,
} from '../src/server/pricing.js';
import { openDb } from '../src/server/db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-pricing-'));
  const db = openDb(join(dir, 'usage.db'));
  return { db, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function insertWindow(db: any, model: string, effectiveFrom: string, w: Partial<Window> = {}) {
  db.prepare(
    `INSERT INTO pricing (model_name, effective_from, input, output, cache_create, cache_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    model, effectiveFrom,
    w.input ?? 1, w.output ?? 2, w.cacheCreate ?? 0.5, w.cacheRead ?? 0.1,
    Date.now(),
  );
}

describe('pickWindow', () => {
  const wins: Window[] = [
    { effectiveFrom: '2025-01-01', input: 1, output: 2, cacheCreate: 0.5, cacheRead: 0.1 },
    { effectiveFrom: '2026-04-01', input: 3, output: 6, cacheCreate: 1.5, cacheRead: 0.3 },
  ];
  it('returns latest window with effectiveFrom <= date', () => {
    expect(pickWindow(wins, '2026-04-15')?.input).toBe(3);
    expect(pickWindow(wins, '2025-06-15')?.input).toBe(1);
  });
  it('returns undefined when date precedes all windows', () => {
    expect(pickWindow(wins, '2024-12-31')).toBeUndefined();
  });
  it('returns undefined for empty input', () => {
    expect(pickWindow(undefined, '2026-01-01')).toBeUndefined();
    expect(pickWindow([], '2026-01-01')).toBeUndefined();
  });
});

describe('toLocalYMD', () => {
  it('formats a Unix-ms timestamp as YYYY-MM-DD in the local timezone', () => {
    // 2026-04-15 noon local
    const ts = new Date(2026, 3, 15, 12, 0, 0).getTime();
    expect(toLocalYMD(ts)).toBe('2026-04-15');
  });
});

describe('priceFor (integration)', () => {
  it('uses DEFAULT_PRICING_PER_M when no windows exist for a known model', () => {
    const { db, cleanup } = makeDb();
    try {
      const ctx = loadPriceCtx(db);
      const p = priceFor(ctx, 'claude-sonnet-4-6', Date.now());
      expect(p).toEqual(DEFAULT_PRICING_PER_M['claude-sonnet-4-6']);
    } finally { cleanup(); }
  });

  it('hits the latest window <= message date', () => {
    const { db, cleanup } = makeDb();
    try {
      insertWindow(db, 'claude-sonnet-4-6', '2025-01-01', { input: 4, output: 16, cacheCreate: 5, cacheRead: 0.4 });
      insertWindow(db, 'claude-sonnet-4-6', '2026-04-01', { input: 6, output: 30, cacheCreate: 7.5, cacheRead: 0.6 });
      const ctx = loadPriceCtx(db);
      const p1 = priceFor(ctx, 'claude-sonnet-4-6', new Date(2026, 3, 15).getTime());
      expect(p1?.input).toBe(6);
      const p2 = priceFor(ctx, 'claude-sonnet-4-6', new Date(2025, 6, 1).getTime());
      expect(p2?.input).toBe(4);
    } finally { cleanup(); }
  });

  it('falls back to DEFAULT when message date precedes all windows', () => {
    const { db, cleanup } = makeDb();
    try {
      insertWindow(db, 'claude-sonnet-4-6', '2026-04-01', { input: 6, output: 30, cacheCreate: 7.5, cacheRead: 0.6 });
      const ctx = loadPriceCtx(db);
      const p = priceFor(ctx, 'claude-sonnet-4-6', new Date(2025, 0, 1).getTime());
      expect(p).toEqual(DEFAULT_PRICING_PER_M['claude-sonnet-4-6']);
    } finally { cleanup(); }
  });

  it('auto-creates unregistered model under unknown and returns null', () => {
    const { db, cleanup } = makeDb();
    try {
      const ctx = loadPriceCtx(db);
      const p = priceFor(ctx, 'foo-model-xyz', Date.now());
      expect(p).toBeNull();
      const row = db.prepare(
        `SELECT p.slug FROM models m JOIN providers p ON p.id=m.provider_id
         WHERE m.model_name='foo-model-xyz'`,
      ).get() as { slug: string };
      expect(row.slug).toBe('unknown');
    } finally { cleanup(); }
  });

  it('returns null for models already on the unknown provider', () => {
    const { db, cleanup } = makeDb();
    try {
      const ctx = loadPriceCtx(db);
      priceFor(ctx, 'foo-bar', Date.now()); // creates under unknown
      const p = priceFor(ctx, 'foo-bar', Date.now());
      expect(p).toBeNull();
    } finally { cleanup(); }
  });
});

describe('applyPrice', () => {
  it('computes cost from per-million price and token counts', () => {
    const cost = applyPrice(
      { input: 3, output: 15, cacheCreate: 3.75, cacheRead: 0.3 },
      { inputTokens: 1_000_000, outputTokens: 100_000, cacheCreationTokens: 0, cacheReadTokens: 0 },
    );
    // 1M*3 + 100k*15/1M = 3 + 1.5 = 4.5
    expect(cost).toBeCloseTo(4.5, 6);
  });
});
