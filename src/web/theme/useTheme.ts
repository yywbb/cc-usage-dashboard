import { createContext, useContext } from 'react';
import type { Mode } from './tokens.js';

export interface ThemeCtx {
  mode: Mode;
  toggle: () => void;
}

export const ThemeContext = createContext<ThemeCtx | null>(null);

export function useTheme(): ThemeCtx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
