import type { FastifyInstance } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';
import { DEFAULT_PRICING_PER_M, type ModelPrice, type PriceTable } from '../pricing.js';

interface PricingDeps {
  db: DatabaseType;
}

interface PricingPayload {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

interface ModelUsage {
  messages: number;
  totalTokens: number;
  costUsd: number;
}

type ModelSource = 'default' | 'override' | 'custom' | 'unconfigured';

interface ModelView {
  model: string;
  price: ModelPrice;
  source: ModelSource;
  usage: ModelUsage;
}

const FALLBACK_MODEL = 'claude-sonnet-4-6';

const FIELDS: Array<keyof PricingPayload> = ['input', 'output', 'cacheCreate', 'cacheRead'];
const MODEL_RE = /^[A-Za-z0-9._-]{1,64}$/;

function readUsageByModel(db: DatabaseType): Map<string, ModelUsage> {
  const rows = db.prepare(
    `SELECT model,
            COUNT(*) as messages,
            COALESCE(SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens), 0) as tokens,
            COALESCE(SUM(cost_usd), 0) as cost
     FROM messages
     WHERE model IS NOT NULL
     GROUP BY model`
  ).all() as Array<{ model: string; messages: number; tokens: number; cost: number }>;
  const out = new Map<string, ModelUsage>();
  for (const r of rows) {
    out.set(r.model, { messages: r.messages, totalTokens: r.tokens, costUsd: r.cost });
  }
  return out;
}

function classifySource(model: string, defaults: PriceTable, overrides: PriceTable): ModelSource {
  const inDefault = model in defaults;
  const inOverride = model in overrides;
  if (inOverride) return inDefault ? 'override' : 'custom';
  if (inDefault) return 'default';
  return 'unconfigured';
}

function buildModelsView(db: DatabaseType, overrides: PriceTable): ModelView[] {
  const defaults = DEFAULT_PRICING_PER_M;
  const usage = readUsageByModel(db);
  const fallback = defaults[FALLBACK_MODEL];
  const models = new Set<string>([...usage.keys(), ...Object.keys(overrides)]);
  return [...models].map(model => {
    const source = classifySource(model, defaults, overrides);
    const price = overrides[model] ?? defaults[model] ?? fallback;
    const u = usage.get(model) ?? { messages: 0, totalTokens: 0, costUsd: 0 };
    return { model, price, source, usage: u };
  }).sort((a, b) => {
    if (b.usage.costUsd !== a.usage.costUsd) return b.usage.costUsd - a.usage.costUsd;
    return a.model.localeCompare(b.model);
  });
}

function readOverridesPerM(db: DatabaseType): PriceTable {
  const rows = db.prepare(
    `SELECT model, input, output, cache_create, cache_read FROM pricing_overrides ORDER BY model`
  ).all() as Array<{
    model: string;
    input: number;
    output: number;
    cache_create: number;
    cache_read: number;
  }>;
  const out: PriceTable = {};
  for (const r of rows) {
    out[r.model] = {
      input: r.input,
      output: r.output,
      cacheCreate: r.cache_create,
      cacheRead: r.cache_read,
    };
  }
  return out;
}

function effectivePerM(overrides: PriceTable): PriceTable {
  return { ...DEFAULT_PRICING_PER_M, ...overrides };
}

function validatePayload(body: unknown): PricingPayload | string {
  if (!body || typeof body !== 'object') return 'body must be an object';
  const b = body as Record<string, unknown>;
  const out = {} as PricingPayload;
  for (const f of FIELDS) {
    const v = b[f];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      return `field "${f}" must be a non-negative finite number`;
    }
    out[f] = v;
  }
  return out;
}

export async function registerPricing(app: FastifyInstance, deps: PricingDeps) {
  app.get('/api/pricing', async () => {
    const overrides = readOverridesPerM(deps.db);
    const defaults = DEFAULT_PRICING_PER_M;
    const effective = effectivePerM(overrides);
    const models = buildModelsView(deps.db, overrides);
    return { defaults, overrides, effective, fallbackModel: FALLBACK_MODEL, models };
  });

  app.put('/api/pricing/:model', async (req, reply) => {
    const { model } = req.params as { model: string };
    if (!MODEL_RE.test(model)) {
      reply.code(400);
      return { error: 'invalid model name' };
    }
    const payload = validatePayload(req.body);
    if (typeof payload === 'string') {
      reply.code(400);
      return { error: payload };
    }
    deps.db.prepare(
      `INSERT INTO pricing_overrides (model, input, output, cache_create, cache_read, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(model) DO UPDATE SET
         input = excluded.input,
         output = excluded.output,
         cache_create = excluded.cache_create,
         cache_read = excluded.cache_read,
         updated_at = excluded.updated_at`
    ).run(
      model,
      payload.input,
      payload.output,
      payload.cacheCreate,
      payload.cacheRead,
      Date.now(),
    );
    const saved: ModelPrice = {
      input: payload.input,
      output: payload.output,
      cacheCreate: payload.cacheCreate,
      cacheRead: payload.cacheRead,
    };
    return { model, price: saved };
  });

  app.delete('/api/pricing/:model', async (req) => {
    const { model } = req.params as { model: string };
    const r = deps.db.prepare('DELETE FROM pricing_overrides WHERE model = ?').run(model);
    return { model, deleted: r.changes > 0 };
  });
}
