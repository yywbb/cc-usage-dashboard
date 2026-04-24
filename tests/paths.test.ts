import { describe, it, expect } from 'vitest';
import { reverseProjectDirName, encodeProjectDir, decodeProjectDir } from '../src/server/paths.js';

describe('reverseProjectDirName', () => {
  it('reverses typical Windows encoding', () => {
    expect(reverseProjectDirName('D--QC-code2-linz-tools-genealogy'))
      .toBe('D:/QC/code2/linz/tools/genealogy');
  });

  it('reverses nested path', () => {
    expect(reverseProjectDirName('C--Users-EDY-workspace'))
      .toBe('C:/Users/EDY/workspace');
  });

  it('returns null when no drive-letter pattern matches', () => {
    expect(reverseProjectDirName('plain-name-no-drive')).toBeNull();
  });
});

describe('encode/decode projectDir b64url', () => {
  it('round-trips', () => {
    const orig = 'D:/QC/code2/linz/tools/genealogy-platform';
    expect(decodeProjectDir(encodeProjectDir(orig))).toBe(orig);
  });
  it('is url-safe', () => {
    const b64 = encodeProjectDir('D:/QC/code2/linz/tools/genealogy-platform');
    expect(b64).not.toMatch(/[+/=]/);
  });
});
