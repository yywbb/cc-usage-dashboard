import type { Database as DatabaseType } from 'better-sqlite3';

export interface ModelPriceM {
  input: number;        // USD per 1,000,000 tokens
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens?: number;
}

export type PriceTable = Record<string, ModelPriceM>;

export const DEFAULT_PRICING_PER_M: PriceTable = {
  'claude-opus-4-7':            { input: 5, output: 25, cacheCreate: 6.25, cacheRead: 0.50 },
  'claude-opus-4-6':            { input: 5, output: 25, cacheCreate: 6.25, cacheRead: 0.50 },
  'claude-opus-4-6-thinking':   { input: 5, output: 25, cacheCreate: 6.25, cacheRead: 0.50 },
  'claude-sonnet-4-6':          { input: 3, output: 15, cacheCreate: 3.75, cacheRead: 0.30 },
  'claude-haiku-4-5':           { input: 1, output:  5, cacheCreate: 1.25, cacheRead: 0.10 },
  'claude-haiku-4-5-20251001':  { input: 1, output:  5, cacheCreate: 1.25, cacheRead: 0.10 },
  'gpt-5':                      { input: 1.25, output: 10,   cacheCreate: 0, cacheRead: 0.125 },
  'gpt-5-codex':                { input: 1.25, output: 10,   cacheCreate: 0, cacheRead: 0.125 },
  'gpt-5.3-codex':              { input: 1.25, output: 10,   cacheCreate: 0, cacheRead: 0.125 },
  'gpt-5-mini':                 { input: 0.25, output: 2,    cacheCreate: 0, cacheRead: 0.025 },
  'gpt-4.1':                    { input: 2,    output: 8,    cacheCreate: 0, cacheRead: 0.50  },
  'o4-mini':                    { input: 1.10, output: 4.40, cacheCreate: 0, cacheRead: 0.275 },
};

const M = 1_000_000;

export interface Window extends ModelPriceM {
  effectiveFrom: string; // 'YYYY-MM-DD'
}

export interface PriceCtx {
  db: DatabaseType;
  modelMeta: Map<string, { providerSlug: string }>;
  windowsByModel: Map<string, Window[]>; // sorted ascending by effectiveFrom
  defaults: Map<string, ModelPriceM>;
  unknownProviderId: number;
}

/**
 * Load everything priceFor() needs into memory once. Caller invokes this at the
 * start of a batch (ingest or recompute) and reuses the ctx for every message.
 */
export function loadPriceCtx(db: DatabaseType): PriceCtx {
  const metaRows = db.prepare(
    `SELECT m.model_name, p.slug
     FROM models m JOIN providers p ON p.id = m.provider_id`,
  ).all() as Array<{ model_name: string; slug: string }>;
  const modelMeta = new Map<string, { providerSlug: string }>();
  for (const r of metaRows) modelMeta.set(r.model_name, { providerSlug: r.slug });

  const winRows = db.prepare(
    `SELECT model_name, effective_from, input, output, cache_create, cache_read
     FROM pricing
     ORDER BY model_name, effective_from ASC`,
  ).all() as Array<{
    model_name: string;
    effective_from: string;
    input: number;
    output: number;
    cache_create: number;
    cache_read: number;
  }>;
  const windowsByModel = new Map<string, Window[]>();
  for (const r of winRows) {
    const w: Window = {
      effectiveFrom: r.effective_from,
      input: r.input,
      output: r.output,
      cacheCreate: r.cache_create,
      cacheRead: r.cache_read,
    };
    const arr = windowsByModel.get(r.model_name);
    if (arr) arr.push(w); else windowsByModel.set(r.model_name, [w]);
  }

  const defaults = new Map<string, ModelPriceM>();
  for (const [k, v] of Object.entries(DEFAULT_PRICING_PER_M)) defaults.set(k, v);

  const unk = db.prepare(`SELECT id FROM providers WHERE slug='unknown'`).get() as
    | { id: number }
    | undefined;
  if (!unk) throw new Error("loadPriceCtx: 'unknown' provider missing — migration 003 not applied");

  return { db, modelMeta, windowsByModel, defaults, unknownProviderId: unk.id };
}

/**
 * Returns the latest window with effectiveFrom <= date, or undefined.
 * windows must be sorted ascending by effectiveFrom (loadPriceCtx guarantees this).
 */
export function pickWindow(windows: Window[] | undefined, date: string): Window | undefined {
  if (!windows || windows.length === 0) return undefined;
  let hit: Window | undefined;
  for (const w of windows) {
    if (w.effectiveFrom <= date) hit = w; else break;
  }
  return hit;
}

/**
 * Convert a Unix-ms timestamp into a local-date 'YYYY-MM-DD' string. Matches the
 * SQL convention `date(timestamp/1000,'unixepoch','localtime')` used throughout
 * the dashboard so window boundaries align with day buckets.
 */
export function toLocalYMD(timestampMs: number): string {
  const d = new Date(timestampMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Insert a model row pointing to the unknown provider. Used when a message
 * arrives for a model the user has never registered.
 */
export function autoCreateUnderUnknown(db: DatabaseType, model: string, unknownProviderId: number): void {
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO models (model_name, provider_id, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).run(model, unknownProviderId, now, now);
}

/**
 * Returns the per-million price applicable to a message. Mutates ctx.modelMeta
 * to cache an unknown-classification so subsequent calls in the same batch
 * don't re-INSERT.
 *
 * Returns null when the model is on the unknown provider (cost should be 0)
 * OR when no pricing window and no DEFAULT fallback exist.
 */
export function priceFor(ctx: PriceCtx, model: string, messageTimestampMs: number): ModelPriceM | null {
  let meta = ctx.modelMeta.get(model);
  if (!meta) {
    autoCreateUnderUnknown(ctx.db, model, ctx.unknownProviderId);
    meta = { providerSlug: 'unknown' };
    ctx.modelMeta.set(model, meta);
  }
  if (meta.providerSlug === 'unknown') return null;

  const date = toLocalYMD(messageTimestampMs);
  const win = pickWindow(ctx.windowsByModel.get(model), date);
  if (win) return win;
  return ctx.defaults.get(model) ?? null;
}

/** Apply a per-million price to token counts → USD cost. */
export function applyPrice(price: ModelPriceM, t: TokenCounts): number {
  return (
    (t.inputTokens            * price.input)       / M +
    (t.outputTokens           * price.output)      / M +
    ((t.reasoningTokens ?? 0) * price.output)      / M +
    (t.cacheCreationTokens    * price.cacheCreate) / M +
    (t.cacheReadTokens        * price.cacheRead)   / M
  );
}
