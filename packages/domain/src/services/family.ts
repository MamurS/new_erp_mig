/*
 * Family members (FAMILY_SPEC): the family of an employee, the access of a signed-in insured person to
 * another person of the family, consents, the payout card and the premium of a family member. Rules
 * themselves live in ../family.ts.
 */
import type { Appointment, FamilyMemberBrief, Policy, UUID } from '@mig/contracts';
import { allows, familyAccess, isDependentChild, isFamilyRelation, type AgeLimits, type FamilyAccessLevel, type FamilyDataKind } from '../family';
import { tariffOf } from '../policies';
import { contractPricing, personPremium, PricingError } from '../pricing';
import type { ClaimRow, InsuredRow } from '../store/db';
import { errorOf, notFound, todayIso, type BaseCtx } from './kernel';
import { loadParams, type ParamsView } from './params';

export const ageLimits = (P: ParamsView): AgeLimits => ({ maxChildAge: P.dmsParam('maxChildAge'), studentMaxAge: P.dmsParam('studentMaxAge') });

/** Family members of an employee (every status). */
export async function familyOf(ctx: BaseCtx, employeeId: UUID): Promise<InsuredRow[]> {
  return ctx.repos.insured.list({ where: { principalId: employeeId } });
}

export async function principalOf(ctx: BaseCtx, i: Pick<InsuredRow, 'principalId'>): Promise<InsuredRow | undefined> {
  return i.principalId ? ((await ctx.repos.insured.get(i.principalId)) ?? undefined) : undefined;
}

/** Names and relations of an employee's family (other screens list them instead of «семья: N»). */
export async function familyBrief(ctx: BaseCtx, i: InsuredRow): Promise<FamilyMemberBrief[]> {
  if (i.relation !== 'employee') return [];
  return (await familyOf(ctx, i.id)).flatMap((m) => (isFamilyRelation(m.relation) ? [{ id: m.id, fullName: m.fullName, relation: m.relation, status: m.status }] : []));
}

/** The card reimbursements are paid to: the person's own, else the employee's (a family member by default). */
export async function payoutCardOf(ctx: BaseCtx, i: InsuredRow): Promise<{ card: string; own: boolean }> {
  if (i.payoutCard) return { card: i.payoutCard, own: true };
  return { card: (await principalOf(ctx, i))?.payoutCard ?? '', own: false };
}

export async function hasConsent(ctx: BaseCtx, ownerId: UUID, viewerId: UUID): Promise<boolean> {
  return ctx.repos.familyConsents.exists({ ownerId, viewerId, revokedAt: { isNull: true } });
}

export async function accessOf(ctx: BaseCtx, viewer: InsuredRow, target: InsuredRow, P?: ParamsView): Promise<FamilyAccessLevel> {
  const params = P ?? (await loadParams(ctx));
  // familyAccess asks for the consent of the target to the viewer only when the viewer is the target's employee.
  const consent = viewer.id !== target.id && target.principalId === viewer.id ? await hasConsent(ctx, target.id, viewer.id) : false;
  return familyAccess(viewer, target, { today: todayIso(ctx), limits: ageLimits(params), consent: () => consent });
}

/**
 * The person a /api/me request is about: the signed-in person, or `personId` of the family when the access
 * allows that kind of data. Anyone else — another family, an adult without consent for medical data — is 404.
 */
export async function personFor(ctx: BaseCtx, me: InsuredRow, personId: string | null, kind: FamilyDataKind): Promise<{ person: InsuredRow; access: FamilyAccessLevel }> {
  if (!personId || personId === me.id) return { person: me, access: 'self' };
  if (!/^[0-9a-f-]{36}$/i.test(personId)) throw notFound();
  const person = await ctx.repos.insured.get(personId);
  if (!person) throw notFound();
  const access = await accessOf(ctx, me, person);
  if (!allows(access, kind)) throw notFound();
  return { person, access };
}

/** `?personId=` of a /api/me request. */
export const personIdParam = (url: URL): string | null => url.searchParams.get('personId');

export function isDependent(i: InsuredRow, today: string, P: ParamsView): boolean {
  return isDependentChild(i, today, ageLimits(P));
}

/**
 * Annual premium of a person on the policy: by the terms of the policy's contract (by type or by the age band
 * on `on`); a policy without a contract — by type from the policy tariff.
 */
export async function annualPremiumOf(
  ctx: BaseCtx,
  policy: Pick<Policy, 'tariff' | 'premium' | 'insuredCount' | 'program' | 'contractId'>,
  person: Pick<InsuredRow, 'relation' | 'birthDate'>,
  on: string,
): Promise<number> {
  const c = policy.contractId ? await ctx.repos.contracts.get(policy.contractId) : null;
  const t = tariffOf(policy);
  const pricing = c ? contractPricing(c.params) : contractPricing({ premiumEmployee: t.employee, premiumFamily: t.family });
  try {
    return personPremium(pricing, person, on).annual;
  } catch (e) {
    if (e instanceof PricingError) throw errorOf(422, 'validation', e.problem);
    throw e;
  }
}

/** An appointment of a person whose medical data the signed-in person may see; anything else is 404. */
export async function myAppointment(ctx: BaseCtx, me: InsuredRow, id: string): Promise<Appointment> {
  const a = await ctx.repos.appointments.get(id);
  const who = a ? await ctx.repos.insured.get(a.insuredId) : null;
  if (!a || !who || (who.id !== me.id && (await accessOf(ctx, me, who)) !== 'full')) throw notFound();
  return a;
}

/** A claim of a person whose medical data the signed-in person may see; anything else is 404. */
export async function myClaimOf(ctx: BaseCtx, me: InsuredRow, id: string): Promise<{ c: ClaimRow; who: InsuredRow }> {
  const c = await ctx.repos.claims.get(id);
  const who = c ? await ctx.repos.insured.get(c.insuredId) : null;
  if (!c || !who || (who.id !== me.id && (await accessOf(ctx, me, who)) !== 'full')) throw notFound();
  return { c, who };
}
