/* Pure helpers for the insured app (no React). */
import type { I18nKey } from '@/i18n';
import type { LimitCategory, MyClaim, Specialty } from '@/shared/types';
import { addDaysISO, todayISO } from '@/shared/lib/format';
import { isSafeHttpUrl, safeUrl } from '@/shared/lib/safeUrl';

export const SPECIALTIES: readonly Specialty[] = [
  'therapist',
  'pediatrician',
  'dentist',
  'cardiologist',
  'gynecologist',
  'ent',
  'neurologist',
  'ophthalmologist',
];

export function isSpecialty(v: unknown): v is Specialty {
  return typeof v === 'string' && (SPECIALTIES as readonly string[]).includes(v);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** Limit category that pays for a visit to this doctor. */
export function limitForSpecialty(s: Specialty): LimitCategory {
  return s === 'dentist' ? 'dental' : 'outpatient';
}

/** The next `count` calendar days in Tashkent, starting today. */
export function nextDays(count = 4, now: Date = new Date()): string[] {
  const today = todayISO(now);
  return Array.from({ length: count }, (_, i) => addDaysISO(today, i));
}

/** Weekday index (0 = Sunday) of an ISO date. */
export function weekdayOf(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

type T = (key: I18nKey, vars?: Record<string, string | number>) => string;

/** «Сегодня», «Завтра», or «Чт, 01.10». */
export function dayLabel(iso: string, t: T, now: Date = new Date()): string {
  const today = todayISO(now);
  if (iso === today) return t('common.today');
  if (iso === addDaysISO(today, 1)) return t('common.tomorrow');
  const [, m, d] = iso.split('-');
  return `${t(`weekday.${weekdayOf(iso)}` as I18nKey)}, ${d}.${m}`;
}

export const CLAIM_STEP_KEYS: readonly MyClaim['steps'][number]['key'][] = ['received', 'checked', 'approved', 'paid'];

/** Number of completed steps (0..4) for the four-step bar. */
export function doneSteps(claim: Pick<MyClaim, 'steps'>): number {
  return claim.steps.filter((s) => s.done).length;
}

export type TextPart = { kind: 'text'; value: string } | { kind: 'link'; value: string; href: string };

/**
 * Splits chat text into plain text and links. Only absolute http(s) URLs that pass
 * `isSafeHttpUrl` become links; anything else (e.g. `javascript:`) stays as text.
 */
export function linkify(text: string): TextPart[] {
  const out: TextPart[] = [];
  const re = /\bhttps?:\/\/[^\s<>"']+/gi;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    // Trailing punctuation belongs to the sentence, not the URL.
    const raw = m[0].replace(/[.,;:!?)»]+$/, '');
    if (idx > last) out.push({ kind: 'text', value: text.slice(last, idx) });
    if (isSafeHttpUrl(raw)) out.push({ kind: 'link', value: raw, href: safeUrl(raw) });
    else out.push({ kind: 'text', value: raw });
    last = idx + raw.length;
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
  return out.filter((p) => p.value.length > 0);
}

export const CHAT_MAX = 1000;

/** QR payload: only the one-time token, never PINFL or other personal data (SPEC §8.4, §9.4). */
export function qrPayload(token: string): string {
  return `MIG-DMS:${token}`;
}
