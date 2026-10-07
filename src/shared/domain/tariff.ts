/*
 * Demo tariff and quote calculation (LIFECYCLE_SPEC §5). Base rates, age coefficients and the group
 * discount are DMS parameters; the functions take their current values and are pure.
 */
import { msg } from '@/i18n';
import type { AgeBand, AgeBandRate, CensusRelation, DmsParamKey, DmsParamValues, ISODate, Money, ProgramCode, Quote, StaffAuthority } from '@/shared/types';
import { TARIFF_BASE_KEY } from '@/shared/config/dmsParameters';

export const AGE_BANDS: readonly AgeBand[] = ['0-17', '18-29', '30-39', '40-49', '50-59', '60+'];

export const AGE_BAND_LABEL: Record<AgeBand, string> = {
  '0-17': '0–17',
  '18-29': '18–29',
  '30-39': '30–39',
  '40-49': '40–49',
  '50-59': '50–59',
  '60+': '60+',
};

export const BAND_COEF_KEY: Record<AgeBand, DmsParamKey> = {
  '0-17': 'tariffCoef0to17',
  '18-29': 'tariffCoef18to29',
  '30-39': 'tariffCoef30to39',
  '40-49': 'tariffCoef40to49',
  '50-59': 'tariffCoef50to59',
  '60+': 'tariffCoef60plus',
};

/** A quote age band as a row of the contract's band table: '0-17' → 0..17, '60+' → 60 and older. */
export function bandBounds(band: AgeBand): { minAge: number; maxAge: number | null } {
  if (band.endsWith('+')) return { minAge: Number(band.slice(0, -1)), maxAge: null };
  const [min, max] = band.split('-').map(Number) as [number, number];
  return { minAge: min, maxAge: max };
}

export interface CensusRow {
  gender: 'm' | 'f';
  birthYear: number;
  relation: CensusRelation;
}

const round1000 = (v: number) => Math.round(v / 1000) * 1000;

/** Age in full years on a date, from the birth year only (the census has no birth dates). */
export function ageOn(birthYear: number, date: ISODate): number {
  return Math.max(0, Number(date.slice(0, 4)) - birthYear);
}

export function bandOf(age: number): AgeBand {
  if (age < 18) return '0-17';
  if (age < 30) return '18-29';
  if (age < 40) return '30-39';
  if (age < 50) return '40-49';
  if (age < 60) return '50-59';
  return '60+';
}

export interface QuoteInput {
  program: ProgramCode;
  rows: readonly CensusRow[];
  /** Start of coverage: ages are counted on it. */
  startDate: ISODate;
  adjustments: readonly { label: string; pct: number; comment: string }[];
}

export type QuoteCalc = Pick<Quote, 'rates' | 'groupDiscountPct' | 'premiumEmployee' | 'premiumFamily' | 'total' | 'discountFromTariffPct' | 'ageBandRates'> & {
  employees: number;
  familyMembers: number;
  /** Total by the tariff with the group discount, before manual adjustments. */
  tariffTotal: Money;
};

/**
 * Premium = Σ by age bands (count × base rate × coefficient) × (1 − group discount) × (1 + Σ adjustments).
 * Premiums per employee and per family member are the averages of their groups, rounded to 1000;
 * the total is built from them, so the contract and the schedule add up exactly.
 */
export function calculateQuote(input: QuoteInput, params: Readonly<DmsParamValues>): QuoteCalc {
  const base = params[TARIFF_BASE_KEY[input.program]];
  const people = input.rows.map((r) => ({ ...r, band: bandOf(ageOn(r.birthYear, input.startDate)) }));
  const rates = AGE_BANDS.map((band) => {
    const count = people.filter((p) => p.band === band).length;
    const coefficient = params[BAND_COEF_KEY[band]];
    return { band, count, baseRate: base, coefficient, premium: round1000(count * base * coefficient) };
  });
  const total = people.length;
  const groupDiscountPct = total >= params.groupDiscountFrom ? params.groupDiscountShare : 0;
  const adjustment = input.adjustments.reduce((s, a) => s + a.pct, 0);
  const factor = (1 - groupDiscountPct) * (1 + adjustment);
  const sumOf = (rel: (r: CensusRelation) => boolean) => people.filter((p) => rel(p.relation)).reduce((s, p) => s + base * params[BAND_COEF_KEY[p.band]], 0);
  const employees = people.filter((p) => p.relation === 'employee').length;
  const familyMembers = total - employees;
  const premiumEmployee = employees ? round1000((sumOf((r) => r === 'employee') * factor) / employees) : 0;
  const premiumFamily = familyMembers ? round1000((sumOf((r) => r !== 'employee') * factor) / familyMembers) : 0;
  return {
    rates,
    groupDiscountPct,
    premiumEmployee,
    premiumFamily,
    total: premiumEmployee * employees + premiumFamily * familyMembers,
    discountFromTariffPct: Math.max(0, Math.round(-adjustment * 10_000) / 10_000),
    employees,
    familyMembers,
    tariffTotal: round1000(rates.reduce((s, r) => s + r.premium, 0) * (1 - groupDiscountPct)),
    ageBandRates: ageBandRatesOf(base, params, factor),
  };
}

/**
 * The contract's age-band rate table derived from the quote (the appendix for `age_banded` contracts):
 * per person of a band, base rate × band coefficient × (1 − group discount) × (1 + adjustments), rounded to 1000.
 * The same factors as the quote's premiums, so the underwriter does not fill the table by hand.
 */
export function ageBandRatesOf(base: Money, params: Readonly<DmsParamValues>, factor: number): AgeBandRate[] {
  return AGE_BANDS.map((band) => ({ ...bandBounds(band), annual: round1000(base * params[BAND_COEF_KEY[band]] * factor) }));
}

/** Why a quote needs approval by someone with more authority; null when the author may approve it alone. */
export function quoteAuthorityProblem(
  q: Pick<Quote, 'discountFromTariffPct' | 'total'>,
  authority: StaffAuthority | undefined,
  /** The census group against the minimal group size: below it only `allowBelowMinGroup` approves. */
  group?: { size: number; min: number },
): string | null {
  if (group && group.size < group.min && !authority?.allowBelowMinGroup) return msg('dom.quote.belowMinGroup', { n: group.size, min: group.min });
  const maxDiscount = authority?.quoteDiscountMaxPct ?? 0;
  if (q.discountFromTariffPct > maxDiscount + 1e-9) return msg('dom.quote.discountAboveAuthority', { pct: pct(q.discountFromTariffPct), max: pct(maxDiscount) });
  if (authority?.quotePremiumMax !== undefined && q.total > authority.quotePremiumMax) return msg('dom.quote.premiumAboveAuthority');
  return null;
}

/** An approver of a quote: another underwriter whose authority covers it. */
export function canApproveQuote(
  approver: { id: string; role: string; authority?: StaffAuthority },
  q: Pick<Quote, 'discountFromTariffPct' | 'total' | 'createdById'>,
  group?: { size: number; min: number },
): boolean {
  return approver.role === 'underwriter' && approver.id !== q.createdById && quoteAuthorityProblem(q, approver.authority, group) === null;
}

function pct(v: number): string {
  return `${String(Math.round(v * 1000) / 10).replace('.', ',')}%`;
}
