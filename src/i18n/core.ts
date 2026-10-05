/*
 * Interface strings: one flat set of keys (`ns.screen.item`) in three locales. No React here, so
 * labels, formatters and module-level constants can read the current language too.
 *
 * - t(key, params): `{name}` placeholders are replaced by params.
 * - tp(base, n, params): plural forms live under `base.one|few|many|other` (Intl.PluralRules);
 *   `{n}` is the formatted number.
 * - msg(key, params) packs a key and its params into one string (zod messages, server field errors);
 *   tm(packed) translates it. A string that is not a known key is shown as is (user data).
 * - defineLabels(prefix, ids) makes `{ [id]: string }` whose values are read in the current language.
 *
 * Missing keys fall back to Russian, then to the key itself. Changing the language re-renders the app
 * from the root (I18nProvider), so values read during render are always current.
 */
import { getPref, setPref } from '@/shared/lib/storage';
import { DEFAULT_LOCALE, INTL_LOCALE, isLocale, type Locale } from './locales';
import { ru } from './dict/ru';
import { uzLatn } from './dict/uz-Latn';
import { en } from './dict/en';
import type { demo as ruDemo } from './dict/ru/demo';

/** Demo strings are registered by the demo module itself, so a build without VITE_DEMO_MODE has none. */
export type I18nKey = keyof typeof ru | keyof typeof ruDemo;
export type Params = Record<string, string | number>;

/** Keys that have plural forms: `base.other` exists. */
export type PluralBase = { [K in I18nKey]: K extends `${infer B}.other` ? B : never }[I18nKey];

const DICTS: Record<Locale, Record<string, string | undefined>> = { ru: { ...ru }, 'uz-Latn': { ...uzLatn }, en: { ...en } };

/** Adds a namespace that is loaded on demand (the demo module's strings). */
export function registerMessages(dicts: Record<Locale, Readonly<Record<string, string | undefined>>>): void {
  for (const l of Object.keys(dicts) as Locale[]) Object.assign(DICTS[l], dicts[l]);
}

let current: Locale = readStored();
const listeners = new Set<() => void>();

function readStored(): Locale {
  const v = getPref('lang', DEFAULT_LOCALE);
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

export function getLocale(): Locale {
  return current;
}

export function intlLocale(locale: Locale = current): string {
  return INTL_LOCALE[locale];
}

export function setLocale(locale: Locale): void {
  if (!isLocale(locale) || locale === current) return;
  current = locale;
  setPref('lang', locale);
  applyHtmlLang();
  for (const l of listeners) l();
}

/** `<html lang>`: ru, uz-Latn or en. */
export function applyHtmlLang(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = current;
}

export function subscribeLocale(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function interpolate(s: string, params?: Params): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

function lookup(locale: Locale, key: string): string | undefined {
  return DICTS[locale][key] ?? (locale === 'ru' ? undefined : DICTS.ru[key]);
}

export function hasKey(key: string): boolean {
  return DICTS.ru[key] !== undefined;
}

/** Translates in a given locale (tests, documents with their own language). */
export function translate(locale: Locale, key: I18nKey, params?: Params): string {
  return interpolate(lookup(locale, key) ?? key, params);
}

export function t(key: I18nKey, params?: Params): string {
  return translate(current, key, params);
}

/**
 * Keys built at run time (`labels.role.${role}`). The completeness and label tests make sure they
 * exist; an unknown key comes back unchanged.
 */
export function tKey(key: string, params?: Params): string {
  return interpolate(lookup(current, key) ?? key, params);
}

const pluralRules = new Map<Locale, Intl.PluralRules>();
function pluralCategory(locale: Locale, n: number): Intl.LDMLPluralRule {
  let r = pluralRules.get(locale);
  if (!r) {
    r = new Intl.PluralRules(INTL_LOCALE[locale]);
    pluralRules.set(locale, r);
  }
  return r.select(n);
}

export function translatePlural(locale: Locale, base: PluralBase, n: number, params?: Params): string {
  const cat = pluralCategory(locale, n);
  const s = lookup(locale, `${base}.${cat}`) ?? lookup(locale, `${base}.other`) ?? base;
  return interpolate(s, { n: new Intl.NumberFormat(INTL_LOCALE[locale]).format(n), ...params });
}

export function tp(base: PluralBase, n: number, params?: Params): string {
  return translatePlural(current, base, n, params);
}

const SEP = '|';

/** Packs a key and params into one string: `v.tooLong|{"max":200}`. */
export function msg(key: I18nKey, params?: Params): string {
  return params ? `${key}${SEP}${JSON.stringify(params)}` : key;
}

export function unpack(packed: string): { key: string; params?: Params } {
  const i = packed.indexOf(SEP);
  if (i < 0) return { key: packed };
  try {
    return { key: packed.slice(0, i), params: JSON.parse(packed.slice(i + 1)) as Params };
  } catch {
    return { key: packed };
  }
}

/** Translates a packed message; anything else (user data, an old message) is returned as is. */
export function tm(packed: string | undefined | null): string {
  if (!packed) return '';
  const { key, params } = unpack(packed);
  return hasKey(key) ? tKey(key, params) : packed;
}

/** A map of labels read in the current language: `defineLabels('labels.role', ROLES).operator`. */
export function defineLabels<K extends string>(prefix: string, ids: readonly K[]): Readonly<Record<K, string>> {
  const out = {} as Record<K, string>;
  for (const id of ids) Object.defineProperty(out, id, { enumerable: true, get: () => tKey(`${prefix}.${id}`) });
  return out;
}
