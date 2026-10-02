/*
 * Matching bank payments to invoices (1C statement): first by the invoice number in the payment
 * purpose, then by the payer's INN plus the exact outstanding amount. Anything ambiguous or not found
 * goes to the accountant's «Ручная разноска» queue with candidate invoices. Pure functions.
 */
import type { ISODate, Money, PaymentCandidateWhy, PaymentQueueReason, UUID } from '@/shared/types';

export interface OpenInvoice {
  id: UUID;
  number: string;
  clientId: UUID;
  /** INN of the invoiced client. */
  clientInn: string;
  amount: Money;
  paid: Money;
  dueDate: ISODate;
}

export interface StatementLine {
  amount: Money;
  payerInn: string;
  purpose: string;
}

export interface Candidate {
  invoiceId: UUID;
  why: PaymentCandidateWhy;
}

export type MatchResult =
  | { kind: 'matched'; invoiceId: UUID; by: 'number' | 'inn_amount' }
  | { kind: 'manual'; reason: PaymentQueueReason; candidates: Candidate[] };

export const PAYMENT_QUEUE_REASON_LABEL: Record<PaymentQueueReason, string> = {
  third_party: 'Счёт указан, но плательщик — другой ИНН',
  over_remaining: 'Сумма больше остатка по указанному счёту',
  several_numbers: 'В назначении несколько счетов',
  ambiguous: 'Несколько счетов плательщика с такой суммой',
  amount_mismatch: 'Сумма не совпадает ни с одним счётом плательщика',
  no_invoices: 'У плательщика нет неоплаченных счетов',
  unknown_payer: 'Плательщик с таким ИНН не найден',
};

export const PAYMENT_CANDIDATE_WHY_LABEL: Record<PaymentCandidateWhy, string> = {
  number: 'номер в назначении',
  inn_amount: 'ИНН и сумма',
  inn: 'ИНН плательщика',
  amount: 'сумма',
};

export const remainingOf = (i: Pick<OpenInvoice, 'amount' | 'paid'>): Money => Math.max(0, i.amount - i.paid);

/** Upper case, one kind of dash, no spaces: «сч - 2026 - 002001» and «СЧ-2026-002001» are the same. */
function normalizeRef(s: string): string {
  return s
    .toUpperCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/№/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ');
}

/** Invoices whose number appears in the purpose as a whole token (not a prefix of a longer number). */
export function invoicesNamedIn<T extends Pick<OpenInvoice, 'number'>>(
  purpose: string,
  invoices: readonly T[],
): T[] {
  const text = normalizeRef(purpose);
  return invoices.filter((i) => {
    const n = normalizeRef(i.number);
    let at = text.indexOf(n);
    while (at >= 0) {
      const before = text[at - 1];
      const after = text[at + n.length];
      if ((!before || !/[\p{L}\p{N}-]/u.test(before)) && (!after || !/[\p{L}\p{N}]/u.test(after)))
        return true;
      at = text.indexOf(n, at + 1);
    }
    return false;
  });
}

const byDue = (a: OpenInvoice, b: OpenInvoice) =>
  a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;

/**
 * `invoices` are all invoices that can be paid (with their current paid amount); paid ones are
 * ignored. A payment is matched automatically only when exactly one invoice fits.
 */
export function matchPayment(line: StatementLine, invoices: readonly OpenInvoice[]): MatchResult {
  const open = invoices.filter((i) => remainingOf(i) > 0).sort(byDue);
  const inn = line.payerInn.replace(/\D/g, '');

  // 1. The invoice number in the purpose.
  const named = invoicesNamedIn(line.purpose, open);
  if (named.length > 1)
    return {
      kind: 'manual',
      reason: 'several_numbers',
      candidates: named.map((i) => ({ invoiceId: i.id, why: 'number' })),
    };
  const one = named[0];
  if (one) {
    if (one.clientInn !== inn)
      return { kind: 'manual', reason: 'third_party', candidates: [{ invoiceId: one.id, why: 'number' }] };
    if (line.amount > remainingOf(one))
      return {
        kind: 'manual',
        reason: 'over_remaining',
        candidates: [{ invoiceId: one.id, why: 'number' }, ...others(open, one, inn)],
      };
    return { kind: 'matched', invoiceId: one.id, by: 'number' };
  }

  // 2. INN plus the exact outstanding amount.
  const own = open.filter((i) => i.clientInn === inn);
  const exact = own.filter((i) => remainingOf(i) === line.amount);
  if (exact.length === 1) return { kind: 'matched', invoiceId: exact[0]!.id, by: 'inn_amount' };
  if (exact.length > 1)
    return {
      kind: 'manual',
      reason: 'ambiguous',
      candidates: exact.map((i) => ({ invoiceId: i.id, why: 'inn_amount' })),
    };
  if (own.length)
    return {
      kind: 'manual',
      reason: 'amount_mismatch',
      candidates: own.map((i) => ({ invoiceId: i.id, why: 'inn' })),
    };

  // 3. Hints only: invoices of anyone with exactly this outstanding amount (a payment by a third party).
  const sameAmount = open
    .filter((i) => remainingOf(i) === line.amount)
    .map((i): Candidate => ({ invoiceId: i.id, why: 'amount' }));
  const payerKnown = invoices.some((i) => i.clientInn === inn);
  return { kind: 'manual', reason: payerKnown ? 'no_invoices' : 'unknown_payer', candidates: sameAmount };
}

function others(open: readonly OpenInvoice[], except: OpenInvoice, inn: string): Candidate[] {
  return open
    .filter((i) => i.id !== except.id && i.clientInn === inn)
    .map((i) => ({ invoiceId: i.id, why: 'inn' }));
}

/** Manual allocation of a queued payment; returns an error text or null. */
export function checkAllocation(
  payment: { amount: Money; allocated: Money; payerInn: string },
  lines: readonly { invoice: Pick<OpenInvoice, 'amount' | 'paid' | 'clientInn' | 'number'>; amount: Money }[],
  comment: string | undefined,
): string | null {
  if (!lines.length) return 'Выберите счёт';
  const total = lines.reduce((s, l) => s + l.amount, 0);
  if (total > payment.amount - payment.allocated)
    return `Сумма разноски больше остатка платежа (${payment.amount - payment.allocated})`;
  for (const l of lines) {
    if (l.amount <= 0) return 'Сумма по счёту больше нуля';
    if (l.amount > remainingOf(l.invoice)) return `Сумма больше остатка по счёту ${l.invoice.number}`;
  }
  const foreign = lines.some((l) => l.invoice.clientInn !== payment.payerInn.replace(/\D/g, ''));
  if (foreign && (comment ?? '').trim().length < 5)
    return 'Плательщик — другой ИНН: укажите комментарий (минимум 5 символов)';
  return null;
}
