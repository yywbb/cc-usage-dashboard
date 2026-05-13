import type { DatabaseType } from '../../db.js';
import type { ScanResult } from '../../../shared/types.js';

export type SourceId = 'claude' | 'codex';

export interface ScanSource {
  readonly id: SourceId;
  /** 默认根目录（不存在时调用方应跳过） */
  defaultRoot(): string;
  /** 全量/增量扫描；scan_cursor 表自动断点续扫 */
  scanAll(db: DatabaseType, root: string): ScanResult;
}
