import type { DatabaseType } from './db.js';
import { withTransaction } from './db.js';
import { DEFAULT_PRICING_PER_M } from './pricing.js';

const OPENAI_MODELS = new Set([
  'gpt-5', 'gpt-5-codex',
  'gpt-5.2', 'gpt-5.2-codex',
  'gpt-5.3-codex',
  'gpt-5.4',
  'gpt-5.5',
  'gpt-5-mini', 'gpt-4.1', 'o4-mini',
  'codex-auto-review',
]);

/**
 * Idempotent: ensures the openai provider row exists, then registers every
 * model in DEFAULT_PRICING_PER_M under the correct provider (openai or anthropic).
 * Also reclassifies any model previously auto-created under 'unknown' (e.g.
 * because it was scanned before being added to DEFAULT_PRICING_PER_M) into
 * its proper provider so subsequent recompute-cost picks up the right price.
 * Called on every openDb() so newly-added defaults flow into the DB on next
 * startup without needing a migration.
 */
export function syncKnownModels(db: DatabaseType): void {
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO providers (slug, display_name, is_builtin, created_at, updated_at)
     VALUES ('openai', 'OpenAI', 1, ?, ?)`,
  ).run(now, now);

  const idBySlug = new Map<string, number>();
  for (const r of db.prepare(`SELECT id, slug FROM providers`).all() as Array<{ id: number; slug: string }>) {
    idBySlug.set(r.slug, r.id);
  }
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO models (model_name, provider_id, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  );
  const reclassifyStmt = db.prepare(
    `UPDATE models SET provider_id = ?, updated_at = ?
     WHERE model_name = ?
       AND provider_id = (SELECT id FROM providers WHERE slug = 'unknown')`,
  );
  withTransaction(db, () => {
    for (const model of Object.keys(DEFAULT_PRICING_PER_M)) {
      const slug = OPENAI_MODELS.has(model) ? 'openai' : 'anthropic';
      const pid = idBySlug.get(slug);
      if (pid === undefined) continue;
      insertStmt.run(model, pid, now, now);
      reclassifyStmt.run(pid, now, model);
    }
  });
}
