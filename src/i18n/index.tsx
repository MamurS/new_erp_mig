/*
 * React side of the interface strings. The provider sits at the app root; a language change
 * re-mounts everything below it, so every string read during render is in the new language
 * (form drafts on the screen are reset: the language is not changed in the middle of a form).
 */
import { Fragment, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { applyHtmlLang, getLocale, setLocale, subscribeLocale, t, tm, tp } from './core';
import type { Locale } from './locales';

export {
  defineLabels,
  getLocale,
  hasKey,
  intlLocale,
  msg,
  setLocale,
  subscribeLocale,
  t,
  tKey,
  tm,
  tp,
  translate,
  translatePlural,
  unpack,
} from './core';
export type { I18nKey, Params, PluralBase } from './core';
export { LOCALES, LOCALE_NAME, LOCALE_SHORT, INTL_LOCALE, isLocale, type Locale } from './locales';

/** Kept for the insured app's existing code. */
export type Lang = Locale;

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  useEffect(() => applyHtmlLang(), [locale]);
  return <Fragment key={locale}>{children}</Fragment>;
}

export function useI18n() {
  const lang = useLocale();
  return { lang, setLang: setLocale, t, tp, tm };
}
