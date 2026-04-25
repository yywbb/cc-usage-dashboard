import { createContext, useContext, useState, useMemo, type ReactNode } from 'react';

interface Ctx {
  container: HTMLElement | null;
  setContainer: (el: HTMLElement | null) => void;
}

const PageHeaderCtx = createContext<Ctx | null>(null);

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ container, setContainer }), [container]);
  return <PageHeaderCtx.Provider value={value}>{children}</PageHeaderCtx.Provider>;
}

export function usePageHeader(): Ctx {
  const ctx = useContext(PageHeaderCtx);
  if (!ctx) throw new Error('usePageHeader must be used inside <PageHeaderProvider>');
  return ctx;
}
