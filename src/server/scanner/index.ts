import type { Database as DatabaseType } from 'better-sqlite3';
import { readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseJsonlLine } from './parser.js';
import { insertMessages, upsertProject, recomputeSession } from './writer.js';
import { getCursor, upsertCursor } from './cursor.js';
import { reverseProjectDirName } from '../paths.js';
import type { ParsedMessage, ScanResult } from '../../shared/types.js';

const CHUNK_SIZE = 256 * 1024;
const BATCH_SIZE = 1000;

export function scanAll(db: DatabaseType, projectsRoot: string): ScanResult {
  const start = Date.now();
  let scannedFiles = 0;
  let newMessages = 0;

  const projectDirs = readdirSync(projectsRoot, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({ dirName: d.name, fullPath: join(projectsRoot, d.name) }));

  for (const { dirName, fullPath } of projectDirs) {
    upsertProject(db, {
      projectDir: fullPath,
      displayName: dirName,
      realPath: reverseProjectDirName(dirName),
    });

    const jsonlFiles = walkJsonl(fullPath);

    for (const filePath of jsonlFiles) {
      const sessionId = basename(filePath, '.jsonl');
      const added = scanOne(db, filePath, fullPath, sessionId);
      if (added > 0) {
        recomputeSession(db, sessionId);
        newMessages += added;
      }
      scannedFiles++;
    }
  }

  return { scannedFiles, newMessages, durationMs: Date.now() - start };
}

function walkJsonl(dir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
    }
  }
  return out;
}

function scanOne(
  db: DatabaseType,
  filePath: string,
  projectDir: string,
  sessionId: string,
): number {
  const stat = statSync(filePath);
  const prev = getCursor(db, filePath);
  if (prev && prev.sizeBytes === stat.size && prev.mtimeMs === stat.mtimeMs) {
    return 0;
  }
  const startOffset = prev && stat.size >= prev.sizeBytes ? prev.lastOffset : 0;
  const { messages, endOffset } = readFromOffset(filePath, startOffset, sessionId);

  let inserted = 0;
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    inserted += insertMessages(db, projectDir, sessionId, messages.slice(i, i + BATCH_SIZE));
  }

  upsertCursor(db, {
    filePath, projectDir,
    sizeBytes: stat.size, mtimeMs: stat.mtimeMs,
    lastOffset: endOffset,
    lastScannedAt: Date.now(),
  });
  return inserted;
}

function readFromOffset(
  filePath: string,
  startOffset: number,
  sessionId: string,
): { messages: ParsedMessage[]; endOffset: number } {
  const fd = openSync(filePath, 'r');
  const messages: ParsedMessage[] = [];
  let offset = startOffset;
  let lastCompleteEnd = startOffset;
  let buffer = '';
  const chunk = Buffer.alloc(CHUNK_SIZE);

  try {
    while (true) {
      const bytes = readSync(fd, chunk, 0, CHUNK_SIZE, offset);
      if (bytes <= 0) break;
      buffer += chunk.subarray(0, bytes).toString('utf8');
      offset += bytes;

      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim().length === 0) {
          lastCompleteEnd += nl + 1;
          continue;
        }
        const parsed = parseJsonlLine(line, sessionId);
        if (parsed) messages.push(parsed);
        lastCompleteEnd += nl + 1;
      }
    }
  } finally {
    closeSync(fd);
  }
  return { messages, endOffset: lastCompleteEnd };
}
