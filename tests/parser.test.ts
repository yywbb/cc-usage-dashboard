import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseJsonlLine } from '../src/server/scanner/parser.js';

const lines = readFileSync('tests/fixtures/session-sample.jsonl', 'utf8')
  .split('\n').filter(Boolean);

describe('parseJsonlLine', () => {
  it('parses user message with preview', () => {
    const r = parseJsonlLine(lines[0], 'sess-1');
    expect(r).not.toBeNull();
    expect(r!.role).toBe('user');
    expect(r!.textPreview).toContain('排序');
    expect(r!.inputTokens).toBe(0);
  });

  it('parses assistant message with usage and tool_names', () => {
    const r = parseJsonlLine(lines[1], 'sess-1');
    expect(r).not.toBeNull();
    expect(r!.role).toBe('assistant');
    expect(r!.model).toBe('claude-sonnet-4-6');
    expect(r!.inputTokens).toBe(100);
    expect(r!.outputTokens).toBe(200);
    expect(r!.cacheCreationTokens).toBe(50);
    expect(r!.cacheReadTokens).toBe(1000);
    expect(r!.stopReason).toBe('end_turn');
    expect(r!.toolNames).toEqual(['Write']);
    expect(r!.textPreview).toContain('冒泡');
  });

  it('returns null on invalid JSON', () => {
    expect(parseJsonlLine('{not-json', 'sess-1')).toBeNull();
  });

  it('returns null on JSON without expected shape', () => {
    expect(parseJsonlLine('{"random":"thing"}', 'sess-1')).toBeNull();
  });
});
