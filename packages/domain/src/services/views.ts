/* Projections of DB rows into API DTOs. Masking happens here, on the "server". */
import type { Client, Insured, MyClaim, SessionUser } from '@mig/contracts';
import type { ClaimDetail, HrEmployee, InsuredDetail, InsuredListItem } from '@mig/contracts/dto';
import { can, insuredVisibility } from '../auth/permissions';
import { CLAIM_TO_LIMIT, claimTransitions, requiresMedicalReview, toMyClaimStatus } from '../claims';
import type { LegalFormCode } from '../config/legalForms';
import { clauseLabel } from '../documents/templates/index';
import { ageLimitDate, childAgeLimit, reachedAgeLimit } from '../family';
import { maskBirthDate, maskCard, maskEmail, maskPhone, maskPinfl } from '../lib/mask';
import { DAY, isoDay, parseIso } from '../lib/time';
import { canApproveDecision } from '../settlement';
import type { ClaimRow, ClientRow, InsuredRow } from '../store/db';
import { todayIso, type BaseCtx } from './kernel';
import { loadParams, type ParamsView } from './params';
import { currentReserve, reserveTimeline } from './settlement';
import { ageLimits, familyBrief, payoutCardOf, principalOf } from './family';

/** Insured people of a client (employees and family members, each person counts). */
export async function insuredCountFor(ctx: BaseCtx, clientId: string): Promise<number> {
  return ctx.repos.facts.clientInsuredCount(clientId);
}

/** Legal form of a client (rows that show the client by name carry it next to the name). */
export async function clientLegalFormOf(ctx: BaseCtx, clientId: string | null | undefined): Promise<LegalFormCode | undefined> {
  return clientId ? ctx.repos.facts.clientLegalForm(clientId) : undefined;
}

/** Legal form of a clinic. */
export async function clinicLegalFormOf(ctx: BaseCtx, clinicId: string | null | undefined): Promise<LegalFormCode | undefined> {
  return clinicId ? (await ctx.repos.clinics.get(clinicId))?.legalForm : undefined;
}

/** Legal form of an assistance company. */
export async function assistanceLegalFormOf(ctx: BaseCtx, assistanceId: string | null | undefined): Promise<LegalFormCode | undefined> {
  return assistanceId ? (await ctx.repos.assistances.get(assistanceId))?.legalForm : undefined;
}

export async function toClient(ctx: BaseCtx, c: ClientRow): Promise<Client> {
  return {
    ...c,
    hrContact: { name: c.hrContact.name, phoneMasked: maskPhone(c.hrContact.phone), emailMasked: maskEmail(c.hrContact.email) },
    insuredCount: await insuredCountFor(ctx, c.id),
  };
}

/** A child over the age limit: the staff card explains the `age_limit` task of the manager queue. */
function ageLimitOf(i: InsuredRow, today: string, P: ParamsView): Pick<Insured, 'ageLimit'> {
  const limits = ageLimits(P);
  if (!reachedAgeLimit(i, today, limits)) return {};
  return { ageLimit: { age: childAgeLimit(i, limits), reachedOn: ageLimitDate(i, limits) } };
}

export async function toInsured(ctx: BaseCtx, i: InsuredRow, P?: ParamsView): Promise<Insured> {
  const params = P ?? (await loadParams(ctx));
  const principal = await principalOf(ctx, i);
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
    relation: i.relation,
    ...(principal ? { principalId: principal.id, principalName: principal.fullName } : {}),
    ...(i.isStudent ? { isStudent: true } : {}),
    ...ageLimitOf(i, todayIso(ctx), params),
    family: await familyBrief(ctx, i),
    appStatus: i.appStatus,
    myIdVerified: i.myIdVerified,
    attachedClinicId: i.attachedClinicId,
    insuredFrom: i.insuredFrom,
    status: i.status,
    ...(i.externalCertificateNumber ? { externalCertificateNumber: i.externalCertificateNumber } : {}),
    ...(i.migration ? { migration: i.migration } : {}),
  };
}

export async function toInsuredListItem(ctx: BaseCtx, i: InsuredRow, user: SessionUser, principals?: ReadonlyMap<string, Pick<InsuredRow, 'id' | 'fullName'>>): Promise<InsuredListItem> {
  const principal = principals ? (i.principalId ? principals.get(i.principalId) : undefined) : await principalOf(ctx, i);
  const base: InsuredListItem = {
    id: i.id,
    fullName: i.fullName,
    clientId: i.clientId,
    clientName: i.clientName,
    policyId: i.policyId,
    position: i.position,
    status: i.status,
    appStatus: i.appStatus,
    relation: i.relation,
    ...(principal ? { principalId: principal.id, principalName: principal.fullName } : {}),
  };
  if (insuredVisibility(user.role) === 'masked') {
    base.pinflMasked = maskPinfl(i.pinfl);
    base.phoneMasked = maskPhone(i.phone);
    base.birthDateMasked = maskBirthDate(i.birthDate);
  }
  return base;
}

/** List rows of a page: the employees of family members are read once for the page. */
export async function toInsuredListItems(ctx: BaseCtx, rows: readonly InsuredRow[], user: SessionUser): Promise<InsuredListItem[]> {
  const principals = await principalsOf(ctx, rows);
  const out: InsuredListItem[] = [];
  for (const i of rows) out.push(await toInsuredListItem(ctx, i, user, principals));
  return out;
}

/** The employees (id and name) of the family members among `rows`, as the person's RLS shows them. */
export async function principalsOf(ctx: BaseCtx, rows: readonly Pick<InsuredRow, 'principalId'>[]): Promise<Map<string, Pick<InsuredRow, 'id' | 'fullName'>>> {
  const ids = [...new Set(rows.map((i) => i.principalId).filter((x): x is string => !!x))];
  return new Map((ids.length ? await ctx.repos.insured.select(['id', 'fullName'], { where: { id: { in: ids } } }) : []).map((p) => [p.id, p]));
}

export async function toInsuredDetail(ctx: BaseCtx, i: InsuredRow, P?: ParamsView): Promise<InsuredDetail> {
  const policy = (await ctx.repos.policies.get(i.policyId))!;
  return {
    ...(await toInsured(ctx, i, P)),
    policyNumber: policy.number,
    program: policy.program,
    policyStart: policy.startDate,
    policyEnd: policy.endDate,
    emailMasked: maskEmail(i.email),
  };
}

export async function toHrEmployee(ctx: BaseCtx, i: InsuredRow): Promise<HrEmployee> {
  const policy = await ctx.repos.policies.get(i.policyId);
  return {
    id: i.id,
    fullName: i.fullName,
    position: i.position,
    program: policy?.program ?? 'standard',
    insuredFrom: i.insuredFrom,
    family: await familyBrief(ctx, i),
    appStatus: i.appStatus,
    status: i.status,
    excludedFrom: i.excludedFrom,
    addedAt: i.addedAt,
  };
}

const PAID_LIKE = new Set(['approved', 'to_pay', 'paid']);
/** Claim statuses whose amount counts as used limit. */
export const PAID_LIKE_STATUSES = ['approved', 'to_pay', 'paid'] as const;

/** Limits of a person (services/limits.ts: the narrow coverage inputs, the sums computed as before). */
export { limitsFor } from './limits';
import { limitsFor } from './limits';


export async function toClaimDetail(ctx: BaseCtx, c: ClaimRow, user: SessionUser): Promise<ClaimDetail> {
  const i = (await ctx.repos.insured.get(c.insuredId))!;
  const cat = CLAIM_TO_LIMIT[c.category];
  const usage = (await limitsFor(ctx, i)).find((l) => l.category === cat)!;
  const counted = PAID_LIKE.has(c.status) ? (c.amountApproved ?? c.amountClaimed) : 0;
  const usedExcl = usage.used - counted;
  const remaining = Math.max(0, usage.limit - usedExcl);
  const payout = c.amountApproved ?? c.amountClaimed;
  const t = claimTransitions(user, c);
  const { publicRejectionReason: _p, reserveHistory: _r, receiptHash: _h, expectedPrice: _e, registryLineId: _l, ...claim } = c;
  const staff = await ctx.repos.staff.get(user.id);
  const open = ['new', 'review', 'medical_review'].includes(c.status);
  return {
    ...claim,
    reserve: currentReserve(c),
    reserveHistory: can(user, 'claims.reserves') || can(user, 'claims.reserves', { sub: 'read' }) ? reserveTimeline(c) : undefined,
    limitCheck: { category: cat, limit: usage.limit, used: usedExcl, remaining, remainingAfter: remaining - payout },
    allowedTransitions: t.allowed,
    blockedTransitions: t.blocked,
    medicalReviewRequired: requiresMedicalReview(c),
    settlement: {
      canDecide: can(user, 'claims.decide') && ((open && !c.pendingDecision) || c.appeal?.status === 'open'),
      canApprovePending: !!c.pendingDecision && !!staff && canApproveDecision(staff, c.pendingDecision),
      canRequestOpinion: can(user, 'claims.decide') && (c.status === 'new' || c.status === 'review'),
      canGiveOpinion: can(user, 'claims.medical_opinion') && !!c.opinion && !c.opinion.text,
      canChangeReserve: can(user, 'claims.reserves') && open,
      authorityMax: staff?.authority.claimDecisionMax ?? null,
    },
  };
}

/** List row: the claim without internal fields, with the current reserve. */
export function toClaimListItem(c: ClaimRow) {
  const { publicRejectionReason: _p, reserveHistory: _r, receiptHash: _h, expectedPrice: _e, registryLineId: _l, ...claim } = c;
  return { ...claim, reserve: currentReserve(c) };
}

export async function toMyClaim(ctx: BaseCtx, c: ClaimRow, i: InsuredRow): Promise<MyClaim> {
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
    payoutCardMasked: maskCard((await payoutCardOf(ctx, i)).card),
  };
  if (status === 'approved') out.expectedPayoutBy = isoDay(ctx.now() + 2 * DAY);
  if (status === 'received' || status === 'checking') out.expectedPayoutBy = isoDay(parseIso(c.slaDueAt) + 2 * DAY);
  if (status === 'rejected') out.rejectionReason = c.publicRejectionReason ?? 'Услуга не входит в программу страхования';
  // Partial approval: the reason for the difference is explained too (LIFECYCLE_SPEC §13).
  if (c.decision?.kind === 'partial') out.rejectionReason = c.decision.reason;
  if (c.decision?.clauseId) out.clauseRef = clauseLabel(c.decision.clauseId);
  out.canAppeal = (status === 'rejected' || c.decision?.kind === 'partial') && !c.appeal;
  if (c.appeal) out.appealStatus = c.appeal.status;
  out.letterAvailable = !!c.decision;
  return out;
}
