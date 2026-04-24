export type Mode = 'light' | 'dark';

interface Tokens {
  primary: string;
  primaryHover: string;
  purple: string;
  cyan: string;
  success: string;
  warning: string;
  danger: string;
  pageBg: string;
  cardBg: string;
  sidebarBg: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  chartPalette: string[];
}

export const TOKENS: Record<Mode, Tokens> = {
  light: {
    primary: '#4f46e5',
    primaryHover: '#4338ca',
    purple: '#8b5cf6',
    cyan: '#06b6d4',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    pageBg: '#f7f8fa',
    cardBg: '#ffffff',
    sidebarBg: '#0f172a',
    border: '#eef2f7',
    textPrimary: '#0f172a',
    textSecondary: '#64748b',
    textMuted: '#94a3b8',
    chartPalette: ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'],
  },
  dark: {
    primary: '#818cf8',
    primaryHover: '#a5b4fc',
    purple: '#a78bfa',
    cyan: '#22d3ee',
    success: '#34d399',
    warning: '#fbbf24',
    danger: '#f87171',
    pageBg: '#0b1220',
    cardBg: '#111827',
    sidebarBg: '#0f172a',
    border: '#1f2937',
    textPrimary: '#f1f5f9',
    textSecondary: '#94a3b8',
    textMuted: '#64748b',
    chartPalette: ['#818cf8', '#a78bfa', '#22d3ee', '#34d399', '#fbbf24', '#f87171'],
  },
};

export const RADIUS = { card: 12, control: 8 } as const;
export const SPACING = { cardPad: 18, pageX: 28, pageY: 22 } as const;
