import { describe, expect, it } from 'vitest';
import { makeKpParamsSchema } from './forms';

const schema = makeKpParamsSchema(() => '2026-09-30');
const valid = {
  templateId: 'gold',
  lang: 'ru',
  variant: 'grey',
  sumInsured: 200_000_000,
  premiumEmployee: 15_000_000,
  premiumFamily: 5_000_000,
  employees: 45,
  familyMembers: 0,
  coverageStart: '01.01.2027',
  coverageEnd: '2027-12-31',
  validUntil: '30.09.2026',
  paymentTerms: 'single',
};
const fields = (v: unknown) => {
  const r = schema.safeParse(v);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
};

describe('kpParamsSchema', () => {
  it('accepts valid parameters and normalises dates to ISO', () => {
    const r = schema.parse(valid);
    expect(r.coverageStart).toBe('2027-01-01');
    expect(r.validUntil).toBe('2026-09-30');
  });
  it('limits sums to integers 1…10¹² and counts to 0…100 000, at least one employee', () => {
    expect(fields({ ...valid, sumInsured: 0 })).toContain('sumInsured');
    expect(fields({ ...valid, premiumEmployee: 1.5 })).toContain('premiumEmployee');
    expect(fields({ ...valid, premiumFamily: 1_000_000_000_001 })).toContain('premiumFamily');
    expect(fields({ ...valid, sumInsured: 1_000_000_000_000 })).toEqual([]);
    expect(fields({ ...valid, employees: 0 })).toContain('employees');
    expect(fields({ ...valid, familyMembers: -1 })).toContain('familyMembers');
    expect(fields({ ...valid, familyMembers: 100_001 })).toContain('familyMembers');
    expect(fields({ ...valid, sumInsured: '100' })).toContain('sumInsured');
  });
  it('requires coverageEnd after coverageStart and validUntil not in the past', () => {
    expect(fields({ ...valid, coverageEnd: '01.01.2027' })).toContain('coverageEnd');
    expect(fields({ ...valid, validUntil: '29.09.2026' })).toContain('validUntil');
  });
  it('rejects unknown templates, languages and covers', () => {
    expect(fields({ ...valid, templateId: 'silver' })).toContain('templateId');
    expect(fields({ ...valid, lang: 'uz' })).toContain('lang');
    expect(fields({ ...valid, variant: 'red' })).toContain('variant');
  });
});
