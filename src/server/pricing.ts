export interface ModelPrice {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

const M = 1_000_000;

export const PRICING: Record<string, ModelPrice> = {
  'claude-opus-4-7':   { input: 15 / M, output: 75 / M, cacheCreate: 18.75 / M, cacheRead: 1.50 / M },
  'claude-sonnet-4-6': { input:  3 / M, output: 15 / M, cacheCreate:  3.75 / M, cacheRead: 0.30 / M },
  'claude-haiku-4-5':  { input:  1 / M, output:  5 / M, cacheCreate:  1.25 / M, cacheRead: 0.10 / M },
};

const FALLBACK_MODEL = 'claude-sonnet-4-6';

export function computeCostUsd(model: string, tokens: TokenCounts): number {
  const price = PRICING[model] ?? PRICING[FALLBACK_MODEL];
  return (
    tokens.inputTokens          * price.input       +
    tokens.outputTokens         * price.output      +
    tokens.cacheCreationTokens  * price.cacheCreate +
    tokens.cacheReadTokens      * price.cacheRead
  );
}
