import type { Database as DatabaseType } from 'better-sqlite3';
import { DEFAULT_PRICING_PER_M } from './pricing.js';

/**
 * Idempotent: registers every model in DEFAULT_PRICING_PER_M as belonging to
 * the builtin 'anthropic' provider. Called on every openDb() so newly-added
 * defaults flow into the DB on next startup without needing a migration.
 */
export function syncKnownAnthropicModels(db: DatabaseType): void {
  const anthropic = db.prepare(`SELECT id FROM providers WHERE slug='anthropic'`).get() as
    | { id: number }
    | undefined;
  if (!anthropic) return; // migration 003 not yet applied (defensive)
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO models (model_name, provider_id, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  );
  const now = Date.now();
  const tx = db.transaction(() => {
    for (const model of Object.keys(DEFAULT_PRICING_PER_M)) {
      stmt.run(model, anthropic.id, now, now);
    }
  });
  tx();
}
