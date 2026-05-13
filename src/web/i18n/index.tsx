import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Locale } from 'antd/es/locale';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn.js';
import 'dayjs/locale/en.js';
import { MESSAGES, type Lang, type MessageKey } from './messages.js';

export type { Lang } from './messages.js';

const STORAGE_KEY = 'ccLang';

function readStoredLang(): Lang {
  if (typeof localStorage === 'undefined') return 'zh';
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === 'zh' || raw === 'en') return raw;
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('en')) {
    return 'en';
  }
  return 'zh';
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

export interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
  /**
   * Translate a message key. `MessageKey` gets autocomplete; plain `string` is
   * also accepted so server-emitted keys (e.g. monitor alerts) can be passed
   * directly. Unknown keys fall back to the key itself.
   */
  t: (key: MessageKey | (string & {}), vars?: Record<string, string | number>) => string;
  antdLocale: Locale;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readStoredLang());

  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, lang);
    }
    dayjs.locale(lang === 'zh' ? 'zh-cn' : 'en');
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    }
  }, [lang]);

  const setLang = useCallback((l: Lang) => setLangState(l), []);
  const toggle = useCallback(() => setLangState(prev => (prev === 'zh' ? 'en' : 'zh')), []);

  const t = useCallback<I18nCtx['t']>(
    (key, vars) => {
      const table = MESSAGES[lang] as Record<string, string>;
      const raw = table[key] ?? (MESSAGES.zh as Record<string, string>)[key] ?? key;
      return interpolate(raw, vars);
    },
    [lang],
  );

  const value = useMemo<I18nCtx>(
    () => ({ lang, setLang, toggle, t, antdLocale: lang === 'zh' ? zhCN : enUS }),
    [lang, setLang, toggle, t],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
