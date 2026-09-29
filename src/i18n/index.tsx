import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getPref, setPref } from '@/shared/lib/storage';
import { ru, type I18nKey } from './ru';
import { uz } from './uz';

export type Lang = 'ru' | 'uz';
const DICTS = { ru, uz } as const;

export function translate(lang: Lang, key: I18nKey, vars?: Record<string, string | number>): string {
  let s: string = DICTS[lang][key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: I18nKey, vars?: Record<string, string | number>) => string;
}

const I18nCtx = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => getPref('lang', 'ru'));
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    setPref('lang', l);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    return () => {
      document.documentElement.lang = 'ru';
    };
  }, [lang]);
  const value = useMemo<Ctx>(() => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars) }), [lang, setLang]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n(): Ctx {
  const c = useContext(I18nCtx);
  if (!c) throw new Error('I18nProvider missing');
  return c;
}

export type { I18nKey };
