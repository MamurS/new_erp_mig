/*
 * Adding family members (FAMILY_SPEC «Кто добавляет членов семьи»): HR adds one like an employee — a change
 * request for MIG; the employee asks from the app — HR approves the request into the same change request.
 * After MIG approves it, the person gets a certificate and an endorsement carries the premium for the rest
 * of the term by the age group.
 */
import type { FamilyRelation, SessionUser } from '@mig/contracts';
import type { FamilyRequest, HrFamilyMember } from '@mig/contracts/dto';
import { ageOn, isFamilyRelation, reachedAgeLimit } from '@mig/domain/family';
import { msg } from '@mig/i18n';
import type { ClientRow, Db, FamilyRequestRow, InsuredRow, PolicyChangeRow } from './db';
import { HttpError } from './http';
import { maskBirthDate, maskPinfl } from './mask';
import { requestChange } from './policy-core';
import { ageLimits, todayIso } from './family-core';

export function toFamilyRequest(d: Db, r: FamilyRequestRow): FamilyRequest {
  const employee = d.insured.find((i) => i.id === r.employeeId);
  return {
    id: r.id,
    employeeId: r.employeeId,
    employeeName: employee?.fullName ?? '',
    fullName: r.fullName,
    relation: r.relation,
    birthDateMasked: maskBirthDate(r.birthDate),
    pinflMasked: maskPinfl(r.pinfl),
    ...(r.isStudent ? { isStudent: true } : {}),
    age: ageOn(r.birthDate, todayIso()),
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
export function employeeOfCompany(d: Db, companyId: string, id: string): InsuredRow | undefined {
  return d.insured.find((i) => i.id === id && i.clientId === companyId && i.relation === 'employee' && i.status === 'active');
}

/** The change request for a new family member (HR's own input or an approved app request). */
export function requestFamilyAdd(
  d: Db,
  actor: Pick<SessionUser, 'id' | 'displayName'>,
  client: ClientRow,
  employee: InsuredRow,
  person: { fullName: string; birthDate: string; pinfl: string; relation: FamilyRelation; isStudent?: boolean; phone?: string; startDate: string; familyRequestId?: string },
): PolicyChangeRow {
  if (d.insured.some((i) => i.pinfl === person.pinfl && i.clientId === client.id && i.status === 'active')) {
    throw new HttpError(409, 'conflict', 'srv.hr.pinflInsured', { fields: { pinfl: msg('srv.hr.alreadyListed') } });
  }
  if (person.phone && d.insured.some((i) => i.phone === person.phone && i.status === 'active')) {
    // The phone is the login to the app: two active persons cannot share it.
    throw new HttpError(409, 'conflict', 'srv.family.phoneTaken', { fields: { phone: msg('srv.family.phoneTaken') } });
  }
  return requestChange(d, actor, client, 'add', {
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
export function hrFamilyList(d: Db, companyId: string, employeeId?: string): HrFamilyMember[] {
  const today = todayIso();
  const limits = ageLimits();
  const name = (id: string | undefined) => d.insured.find((i) => i.id === id)?.fullName ?? '';
  const people: HrFamilyMember[] = d.insured
    .filter((i) => i.clientId === companyId && i.principalId && (!employeeId || i.principalId === employeeId))
    .flatMap((i) =>
      isFamilyRelation(i.relation)
        ? [
            {
              id: i.id,
              fullName: i.fullName,
              relation: i.relation,
              employeeId: i.principalId!,
              employeeName: name(i.principalId),
              birthDateMasked: maskBirthDate(i.birthDate),
              status: i.status,
              insuredFrom: i.insuredFrom,
              ...(i.certificateNumber ? { certificateNumber: i.certificateNumber } : {}),
              ...(i.isStudent ? { isStudent: true } : {}),
              ...(reachedAgeLimit(i, today, limits) ? { overAgeLimit: true } : {}),
              appStatus: i.appStatus,
            },
          ]
        : [],
    );
  // Requests not yet approved by MIG are listed too, like new employees (POLICY_SPEC §5.1).
  const requests: HrFamilyMember[] = d.policyChanges
    .filter((c) => c.clientId === companyId && c.kind === 'add' && c.principalId && (c.status === 'pending' || c.status === 'rejected') && (!employeeId || c.principalId === employeeId))
    .flatMap((c) =>
      isFamilyRelation(c.relation)
        ? [
            {
              id: c.id,
              fullName: c.fullName,
              relation: c.relation,
              employeeId: c.principalId!,
              employeeName: c.principalName ?? name(c.principalId),
              birthDateMasked: c.newPerson ? maskBirthDate(c.newPerson.birthDate) : '',
              status: c.status === 'rejected' ? ('rejected' as const) : ('pending' as const),
              insuredFrom: c.effectiveDate,
              ...(c.newPerson?.isStudent ? { isStudent: true } : {}),
              appStatus: 'not_invited' as const,
              ...(c.rejectionReason ? { rejectionReason: c.rejectionReason } : {}),
            },
          ]
        : [],
    );
  return [...requests, ...people].sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'ru') || a.fullName.localeCompare(b.fullName, 'ru'));
}
