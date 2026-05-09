import { homedir } from 'node:os';
import { join } from 'node:path';

export function defaultCodexHome(): string {
  return process.env.CODEX_HOME ?? join(homedir(), '.codex');
}

export function defaultCodexSessionsRoot(): string {
  return join(defaultCodexHome(), 'sessions');
}

export function normalizeCwd(cwd: string | null | undefined): string | null {
  if (!cwd) return null;
  let s = cwd.replace(/\\/g, '/');
  // Windows 盘符 d:/... → D:/...
  s = s.replace(/^([a-z]):/, (_, d) => `${d.toUpperCase()}:`);
  return s;
}

export function syntheticProjectDir(realPath: string): string {
  return 'codex:' + Buffer.from(realPath, 'utf8').toString('base64url');
}
