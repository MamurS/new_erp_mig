/*
 * Premium of a person included during the contract term, by the contract's terms (`pricingBasis`):
 * - `flat_by_type` (default) — premium_employee for an employee, premium_family for a family member;
 * - `age_banded` — the annual rate of the person's age band on the inclusion date, from the contract's
 *   band table (an appendix taken from the approved quote).
 * The amount for the rest of the term is that annual premium × remaining days / term days (endorsements.ts).
 */
import { defineLabels, msg } from '@/i18n';
import type { AgeBandRate, Contract, ISODate, InsuredRelation, Money, PricingBasis } from '@/shared/types';
import { ageOn } from './family';

export const PRICING_BASES = ['flat_by_type', 'age_banded'] as const satisfies readonly PricingBasis[];
/** «По типу (сотрудник / член семьи)», «По возрастной группе». */
export const PRICING_BASIS_LABEL = defineLabels<PricingBasis>('labels.pricingBasis', PRICING_BASES);

/** The contract terms the premium of a person depends on. */
export interface ContractPricing {
  pricingBasis: PricingBasis;
  premiumEmployee: Money;
  premiumFamily: Money;
  ageBandRates?: readonly AgeBandRate[];
}

/** The pricing terms of a contract (contracts saved before `pricingBasis` count as `flat_by_type`). */
export function contractPricing(params: Pick<Contract['params'], 'premiumEmployee' | 'premiumFamily' | 'ageBandRates'> & { pricingBasis?: PricingBasis }): ContractPricing {
  return { pricingBasis: params.pricingBasis ?? 'flat_by_type', premiumEmployee: params.premiumEmployee, premiumFamily: params.premiumFamily, ageBandRates: params.ageBandRates };
}

/** Which rule gave the premium: shown in the endorsement line. */
export type PricingRule =
  | { basis: 'flat_by_type'; key: 'premium_employee' | 'premium_family' }
  | { basis: 'age_banded'; minAge: number; maxAge: number | null };

export interface PersonPremium {
  annual: Money;
  rule: PricingRule;
}

/** «0–17», «60+». */
export function bandLabel(b: { minAge: number; maxAge: number | null }): string {
  return b.maxAge === null ? `${b.minAge}+` : `${b.minAge}–${b.maxAge}`;
}

export function bandRateFor(rates: readonly AgeBandRate[], age: number): AgeBandRate | undefined {
  return rates.find((r) => age >= r.minAge && (r.maxAge === null || age <= r.maxAge));
}

/**
 * Why the band table is not usable (packed message), or null. A table starts at age 0, has no gaps or
 * overlaps, ends with an open band, and each rate is a whole positive amount.
 */
export function bandTableProblem(rates: readonly AgeBandRate[] | undefined): string | null {
  if (!rates?.length) return msg('dom.pricing.noBandTable');
  let next = 0;
  for (const [i, r] of rates.entries()) {
    const last = i === rates.length - 1;
    const bad =
      r.minAge !== next ||
      !Number.isInteger(r.annual) ||
      r.annual <= 0 ||
      (r.maxAge === null ? !last : !Number.isInteger(r.maxAge) || r.maxAge < r.minAge || last);
    if (bad) return msg('dom.pricing.badBandTable');
    next = (r.maxAge ?? 0) + 1;
  }
  return null;
}

/** Why the contract's pricing terms cannot be used (the contract cannot be saved or signed), or null. */
export function pricingProblem(p: Pick<ContractPricing, 'pricingBasis' | 'ageBandRates'>): string | null {
  return p.pricingBasis === 'age_banded' ? bandTableProblem(p.ageBandRates) : null;
}

export class PricingError extends Error {
  constructor(readonly problem: string) {
    super(problem);
    this.name = 'PricingError';
  }
}

/**
 * Annual premium of a person under the contract terms, with the rule used. For `age_banded` the band is
 * the person's age (full years by the date of birth) on `on` — the inclusion date. Throws `PricingError`
 * when the contract is `age_banded` without a usable table.
 */
export function personPremium(p: ContractPricing, person: { relation: InsuredRelation; birthDate: ISODate | '' }, on: ISODate): PersonPremium {
  if (p.pricingBasis === 'age_banded') {
    const problem = bandTableProblem(p.ageBandRates);
    if (problem) throw new PricingError(problem);
    const band = person.birthDate ? bandRateFor(p.ageBandRates!, ageOn(person.birthDate, on)) : undefined;
    if (!band) throw new PricingError(msg('dom.pricing.noBand'));
    return { annual: band.annual, rule: { basis: 'age_banded', minAge: band.minAge, maxAge: band.maxAge } };
  }
  return person.relation === 'employee'
    ? { annual: p.premiumEmployee, rule: { basis: 'flat_by_type', key: 'premium_employee' } }
    : { annual: p.premiumFamily, rule: { basis: 'flat_by_type', key: 'premium_family' } };
}

/** A rule stored in a change request payload (`payload.rule`), if it is one. */
export function asPricingRule(v: unknown): PricingRule | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  if (r.basis === 'flat_by_type' && (r.key === 'premium_employee' || r.key === 'premium_family')) return { basis: 'flat_by_type', key: r.key };
  if (r.basis === 'age_banded' && typeof r.minAge === 'number' && (r.maxAge === null || typeof r.maxAge === 'number')) return { basis: 'age_banded', minAge: r.minAge, maxAge: r.maxAge };
  return undefined;
}

/** Text form of a band table in the transfer files: «0-17:900000; 18-29:1200000; …; 60+:2900000». */
export function formatAgeBands(rates: readonly AgeBandRate[]): string {
  return rates.map((r) => `${r.minAge}${r.maxAge === null ? '+' : `-${r.maxAge}`}:${r.annual}`).join('; ');
}

/**
 * Parses the text form of a band table (spaces inside sums allowed); null when a part is malformed.
 * Whether the bands cover all ages is checked separately (`bandTableProblem`).
 */
export function parseAgeBands(text: string): AgeBandRate[] | null {
  const parts = text.split(';').map((x) => x.trim()).filter(Boolean);
  if (!parts.length || parts.length > 20) return null;
  const out: AgeBandRate[] = [];
  for (const part of parts) {
    const m = /^(\d{1,3})\s*(?:-\s*(\d{1,3})|(\+))\s*:\s*(\d[\d\s\u00a0]{0,16})$/.exec(part);
    if (!m) return null;
    const annual = Number(m[4]!.replace(/[\s\u00a0]/g, ''));
    out.push({ minAge: Number(m[1]), maxAge: m[3] ? null : Number(m[2]), annual });
  }
  return out;
}
