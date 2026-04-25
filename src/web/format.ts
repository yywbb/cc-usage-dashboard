import { useStore } from './store.js';

export function formatTokensCompact(n: number): string {
  const v = Math.round(n);
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 1 : 2) + 'k';
  return v.toLocaleString();
}

export function formatTokensExact(n: number): string {
  return Math.round(n).toLocaleString();
}

export function useFormatTokens(): (n: number) => string {
  const compact = useStore(s => s.compactNumbers);
  return compact ? formatTokensCompact : formatTokensExact;
}
