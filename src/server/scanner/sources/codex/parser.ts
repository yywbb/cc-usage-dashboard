import type { ParsedMessage, RateLimitSnapshot } from '../../../../shared/types.js';
import { normalizeCwd } from './paths.js';

const PREVIEW_LEN = 200;

export interface CodexFileResult {
  sessionId: string;
  cwdRealPath: string | null;
  originator: string | null;
  messages: ParsedMessage[];
  rateLimit: RateLimitSnapshot | null;
}

export function parseCodexRollout(content: string): CodexFileResult {
  let sessionId = '';
  let cwdRealPath: string | null = null;
  let originator: string | null = null;
  let currentModel: string | null = null;
  let lastAgentText: string | null = null;
  let rateLimit: RateLimitSnapshot | null = null;
  const messages: ParsedMessage[] = [];

  let prev = { input: 0, cached: 0, output: 0, reasoning: 0, total: 0 };

  const lines = content.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }

    if (ev.type === 'session_meta') {
      const p = ev.payload ?? {};
      sessionId = p.id ?? sessionId;
      cwdRealPath = normalizeCwd(p.cwd);
      originator = p.originator ?? null;
      continue;
    }

    if (ev.type === 'turn_context') {
      currentModel = ev.payload?.model ?? currentModel;
      continue;
    }

    if (ev.type === 'event_msg' && ev.payload?.type === 'agent_message') {
      const msg = ev.payload.message;
      if (typeof msg === 'string') lastAgentText = msg.slice(0, PREVIEW_LEN);
      continue;
    }

    if (ev.type !== 'event_msg' || ev.payload?.type !== 'token_count') continue;

    const cur = ev.payload.info?.total_token_usage;
    const rl  = ev.payload.rate_limits;
    const planType = ev.payload.plan_type ?? rl?.plan_type ?? null;

    if (rl) {
      rateLimit = {
        sessionId,
        observedAt: Date.parse(ev.timestamp),
        primaryUsedPct:    rl.primary?.used_percent    ?? null,
        primaryWindowMin:  rl.primary?.window_minutes  ?? null,
        primaryResetsAt:   rl.primary?.resets_at       ?? null,
        secondaryUsedPct:  rl.secondary?.used_percent  ?? null,
        secondaryWindowMin:rl.secondary?.window_minutes?? null,
        secondaryResetsAt: rl.secondary?.resets_at     ?? null,
        planType,
      };
    }

    if (!cur) continue;
    if (cur.total_tokens <= prev.total) continue;

    const dInput     = cur.input_tokens         - prev.input;
    const dCached    = cur.cached_input_tokens  - prev.cached;
    const dOutput    = cur.output_tokens        - prev.output;
    const dReasoning = (cur.reasoning_output_tokens ?? 0) - prev.reasoning;

    messages.push({
      messageId: `${sessionId}:${ev.timestamp}`,
      sessionId,
      parentUuid: null,
      role: 'assistant',
      model: currentModel ?? 'gpt-5',
      timestamp: Date.parse(ev.timestamp),
      inputTokens:        Math.max(0, dInput - dCached),
      outputTokens:       Math.max(0, dOutput),
      cacheCreationTokens: 0,
      cacheReadTokens:    Math.max(0, dCached),
      reasoningTokens:    Math.max(0, dReasoning),
      stopReason: null,
      toolNames: [],
      textPreview: lastAgentText,
      source: 'codex',
      originator,
      cwdRealPath,
    });

    prev = {
      input: cur.input_tokens, cached: cur.cached_input_tokens,
      output: cur.output_tokens, reasoning: cur.reasoning_output_tokens ?? 0,
      total: cur.total_tokens,
    };
  }

  return { sessionId, cwdRealPath, originator, messages, rateLimit };
}
