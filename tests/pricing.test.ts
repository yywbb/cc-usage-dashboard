import { describe, it, expect } from 'vitest';
import {
  computeCostUsd, computeCostUsdWith, loadPriceTable, PRICING, DEFAULT_PRICING_PER_M,
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

describe('computeCostUsd', () => {
  it('computes sonnet cost for mixed token types', () => {
    const cost = computeCostUsd('claude-sonnet-4-6', {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
    // 1M input * $3 + 100k output * $15/1M = 3 + 1.5 = 4.5
    expect(cost).toBeCloseTo(4.5, 6);
  });

  it('computes opus cost including cache', () => {
    const cost = computeCostUsd('claude-opus-4-7', {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
    });
    // 1M cacheCreate * $6.25 + 1M cacheRead * $0.50 = 6.75
    expect(cost).toBeCloseTo(6.75, 6);
  });

  it('falls back to sonnet pricing for unknown model', () => {
    const known = computeCostUsd('claude-sonnet-4-6', {
      inputTokens: 10_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
    });
    const unknown = computeCostUsd('foo-model-xyz', {
      inputTokens: 10_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
    });
    expect(unknown).toBeCloseTo(known, 6);
  });

  it('has required models in PRICING and DEFAULT_PRICING_PER_M', () => {
    expect(PRICING['claude-opus-4-7']).toBeDefined();
    expect(PRICING['claude-opus-4-6']).toBeDefined();
    expect(PRICING['claude-opus-4-6-thinking']).toBeDefined();
    expect(PRICING['claude-sonnet-4-6']).toBeDefined();
    expect(PRICING['claude-haiku-4-5']).toBeDefined();
    expect(DEFAULT_PRICING_PER_M['claude-opus-4-7'].input).toBe(5);
    expect(DEFAULT_PRICING_PER_M['claude-opus-4-7'].output).toBe(25);
  });
});

describe('loadPriceTable + overrides', () => {
  it('returns defaults when no overrides exist', () => {
    const { db, cleanup } = makeDb();
    try {
      const table = loadPriceTable(db);
      expect(table['claude-sonnet-4-6'].input).toBeCloseTo(3 / 1_000_000, 12);
    } finally { cleanup(); }
  });

  it('applies override on top of defaults and is used by computeCostUsdWith', () => {
    const { db, cleanup } = makeDb();
    try {
      db.prepare(
        `INSERT INTO pricing_overrides (model, input, output, cache_create, cache_read, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('claude-sonnet-4-6', 6, 30, 7.5, 0.6, Date.now());
      const table = loadPriceTable(db);
      const cost = computeCostUsdWith(table, 'claude-sonnet-4-6', {
        inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
      });
      expect(cost).toBeCloseTo(6, 6); // 1M * $6/M
    } finally { cleanup(); }
  });

  it('supports custom (non-default) models via overrides', () => {
    const { db, cleanup } = makeDb();
    try {
      db.prepare(
        `INSERT INTO pricing_overrides (model, input, output, cache_create, cache_read, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('my-custom-model', 2, 10, 2.5, 0.2, Date.now());
      const table = loadPriceTable(db);
      const cost = computeCostUsdWith(table, 'my-custom-model', {
        inputTokens: 500_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0,
      });
      expect(cost).toBeCloseTo(1, 6); // 500k * $2/M = $1
    } finally { cleanup(); }
  });
});
