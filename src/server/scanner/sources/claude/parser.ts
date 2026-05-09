import type { ParsedMessage } from '../../../../shared/types.js';

const PREVIEW_LEN = 200;

export function parseJsonlLine(line: string, sessionId: string): ParsedMessage | null {
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || !obj.message || typeof obj.message !== 'object') {
    return null;
  }
  const m = obj.message;
  const role = m.role;
  if (role !== 'user' && role !== 'assistant') return null;

  const timestamp = obj.timestamp
    ? new Date(obj.timestamp).getTime()
    : Date.now();

  const usage = m.usage ?? {};
  const content = Array.isArray(m.content) ? m.content : [];
  const toolNames: string[] = content
    .filter((c: any) => c && c.type === 'tool_use' && typeof c.name === 'string')
    .map((c: any) => c.name);

  let textPreview: string | null = null;
  for (const c of content) {
    if (c && c.type === 'text' && typeof c.text === 'string') {
      textPreview = c.text.slice(0, PREVIEW_LEN);
      break;
    }
  }
  if (!textPreview && role === 'user' && typeof m.content === 'string') {
    textPreview = m.content.slice(0, PREVIEW_LEN);
  }

  const messageId: string = m.id ?? obj.uuid ?? `${sessionId}:${timestamp}`;

  return {
    messageId,
    sessionId,
    parentUuid: obj.parentUuid ?? null,
    role,
    model: m.model ?? null,
    timestamp,
    inputTokens: Number(usage.input_tokens) || 0,
    outputTokens: Number(usage.output_tokens) || 0,
    cacheCreationTokens: Number(usage.cache_creation_input_tokens) || 0,
    cacheReadTokens: Number(usage.cache_read_input_tokens) || 0,
    stopReason: m.stop_reason ?? null,
    toolNames,
    textPreview,
  };
}
