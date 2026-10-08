/* Policy issuance and changes of the insured list (POLICY_SPEC §3): tariffs, premium, pro-rata. */
import { defineLabels, msg } from '@mig/i18n';
import type { ISODate, Money, Policy, PolicyChangeKind, PolicyChangeStatus, PolicyTariff, ProgramCode } from '@mig/contracts';
import { DMS_DEFAULTS, TARIFF_BASE_KEY } from './config/dmsParameters';
import { toCsv } from './lib/csv';

/** Demo annual tariff per employee: the base rates of «Параметры ДМС». A family member costs FAMILY_SHARE of it. */
export const BASE_TARIFF: Record<ProgramCode, Money> = {
  basic: DMS_DEFAULTS[TARIFF_BASE_KEY.basic],
  standard: DMS_DEFAULTS[TARIFF_BASE_KEY.standard],
  standard_plus: DMS_DEFAULTS[TARIFF_BASE_KEY.standard_plus],
  premium: DMS_DEFAULTS[TARIFF_BASE_KEY.premium],
};
export const FAMILY_SHARE = 0.8;
export const POLICY_CSV_MAX_ROWS = 5000;
export const POLICY_CSV_MAX_BYTES = 5 * 1024 * 1024;
/**
 * A row per person (FAMILY_SPEC): a family member has `relation` (spouse, child, parent, other) and the employee's
 * PINFL in `principal_pinfl`; `student` = 1 for a child studying full time. Phone and position are optional for a
 * family member.
 */
export const POLICY_CSV_HEADER = ['fullName', 'birthDate', 'pinfl', 'phone', 'position', 'relation', 'principal_pinfl', 'student'] as const;
/** A policy that starts later than this is issued as a draft. */
export const DRAFT_IF_STARTS_IN_DAYS = 30;
export const MAX_POLICY_MONTHS = 12;

export const POLICY_CHANGE_KIND_LABEL = defineLabels<PolicyChangeKind>('labels.policyChangeKind', ['add', 'exclude']);
export const POLICY_CHANGE_STATUS_LABEL = defineLabels<PolicyChangeStatus>('labels.policyChangeStatus', ['pending', 'approved', 'rejected']);

const DAY = 86_400_000;
const round1000 = (v: number) => Math.round(v / 1000) * 1000;
const dayNumber = (d: ISODate) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY);

export function defaultTariff(program: ProgramCode): PolicyTariff {
  const employee = BASE_TARIFF[program];
  return { employee, family: round1000(employee * FAMILY_SHARE) };
}

export function policyPremium(tariff: PolicyTariff, employees: number, familyMembers: number): Money {
  return round1000(tariff.employee * employees + tariff.family * familyMembers);
}

/** Days of the period, both ends included. */
export function daysInclusive(from: ISODate, to: ISODate): number {
  return dayNumber(to) - dayNumber(from) + 1;
}

/** End date by default: one year minus one day after the start. */
export function defaultEndDate(start: ISODate): ISODate {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y + 1, m - 1, d) - DAY);
  return next.toISOString().slice(0, 10);
}

/** Tariff of a policy; policies without a stored tariff fall back to premium per insured person. */
export function tariffOf(p: Pick<Policy, 'tariff' | 'premium' | 'insuredCount' | 'program'>): PolicyTariff {
  if (p.tariff) return p.tariff;
  if (p.premium > 0 && p.insuredCount > 0) {
    const employee = round1000(p.premium / p.insuredCount);
    return { employee, family: round1000(employee * FAMILY_SHARE) };
  }
  return defaultTariff(p.program);
}

/**
 * Pro-rata change of the premium when a person with the annual premium `annual` is added (+) or excluded (−)
 * from `effective` until the end of the policy, both days included. Outside the period the change is 0.
 */
export function proRataAmount(policy: Pick<Policy, 'startDate' | 'endDate'>, annual: Money, kind: PolicyChangeKind, effective: ISODate): Money {
  if (effective < policy.startDate || effective > policy.endDate) return 0;
  const total = daysInclusive(policy.startDate, policy.endDate);
  const left = daysInclusive(effective, policy.endDate);
  const delta = round1000((annual * left) / total);
  return kind === 'add' ? delta : -delta;
}

/** Pro-rata change for an employee by the policy tariff. */
export function proRataDelta(policy: Pick<Policy, 'startDate' | 'endDate'>, tariff: PolicyTariff, kind: PolicyChangeKind, effective: ISODate): Money {
  return proRataAmount(policy, tariff.employee, kind, effective);
}

/** Why a change date does not fit the policy, or null. */
export function changeDateProblem(
  policy: Pick<Policy, 'startDate' | 'endDate'>,
  kind: PolicyChangeKind,
  effective: ISODate,
  insuredFrom?: ISODate,
): string | null {
  if (effective < policy.startDate || effective > policy.endDate) return msg('dom.policies.dateOutside');
  if (kind === 'exclude' && insuredFrom && effective < insuredFrom) return msg('dom.policies.excludeBeforeAdd');
  return null;
}

/** Validity of the policy period from the issuance form. */
export function policyPeriodProblem(start: ISODate, end: ISODate): string | null {
  if (end < start) return msg('v.endBeforeStart');
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  const maxEnd = new Date(Date.UTC(y, m - 1 + MAX_POLICY_MONTHS, d) - DAY).toISOString().slice(0, 10);
  if (end > maxEnd) return msg('dom.policies.maxMonths', { n: MAX_POLICY_MONTHS });
  if (daysInclusive(start, end) < 28) return msg('dom.policies.minMonth');
  return null;
}

/** Template of the list of insured persons (appendix 2 of a contract, the policy issue): a row per person. */
export function annex2TemplateCsv(): string {
  return toCsv(POLICY_CSV_HEADER, [
    ['Ivanov Ivan Ivanovich', '15.03.1990', '31503900000001', '+998901234567', 'Muhandis', 'employee', '', ''],
    ['Ivanova Anna Petrovna', '02.04.1992', '40204920000002', '', '', 'spouse', '31503900000001', ''],
    ['Ivanov Pavel Ivanovich', '10.10.2015', '31010150000003', '', '', 'child', '31503900000001', ''],
  ]);
}
