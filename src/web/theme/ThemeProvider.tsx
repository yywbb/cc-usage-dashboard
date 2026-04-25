import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { ThemeContext } from './useTheme.js';
import { TOKENS, RADIUS, type Mode } from './tokens.js';

const STORAGE_KEY = 'ccTheme';

function readStoredMode(): Mode {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  return raw === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(() => readStoredMode());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
    document.documentElement.dataset.theme = mode;
    document.body.style.background = TOKENS[mode].pageBg;
    document.body.style.color = TOKENS[mode].textPrimary;

    const root = document.documentElement;
    if (mode === 'dark') {
      root.style.setProperty('--cc-sb-track', 'transparent');
      root.style.setProperty('--cc-sb-thumb', 'rgba(148,163,184,0.25)');
      root.style.setProperty('--cc-sb-thumb-hover', 'rgba(148,163,184,0.45)');
    } else {
      root.style.setProperty('--cc-sb-track', 'transparent');
      root.style.setProperty('--cc-sb-thumb', 'rgba(100,116,139,0.28)');
      root.style.setProperty('--cc-sb-thumb-hover', 'rgba(100,116,139,0.55)');
    }
  }, [mode]);

  const toggle = useCallback(() => setMode(m => (m === 'light' ? 'dark' : 'light')), []);

  const ctx = useMemo(() => ({ mode, toggle }), [mode, toggle]);
  const t = TOKENS[mode];

  return (
    <ThemeContext.Provider value={ctx}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: {
            colorPrimary: t.primary,
            colorSuccess: t.success,
            colorWarning: t.warning,
            colorError: t.danger,
            colorBgLayout: t.pageBg,
            colorBgContainer: t.cardBg,
            colorBorder: t.border,
            colorBorderSecondary: t.border,
            colorText: t.textPrimary,
            colorTextSecondary: t.textSecondary,
            borderRadius: RADIUS.control,
            borderRadiusLG: RADIUS.card,
            fontFamily: `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif`,
          },
          components: {
            Card: { borderRadiusLG: RADIUS.card, paddingLG: 18 },
            Table: { headerBg: t.pageBg, rowHoverBg: t.pageBg },
            Layout: { siderBg: t.sidebarBg, headerBg: t.cardBg, bodyBg: t.pageBg },
            Menu: { darkItemBg: t.sidebarBg, darkSubMenuItemBg: t.sidebarBg },
          },
        }}
      >
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}
