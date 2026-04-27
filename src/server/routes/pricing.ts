import type { FastifyInstance } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';
import { DEFAULT_PRICING_PER_M, type ModelPriceM } from '../pricing.js';

interface PricingDeps {
  db: DatabaseType;
}

const SLUG_RE = /^[a-z0-9-]{1,32}$/;
const MODEL_RE = /^[A-Za-z0-9._-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRICE_FIELDS = ['input', 'output', 'cacheCreate', 'cacheRead'] as const;

interface PricePayload { input: number; output: number; cacheCreate: number; cacheRead: number; }

function validatePrice(body: unknown): PricePayload | string {
  if (!body || typeof body !== 'object') return 'body must be an object';
  const b = body as Record<string, unknown>;
  const out = {} as PricePayload;
  for (const f of PRICE_FIELDS) {
    const v = b[f];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      return `field "${f}" must be a non-negative finite number`;
    }
    out[f] = v;
  }
  return out;
}

export async function registerPricing(app: FastifyInstance, deps: PricingDeps) {
  // ---------- providers ----------
  app.get('/api/providers', async () => {
    const rows = deps.db.prepare(
      `SELECT p.id, p.slug, p.display_name AS displayName, p.is_builtin AS isBuiltin,
              (SELECT COUNT(*) FROM models m WHERE m.provider_id = p.id) AS modelCount
       FROM providers p
       ORDER BY p.is_builtin DESC, p.slug`,
    ).all();
    return rows;
  });

  app.post('/api/providers', async (req, reply) => {
    const b = (req.body ?? {}) as { slug?: string; displayName?: string };
    if (!b.slug || !SLUG_RE.test(b.slug)) {
      reply.code(400);
      return { error: 'slug must match /^[a-z0-9-]{1,32}$/' };
    }
    if (!b.displayName || typeof b.displayName !== 'string' || !b.displayName.trim()) {
      reply.code(400);
      return { error: 'displayName required' };
    }
    const now = Date.now();
    try {
      const r = deps.db.prepare(
        `INSERT INTO providers (slug, display_name, is_builtin, created_at, updated_at)
         VALUES (?, ?, 0, ?, ?)`,
      ).run(b.slug, b.displayName.trim(), now, now);
      return { id: r.lastInsertRowid, slug: b.slug, displayName: b.displayName.trim(), isBuiltin: 0 };
    } catch (e: any) {
      if (String(e.message).includes('UNIQUE')) {
        reply.code(409);
        return { error: `slug "${b.slug}" already exists` };
      }
      throw e;
    }
  });

  app.patch('/api/providers/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = (req.body ?? {}) as { displayName?: string };
    if (!b.displayName || typeof b.displayName !== 'string' || !b.displayName.trim()) {
      reply.code(400);
      return { error: 'displayName required' };
    }
    const r = deps.db.prepare(
      `UPDATE providers SET display_name = ?, updated_at = ? WHERE id = ?`,
    ).run(b.displayName.trim(), Date.now(), id);
    if (r.changes === 0) { reply.code(404); return { error: 'not found' }; }
    return { id, displayName: b.displayName.trim() };
  });

  app.delete('/api/providers/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const prov = deps.db.prepare(`SELECT id, slug, is_builtin FROM providers WHERE id=?`).get(id) as
      | { id: number; slug: string; is_builtin: number } | undefined;
    if (!prov) { reply.code(404); return { error: 'not found' }; }
    if (prov.is_builtin) { reply.code(400); return { error: 'builtin provider cannot be deleted' }; }
    const unk = deps.db.prepare(`SELECT id FROM providers WHERE slug='unknown'`).get() as { id: number };
    const tx = deps.db.transaction(() => {
      deps.db.prepare(`UPDATE models SET provider_id=?, updated_at=? WHERE provider_id=?`)
             .run(unk.id, Date.now(), id);
      deps.db.prepare(`DELETE FROM providers WHERE id=?`).run(id);
    });
    tx();
    return { id, deleted: true };
  });

  // ---------- models ----------
  app.get('/api/models', async () => {
    const rows = deps.db.prepare(
      `SELECT m.model_name AS modelName, p.id AS providerId, p.slug AS providerSlug,
              p.display_name AS providerDisplayName,
              COALESCE(SUM(msg.input_tokens + msg.output_tokens
                         + msg.cache_creation_tokens + msg.cache_read_tokens), 0) AS totalTokens,
              COALESCE(SUM(msg.cost_usd), 0) AS costUsd,
              COALESCE(COUNT(msg.message_id), 0) AS messageCount
       FROM models m
       JOIN providers p ON p.id = m.provider_id
       LEFT JOIN messages msg ON msg.model = m.model_name
       GROUP BY m.model_name
       ORDER BY p.is_builtin DESC, p.slug, m.model_name`,
    ).all() as Array<{
      modelName: string; providerId: number; providerSlug: string; providerDisplayName: string;
      totalTokens: number; costUsd: number; messageCount: number;
    }>;
    // Attach current effective price (latest pricing window <= today OR DEFAULT_PRICING_PER_M).
    const winStmt = deps.db.prepare(
      `SELECT input, output, cache_create AS cacheCreate, cache_read AS cacheRead, effective_from AS effectiveFrom
       FROM pricing WHERE model_name = ? AND effective_from <= ?
       ORDER BY effective_from DESC LIMIT 1`,
    );
    const today = (() => {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    })();
    return rows.map(r => {
      const w = winStmt.get(r.modelName, today) as
        | (ModelPriceM & { effectiveFrom: string }) | undefined;
      const def = DEFAULT_PRICING_PER_M[r.modelName] ?? null;
      let currentPrice: ModelPriceM | null = w ?? def;
      let priceSource: 'window' | 'default' | 'none' = w ? 'window' : def ? 'default' : 'none';
      return {
        ...r,
        currentPrice,
        priceSource,
        currentEffectiveFrom: w?.effectiveFrom ?? null,
      };
    });
  });

  app.post('/api/models', async (req, reply) => {
    const b = (req.body ?? {}) as { modelName?: string; providerId?: number };
    if (!b.modelName || !MODEL_RE.test(b.modelName)) {
      reply.code(400); return { error: 'invalid modelName' };
    }
    if (typeof b.providerId !== 'number') {
      reply.code(400); return { error: 'providerId required' };
    }
    const prov = deps.db.prepare(`SELECT id FROM providers WHERE id=?`).get(b.providerId);
    if (!prov) { reply.code(400); return { error: 'provider not found' }; }
    const now = Date.now();
    try {
      deps.db.prepare(
        `INSERT INTO models (model_name, provider_id, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      ).run(b.modelName, b.providerId, now, now);
    } catch (e: any) {
      if (String(e.message).includes('UNIQUE')) {
        // Already exists — treat as idempotent and PATCH provider
        deps.db.prepare(`UPDATE models SET provider_id=?, updated_at=? WHERE model_name=?`)
               .run(b.providerId, now, b.modelName);
      } else throw e;
    }
    return { modelName: b.modelName, providerId: b.providerId };
  });

  app.patch('/api/models/:model', async (req, reply) => {
    const model = (req.params as { model: string }).model;
    if (!MODEL_RE.test(model)) { reply.code(400); return { error: 'invalid model name' }; }
    const b = (req.body ?? {}) as { providerId?: number };
    if (typeof b.providerId !== 'number') { reply.code(400); return { error: 'providerId required' }; }
    const prov = deps.db.prepare(`SELECT id FROM providers WHERE id=?`).get(b.providerId);
    if (!prov) { reply.code(400); return { error: 'provider not found' }; }
    const r = deps.db.prepare(`UPDATE models SET provider_id=?, updated_at=? WHERE model_name=?`)
                     .run(b.providerId, Date.now(), model);
    if (r.changes === 0) { reply.code(404); return { error: 'model not found' }; }
    return { model, providerId: b.providerId };
  });

  app.delete('/api/models/:model', async (req, reply) => {
    const model = (req.params as { model: string }).model;
    const r = deps.db.prepare(`DELETE FROM models WHERE model_name=?`).run(model);
    if (r.changes === 0) { reply.code(404); return { error: 'not found' }; }
    return { model, deleted: true };
  });

  // ---------- pricing windows ----------
  app.get('/api/pricing/:model', async (req, reply) => {
    const model = (req.params as { model: string }).model;
    const m = deps.db.prepare(`SELECT model_name FROM models WHERE model_name=?`).get(model);
    if (!m) { reply.code(404); return { error: 'model not found' }; }
    const windows = deps.db.prepare(
      `SELECT id, effective_from AS effectiveFrom, input, output,
              cache_create AS cacheCreate, cache_read AS cacheRead, note, created_at AS createdAt
       FROM pricing WHERE model_name=?
       ORDER BY effective_from DESC`,
    ).all(model);
    const def = DEFAULT_PRICING_PER_M[model] ?? null;
    return { model, windows, defaultFallback: def };
  });

  app.post('/api/pricing/:model', async (req, reply) => {
    const model = (req.params as { model: string }).model;
    const m = deps.db.prepare(`SELECT model_name FROM models WHERE model_name=?`).get(model);
    if (!m) { reply.code(404); return { error: 'model not found' }; }
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (typeof b.effectiveFrom !== 'string' || !DATE_RE.test(b.effectiveFrom)) {
      reply.code(400); return { error: 'effectiveFrom must be YYYY-MM-DD' };
    }
    const price = validatePrice(b);
    if (typeof price === 'string') { reply.code(400); return { error: price }; }
    const note = typeof b.note === 'string' ? b.note : null;
    try {
      const r = deps.db.prepare(
        `INSERT INTO pricing (model_name, effective_from, input, output, cache_create, cache_read, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(model, b.effectiveFrom, price.input, price.output, price.cacheCreate, price.cacheRead, note, Date.now());
      return { id: r.lastInsertRowid, model, effectiveFrom: b.effectiveFrom, ...price, note };
    } catch (e: any) {
      if (String(e.message).includes('UNIQUE')) {
        reply.code(409); return { error: `pricing for (${model}, ${b.effectiveFrom}) already exists` };
      }
      throw e;
    }
  });

  app.patch('/api/pricing/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const price = validatePrice(b);
    if (typeof price === 'string') { reply.code(400); return { error: price }; }
    if (typeof b.effectiveFrom !== 'string' || !DATE_RE.test(b.effectiveFrom)) {
      reply.code(400); return { error: 'effectiveFrom must be YYYY-MM-DD' };
    }
    const note = typeof b.note === 'string' ? b.note : null;
    let r: ReturnType<ReturnType<typeof deps.db.prepare>['run']>;
    try {
      r = deps.db.prepare(
        `UPDATE pricing SET effective_from=?, input=?, output=?, cache_create=?, cache_read=?, note=?
         WHERE id=?`,
      ).run(b.effectiveFrom, price.input, price.output, price.cacheCreate, price.cacheRead, note, id);
    } catch (e: any) {
      if (String(e.message).includes('UNIQUE')) {
        reply.code(409); return { error: 'pricing window for that date already exists' };
      }
      throw e;
    }
    if (r.changes === 0) { reply.code(404); return { error: 'not found' }; }
    return { id, effectiveFrom: b.effectiveFrom, ...price, note };
  });

  app.delete('/api/pricing/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const r = deps.db.prepare(`DELETE FROM pricing WHERE id=?`).run(id);
    if (r.changes === 0) { reply.code(404); return { error: 'not found' }; }
    return { id, deleted: true };
  });
}
