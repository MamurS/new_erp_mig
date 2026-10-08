import { describe, expect, it } from 'vitest';
import { tm } from '@mig/i18n';
import { DMS_DEFAULTS, formBit } from './config/dmsParameters';
import { belowMin, countsOf, exclusionDropsBelow, groupLabel, groupRulesOf, groupSize, legalFormAllowed, legalFormProblem } from './minGroup';
import { canApproveQuote, quoteAuthorityProblem } from './tariff';

const rules = groupRulesOf(DMS_DEFAULTS);

describe('minimal group: the «Клиенты» parameters', () => {
  it('demo values: 10 employees, family not counted, all forms but ИП, notify during the term', () => {
    expect(rules).toMatchObject({ min: 10, countsFamily: false, belowMinDuringTerm: 'notify' });
    expect(legalFormAllowed('llc', rules)).toBe(true);
    expect(legalFormAllowed('jsc', rules)).toBe(true);
    expect(legalFormAllowed('sole_proprietor', rules)).toBe(false);
  });

  it('a disallowed form gets an explanation naming the form; an allowed one none', () => {
    expect(legalFormProblem('llc', rules)).toBeNull();
    expect(tm(legalFormProblem('sole_proprietor', rules))).toMatch(/не допускается: ДМС оформляется только для компаний/);
    expect(legalFormAllowed('sole_proprietor', { allowedForms: rules.allowedForms | formBit('sole_proprietor') })).toBe(true);
  });

  it('the size counts employees, or employees with family members when the parameter says so', () => {
    const c = countsOf([{ relation: 'employee' }, { relation: 'employee' }, { relation: 'spouse' }, { relation: 'child' }]);
    expect(c).toEqual({ employees: 2, family: 2 });
    expect(groupSize(c, { countsFamily: false })).toBe(2);
    expect(groupSize(c, { countsFamily: true })).toBe(4);
    expect(belowMin({ employees: 9, family: 5 }, rules)).toBe(true);
    expect(belowMin({ employees: 9, family: 5 }, { min: 10, countsFamily: true })).toBe(false);
    expect(belowMin({ employees: 10, family: 0 }, rules)).toBe(false);
    expect(tm(groupLabel({ employees: 6, family: 1 }, rules))).toBe('Сотрудников 6 из минимума 10');
    expect(tm(groupLabel({ employees: 6, family: 1 }, { min: 10, countsFamily: true }))).toBe('Застрахованных 7 из минимума 10');
  });

  it('an exclusion drops the group below the minimum only when it crosses it', () => {
    expect(exclusionDropsBelow({ employees: 10, family: 0 }, { employees: 1, family: 0 }, rules)).toBe(true);
    expect(exclusionDropsBelow({ employees: 11, family: 0 }, { employees: 1, family: 3 }, rules)).toBe(false);
    expect(exclusionDropsBelow({ employees: 11, family: 3 }, { employees: 1, family: 3 }, { min: 12, countsFamily: true })).toBe(true);
    // Already below: no new crossing.
    expect(exclusionDropsBelow({ employees: 8, family: 0 }, { employees: 1, family: 0 }, rules)).toBe(false);
  });

  it('a quote below the minimum needs the exception authority, whatever the discount', () => {
    const q = { discountFromTariffPct: 0, total: 1_000_000 };
    const below = { size: 6, min: 10 };
    expect(tm(quoteAuthorityProblem(q, { quoteDiscountMaxPct: 0.1 }, below))).toMatch(/численность ниже минимальной: 6 из 10/);
    expect(quoteAuthorityProblem(q, { quoteDiscountMaxPct: 0.1, allowBelowMinGroup: true }, below)).toBeNull();
    expect(quoteAuthorityProblem(q, { quoteDiscountMaxPct: 0.1 }, { size: 10, min: 10 })).toBeNull();
    const uw = { id: 'a', role: 'underwriter', authority: { quoteDiscountMaxPct: 0.1 } };
    expect(canApproveQuote(uw, { ...q, createdById: 'b' }, below)).toBe(false);
    expect(canApproveQuote({ ...uw, authority: { ...uw.authority, allowBelowMinGroup: true } }, { ...q, createdById: 'b' }, below)).toBe(true);
  });
});
