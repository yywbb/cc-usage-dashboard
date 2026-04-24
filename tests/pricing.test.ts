import { describe, it, expect } from 'vitest';
import { computeCostUsd, PRICING } from '../src/server/pricing.js';

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
    // 1M cacheCreate * $18.75 + 1M cacheRead * $1.50 = 20.25
    expect(cost).toBeCloseTo(20.25, 6);
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

  it('has required models in PRICING', () => {
    expect(PRICING['claude-opus-4-7']).toBeDefined();
    expect(PRICING['claude-sonnet-4-6']).toBeDefined();
    expect(PRICING['claude-haiku-4-5']).toBeDefined();
  });
});
