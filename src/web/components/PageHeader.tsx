import { useEffect, type ReactNode } from 'react';
import { usePageHeader } from './PageHeaderContext.js';

export default function PageHeader({
  title, subtitle, extra,
}: { title: string; subtitle?: string; extra?: ReactNode }) {
  const { set } = usePageHeader();
  useEffect(() => {
    set({ title, subtitle, extra });
    return () => set(null);
  }, [title, subtitle, extra, set]);
  return null;
}
