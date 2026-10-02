/*
 * Pure formatting helpers for commercial offer (KP) documents. No DOM: the backend repeats them.
 * Every value that ends up in HTML goes through escapeHtml(), including already formatted numbers.
 */
import type { Client, ISODate, KpLang, KpPaymentTerms } from '@/shared/types';
import { escapeHtml } from '@/features/documents/html';

export { escapeHtml };

function assertAmount(n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('Amount must be a non-negative safe integer');
}

/** Groups digits of a validated integer: `15 000 000` (ru, NBSP) or `15,000,000` (en). */
export function groupDigits(n: number, lang: KpLang): string {
  assertAmount(n);
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'ru' ? '\u00A0' : ',');
}

/** Money as in the GOLD brochure: `15 000 000 сум` (ru) or `15,000,000 UZS` (en). */
export function formatKpMoney(n: number, lang: KpLang): string {
  return lang === 'ru' ? `${groupDigits(n, lang)}\u00A0сум` : `${groupDigits(n, lang)} UZS`;
}

/** `2026-09-30` → `30.09.2026` (both languages). Invalid input yields an empty string. */
export function formatKpDate(iso: ISODate): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

export const PAYMENT_TERMS_LABEL: Record<KpLang, Record<KpPaymentTerms, string>> = {
  ru: { single: 'Единовременно', quarterly: 'Поквартально', monthly: 'Помесячно' },
  en: { single: 'Single payment', quarterly: 'Quarterly', monthly: 'Monthly' },
};

const LEGAL_FORM_EN: Record<Client['legalForm'], string> = {
  ООО: 'LLC',
  АО: 'JSC',
  'СП ООО': 'JV LLC',
  ЧП: 'PE',
};

/** `ООО «Name»` (ru) or `LLC “Name”` (en). Returns plain text; escape before use in HTML. */
export function clientDisplayName(legalForm: Client['legalForm'], name: string, lang: KpLang): string {
  return lang === 'ru' ? `${legalForm} «${name}»` : `${LEGAL_FORM_EN[legalForm]} “${name}”`;
}
