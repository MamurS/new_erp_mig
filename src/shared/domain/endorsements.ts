/*
 * Premium for the rest of the contract term (LIFECYCLE_SPEC §11): adding a person, excluding one
 * under three refund rules, changing the program. Every line carries a human formula.
 */
import { defineLabels, msg } from '@/i18n';
import type { ChangeRequestType, ISODate, Money } from '@/shared/types';
import { daysInclusive } from './policies';

export type RefundRule = 'pro_rata' | 'pro_rata_minus_claims' | 'none';
export const REFUND_RULES: readonly RefundRule[] = ['pro_rata', 'pro_rata_minus_claims', 'none'];
export type CoverageStartRule = 'from_hr_request' | 'from_endorsement_signed';
export const COVERAGE_START_RULES: readonly CoverageStartRule[] = ['from_hr_request', 'from_endorsement_signed'];
export type EndorsementPeriodicity = 'monthly' | 'per_change';
export const PERIODICITIES: readonly EndorsementPeriodicity[] = ['monthly', 'per_change'];

export const CHANGE_TYPE_LABEL = defineLabels<ChangeRequestType>('labels.changeType', ['add_insured', 'exclude_insured', 'change_program', 'other']);

export interface LineCalc {
  days: number;
  amount: Money;
  formula: string;
}

const g = (n: number) => String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Days from the effective date to the end of the contract, both included; 0 outside the term. */
export function remainingDays(effective: ISODate, start: ISODate, end: ISODate): number {
  if (effective > end) return 0;
  return daysInclusive(effective < start ? start : effective, end);
}

/** Inclusion: annual premium × remaining days / days of the term. */
export function addLine(annual: Money, effective: ISODate, start: ISODate, end: ISODate): LineCalc {
  const days = remainingDays(effective, start, end);
  const term = daysInclusive(start, end);
  const amount = Math.round((annual * days) / term);
  return { days, amount, formula: `${g(annual)} × ${days} / ${term} = ${g(amount)}` };
}

/** Exclusion under the refund rule; with claims deducted the refund is never below zero. */
export function excludeLine(annual: Money, effective: ISODate, start: ISODate, end: ISODate, rule: RefundRule, claimsPaid: Money): LineCalc {
  const days = remainingDays(effective, start, end);
  const term = daysInclusive(start, end);
  const proRata = Math.round((annual * days) / term);
  if (rule === 'none') return { days, amount: 0, formula: msg('dom.endorsement.noRefund') };
  if (rule === 'pro_rata') return { days, amount: -proRata, formula: `−(${g(annual)} × ${days} / ${term}) = −${g(proRata)}` };
  const refund = Math.max(0, proRata - claimsPaid);
  return {
    days,
    amount: -refund,
    formula: msg('dom.endorsement.minusClaims', { annual: g(annual), days, term, claims: g(claimsPaid), refund: g(refund) }),
  };
}

/** Program change: difference of annual premiums for the remaining term (may be negative). */
export function programChangeLine(oldAnnual: Money, newAnnual: Money, effective: ISODate, start: ISODate, end: ISODate): LineCalc {
  const days = remainingDays(effective, start, end);
  const term = daysInclusive(start, end);
  const amount = Math.round(((newAnnual - oldAnnual) * days) / term);
  return { days, amount, formula: `(${g(newAnnual)} − ${g(oldAnnual)}) × ${days} / ${term} = ${amount < 0 ? '−' : ''}${g(amount)}` };
}

/** Coverage of a new person starts on the HR request date or when the endorsement is signed. */
export function coverageStart(rule: CoverageStartRule, requestDate: ISODate, signedDate: ISODate | null): ISODate | null {
  return rule === 'from_hr_request' ? requestDate : signedDate;
}

/** `YYYY-MM` bucket of a monthly endorsement. */
export function monthOf(date: ISODate): string {
  return date.slice(0, 7);
}
