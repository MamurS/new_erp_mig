import type { ISODate, ISODateTime, Money } from '@/shared/types';

export const TZ = 'Asia/Tashkent';
const DAY_MS = 86_400_000;

const moneyFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

/** Normalises the narrow no-break space Intl uses to a regular no-break space. */
function spaces(s: string): string {
  return s.replace(/[  ]/g, ' ');
}

/** `12 500 000 UZS` */
export function formatMoney(value: Money, withCurrency = true): string {
  const n = spaces(moneyFmt.format(Math.round(value)));
  return withCurrency ? `${n} UZS` : n;
}

/** Compact money for KPIs: `12,5 млн UZS`. */
export function formatMoneyShort(value: Money): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${spaces((value / 1e9).toLocaleString('ru-RU', { maximumFractionDigits: 1 }))} млрд UZS`;
  if (abs >= 1e6) return `${spaces((value / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 }))} млн UZS`;
  return formatMoney(value);
}

export function formatNumber(value: number): string {
  return spaces(moneyFmt.format(value));
}

export function formatPercent(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`;
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

/** `29.09.2026` */
export function formatDate(value: ISODate | ISODateTime | Date): string {
  const p = tashkentParts(toDate(value));
  return `${pad(p.d)}.${pad(p.m)}.${p.y}`;
}

/** `14:21` */
export function formatTime(value: ISODateTime | Date): string {
  const p = tashkentParts(toDate(value));
  return `${pad(p.hh)}:${pad(p.mm)}`;
}

/** `29.09.2026, 14:21` */
export function formatDateTime(value: ISODateTime | Date): string {
  return `${formatDate(value)}, ${formatTime(value)}`;
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

/** «через 16 дн», «сегодня», «−1 дн» */
export function formatRelativeDays(value: ISODate | ISODateTime, now: Date = new Date()): string {
  const days = daysUntil(value, now);
  if (days === 0) return 'сегодня';
  if (days > 0) return `через ${days} дн`;
  return `−${Math.abs(days)} дн`;
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
  const words = name
    .replace(/[«»"'()]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !['ООО', 'АО', 'СП', 'ЧП'].includes(w));
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
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
}
