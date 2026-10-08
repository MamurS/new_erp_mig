/*
 * Adding family members (FAMILY_SPEC «Кто добавляет членов семьи»): HR adds one like an employee — a change
 * request for MIG; the employee asks from the app — HR approves the request into the same change request.
 * After MIG approves it, the person gets a certificate and an endorsement carries the premium for the rest
 * of the term by the age group.
 */
import type { FamilyRelation, SessionUser } from '@mig/contracts';
import type { FamilyRequest, HrFamilyMember } from '@mig/contracts/dto';
import { msg } from '@mig/i18n';
import { ageOn, isFamilyRelation, reachedAgeLimit } from '../family';
import { maskBirthDate, maskPinfl } from '../lib/mask';
import type { ClientRow, FamilyRequestRow, InsuredRow, PolicyChangeRow } from '../store/db';
import { DomainError, type BaseCtx } from './kernel';
import { loadParams } from './params';
import { requestChange } from './policy';
import { ageLimits, todayIso } from './family';

export async function toFamilyRequest(ctx: BaseCtx, r: FamilyRequestRow): Promise<FamilyRequest> {
  const employee = await ctx.repos.insured.get(r.employeeId);
  return {
    id: r.id,
    employeeId: r.employeeId,
    employeeName: employee?.fullName ?? '',
    fullName: r.fullName,
    relation: r.relation,
    birthDateMasked: maskBirthDate(r.birthDate),
    pinflMasked: maskPinfl(r.pinfl),
    ...(r.isStudent ? { isStudent: true } : {}),
    age: ageOn(r.birthDate, todayIso(ctx)),
    status: r.status,
    createdAt: r.createdAt,
    consentAt: r.consentAt,
    ...(r.decidedAt ? { decidedAt: r.decidedAt } : {}),
    ...(r.decidedByName ? { decidedByName: r.decidedByName } : {}),
    ...(r.rejectionReason ? { rejectionReason: r.rejectionReason } : {}),
    ...(r.policyChangeId ? { policyChangeId: r.policyChangeId } : {}),
  };
}

/** An active employee of the HR's company; anyone else «does not exist» (404 by the caller). */
export async function employeeOfCompany(ctx: BaseCtx, companyId: string, id: string): Promise<InsuredRow | undefined> {
  return (await ctx.repos.insured.first({ where: { id, clientId: companyId, relation: 'employee', status: 'active' } })) ?? undefined;
}

/** The change request for a new family member (HR's own input or an approved app request). */
export async function requestFamilyAdd(
  ctx: BaseCtx,
  actor: Pick<SessionUser, 'id' | 'displayName'>,
  client: ClientRow,
  employee: InsuredRow,
  person: { fullName: string; birthDate: string; pinfl: string; relation: FamilyRelation; isStudent?: boolean; phone?: string; startDate: string; familyRequestId?: string },
): Promise<PolicyChangeRow> {
  if (await ctx.repos.insured.exists({ pinfl: person.pinfl, clientId: client.id, status: 'active' })) {
    throw new DomainError(409, 'conflict', 'srv.hr.pinflInsured', { fields: { pinfl: msg('srv.hr.alreadyListed') } });
  }
  if (person.phone && (await ctx.repos.insured.exists({ phone: person.phone, status: 'active' }))) {
    // The phone is the login to the app: two active persons cannot share it.
    throw new DomainError(409, 'conflict', 'srv.family.phoneTaken', { fields: { phone: msg('srv.family.phoneTaken') } });
  }
  return requestChange(ctx, actor, client, 'add', {
    effectiveDate: person.startDate,
    fullName: person.fullName,
    position: '',
    relation: person.relation,
    principal: employee,
    newPerson: { birthDate: person.birthDate, pinfl: person.pinfl, phone: person.phone ?? '', ...(person.isStudent ? { isStudent: true } : {}) },
    ...(person.familyRequestId ? { familyRequestId: person.familyRequestId } : {}),
  });
}

/** Family members of the company for HR: names, relations and coverage only, no medical data. */
export async function hrFamilyList(ctx: BaseCtx, companyId: string, employeeId?: string): Promise<HrFamilyMember[]> {
  const today = todayIso(ctx);
  const limits = ageLimits(await loadParams(ctx));
  const names = new Map<string, string>();
  const name = async (id: string | undefined): Promise<string> => {
    if (!id) return '';
    if (!names.has(id)) names.set(id, (await ctx.repos.insured.get(id))?.fullName ?? '');
    return names.get(id)!;
  };
  const people: HrFamilyMember[] = [];
  for (const i of await ctx.repos.insured.list({ where: { clientId: companyId, principalId: employeeId ? employeeId : { isNull: false } } })) {
    if (!i.principalId || !isFamilyRelation(i.relation)) continue;
    people.push({
      id: i.id,
      fullName: i.fullName,
      relation: i.relation,
      employeeId: i.principalId,
      employeeName: await name(i.principalId),
      birthDateMasked: maskBirthDate(i.birthDate),
      status: i.status,
      insuredFrom: i.insuredFrom,
      ...(i.certificateNumber ? { certificateNumber: i.certificateNumber } : {}),
      ...(i.isStudent ? { isStudent: true } : {}),
      ...(reachedAgeLimit(i, today, limits) ? { overAgeLimit: true } : {}),
      appStatus: i.appStatus,
    });
  }
  // Requests not yet approved by MIG are listed too, like new employees (POLICY_SPEC §5.1).
  const requests: HrFamilyMember[] = [];
  const changes = await ctx.repos.policyChanges.list({
    where: { clientId: companyId, kind: 'add', principalId: employeeId ? employeeId : { isNull: false }, status: { in: ['pending', 'rejected'] } },
  });
  for (const c of changes) {
    if (!c.principalId || !isFamilyRelation(c.relation)) continue;
    requests.push({
      id: c.id,
      fullName: c.fullName,
      relation: c.relation,
      employeeId: c.principalId,
      employeeName: c.principalName ?? (await name(c.principalId)),
      birthDateMasked: c.newPerson ? maskBirthDate(c.newPerson.birthDate) : '',
      status: c.status === 'rejected' ? ('rejected' as const) : ('pending' as const),
      insuredFrom: c.effectiveDate,
      ...(c.newPerson?.isStudent ? { isStudent: true } : {}),
      appStatus: 'not_invited' as const,
      ...(c.rejectionReason ? { rejectionReason: c.rejectionReason } : {}),
    });
  }
  return [...requests, ...people].sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'ru') || a.fullName.localeCompare(b.fullName, 'ru'));
}
