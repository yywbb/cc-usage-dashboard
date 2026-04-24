import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

export interface PageHeaderState {
  title: string;
  subtitle?: string;
  extra?: ReactNode;
}

interface Ctx {
  state: PageHeaderState | null;
  set: (s: PageHeaderState | null) => void;
}

const PageHeaderCtx = createContext<Ctx | null>(null);

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PageHeaderState | null>(null);
  const set = useCallback((s: PageHeaderState | null) => setState(s), []);
  const value = useMemo(() => ({ state, set }), [state, set]);
  return <PageHeaderCtx.Provider value={value}>{children}</PageHeaderCtx.Provider>;
}

export function usePageHeader(): Ctx {
  const ctx = useContext(PageHeaderCtx);
  if (!ctx) throw new Error('usePageHeader must be used inside <PageHeaderProvider>');
  return ctx;
}
