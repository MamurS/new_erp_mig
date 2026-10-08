/*
 * React side of the interface strings. The provider sits at the app root; a language change
 * re-mounts everything below it, so every string read during render is in the new language
 * (form drafts on the screen are reset: the language is not changed in the middle of a form).
 */
import { Fragment, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { getPref, setPref } from '@/shared/lib/storage';
import { configureLocaleStore, getLocale, setLocale, subscribeLocale, t, tm, tp } from '@mig/i18n';
import { DEFAULT_LOCALE, type Locale } from '@mig/i18n';

// The chosen language is a UI preference of this browser.
configureLocaleStore({ load: () => getPref('lang', DEFAULT_LOCALE), save: (l) => setPref('lang', l) });

/** `<html lang>`: ru, uz-Latn or en. */
export function applyHtmlLang(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = getLocale();
}
subscribeLocale(applyHtmlLang);

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
} from '@mig/i18n';
export type { I18nKey, Params, PluralBase } from '@mig/i18n';
export { LOCALES, LOCALE_NAME, LOCALE_SHORT, INTL_LOCALE, isLocale, type Locale } from '@mig/i18n';

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
