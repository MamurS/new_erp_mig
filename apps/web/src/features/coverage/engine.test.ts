/* Coverage engine (AI_COVERAGE_SPEC §7): every branch of the verdict, sub-limits, waiting period, reserves of guarantee letters. */
import { describe, expect, it } from 'vitest';
import type { LimitUsage } from '@mig/contracts';
import { catalogItem, SERVICE_CATALOG } from './catalog';
import { COVERAGE_RULES } from './rules';
import { evaluateCoverage, limitStatus, ruleFor, type CoverageContext } from './engine';
import { clauseByRef } from '@mig/domain/documents/templates/index';

const limits = (over: Partial<Record<'outpatient' | 'dental' | 'medicines' | 'inpatient', Partial<LimitUsage>>> = {}): LimitUsage[] =>
  (['outpatient', 'dental', 'medicines', 'inpatient'] as const).map((category) => ({ category, limit: 10_000_000, used: 0, reserved: 0, ...over[category] }));

const ctx = (over: Partial<CoverageContext> = {}): CoverageContext => ({
  program: 'standard',
  policy: { id: 'p', status: 'active', startDate: '2026-01-01', endDate: '2026-12-31' },
  insured: { id: 'i', insuredFrom: '2026-01-01', status: 'active' },
  limits: limits(),
  rules: COVERAGE_RULES,
  catalog: catalogItem,
  ...over,
});
const input = (serviceCodes: string[], over: { serviceDate?: string; amount?: number } = {}) => ({ policyId: 'p', insuredId: 'i', serviceCodes, serviceDate: '2026-10-01', ...over });

describe('catalog and rules', () => {
  it('~150 services with synonyms, unique codes; every group has a rule in every program; every clause exists', () => {
    expect(SERVICE_CATALOG.length).toBeGreaterThanOrEqual(150);
    expect(new Set(SERVICE_CATALOG.map((s) => s.code)).size).toBe(SERVICE_CATALOG.length);
    for (const s of SERVICE_CATALOG) {
      expect(s.synonyms.length, s.code).toBeGreaterThan(0);
      for (const p of ['basic', 'standard', 'standard_plus', 'premium'] as const) expect(ruleFor(COVERAGE_RULES, p, s), `${p} ${s.code}`).toBeTruthy();
    }
    for (const r of COVERAGE_RULES) for (const ref of r.clauseIds) expect(clauseByRef(ref), ref).toBeTruthy();
  });
});

describe('evaluateCoverage', () => {
  it('covered with the clause and the remaining limit', () => {
    const v = evaluateCoverage(input(['TH-101'], { amount: 180_000 }), ctx());
    expect(v).toMatchObject({ decision: 'covered', clauseIds: ['program:1.1'], limit: { category: 'outpatient', remaining: 10_000_000, afterThis: 9_820_000 } });
  });
  it('needs a guarantee letter: by the rule and by the service', () => {
    expect(evaluateCoverage(input(['DG-314']), ctx()).decision).toBe('needs_guarantee');
    expect(evaluateCoverage(input(['IP-601']), ctx()).clauseIds).toContain('contract:4.5');
  });
  it('excluded: vitamins, cosmetics, optics, prosthetics, check-ups', () => {
    for (const code of ['VT-101', 'CS-101', 'OPT-101', 'DP-102', 'CH-101', 'CL-101', 'BD-101']) {
      const v = evaluateCoverage(input([code]), ctx());
      expect(v.decision, code).toBe('excluded');
      expect(v.clauseIds.some((c) => c.startsWith('program:6.')), code).toBe(true);
    }
  });
  it('program differences: vaccination and dental hygiene only in the richer programs', () => {
    expect(evaluateCoverage(input(['MD-503']), ctx()).decision).toBe('excluded');
    expect(evaluateCoverage(input(['MD-503']), ctx({ program: 'premium' })).decision).toBe('covered');
    expect(evaluateCoverage(input(['PH-101']), ctx({ program: 'basic' })).decision).toBe('excluded');
  });
  it('waiting period from the start of the person\'s coverage', () => {
    const c = ctx({ insured: { id: 'i', insuredFrom: '2026-09-20', status: 'active' } });
    const v = evaluateCoverage(input(['DT-402'], { serviceDate: '2026-10-01' }), c);
    expect(v.decision).toBe('excluded');
    expect(v.clauseIds).toContain('program:7.2');
    expect(evaluateCoverage(input(['DT-402'], { serviceDate: '2026-10-20' }), c).decision).toBe('covered');
    expect(evaluateCoverage(input(['DT-402'], { serviceDate: '2026-10-01' }), { ...c, program: 'premium' }).decision).toBe('covered');
  });
  it('limit: reserves of approved guarantee letters count; exhausted → limit_exhausted', () => {
    const reserved = ctx({ limits: limits({ outpatient: { used: 6_000_000, reserved: 3_500_000 } }) });
    expect(evaluateCoverage(input(['TH-101'], { amount: 180_000 }), reserved).limit).toMatchObject({ remaining: 500_000, afterThis: 320_000 });
    const out = ctx({ limits: limits({ outpatient: { used: 6_000_000, reserved: 4_000_000 } }) });
    expect(evaluateCoverage(input(['TH-101']), out)).toMatchObject({ decision: 'limit_exhausted', clauseIds: ['program:7.1', 'contract:4.6'] });
    const partly = evaluateCoverage(input(['TH-101'], { amount: 900_000 }), reserved);
    expect(partly.decision).toBe('covered');
    expect(partly.notes.join(' ')).toMatch(/частично/);
  });
  it('sub-limit of physiotherapy', () => {
    const v = evaluateCoverage(input(['PH-101'], { amount: 2_000_000 }), ctx());
    expect(v.notes.join(' ')).toMatch(/Подлимит 1500000/);
    expect(v.limit!.afterThis).toBe(10_000_000 - 1_500_000);
  });
  it('policy inactive: outside the policy term, before the person\'s coverage, after exclusion, a non-active policy', () => {
    expect(evaluateCoverage(input(['TH-101'], { serviceDate: '2027-01-02' }), ctx()).decision).toBe('policy_inactive');
    expect(evaluateCoverage(input(['TH-101'], { serviceDate: '2026-03-01' }), ctx({ insured: { id: 'i', insuredFrom: '2026-04-01', status: 'active' } })).decision).toBe('policy_inactive');
    expect(evaluateCoverage(input(['TH-101']), ctx({ insured: { id: 'i', insuredFrom: '2026-01-01', excludedFrom: '2026-09-01', status: 'excluded' } })).decision).toBe('policy_inactive');
    expect(evaluateCoverage(input(['TH-101']), ctx({ policy: { id: 'p', status: 'expired', startDate: '2026-01-01', endDate: '2026-12-31' } })).decision).toBe('policy_inactive');
  });
  it('unknown: no codes, an unknown code, no rule', () => {
    expect(evaluateCoverage(input([]), ctx()).decision).toBe('unknown');
    expect(evaluateCoverage(input(['ZZ-999']), ctx()).decision).toBe('unknown');
    expect(evaluateCoverage(input(['TH-101']), ctx({ rules: [] })).decision).toBe('unknown');
  });
  it('several codes: the strictest verdict wins, clauses of all are listed', () => {
    const v = evaluateCoverage(input(['TH-101', 'DG-314', 'VT-101']), ctx());
    expect(v.decision).toBe('excluded');
    expect(v.clauseIds).toEqual(expect.arrayContaining(['program:1.1', 'program:2.3', 'program:6.2']));
    expect(evaluateCoverage(input(['TH-101', 'DG-314']), ctx()).decision).toBe('needs_guarantee');
  });
  it('limit status for clinics without sums', () => {
    const l = limits({ outpatient: { used: 9_000_000 } });
    expect(limitStatus({ category: 'outpatient', remaining: 1_000_000 }, l, 0.2)).toBe('low');
    expect(limitStatus({ category: 'outpatient', remaining: 5_000_000 }, l, 0.2)).toBe('available');
    expect(limitStatus({ category: 'outpatient', remaining: 0 }, l, 0.2)).toBe('exhausted');
    expect(limitStatus(null, l, 0.2)).toBeNull();
  });
});
