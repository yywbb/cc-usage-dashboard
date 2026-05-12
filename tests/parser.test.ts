import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseJsonlLine } from '../src/server/scanner/sources/claude/parser.js';

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

  it('marks Claude synthetic API error messages as failed responses without a model', () => {
    const line = JSON.stringify({
      uuid: 'err-1',
      timestamp: '2026-04-20T10:00:15.000Z',
      isApiErrorMessage: true,
      message: {
        id: 'err-msg-1',
        role: 'assistant',
        model: '<synthetic>',
        content: [{ type: 'text', text: 'API Error: 429 rate limit' }],
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });

    const r = parseJsonlLine(line, 'sess-1');
    expect(r).not.toBeNull();
    expect(r!.model).toBeNull();
    expect(r!.responseError).toBe(true);
  });

  it('keeps non-error synthetic messages out of model accounting', () => {
    const line = JSON.stringify({
      uuid: 'synthetic-1',
      timestamp: '2026-04-20T10:00:20.000Z',
      isApiErrorMessage: false,
      message: {
        id: 'synthetic-msg-1',
        role: 'assistant',
        model: '<synthetic>',
        content: [{ type: 'text', text: 'No response requested.' }],
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });

    const r = parseJsonlLine(line, 'sess-1');
    expect(r).not.toBeNull();
    expect(r!.model).toBeNull();
    expect(r!.responseError).toBe(false);
    expect(r!.textPreview).toBe('No response requested.');
  });
});
