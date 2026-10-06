/*
 * Family members on the mock server (FAMILY_SPEC): the family of an employee, the access of a signed-in
 * insured person to another person of the family, consents, the payout card and the premium of a
 * family member. Rules themselves live in src/shared/domain/family.ts.
 */
import type { FamilyMemberBrief, Policy, UUID } from '@/shared/types';
import { allows, familyAccess, isDependentChild, isFamilyRelation, personAnnualPremium, type AgeLimits, type FamilyAccessLevel, type FamilyDataKind } from '@/shared/domain/family';
import { tariffOf } from '@/shared/domain/policies';
import type { Db, InsuredRow } from './db';
import { notFound } from './http';
import { dmsParam, paramValues } from './params';
import { isoDay } from './time';

export const ageLimits = (): AgeLimits => ({ maxChildAge: dmsParam('maxChildAge'), studentMaxAge: dmsParam('studentMaxAge') });
export const todayIso = (): string => isoDay(Date.now());

/** Family members of an employee (every status). */
export function familyOf(d: Db, employeeId: UUID): InsuredRow[] {
  return d.insured.filter((i) => i.principalId === employeeId);
}

export function principalOf(d: Db, i: Pick<InsuredRow, 'principalId'>): InsuredRow | undefined {
  return i.principalId ? d.insured.find((x) => x.id === i.principalId) : undefined;
}

/** Names and relations of an employee's family (other screens list them instead of «семья: N»). */
export function familyBrief(d: Db, i: InsuredRow): FamilyMemberBrief[] {
  if (i.relation !== 'employee') return [];
  return familyOf(d, i.id).flatMap((m) => (isFamilyRelation(m.relation) ? [{ id: m.id, fullName: m.fullName, relation: m.relation, status: m.status }] : []));
}

/** Active family members of the active persons of a policy. */
export function familyCountOf(people: readonly Pick<InsuredRow, 'relation'>[]): number {
  return people.filter((p) => p.relation !== 'employee').length;
}

/** The card reimbursements are paid to: the person's own, else the employee's (a family member by default). */
export function payoutCardOf(d: Db, i: InsuredRow): { card: string; own: boolean } {
  if (i.payoutCard) return { card: i.payoutCard, own: true };
  return { card: principalOf(d, i)?.payoutCard ?? '', own: false };
}

export function hasConsent(d: Db, ownerId: UUID, viewerId: UUID): boolean {
  return d.familyConsents.some((c) => c.ownerId === ownerId && c.viewerId === viewerId && !c.revokedAt);
}

export function accessOf(d: Db, viewer: InsuredRow, target: InsuredRow): FamilyAccessLevel {
  return familyAccess(viewer, target, { today: todayIso(), limits: ageLimits(), consent: (o, v) => hasConsent(d, o, v) });
}

/**
 * The person a /api/me request is about: the signed-in person, or `personId` of the family when the access
 * allows that kind of data. Anyone else — another family, an adult without consent for medical data — is 404.
 */
export function personFor(d: Db, me: InsuredRow, personId: string | null, kind: FamilyDataKind): { person: InsuredRow; access: FamilyAccessLevel } {
  if (!personId || personId === me.id) return { person: me, access: 'self' };
  if (!/^[0-9a-f-]{36}$/i.test(personId)) throw notFound();
  const person = d.insured.find((x) => x.id === personId);
  if (!person) throw notFound();
  const access = accessOf(d, me, person);
  if (!allows(access, kind)) throw notFound();
  return { person, access };
}

/** `?personId=` of a /api/me request. */
export const personIdParam = (url: URL): string | null => url.searchParams.get('personId');

export function isDependent(i: InsuredRow): boolean {
  return isDependentChild(i, todayIso(), ageLimits());
}

/** Annual premium of a person on the policy by type (a family member by the age group on `on`). */
export function annualPremiumOf(policy: Pick<Policy, 'tariff' | 'premium' | 'insuredCount' | 'program'>, person: Pick<InsuredRow, 'relation' | 'birthDate'>, on: string): number {
  return personAnnualPremium(tariffOf(policy), person, on, paramValues());
}
