import type { ISODate, ISODateTime, Money } from '@mig/contracts';
import { getLocale, intlLocale, intlSupports, t, tp } from '@mig/i18n';
import { INTL_LOCALE } from '@mig/i18n';

export const TZ = 'Asia/Tashkent';
const DAY_MS = 86_400_000;

/** Normalises the narrow no-break space Intl uses to a regular no-break space. */
function spaces(s: string): string {
  return s.replace(/[\u202f\u00a0]/g, '\u00a0');
}

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat>();
function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat>(key: string, make: () => T): T {
  let f = cache.get(key) as T | undefined;
  if (!f) {
    f = make();
    cache.set(key, f);
  }
  return f;
}
const numberFmt = (digits: number) =>
  cached(`n:${intlLocale()}:${digits}`, () => new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: digits }));

/** `12 500 000 сум` (ru), `12 500 000 soʻm` (uz-Latn), `12,500,000 UZS` (en). */
export function formatMoney(value: Money, withCurrency = true): string {
  const n = spaces(numberFmt(0).format(Math.round(value)));
  return withCurrency ? `${n}\u00a0${t('fmt.currency')}` : n;
}

/** Compact money for KPIs: `12,5 млн сум`. */
export function formatMoneyShort(value: Money): string {
  const abs = Math.abs(value);
  const v = (x: number) => spaces(numberFmt(1).format(x));
  const nb = (s: string) => spaces(s).replace(/ /g, '\u00a0');
  if (abs >= 1e9) return nb(`${t('fmt.billion', { v: v(value / 1e9) })} ${t('fmt.currency')}`);
  if (abs >= 1e6) return nb(`${t('fmt.million', { v: v(value / 1e6) })} ${t('fmt.currency')}`);
  return formatMoney(value);
}

/** `digits`: fraction digits shown (a rate like «1,4 на 1000»); the separator follows the language. */
export function formatNumber(value: number, digits = 0): string {
  return spaces(numberFmt(digits).format(value));
}

export function formatPercent(ratio: number, digits = 0): string {
  const f = cached(
    `p:${intlLocale()}:${digits}`,
    () => new Intl.NumberFormat(intlLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }),
  );
  return `${f.format(ratio * 100)}%`;
}

/** Calendar parts of a moment in Asia/Tashkent. */
export function tashkentParts(d: Date): { y: number; m: number; d: number; hh: number; mm: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour'), mm: get('minute') };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDate(value: ISODate | ISODateTime | Date): Date {
  if (value instanceof Date) return value;
  // A bare ISO date is interpreted as midnight in Tashkent.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00+05:00`);
  return new Date(value);
}

const dateOpts: Intl.DateTimeFormatOptions = { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' };
const timeOpts: Intl.DateTimeFormatOptions = { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };

/** `29.09.2026` (ru), `29/09/2026` (uz-Latn, en). */
export function formatDate(value: ISODate | ISODateTime | Date): string {
  return cached(`d:${intlLocale()}`, () => new Intl.DateTimeFormat(intlLocale(), dateOpts)).format(toDate(value));
}

/** `14:21` */
export function formatTime(value: ISODateTime | Date): string {
  return cached(`t:${intlLocale()}`, () => new Intl.DateTimeFormat(intlLocale(), timeOpts)).format(toDate(value));
}

/** `29.09.2026, 14:21` */
export function formatDateTime(value: ISODateTime | Date): string {
  return cached(`dt:${intlLocale()}`, () => new Intl.DateTimeFormat(intlLocale(), { ...dateOpts, ...timeOpts })).format(
    toDate(value),
  );
}

/** Documents keep their own fixed formats, whatever the interface language: `29.09.2026`. */
export function formatDateDoc(value: ISODate | ISODateTime | Date): string {
  const p = tashkentParts(toDate(value));
  return `${pad(p.d)}.${pad(p.m)}.${p.y}`;
}

/** Documents: `12 500 000 UZS`. */
export function formatMoneyDoc(value: Money, withCurrency = true): string {
  const n = spaces(new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(value)));
  return withCurrency ? `${n}\u00a0UZS` : n;
}

/** Today in Tashkent as ISO date. */
export function todayISO(now: Date = new Date()): ISODate {
  const p = tashkentParts(now);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function isoDateOf(value: ISODateTime | Date): ISODate {
  return todayISO(toDate(value));
}

/** Whole calendar days between today and the target (in Tashkent). */
export function daysUntil(value: ISODate | ISODateTime, now: Date = new Date()): number {
  const a = toDate(todayISO(now)).getTime();
  const b = toDate(isoDateOf(toDate(value))).getTime();
  return Math.round((b - a) / DAY_MS);
}

/** «через 16 дн.», «сегодня», «вчера» — Intl.RelativeTimeFormat in the interface language. */
export function formatRelativeDays(value: ISODate | ISODateTime, now: Date = new Date()): string {
  const days = daysUntil(value, now);
  // Without Intl data for the language (Uzbek in some Chromium builds) the words come from the dictionary.
  if (!intlSupports(INTL_LOCALE[getLocale()], 'relative')) {
    if (days === 0) return t('fmt.rel.today');
    if (days === 1) return t('fmt.rel.tomorrow');
    if (days === -1) return t('fmt.rel.yesterday');
    return days > 0 ? tp('fmt.rel.in', days) : tp('fmt.rel.ago', -days);
  }
  const f = cached(
    `r:${intlLocale()}`,
    () => new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'auto', style: 'short' }),
  );
  return f.format(days, 'day').replace(/[\u202f\u00a0]/g, ' ');
}

/** Adds days to an ISO date. */
export function addDaysISO(date: ISODate, days: number): ISODate {
  const d = toDate(date);
  return todayISO(new Date(d.getTime() + days * DAY_MS + 12 * 3600_000));
}

/** Russian plural helper: plural(5, ['клиент','клиента','клиентов']). */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** Two-letter initials for avatars. */
export function initials(name: string): string {
  // Names of legal entities carry no legal form (it is a separate field), so every word counts.
  const words = name
    .replace(/[«»"'()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** Seconds to `m:ss`. */
export function formatCountdown(totalSec: number): string {
  const s = Math.max(0, Math.ceil(totalSec));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return t('fmt.bytes', { v: bytes });
  if (bytes < 1024 * 1024) return t('fmt.kb', { v: Math.round(bytes / 1024) });
  return t('fmt.mb', { v: spaces(numberFmt(1).format(bytes / 1024 / 1024)) });
}
