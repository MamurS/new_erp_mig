/*
 * DMS only for companies with a minimal group (DECISIONS «Только корпоративные клиенты и минимальная
 * численность»). Parameters of the «Клиенты» group: `minGroupSize`, `minGroupCountsFamily`,
 * `allowedLegalForms` (a bit mask over LEGAL_FORMS), `belowMinDuringTerm`. Pure rules: the UI warns with them,
 * the mock server refuses with the same ones.
 */
import { msg } from '@mig/i18n';
import type { DmsParamValues } from '@mig/contracts';
import { formsOfMask } from './config/dmsParameters';
import { legalFormShort, type LegalFormCode } from './config/legalForms';

export interface GroupRules {
  min: number;
  countsFamily: boolean;
  allowedForms: number;
  /** After an exclusion during the term the group is below the minimum: notify (default) or forbid. */
  belowMinDuringTerm: 'notify' | 'forbid';
}

export function groupRulesOf(v: Pick<DmsParamValues, 'minGroupSize' | 'minGroupCountsFamily' | 'allowedLegalForms' | 'belowMinDuringTerm'>): GroupRules {
  return { min: v.minGroupSize, countsFamily: v.minGroupCountsFamily === 1, allowedForms: v.allowedLegalForms, belowMinDuringTerm: v.belowMinDuringTerm === 1 ? 'forbid' : 'notify' };
}

export function legalFormAllowed(form: LegalFormCode, rules: Pick<GroupRules, 'allowedForms'>): boolean {
  return formsOfMask(rules.allowedForms).includes(form);
}

/** Packed reason why a lead of this form cannot be saved (null: allowed). */
export function legalFormProblem(form: LegalFormCode, rules: Pick<GroupRules, 'allowedForms'>): string | null {
  return legalFormAllowed(form, rules) ? null : msg('dom.group.formNotAllowed', { form: legalFormShort(form) });
}

export interface GroupCounts {
  employees: number;
  family: number;
}

/** The size of the group as the minimum counts it: employees, or employees with family members. */
export function groupSize(c: GroupCounts, rules: Pick<GroupRules, 'countsFamily'>): number {
  return rules.countsFamily ? c.employees + c.family : c.employees;
}

export function belowMin(c: GroupCounts, rules: Pick<GroupRules, 'min' | 'countsFamily'>): boolean {
  return groupSize(c, rules) < rules.min;
}

/** Packed «сотрудников N из минимума M» (or with family members). */
export function groupLabel(c: GroupCounts, rules: Pick<GroupRules, 'min' | 'countsFamily'>): string {
  return msg(rules.countsFamily ? 'dom.group.countWithFamily' : 'dom.group.count', { n: groupSize(c, rules), min: rules.min });
}

/** An exclusion that leaves the active group below the minimum (null: still at or above it, or already below). */
export function exclusionDropsBelow(before: GroupCounts, excluded: GroupCounts, rules: Pick<GroupRules, 'min' | 'countsFamily'>): boolean {
  const after = { employees: before.employees - excluded.employees, family: before.family - excluded.family };
  return !belowMin(before, rules) && belowMin(after, rules);
}

/** Counts of a list of people by relation (census rows, appendix 2 rows, insured persons). */
export function countsOf(rows: readonly { relation: string }[]): GroupCounts {
  const employees = rows.filter((r) => r.relation === 'employee').length;
  return { employees, family: rows.length - employees };
}
