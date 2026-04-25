import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePageHeader } from './PageHeaderContext.js';
import { useTheme } from '../theme/useTheme.js';
import { TOKENS } from '../theme/tokens.js';

export default function PageHeader({
  title, subtitle, extra,
}: { title: string; subtitle?: string; extra?: ReactNode }) {
  const { container } = usePageHeader();
  const { mode } = useTheme();
  const t = TOKENS[mode];
  if (!container) return null;
  return createPortal(
    <>
      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
        <div style={{
          fontSize: 20, fontWeight: 600, color: t.textPrimary,
          lineHeight: 1.2, letterSpacing: -0.2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: 12, lineHeight: 1.4, color: t.textSecondary, marginTop: 4 }}>{subtitle}</div>
        )}
      </div>
      {extra && <div style={{ display: 'flex', alignItems: 'center' }}>{extra}</div>}
    </>,
    container,
  );
}
