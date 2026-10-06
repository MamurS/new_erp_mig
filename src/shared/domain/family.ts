/*
 * Family members as full insured persons (FAMILY_SPEC): relations, the child age limit, who in the family
 * may see what and shared family limits (the premium of a person by the contract terms: pricing.ts). Pure functions:
 * the mock server passes the parameters and the records; the screens use the same labels.
 */
import { defineLabels } from '@/i18n';
import type { DmsParamValues, FamilyRelation, ISODate, InsuredRelation, UUID } from '@/shared/types';

export const RELATIONS = ['employee', 'spouse', 'child', 'parent', 'other'] as const satisfies readonly InsuredRelation[];
export const FAMILY_RELATIONS = ['spouse', 'child', 'parent', 'other'] as const satisfies readonly FamilyRelation[];
/** «Сотрудник», «Супруг(а)», «Ребёнок», «Родитель», «Другой член семьи». */
export const RELATION_LABEL = defineLabels<InsuredRelation>('labels.censusRelation', RELATIONS);

export function isFamilyRelation(v: string): v is FamilyRelation {
  return (FAMILY_RELATIONS as readonly string[]).includes(v);
}

export type AgeLimits = Pick<DmsParamValues, 'maxChildAge' | 'studentMaxAge'>;

/** What a person of a family looks like to these rules. */
export interface FamilyPerson {
  id: UUID;
  relation: InsuredRelation;
  /** The employee; absent for the employee. */
  principalId?: UUID;
  /** ISO date of birth. */
  birthDate: ISODate;
  isStudent?: boolean;
  status?: 'active' | 'excluded';
}

/** Full years on a date. */
export function ageOn(birthDate: ISODate, on: ISODate): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [y, m, d] = on.split('-').map(Number) as [number, number, number];
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return Math.max(0, age);
}

/** The age a child is covered until: `maxChildAge`, or `studentMaxAge` for a full-time student. */
export function childAgeLimit(p: Pick<FamilyPerson, 'isStudent'>, limits: AgeLimits): number {
  return p.isStudent ? Math.max(limits.maxChildAge, limits.studentMaxAge) : limits.maxChildAge;
}

/** Birthday on which the child reaches the age limit (29 February → 28 February in a common year). */
export function ageLimitDate(p: Pick<FamilyPerson, 'birthDate' | 'isStudent'>, limits: AgeLimits): ISODate {
  const [by, bm, bd] = p.birthDate.split('-').map(Number) as [number, number, number];
  const year = by + childAgeLimit(p, limits);
  const last = new Date(Date.UTC(year, bm, 0)).getUTCDate();
  return `${year}-${String(bm).padStart(2, '0')}-${String(Math.min(bd, last)).padStart(2, '0')}`;
}

/** A child under the age limit: lives inside the parent's app, the parent sees everything. */
export function isDependentChild(p: Pick<FamilyPerson, 'relation' | 'birthDate' | 'isStudent'>, today: ISODate, limits: AgeLimits): boolean {
  return p.relation === 'child' && today < ageLimitDate(p, limits);
}

/** A child that has reached the age limit: a task for MIG's manager (no automatic exclusion). */
export function reachedAgeLimit(p: Pick<FamilyPerson, 'relation' | 'birthDate' | 'isStudent' | 'status'>, today: ISODate, limits: AgeLimits): boolean {
  return p.relation === 'child' && p.status !== 'excluded' && today >= ageLimitDate(p, limits);
}

/** An adult of the family (spouse, parent, other, a child over the limit) signs in with an own phone. */
export function isAdultMember(p: Pick<FamilyPerson, 'relation' | 'birthDate' | 'isStudent'>, today: ISODate, limits: AgeLimits): boolean {
  return p.relation !== 'employee' && !isDependentChild(p, today, limits);
}

/** People of one family share this key: the employee's id. */
export function familyKey(p: Pick<FamilyPerson, 'id' | 'principalId'>): UUID {
  return p.principalId ?? p.id;
}

/**
 * What a signed-in insured person may see about another person (FAMILY_SPEC «Приложение»):
 * - `self` — own data;
 * - `full` — the employee about a child under the age limit, or about an adult who allowed it (consent);
 * - `basic` — the employee about an adult family member: the fact of insurance, the certificate, the QR;
 * - `none` — anyone else, including other members of the family for an adult member and every person of
 *   another family (the server answers 404).
 */
export type FamilyAccessLevel = 'self' | 'full' | 'basic' | 'none';

export function familyAccess(
  viewer: FamilyPerson,
  target: FamilyPerson,
  ctx: { today: ISODate; limits: AgeLimits; consent: (ownerId: UUID, viewerId: UUID) => boolean },
): FamilyAccessLevel {
  if (viewer.id === target.id) return 'self';
  if (target.status === 'excluded') return 'none';
  // Only the employee sees other people of the family; an adult member sees only themselves.
  if (viewer.relation !== 'employee' || target.principalId !== viewer.id) return 'none';
  if (isDependentChild(target, ctx.today, ctx.limits)) return 'full';
  return ctx.consent(target.id, viewer.id) ? 'full' : 'basic';
}

/** Access levels that allow the data of a kind. */
export const FAMILY_DATA_ACCESS = {
  /** Fact of insurance, policy, certificate, QR for the clinic. */
  card: ['self', 'full', 'basic'],
  /** Limits, claims, receipts, appointments and booking. */
  medical: ['self', 'full'],
} as const satisfies Record<string, readonly FamilyAccessLevel[]>;

export type FamilyDataKind = keyof typeof FAMILY_DATA_ACCESS;

export function allows(level: FamilyAccessLevel, kind: FamilyDataKind): boolean {
  return (FAMILY_DATA_ACCESS[kind] as readonly FamilyAccessLevel[]).includes(level);
}

/** Ids of the people whose consumption counts against a person's limits under the limit mode. */
export function limitPoolOf<T extends Pick<FamilyPerson, 'id' | 'principalId'> & { policyId: UUID }>(
  person: T,
  all: readonly T[],
  mode: 'individual' | 'family_shared',
): UUID[] {
  if (mode === 'individual') return [person.id];
  const key = familyKey(person);
  return all.filter((x) => x.policyId === person.policyId && familyKey(x) === key).map((x) => x.id);
}
