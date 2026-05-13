import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncKnownModels } from './seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');
const require = createRequire(import.meta.url);
const { DatabaseSync: SQLiteDatabaseSync } = loadNodeSqlite();

export interface StatementResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

export interface StatementType {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): StatementResult;
}

export interface DatabaseType {
  prepare(sql: string): StatementType;
  exec(sql: string): void;
  close(): void;
}

const transactionDepth = new WeakMap<DatabaseType, number>();

function loadNodeSqlite(): typeof import('node:sqlite') {
  const emitWarning = process.emitWarning;
  process.emitWarning = ((warning: unknown, ...args: unknown[]) => {
    const message = typeof warning === 'string'
      ? warning
      : warning instanceof Error
        ? warning.message
        : '';
    if (message === 'SQLite is an experimental feature and might change at any time') return;
    return (emitWarning as (...emitArgs: unknown[]) => void).call(process, warning, ...args);
  }) as typeof process.emitWarning;
  try {
    return require('node:sqlite') as typeof import('node:sqlite');
  } finally {
    process.emitWarning = emitWarning;
  }
}

export function openDb(dbPath: string): DatabaseType {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new SQLiteDatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  applyMigrations(db);
  syncKnownModels(db);
  return db;
}

export function withTransaction<T>(db: DatabaseType, fn: () => T): T {
  const depth = transactionDepth.get(db) ?? 0;
  if (depth === 0) db.exec('BEGIN');
  transactionDepth.set(db, depth + 1);
  try {
    const result = fn();
    if (depth === 0) db.exec('COMMIT');
    return result;
  } catch (error) {
    if (depth === 0) db.exec('ROLLBACK');
    throw error;
  } finally {
    if (depth === 0) {
      transactionDepth.delete(db);
    } else {
      transactionDepth.set(db, depth);
    }
  }
}

function applyMigrations(db: DatabaseType): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     )`
  );
  const applied = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as { name: string }[])
      .map(r => r.name)
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    withTransaction(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations(name, applied_at) VALUES (?, ?)')
        .run(f, Date.now());
    });
  }
}
