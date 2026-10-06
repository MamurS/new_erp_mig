import { describe, expect, it } from 'vitest';
import { tm } from '@/i18n';
import { changeDateProblem, daysInclusive, defaultEndDate, defaultTariff, policyPeriodProblem, policyPremium, proRataAmount, proRataDelta, tariffOf } from './policies';

const year = { startDate: '2026-01-01', endDate: '2026-12-31' };
const leap = { startDate: '2028-01-01', endDate: '2028-12-31' };
const t = { employee: 3_650_000, family: 2_920_000 };

describe('policy premium and pro-rata (POLICY_SPEC §3)', () => {
  it('defaults: family member is 80% of the employee tariff, a year minus a day', () => {
    expect(defaultTariff('standard')).toEqual({ employee: 3_800_000, family: 3_040_000 });
    expect(defaultEndDate('2026-10-01')).toBe('2027-09-30');
    expect(defaultEndDate('2028-02-29')).toBe('2029-02-28');
  });

  it('premium = tariffs × people, rounded to 1 000', () => {
    expect(policyPremium(t, 3, 2)).toBe(3 * 3_650_000 + 2 * 2_920_000);
    expect(policyPremium({ employee: 1_234_567, family: 0 }, 1, 0)).toBe(1_235_000);
  });

  it('counts days with both ends included, leap years too', () => {
    expect(daysInclusive(year.startDate, year.endDate)).toBe(365);
    expect(daysInclusive(leap.startDate, leap.endDate)).toBe(366);
  });

  it('pro-rata: whole period on the first day, one day on the last, half in the middle', () => {
    expect(proRataDelta(year, t, 'add', '2026-01-01')).toBe(3_650_000);
    expect(proRataDelta(year, t, 'add', '2026-12-31')).toBe(10_000);
    expect(proRataDelta(year, t, 'exclude', '2026-07-02')).toBe(-1_830_000); // 183 of 365 days
    expect(proRataAmount(year, t.employee + t.family, 'add', '2026-07-02')).toBe(3_294_000); // with one family member
    expect(proRataDelta(leap, { employee: 3_660_000, family: 0 }, 'add', '2028-12-31')).toBe(10_000);
  });

  it('is 0 outside the policy period and the dates are checked', () => {
    expect(proRataDelta(year, t, 'add', '2027-01-01')).toBe(0);
    expect(tm(changeDateProblem(year, 'add', '2025-12-31'))).toMatch(/срока полиса/);
    expect(tm(changeDateProblem(year, 'exclude', '2026-02-01', '2026-03-01'))).toMatch(/раньше даты прикрепления/);
    expect(changeDateProblem(year, 'exclude', '2026-04-01', '2026-03-01')).toBeNull();
  });

  it('policy period: 1–12 months, end after start', () => {
    expect(policyPeriodProblem('2026-10-01', '2027-09-30')).toBeNull();
    expect(tm(policyPeriodProblem('2026-10-01', '2027-10-01'))).toMatch(/12 месяцев/);
    expect(tm(policyPeriodProblem('2026-10-01', '2026-10-10'))).toMatch(/месяца/);
    expect(tm(policyPeriodProblem('2026-10-01', '2026-09-01'))).toMatch(/раньше начала/);
  });

  it('seed policies without a stored tariff fall back to premium per person', () => {
    expect(tariffOf({ premium: 10_000_000, insuredCount: 4, program: 'basic' })).toEqual({ employee: 2_500_000, family: 2_000_000 });
    expect(tariffOf({ premium: 0, insuredCount: 0, program: 'basic', tariff: undefined })).toEqual(defaultTariff('basic'));
  });
});
