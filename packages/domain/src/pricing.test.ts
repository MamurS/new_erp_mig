/* Premium of a person included during the term by the contract terms: by type or by the age band table. */
import { tm } from '@mig/i18n';
import { describe, expect, it } from 'vitest';
import type { AgeBandRate } from '@mig/contracts';
import { DMS_DEFAULTS } from './config/dmsParameters';
import { migrationContractRowSchema } from './schemas/migration';
import { addLine } from './endorsements';
import { asPricingRule, bandTableProblem, contractPricing, formatAgeBands, parseAgeBands, personPremium, PricingError, pricingProblem, type ContractPricing } from './pricing';
import { calculateQuote } from './tariff';

const BANDS: AgeBandRate[] = [
  { minAge: 0, maxAge: 17, annual: 900_000 },
  { minAge: 18, maxAge: 29, annual: 1_200_000 },
  { minAge: 30, maxAge: 59, annual: 1_600_000 },
  { minAge: 60, maxAge: null, annual: 2_900_000 },
];
const FLAT: ContractPricing = { pricingBasis: 'flat_by_type', premiumEmployee: 1_500_000, premiumFamily: 1_200_000 };
const BANDED: ContractPricing = { ...FLAT, pricingBasis: 'age_banded', ageBandRates: BANDS };
const CHILD = { relation: 'child' as const, birthDate: '2016-03-09' };
const GROWN = { relation: 'child' as const, birthDate: '2008-10-06' };
const EMPLOYEE = { relation: 'employee' as const, birthDate: '1987-05-12' };

describe('flat_by_type (default)', () => {
  it('an employee pays premium_employee, every family member premium_family whatever the age', () => {
    expect(personPremium(FLAT, EMPLOYEE, '2026-10-06')).toEqual({ annual: 1_500_000, rule: { basis: 'flat_by_type', key: 'premium_employee' } });
    expect(personPremium(FLAT, CHILD, '2026-10-06')).toEqual({ annual: 1_200_000, rule: { basis: 'flat_by_type', key: 'premium_family' } });
    expect(personPremium(FLAT, { relation: 'parent', birthDate: '1950-01-01' }, '2026-10-06').annual).toBe(1_200_000);
    // A table on a contract priced by type is not used.
    expect(personPremium({ ...BANDED, pricingBasis: 'flat_by_type' }, CHILD, '2026-10-06').annual).toBe(1_200_000);
  });
  it('contracts saved without the field count as flat_by_type', () => {
    expect(contractPricing({ premiumEmployee: 1, premiumFamily: 2 }).pricingBasis).toBe('flat_by_type');
  });
});

describe('age_banded', () => {
  it('the rate of the band of the age on the inclusion date', () => {
    expect(personPremium(BANDED, CHILD, '2026-10-06')).toEqual({ annual: 900_000, rule: { basis: 'age_banded', minAge: 0, maxAge: 17 } });
    expect(personPremium(BANDED, EMPLOYEE, '2026-10-06').annual).toBe(1_600_000);
    expect(personPremium(BANDED, { relation: 'parent', birthDate: '1950-01-01' }, '2026-10-06').rule).toEqual({ basis: 'age_banded', minAge: 60, maxAge: null });
  });
  it('boundary: the 18th birthday on the inclusion date moves the child to the next band', () => {
    expect(personPremium(BANDED, GROWN, '2026-10-05').annual).toBe(900_000);
    expect(personPremium(BANDED, GROWN, '2026-10-06').annual).toBe(1_200_000);
  });
  it('without a table it is an error, not a fallback', () => {
    const noTable: ContractPricing = { ...FLAT, pricingBasis: 'age_banded' };
    expect(() => personPremium(noTable, CHILD, '2026-10-06')).toThrow(PricingError);
    expect(pricingProblem(noTable)).toBe('dom.pricing.noBandTable');
    expect(pricingProblem({ ...noTable, ageBandRates: [] })).toBe('dom.pricing.noBandTable');
    expect(pricingProblem(FLAT)).toBeNull();
    expect(pricingProblem(BANDED)).toBeNull();
  });
  it('the table starts at 0, has no gaps or overlaps, ends open, rates above zero', () => {
    expect(bandTableProblem(BANDS)).toBeNull();
    expect(bandTableProblem(BANDS.slice(1))).toBe('dom.pricing.badBandTable');
    expect(bandTableProblem([BANDS[0]!, { minAge: 19, maxAge: null, annual: 1 }])).toBe('dom.pricing.badBandTable');
    expect(bandTableProblem([BANDS[0]!, { minAge: 17, maxAge: null, annual: 1 }])).toBe('dom.pricing.badBandTable');
    expect(bandTableProblem(BANDS.slice(0, 3))).toBe('dom.pricing.badBandTable');
    expect(bandTableProblem([{ minAge: 0, maxAge: null, annual: 0 }])).toBe('dom.pricing.badBandTable');
    expect(bandTableProblem([{ minAge: 0, maxAge: null, annual: 1_000_000 }])).toBeNull();
  });
  it('the quote derives the table from its tariff, coefficients and discounts', () => {
    const rows = Array.from({ length: 30 }, (_, k) => ({ gender: 'm' as const, birthYear: 1960 + k, relation: 'employee' as const }));
    const calc = calculateQuote({ program: 'standard', rows, startDate: '2026-11-01', adjustments: [{ label: 'x', pct: -0.1, comment: 'test' }] }, DMS_DEFAULTS);
    expect(bandTableProblem(calc.ageBandRates)).toBeNull();
    expect(calc.ageBandRates.map((r) => [r.minAge, r.maxAge])).toEqual([[0, 17], [18, 29], [30, 39], [40, 49], [50, 59], [60, null]]);
    const base = DMS_DEFAULTS.tariffBaseStandard;
    const factor = (1 - calc.groupDiscountPct) * 0.9;
    expect(calc.ageBandRates[2]!.annual).toBe(Math.round((base * DMS_DEFAULTS.tariffCoef30to39 * factor) / 1000) * 1000);
  });
});

describe('the endorsement line names the rule', () => {
  const start = '2026-01-01';
  const end = '2026-12-31'; // 365 days
  it('by type and by age band, × remaining days / term days', () => {
    const flat = personPremium(FLAT, CHILD, '2026-06-15');
    const l = addLine(flat.annual, '2026-06-15', start, end, flat.rule);
    expect(l.days).toBe(200);
    expect(l.amount).toBe(Math.round((1_200_000 * 200) / 365));
    expect(tm(l.formula)).toBe(`по типу: premium_family 1 200 000 × 200 / 365 = ${String(l.amount).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`);
    const banded = personPremium(BANDED, CHILD, '2026-06-15');
    expect(tm(addLine(banded.annual, '2026-06-15', start, end, banded.rule).formula)).toMatch(/^по возрастной группе 0–17: 900 000 × 200 \/ 365 = /);
    // Without a rule (a transferred person's own premium) the formula is the bare calculation.
    expect(addLine(1_000_000, '2026-06-15', start, end).formula).toMatch(/^1 000 000 × 200 \/ 365 = /);
  });
  it('a rule stored in a change request is read back safely', () => {
    expect(asPricingRule({ basis: 'flat_by_type', key: 'premium_family' })).toEqual({ basis: 'flat_by_type', key: 'premium_family' });
    expect(asPricingRule({ basis: 'age_banded', minAge: 60, maxAge: null })).toEqual({ basis: 'age_banded', minAge: 60, maxAge: null });
    expect(asPricingRule({ basis: 'flat_by_type', key: 'x' })).toBeUndefined();
    expect(asPricingRule('age_banded')).toBeUndefined();
  });
});

describe('band table in the transfer files', () => {
  it('parses and prints «0-17:900000; …; 60+:2900000»', () => {
    const text = formatAgeBands(BANDS);
    expect(text).toBe('0-17:900000; 18-29:1200000; 30-59:1600000; 60+:2900000');
    expect(parseAgeBands(text)).toEqual(BANDS);
    expect(parseAgeBands('0-17: 900 000;60+:2 900 000')).toEqual([BANDS[0], BANDS[3]]);
    expect(parseAgeBands('0-17=900000')).toBeNull();
    expect(parseAgeBands('')).toBeNull();
  });
  const row = { oldNumber: 'MIG-1', clientStir: '301234567', startDate: '2026-03-01', endDate: '2027-02-28', program: 'standard', premium: '6300000', premium_employee: '3500000', premium_family: '2800000', paymentFrequency: 'single', assistance: '' };
  it('pricing_basis: empty → flat_by_type; age_banded needs a valid age_bands table', () => {
    const flat = migrationContractRowSchema.safeParse(row);
    expect(flat.success && flat.data.pricing_basis).toBe('flat_by_type');
    expect(flat.success && flat.data.age_bands).toBeUndefined();
    const banded = migrationContractRowSchema.safeParse({ ...row, pricing_basis: 'AGE_BANDED', age_bands: formatAgeBands(BANDS) });
    expect(banded.success && banded.data.age_bands).toEqual(BANDS);
    const issue = (r: Record<string, string>) => {
      const p = migrationContractRowSchema.safeParse(r);
      return p.success ? null : p.error.issues.map((i) => `${i.path.join('.')}:${i.message}`);
    };
    expect(issue({ ...row, pricing_basis: 'age_banded' })).toEqual(['age_bands:dom.pricing.noBandTable']);
    expect(issue({ ...row, pricing_basis: 'age_banded', age_bands: '0-17:900000; 30+:1000000' })).toEqual(['age_bands:dom.pricing.badBandTable']);
    expect(issue({ ...row, pricing_basis: 'age_banded', age_bands: 'all:900000' })).toEqual(['age_bands:migration.v.ageBandsFormat']);
    expect(issue({ ...row, pricing_basis: 'by_age' })).toEqual(['pricing_basis:migration.v.pricingBasis']);
  });
});
