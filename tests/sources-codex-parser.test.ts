import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCodexRollout } from '../src/server/scanner/sources/codex/parser.js';

function load(name: string) {
  return readFileSync(`tests/fixtures/codex/${name}`, 'utf8');
}

describe('parseCodexRollout', () => {
  it('parses normal session into 2 messages, attributes model + originator', () => {
    const out = parseCodexRollout(load('normal.jsonl'));
    expect(out.sessionId).toBe('test-sess-001');
    expect(out.cwdRealPath).toBe('D:/Demo/proj');
    expect(out.originator).toBe('codex_cli');
    expect(out.messages).toHaveLength(2);
    const m1 = out.messages[0];
    expect(m1.model).toBe('gpt-5-codex');
    expect(m1.inputTokens).toBe(800);
    expect(m1.cacheReadTokens).toBe(200);
    expect(m1.outputTokens).toBe(300);
    expect(m1.reasoningTokens).toBe(100);
    const m2 = out.messages[1];
    expect(m2.inputTokens).toBe(350);
    expect(m2.cacheReadTokens).toBe(150);
    expect(m2.outputTokens).toBe(300);
    expect(m2.reasoningTokens).toBe(150);
    expect(out.rateLimit?.primaryUsedPct).toBeCloseTo(12.0);
    expect(out.rateLimit?.planType).toBe('pro');
  });

  it('drops duplicate token_count events (issue #884)', () => {
    const out = parseCodexRollout(load('duplicate-token-count.jsonl'));
    expect(out.messages).toHaveLength(2);
    const total = out.messages.reduce(
      (a, m) => a + m.inputTokens + m.cacheReadTokens + m.outputTokens + m.reasoningTokens,
      0,
    );
    expect(total).toBe(280);
  });

  it('falls back to gpt-5 when no turn_context exists', () => {
    const out = parseCodexRollout(load('no-turn-context.jsonl'));
    expect(out.messages[0].model).toBe('gpt-5');
  });

  it('attributes each message to the most recent turn_context model', () => {
    const out = parseCodexRollout(load('multi-model.jsonl'));
    expect(out.messages[0].model).toBe('gpt-5-mini');
    expect(out.messages[1].model).toBe('gpt-5');
  });

  it('records originator from session_meta', () => {
    const out = parseCodexRollout(load('duplicate-token-count.jsonl'));
    expect(out.originator).toBe('codex_vscode');
  });

  it('treats missing reasoning_output_tokens as 0 (no NaN poisoning)', () => {
    const out = parseCodexRollout(load('no-reasoning-field.jsonl'));
    expect(out.messages).toHaveLength(1);
    const m = out.messages[0];
    expect(m.reasoningTokens).toBe(0);
    expect(Number.isFinite(m.inputTokens)).toBe(true);
    expect(Number.isFinite(m.outputTokens)).toBe(true);
    expect(Number.isFinite(m.cacheReadTokens)).toBe(true);
  });

  it('marks non-null Codex rate limit events as failed responses', () => {
    const out = parseCodexRollout([
      `{"timestamp":"2026-04-01T10:00:00.000Z","type":"session_meta","payload":{"id":"test-sess-rate-limited","cwd":"/p","originator":"codex_cli"}}`,
      `{"timestamp":"2026-04-01T10:00:01.000Z","type":"turn_context","payload":{"model":"gpt-5-codex"}}`,
      `{"timestamp":"2026-04-01T10:00:02.000Z","type":"event_msg","payload":{"type":"token_count","info":null,"rate_limits":{"primary":{"used_percent":100,"window_minutes":300,"resets_at":1781000000},"rate_limit_reached_type":"primary","plan_type":"pro"}}}`,
    ].join('\n'));

    expect(out.messages).toHaveLength(1);
    expect(out.messages[0].model).toBeNull();
    expect(out.messages[0].responseError).toBe(true);
    expect(out.messages[0].stopReason).toBe('primary');
    expect(out.messages[0].textPreview).toContain('Codex rate limit reached');
  });
});
