import { describe, it, expect } from 'vitest';
import { normalizeCwd, defaultCodexHome, syntheticProjectDir } from '../src/server/scanner/sources/codex/paths.js';

describe('codex paths', () => {
  it('normalizes Windows cwd: lower drive + backslashes -> upper drive + forward', () => {
    expect(normalizeCwd('d:\\QC\\code\\aiden\\pigx')).toBe('D:/QC/code/aiden/pigx');
  });
  it('keeps POSIX paths unchanged', () => {
    expect(normalizeCwd('/home/u/proj')).toBe('/home/u/proj');
  });
  it('treats null/undefined cwd safely', () => {
    expect(normalizeCwd(null)).toBeNull();
    expect(normalizeCwd(undefined)).toBeNull();
  });
  it('syntheticProjectDir is stable + url-safe', () => {
    const a = syntheticProjectDir('D:/QC/code/aiden/pigx');
    const b = syntheticProjectDir('D:/QC/code/aiden/pigx');
    expect(a).toBe(b);
    expect(a.startsWith('codex:')).toBe(true);
    expect(/[/+=]/.test(a.slice(6))).toBe(false);  // base64url 无 / +
  });
  it('defaultCodexHome respects $CODEX_HOME', () => {
    const old = process.env.CODEX_HOME;
    process.env.CODEX_HOME = 'C:/x';
    try { expect(defaultCodexHome()).toBe('C:/x'); }
    finally { if (old === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = old; }
  });
});
