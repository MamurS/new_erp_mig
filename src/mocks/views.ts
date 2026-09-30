/* Projections of DB rows into API DTOs. Masking happens here, on the "server". */
import type { Client, Insured, LimitCategory, LimitUsage, MyClaim, SessionUser } from '@/shared/types';
import type { ClaimDetail, HrEmployee, InsuredDetail, InsuredListItem } from '@/shared/types/dto';
import { insuredVisibility } from '@/shared/auth/permissions';
import { CLAIM_TO_LIMIT, claimTransitions, requiresMedicalReview, toMyClaimStatus } from '@/shared/domain/claims';
import type { ClaimRow, ClientRow, Db, InsuredRow } from './db';
import { maskBirthDate, maskCard, maskEmail, maskPhone, maskPinfl } from './mask';
import { PROGRAMS } from './programs';
import { limitExtras } from './assistance-core';
import { DAY, isoDay, parseIso } from './time';

export function insuredCountFor(d: Db, clientId: string): number {
  return d.insured.filter((i) => i.clientId === clientId && i.status === 'active').length;
}

export function toClient(d: Db, c: ClientRow): Client {
  return {
    ...c,
    hrContact: { name: c.hrContact.name, phoneMasked: maskPhone(c.hrContact.phone), emailMasked: maskEmail(c.hrContact.email) },
    insuredCount: insuredCountFor(d, c.id),
  };
}

export function toInsured(i: InsuredRow): Insured {
  return {
    id: i.id,
    clientId: i.clientId,
    clientName: i.clientName,
    policyId: i.policyId,
    fullName: i.fullName,
    position: i.position,
    birthDateMasked: maskBirthDate(i.birthDate),
    pinflMasked: maskPinfl(i.pinfl),
    phoneMasked: maskPhone(i.phone),
    familyMembersCount: i.familyMembersCount,
    appStatus: i.appStatus,
    myIdVerified: i.myIdVerified,
    attachedClinicId: i.attachedClinicId,
    insuredFrom: i.insuredFrom,
    status: i.status,
  };
}

export function toInsuredListItem(i: InsuredRow, user: SessionUser): InsuredListItem {
  const base: InsuredListItem = {
    id: i.id,
    fullName: i.fullName,
    clientId: i.clientId,
    clientName: i.clientName,
    policyId: i.policyId,
    position: i.position,
    status: i.status,
    appStatus: i.appStatus,
  };
  if (insuredVisibility(user.role) === 'masked') {
    base.pinflMasked = maskPinfl(i.pinfl);
    base.phoneMasked = maskPhone(i.phone);
    base.birthDateMasked = maskBirthDate(i.birthDate);
  }
  return base;
}

export function toInsuredDetail(d: Db, i: InsuredRow): InsuredDetail {
  const policy = d.policies.find((p) => p.id === i.policyId)!;
  return {
    ...toInsured(i),
    policyNumber: policy.number,
    program: policy.program,
    policyStart: policy.startDate,
    policyEnd: policy.endDate,
    emailMasked: maskEmail(i.email),
  };
}

export function toHrEmployee(d: Db, i: InsuredRow): HrEmployee {
  const policy = d.policies.find((p) => p.id === i.policyId);
  return {
    id: i.id,
    fullName: i.fullName,
    position: i.position,
    program: policy?.program ?? 'standard',
    insuredFrom: i.insuredFrom,
    familyMembersCount: i.familyMembersCount,
    appStatus: i.appStatus,
    status: i.status,
    excludedFrom: i.excludedFrom,
    addedAt: i.addedAt,
  };
}

const PAID_LIKE = new Set(['approved', 'to_pay', 'paid']);

export function limitsFor(d: Db, i: InsuredRow): LimitUsage[] {
  const policy = d.policies.find((p) => p.id === i.policyId);
  const program = PROGRAMS[policy?.program ?? 'standard'];
  const from = policy ? parseIso(policy.startDate) : 0;
  const used: Record<LimitCategory, number> = { outpatient: 0, dental: 0, medicines: 0, inpatient: 0 };
  for (const c of d.claims) {
    if (c.insuredId !== i.id || !PAID_LIKE.has(c.status)) continue;
    if (parseIso(c.serviceDate) < from - 7 * DAY) continue;
    used[CLAIM_TO_LIMIT[c.category]] += c.amountApproved ?? c.amountClaimed;
  }
  // Lines accepted by an assistance count as used; approved guarantee letters reserve the limit.
  const extra = limitExtras(d, i, from);
  return (['outpatient', 'dental', 'medicines', 'inpatient'] as const).map((category) => ({
    category,
    limit: program.limits[category],
    used: used[category] + extra.used[category],
    reserved: extra.reserved[category],
  }));
}

export function toClaimDetail(d: Db, c: ClaimRow, user: SessionUser): ClaimDetail {
  const i = d.insured.find((x) => x.id === c.insuredId)!;
  const cat = CLAIM_TO_LIMIT[c.category];
  const usage = limitsFor(d, i).find((l) => l.category === cat)!;
  const counted = PAID_LIKE.has(c.status) ? (c.amountApproved ?? c.amountClaimed) : 0;
  const usedExcl = usage.used - counted;
  const remaining = Math.max(0, usage.limit - usedExcl);
  const payout = c.amountApproved ?? c.amountClaimed;
  const t = claimTransitions(user, c);
  const { publicRejectionReason: _p, ...claim } = c;
  return {
    ...claim,
    limitCheck: { category: cat, limit: usage.limit, used: usedExcl, remaining, remainingAfter: remaining - payout },
    allowedTransitions: t.allowed,
    blockedTransitions: t.blocked,
    medicalReviewRequired: requiresMedicalReview(c),
  };
}

export function toMyClaim(c: ClaimRow, i: InsuredRow): MyClaim {
  const status = toMyClaimStatus(c.status);
  const whenReached = (targets: string[]) => c.history.find((h) => targets.includes(h.to))?.at;
  const receivedAt = c.createdAt;
  const checkedAt = whenReached(['approved', 'rejected']);
  const approvedAt = whenReached(['approved']);
  const paidAt = whenReached(['paid']);
  const steps: MyClaim['steps'] = [
    { key: 'received', at: receivedAt, done: true },
    { key: 'checked', at: checkedAt, done: !!checkedAt },
    { key: 'approved', at: approvedAt, done: !!approvedAt },
    { key: 'paid', at: paidAt, done: !!paidAt },
  ];
  const out: MyClaim = {
    id: c.id,
    number: c.number,
    category: c.category,
    amountClaimed: c.amountClaimed,
    amountApproved: c.amountApproved,
    providerName: c.providerName,
    serviceDate: c.serviceDate,
    status,
    steps,
    payoutCardMasked: maskCard(i.payoutCard),
  };
  if (status === 'approved') out.expectedPayoutBy = isoDay(Date.now() + 2 * DAY);
  if (status === 'received' || status === 'checking') out.expectedPayoutBy = isoDay(parseIso(c.slaDueAt) + 2 * DAY);
  if (status === 'rejected') out.rejectionReason = c.publicRejectionReason ?? 'Услуга не входит в программу страхования';
  return out;
}
