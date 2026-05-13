import { existsSync } from 'node:fs';
import type { DatabaseType } from '../db.js';
import type { ScanResult } from '../../shared/types.js';
import type { ScanSource, SourceId } from './sources/types.js';
import { claudeSource } from './sources/claude/index.js';
import { codexSource } from './sources/codex/index.js';

export const SOURCES: Record<SourceId, ScanSource> = {
  claude: claudeSource,
  codex: codexSource,
};

export interface ScanAllOptions {
  /** 'all' | 'claude' | 'codex'。默认 'all'。 */
  source?: 'all' | SourceId;
  /** 覆盖默认 root；仅当只指定单一 source 有效。 */
  rootOverride?: string;
}

export function scanAll(
  db: DatabaseType,
  legacyRoot: string | undefined,
  opts: ScanAllOptions = {},
): ScanResult {
  const target = opts.source ?? 'all';
  const ids: SourceId[] = target === 'all' ? (Object.keys(SOURCES) as SourceId[]) : [target];

  const totals: ScanResult = { scannedFiles: 0, newMessages: 0, durationMs: 0 };
  const t0 = Date.now();
  for (const id of ids) {
    const src = SOURCES[id];
    if (!src) continue;
    let root = ids.length === 1 && opts.rootOverride ? opts.rootOverride : src.defaultRoot();
    // 兼容旧调用签名：legacyRoot 仅当 source='claude' 单跑时使用
    if (id === 'claude' && legacyRoot && target !== 'all' && !opts.rootOverride) root = legacyRoot;
    if (!existsSync(root)) continue;
    const r = src.scanAll(db, root);
    totals.scannedFiles += r.scannedFiles;
    totals.newMessages  += r.newMessages;
  }
  totals.durationMs = Date.now() - t0;
  return totals;
}
