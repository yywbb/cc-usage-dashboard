import type { Database as DatabaseType } from 'better-sqlite3';

export interface CursorRow {
  filePath: string;
  projectDir: string;
  sizeBytes: number;
  mtimeMs: number;
  lastOffset: number;
  lastScannedAt: number;
}

export function getCursor(db: DatabaseType, filePath: string): CursorRow | null {
  const r = db.prepare(
    `SELECT file_path as filePath, project_dir as projectDir,
            size_bytes as sizeBytes, mtime_ms as mtimeMs,
            last_offset as lastOffset, last_scanned_at as lastScannedAt
     FROM scan_cursor WHERE file_path = ?`
  ).get(filePath) as CursorRow | undefined;
  return r ?? null;
}

export function upsertCursor(db: DatabaseType, c: CursorRow): void {
  db.prepare(
    `INSERT INTO scan_cursor
       (file_path, project_dir, size_bytes, mtime_ms, last_offset, last_scanned_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET
       project_dir = excluded.project_dir,
       size_bytes = excluded.size_bytes,
       mtime_ms = excluded.mtime_ms,
       last_offset = excluded.last_offset,
       last_scanned_at = excluded.last_scanned_at`
  ).run(c.filePath, c.projectDir, c.sizeBytes, c.mtimeMs, c.lastOffset, c.lastScannedAt);
}

export function allCursors(db: DatabaseType, projectDir: string): CursorRow[] {
  return db.prepare(
    `SELECT file_path as filePath, project_dir as projectDir,
            size_bytes as sizeBytes, mtime_ms as mtimeMs,
            last_offset as lastOffset, last_scanned_at as lastScannedAt
     FROM scan_cursor WHERE project_dir = ?`
  ).all(projectDir) as CursorRow[];
}
