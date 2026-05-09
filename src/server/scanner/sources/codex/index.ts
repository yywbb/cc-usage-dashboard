import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { ScanSource } from '../types.js';
import type { ScanResult } from '../../../../shared/types.js';
import { defaultCodexHome, syntheticProjectDir } from './paths.js';
import { parseCodexRollout } from './parser.js';
import { getCursor, upsertCursor } from '../../cursor.js';
import { ensureSession, insertMessages, recomputeSession, upsertCodexProject, upsertRateLimitSnapshot } from '../../writer.js';

export const codexSource: ScanSource = {
  id: 'codex',
  defaultRoot: () => join(defaultCodexHome(), 'sessions'),
  scanAll(db: DatabaseType, root: string): ScanResult {
    const t0 = Date.now();
    let scannedFiles = 0;
    let newMessages = 0;

    const files = walkRollouts(root);
    for (const filePath of files) {
      const stat = statSync(filePath);
      const prev = getCursor(db, filePath);
      // Codex 文件只追加；mtime+size 不变 = 无新内容
      if (prev && prev.sizeBytes === stat.size && prev.mtimeMs === stat.mtimeMs) continue;

      const content = readFileSync(filePath, 'utf8');
      const parsed = parseCodexRollout(content);
      if (!parsed.sessionId) {
        scannedFiles++;
        continue;
      }

      // 一律全文重解析；session 主键 IGNORE-on-conflict 避免重复，但要按已存在 messageId 跳过
      const realPath = parsed.cwdRealPath ?? '(unknown)';
      const projectDir = syntheticProjectDir(realPath);
      upsertCodexProject(db, { projectDir, displayName: realPath, realPath });

      // Ensure session row exists before any FK-bearing child rows (rate-limit
      // snapshots can be present even when a session produced 0 token_count
      // deltas, in which case insertMessages would not create the parent row).
      ensureSession(db, parsed.sessionId, projectDir, 'codex', parsed.cwdRealPath);

      const added = insertMessages(db, projectDir, parsed.sessionId, parsed.messages);
      if (added > 0) {
        recomputeSession(db, parsed.sessionId);
        newMessages += added;
      }
      if (parsed.rateLimit) upsertRateLimitSnapshot(db, parsed.rateLimit);

      upsertCursor(db, {
        filePath, projectDir,
        sizeBytes: stat.size, mtimeMs: stat.mtimeMs,
        lastOffset: stat.size,    // Codex 我们整文件重读 → cursor 仅作为"已扫"标记
        lastScannedAt: Date.now(),
      });
      scannedFiles++;
    }

    return { scannedFiles, newMessages, durationMs: Date.now() - t0 };
  },
};

function walkRollouts(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries;
    try { entries = readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) out.push(full);
    }
  }
  return out;
}
