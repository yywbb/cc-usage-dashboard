import type { Database as DatabaseType } from 'better-sqlite3';

export interface ModelPrice {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export type PriceTable = Record<string, ModelPrice>;

const M = 1_000_000;

export const DEFAULT_PRICING_PER_M: PriceTable = {
  'claude-opus-4-7':            { input: 5, output: 25, cacheCreate: 6.25, cacheRead: 0.50 },
  'claude-opus-4-6':            { input: 5, output: 25, cacheCreate: 6.25, cacheRead: 0.50 },
  'claude-opus-4-6-thinking':   { input: 5, output: 25, cacheCreate: 6.25, cacheRead: 0.50 },
  'claude-sonnet-4-6':          { input: 3, output: 15, cacheCreate: 3.75, cacheRead: 0.30 },
  'claude-haiku-4-5':           { input: 1, output:  5, cacheCreate: 1.25, cacheRead: 0.10 },
  'claude-haiku-4-5-20251001':  { input: 1, output:  5, cacheCreate: 1.25, cacheRead: 0.10 },
};

export const PRICING: PriceTable = perTokenTable(DEFAULT_PRICING_PER_M);

const FALLBACK_MODEL = 'claude-sonnet-4-6';

function perTokenTable(perM: PriceTable): PriceTable {
  const out: PriceTable = {};
  for (const [k, v] of Object.entries(perM)) {
    out[k] = {
      input: v.input / M,
      output: v.output / M,
      cacheCreate: v.cacheCreate / M,
      cacheRead: v.cacheRead / M,
    };
  }
  return out;
}

export function loadPriceTable(db: DatabaseType): PriceTable {
  const rows = db.prepare(
    `SELECT model, input, output, cache_create, cache_read FROM pricing_overrides`
  ).all() as Array<{
    model: string;
    input: number;
    output: number;
    cache_create: number;
    cache_read: number;
  }>;
  const overrides: PriceTable = {};
  for (const r of rows) {
    overrides[r.model] = {
      input: r.input,
      output: r.output,
      cacheCreate: r.cache_create,
      cacheRead: r.cache_read,
    };
  }
  return perTokenTable({ ...DEFAULT_PRICING_PER_M, ...overrides });
}

export function computeCostUsdWith(
  table: PriceTable,
  model: string,
  tokens: TokenCounts,
): number {
  const price = table[model] ?? table[FALLBACK_MODEL] ?? PRICING[FALLBACK_MODEL];
  return (
    tokens.inputTokens          * price.input       +
    tokens.outputTokens         * price.output      +
    tokens.cacheCreationTokens  * price.cacheCreate +
    tokens.cacheReadTokens      * price.cacheRead
  );
}

export function computeCostUsd(model: string, tokens: TokenCounts): number {
  return computeCostUsdWith(PRICING, model, tokens);
}
