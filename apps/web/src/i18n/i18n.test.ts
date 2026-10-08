import { afterEach, describe, expect, it } from 'vitest';
import { ru as ruMain } from '@mig/i18n/dict/ru/index';
import { uzLatn as uzMain } from '@mig/i18n/dict/uz-Latn/index';
import { en as enMain } from '@mig/i18n/dict/en/index';
import { demo as ruDemo } from '@mig/i18n/dict/ru/demo';
import { demo as uzDemo } from '@mig/i18n/dict/uz-Latn/demo';
import { demo as enDemo } from '@mig/i18n/dict/en/demo';

// The demo namespace is registered by the demo module at run time; the dictionaries cover it too.
const ru: Record<string, string> = { ...ruMain, ...ruDemo };
const uzLatn: Record<string, string> = { ...uzMain, ...uzDemo };
const en: Record<string, string> = { ...enMain, ...enDemo };
// Through the app's entry: it connects the language to storage.ts and <html lang>.
import { getLocale, msg, setLocale, t, tm, tp, translate, translatePlural, unpack } from '@/i18n';
import { getPref, setPref } from '@/shared/lib/storage';
import { formatMoney, formatMoneyShort, formatRelativeDays } from '@mig/domain/lib/format';

const RU_ONLY = /\.(few|many)$/;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

afterEach(() => setLocale('ru'));

describe('dictionaries', () => {
  const ruKeys = Object.keys(ru).sort();

  it.each([
    ['uz-Latn', uzLatn],
    ['en', en],
  ] as const)('%s has every Russian key, nothing else, and no empty values', (_name, dict) => {
    const keys = Object.keys(dict).sort();
    expect(keys.filter((k) => !(k in ru))).toEqual([]);
    expect(ruKeys.filter((k) => !RU_ONLY.test(k) && !(k in dict))).toEqual([]);
    for (const [k, v] of Object.entries(dict)) expect(v.trim(), k).not.toBe('');
  });

  it('namespaces never share a key (a later namespace would silently win)', () => {
    const modules = import.meta.glob<Record<string, Record<string, string>>>('../../../../packages/i18n/src/dict/ru/*.ts', { eager: true });
    const seen = new Map<string, string>();
    const dup: string[] = [];
    for (const [file, mod] of Object.entries(modules)) {
      if (file.endsWith('/index.ts')) continue;
      for (const ns of Object.values(mod))
        for (const k of Object.keys(ns)) {
          if (seen.has(k)) dup.push(`${k}: ${seen.get(k)} and ${file}`);
          seen.set(k, file);
        }
    }
    expect(dup).toEqual([]);
    expect(seen.size).toBe(Object.keys(ru).length);
  });

  it('Russian has no empty values', () => {
    for (const [k, v] of Object.entries(ru)) expect(v.trim(), k).not.toBe('');
  });

  it.each([
    ['uz-Latn', uzLatn],
    ['en', en],
  ] as const)('%s uses the same placeholders as Russian', (_name, dict) => {
    const d: Record<string, string> = dict;
    for (const [k, v] of Object.entries(ru)) {
      const other = d[k];
      if (other !== undefined) expect(placeholders(other), k).toEqual(placeholders(v));
    }
  });

  it('plural keys come in sets: every base has .other in all locales', () => {
    const bases = new Set(Object.keys(ru).filter((k) => /\.(one|few|many|other)$/.test(k)).map((k) => k.replace(/\.\w+$/, '')));
    for (const b of bases) {
      expect(ru, b).toHaveProperty([`${b}.other`]);
      expect(uzLatn, b).toHaveProperty([`${b}.other`]);
      expect(en, b).toHaveProperty([`${b}.other`]);
    }
  });

  it('Uzbek Latin uses ʻ (U+02BB) and ʼ (U+02BC), never ASCII or typographic apostrophes', () => {
    const bad: string[] = [];
    for (const [k, v] of Object.entries(uzLatn)) if (/['’‘`]/.test(v)) bad.push(`${k}: ${v}`);
    expect(bad).toEqual([]);
    // oʻ / gʻ are written with the turned comma, not with the modifier apostrophe.
    for (const [k, v] of Object.entries(uzLatn)) expect(/[OoGg]ʼ/.test(v), `${k}: ${v}`).toBe(false);
  });

  it('Uzbek Latin and English contain no Cyrillic (names of languages aside)', () => {
    for (const [k, v] of Object.entries({ ...uzLatn, ...en })) expect(/[А-Яа-яЁё]/.test(v), `${k}: ${v}`).toBe(false);
  });
});

describe('core', () => {
  it('interpolates, falls back to Russian, then to the key', () => {
    expect(translate('ru', 'shell.panel.withCount', { label: 'Убытки', n: 3 })).toBe('Убытки, задач: 3');
    expect(translate('en', 'shell.panel.withCount', { label: 'Claims', n: 3 })).toBe('Claims, tasks: 3');
    setLocale('uz-Latn');
    expect(t('shell.user.logout')).toBe('Chiqish');
    expect(tm('no.such.key')).toBe('no.such.key');
  });

  it('plural forms follow each language', () => {
    expect(translatePlural('ru', 'common.days', 1)).toBe('1 день');
    expect(translatePlural('ru', 'common.days', 3)).toBe('3 дня');
    expect(translatePlural('ru', 'common.days', 5)).toBe('5 дней');
    expect(translatePlural('ru', 'common.days', 21)).toBe('21 день');
    expect(translatePlural('en', 'common.days', 1)).toBe('1 day');
    expect(translatePlural('en', 'common.days', 5)).toBe('5 days');
    expect(translatePlural('uz-Latn', 'common.days', 5)).toBe('5 kun');
    setLocale('en');
    expect(tp('common.rows', 2)).toBe('2 rows');
  });

  it('packs a key with params for zod messages and server field errors', () => {
    const packed = msg('shell.panel.withCount', { label: 'X', n: 2 });
    expect(unpack(packed)).toEqual({ key: 'shell.panel.withCount', params: { label: 'X', n: 2 } });
    expect(tm(packed)).toBe('X, задач: 2');
    setLocale('en');
    expect(tm(packed)).toBe('X, tasks: 2');
    expect(tm('Текст пользователя')).toBe('Текст пользователя');
  });

  it('remembers the choice through storage.ts and sets <html lang>', () => {
    setLocale('en');
    expect(getLocale()).toBe('en');
    expect(getPref('lang', 'ru')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    setLocale('uz-Latn');
    expect(document.documentElement.lang).toBe('uz-Latn');
  });

  it('reads the old stored Uzbek choice as uz-Latn', () => {
    setPref('lang', 'uz' as never);
    expect(getPref('lang', 'ru')).toBe('uz-Latn');
  });
});

describe('formats follow the interface language', () => {
  const now = new Date('2026-09-29T09:00:00+05:00');
  it('money: сум, soʻm, UZS', () => {
    expect(formatMoney(12_500_000)).toBe('12 500 000 сум');
    expect(formatMoneyShort(12_500_000)).toBe('12,5 млн сум');
    setLocale('uz-Latn');
    expect(formatMoney(12_500_000)).toBe('12 500 000 soʻm');
    setLocale('en');
    expect(formatMoney(12_500_000)).toBe('12,500,000 UZS');
    expect(formatMoneyShort(12_500_000)).toBe('12.5M UZS');
  });

  it('relative days through Intl', () => {
    expect(formatRelativeDays('2026-10-15', now)).toBe('через 16 дн.');
    expect(formatRelativeDays('2026-09-29', now)).toBe('сегодня');
    setLocale('en');
    expect(formatRelativeDays('2026-10-15', now)).toBe('in 16 days');
    setLocale('uz-Latn');
    expect(formatRelativeDays('2026-10-15', now)).toBe('16 kundan keyin');
  });
});
