/* Interface languages. The Uzbek Cyrillic script may come later as a transliteration of uz-Latn. */
export type Locale = 'ru' | 'uz-Latn' | 'en';

export const LOCALES: readonly Locale[] = ['ru', 'uz-Latn', 'en'];
export const DEFAULT_LOCALE: Locale = 'ru';

/** Locale tags for Intl (dates, numbers, plural rules, relative time). */
export const INTL_LOCALE: Record<Locale, string> = {
  ru: 'ru-RU',
  'uz-Latn': 'uz-Latn-UZ',
  en: 'en-GB',
};

/** Names in the switcher, each in its own language (not translated). */
export const LOCALE_NAME: Record<Locale, string> = {
  ru: 'Русский',
  'uz-Latn': 'Oʻzbekcha',
  en: 'English',
};

/** Short codes for compact switchers. */
export const LOCALE_SHORT: Record<Locale, string> = {
  ru: 'RU',
  'uz-Latn': 'UZ',
  en: 'EN',
};

export function isLocale(v: unknown): v is Locale {
  return v === 'ru' || v === 'uz-Latn' || v === 'en';
}
