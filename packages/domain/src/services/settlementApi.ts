/*
 * Claims settlement endpoints (LIFECYCLE_SPEC §13): medical opinion, decisions within the officer's
 * authority and approval above it, reserves, fraud flags, appeals, the decision letter, the reserve
 * report and the claims register. The shared core (reserve timeline, flags, applying a decision) is
 * services/settlement.ts.
 */
import { t } from '@mig/i18n';
import type { ClaimDecision } from '@mig/contracts';
import type { ClaimDetail, ClaimLetter, ReserveReport, ReserveReportRow } from '@mig/contracts/dto';
import { appealResolveSchema, appealSchema, claimDecideSchema, decisionRejectSchema, flagDismissSchema, opinionRequestSchema, opinionSchema, reserveSchema } from '@mig/contracts/forms';
import { can, type Action } from '../auth/permissions';
import { isStaffRole } from '../labels';
import { authorityAmount, canApproveDecision, decisionNeedsApproval, decisionProblem, DECISION_KIND_LABEL } from '../settlement';
import { CLAIM_CATEGORY_LABEL, CLAIM_STATUS_LABEL } from '../claims';
import { clauseByRef, clauseLabel, DECISION_CLAUSES } from '../documents/templates/index';
import { assistanceOn } from '../assistance';
import { toCsv } from '../lib/csv';
import { isoDay } from '../lib/time';
import type { ClaimRow } from '../store/db';
import { audit, conflict, DomainError, errorOf, forbidden, notFound, requirePermission, validate, type AuthCtx } from './kernel';
import { toClaimDetail } from './views';
import { assistanceName } from './assistance';
import { myClaimOf } from './family';
import { applyDecision, currentReserve, nowIso, reserveOnDate } from './settlement';

async function staffClaim(ctx: AuthCtx, id: string, action: Action): Promise<ClaimRow> {
  const { user } = ctx;
  if (!isStaffRole(user.role)) throw forbidden();
  requirePermission(user, action);
  const c = await ctx.repos.claims.get(id);
  if (!c) throw notFound();
  return c;
}

const isClause = (ref: string) => DECISION_CLAUSES.some((c) => c.ref === ref) || !!clauseByRef(ref);

function letterOf(c: ClaimRow): ClaimLetter | null {
  if (!c.decision) return null;
  return {
    claimNumber: c.number,
    insuredName: c.insuredName,
    amountClaimed: c.amountClaimed,
    decision: { kind: c.decision.kind, amount: c.decision.amount, clauseRef: c.decision.clauseId ? clauseLabel(c.decision.clauseId) : undefined, reason: c.decision.reason, at: c.decision.at },
  };
}

function reportRows(entries: { key: string; label: string; reserve: number }[]): ReserveReportRow[] {
  const map = new Map<string, ReserveReportRow>();
  for (const e of entries) {
    const row = map.get(e.key) ?? { key: e.key, label: e.label, claims: 0, reserve: 0 };
    row.claims += 1;
    row.reserve += e.reserve;
    map.set(e.key, row);
  }
  return [...map.values()].sort((a, b) => b.reserve - a.reserve);
}

// ---------------------------------------------------------------- endpoints

export async function requestOpinion(ctx: AuthCtx, id: string, body: unknown): Promise<ClaimDetail> {
  const { user } = ctx;
  const c = await staffClaim(ctx, id, 'claims.decide');
  if (c.status !== 'new' && c.status !== 'review') throw conflict('srv.claim.opinionOnlyInReview');
  const { question } = validate(opinionRequestSchema, body);
  const at = nowIso(ctx);
  c.opinion = { requestedAt: at, requestedByName: user.displayName, ...(question ? { question } : {}) };
  c.history.push({ at, actorName: user.displayName, from: c.status, to: 'medical_review', comment: question ? `Вопрос врачу: ${question}` : 'Запрошено заключение врача' });
  c.status = 'medical_review';
  c.updatedAt = at;
  await ctx.repos.claims.put(c);
  await audit(ctx, user, 'claim_opinion_requested', { targetType: 'claim', targetId: c.id, targetLabel: c.number });
  return toClaimDetail(ctx, c, user);
}

export async function giveOpinion(ctx: AuthCtx, id: string, body: unknown): Promise<ClaimDetail> {
  const { user } = ctx;
  const c = await staffClaim(ctx, id, 'claims.medical_opinion');
  if (!c.opinion || c.opinion.text) throw conflict('srv.claim.opinionNotRequested');
  const input = validate(opinionSchema, body);
  const at = nowIso(ctx);
  // The doctor gives a medical opinion, not a decision: the claim returns to the claims officer.
  c.opinion = { ...c.opinion, text: input.text, recommendation: input.recommendation, byName: user.displayName, at };
  c.history.push({ at, actorName: user.displayName, from: c.status, to: 'review', comment: 'Медицинское заключение дано' });
  c.status = 'review';
  c.updatedAt = at;
  await ctx.repos.claims.put(c);
  await audit(ctx, user, 'claim_opinion_given', { targetType: 'claim', targetId: c.id, targetLabel: c.number });
  return toClaimDetail(ctx, c, user);
}

export async function decide(ctx: AuthCtx, id: string, body: unknown): Promise<ClaimDetail> {
  const { user } = ctx;
  const c = await staffClaim(ctx, id, 'claims.decide');
  const reopening = c.appeal?.status === 'open';
  if (!reopening && c.status !== 'new' && c.status !== 'review') throw conflict(c.status === 'medical_review' ? 'srv.claim.awaitingOpinion' : 'srv.decision.alreadyMade');
  if (c.pendingDecision) throw conflict('srv.claim.decisionPending');
  const input = validate(claimDecideSchema, body);
  const problem = decisionProblem(input.kind, input.amount, c.amountClaimed, input.clauseRef, input.reason, isClause);
  if (problem) {
    // Same order of checks as decisionProblem: clause, then reason, then the amount.
    const field = input.kind !== 'approve' && (!input.clauseRef || !isClause(input.clauseRef)) ? 'clauseRef' : input.kind !== 'approve' && input.reason.trim().length < 5 ? 'reason' : 'amount';
    throw errorOf(422, 'validation', problem, { [field]: problem });
  }
  const staff = (await ctx.repos.staff.get(user.id))!;
  const decision: ClaimDecision = {
    kind: input.kind,
    amount: input.amount,
    ...(input.clauseRef ? { clauseId: input.clauseRef } : {}),
    reason: input.reason,
    byId: user.id,
    byName: user.displayName,
    at: nowIso(ctx),
  };
  if (decisionNeedsApproval(input.kind, input.amount, c.amountClaimed, staff.authority)) {
    // Above the officer's authority: someone of the same role with more authority approves (§2, §13).
    c.pendingDecision = { ...decision, required: authorityAmount(input.kind, input.amount, c.amountClaimed) };
    if (c.status === 'new') {
      c.history.push({ at: decision.at, actorName: user.displayName, from: 'new', to: 'review' });
      c.status = 'review';
    }
    c.updatedAt = decision.at;
    await ctx.repos.claims.put(c);
    await audit(ctx, user, 'claim_decision_escalated', { targetType: 'claim', targetId: c.id, targetLabel: `${c.number}: ${DECISION_KIND_LABEL[input.kind]} ${input.amount}` });
    return toClaimDetail(ctx, c, user);
  }
  if (reopening) c.appeal = { ...c.appeal!, status: 'resolved', resolution: `Решение пересмотрено: ${DECISION_KIND_LABEL[input.kind]}`, resolvedAt: decision.at };
  if (c.status === 'rejected' || c.status === 'approved') c.status = 'review';
  applyDecision(c, decision, user);
  await ctx.repos.claims.put(c);
  await audit(ctx, user, 'claim_decided', { targetType: 'claim', targetId: c.id, targetLabel: `${c.number}: ${DECISION_KIND_LABEL[input.kind]} ${input.amount}`, reason: input.reason || undefined });
  return toClaimDetail(ctx, c, user);
}

export async function approveDecision(ctx: AuthCtx, id: string): Promise<ClaimDetail> {
  const { user } = ctx;
  const c = await staffClaim(ctx, id, 'claims.decide');
  const pending = c.pendingDecision;
  if (!pending) throw conflict('srv.claim.decisionNotPending');
  const staff = (await ctx.repos.staff.get(user.id))!;
  if (pending.byId === user.id) throw new DomainError(403, 'forbidden', 'srv.claim.fourEyes');
  if (!canApproveDecision(staff, pending)) throw new DomainError(403, 'forbidden', 'srv.claim.overAuthority');
  const { required: _r, ...decision } = pending;
  applyDecision(c, { ...decision, approvedByName: user.displayName }, { id: pending.byId, displayName: pending.byName });
  await ctx.repos.claims.put(c);
  await audit(ctx, user, 'claim_decided', { targetType: 'claim', targetId: c.id, targetLabel: `${c.number}: согласовано решение ${pending.byName}`, reason: pending.reason || undefined });
  return toClaimDetail(ctx, c, user);
}

export async function rejectDecision(ctx: AuthCtx, id: string, body: unknown): Promise<ClaimDetail> {
  const { user } = ctx;
  const c = await staffClaim(ctx, id, 'claims.decide');
  const pending = c.pendingDecision;
  if (!pending) throw conflict('srv.claim.decisionNotPending');
  const staff = (await ctx.repos.staff.get(user.id))!;
  if (!canApproveDecision(staff, pending)) throw forbidden();
  const { comment } = validate(decisionRejectSchema, body);
  c.pendingDecision = undefined;
  c.history.push({ at: nowIso(ctx), actorName: user.displayName, from: c.status, to: 'review', comment: `Согласование не дано: ${comment}` });
  c.updatedAt = nowIso(ctx);
  await ctx.repos.claims.put(c);
  await audit(ctx, user, 'claim_decision_rejected', { targetType: 'claim', targetId: c.id, targetLabel: c.number, reason: comment });
  return toClaimDetail(ctx, c, user);
}

export async function changeReserve(ctx: AuthCtx, id: string, body: unknown): Promise<ClaimDetail> {
  const { user } = ctx;
  const c = await staffClaim(ctx, id, 'claims.reserves');
  if (!['new', 'review', 'medical_review', 'approved', 'to_pay'].includes(c.status)) throw conflict('srv.claim.reserveClosed');
  const input = validate(reserveSchema, body);
  const from = currentReserve(c);
  c.reserveHistory = [...(c.reserveHistory ?? []), { at: nowIso(ctx), byName: user.displayName, from, to: input.amount, reason: input.reason }];
  await ctx.repos.claims.put(c);
  await audit(ctx, user, 'claim_reserve_changed', { targetType: 'claim', targetId: c.id, targetLabel: `${c.number}: ${from} → ${input.amount}`, reason: input.reason });
  return toClaimDetail(ctx, c, user);
}

export async function dismissFlag(ctx: AuthCtx, id: string, flagId: string, body: unknown): Promise<ClaimDetail> {
  const { user } = ctx;
  const c = await staffClaim(ctx, id, 'claims.decide');
  const f = c.flags?.find((x) => x.id === flagId);
  if (!f) throw notFound();
  if (f.dismissed) throw conflict('srv.claim.flagDismissed');
  const { comment } = validate(flagDismissSchema, body);
  f.dismissed = { byName: user.displayName, at: nowIso(ctx), comment };
  await ctx.repos.claims.put(c);
  await audit(ctx, user, 'claim_flag_dismissed', { targetType: 'claim', targetId: c.id, targetLabel: `${c.number}: ${f.code}`, reason: comment });
  return toClaimDetail(ctx, c, user);
}

export async function resolveAppeal(ctx: AuthCtx, id: string, body: unknown): Promise<ClaimDetail> {
  const { user } = ctx;
  const c = await staffClaim(ctx, id, 'claims.decide');
  if (c.appeal?.status !== 'open') throw conflict('srv.claim.noOpenAppeal');
  const { resolution } = validate(appealResolveSchema, body);
  c.appeal = { ...c.appeal, status: 'resolved', resolution, resolvedAt: nowIso(ctx) };
  await ctx.repos.claims.put(c);
  await audit(ctx, user, 'claim_appeal_resolved', { targetType: 'claim', targetId: c.id, targetLabel: c.number, reason: resolution });
  return toClaimDetail(ctx, c, user);
}

export async function claimLetter(ctx: AuthCtx, id: string): Promise<ClaimLetter> {
  const { user } = ctx;
  requirePermission(user, 'claims.read');
  if (!isStaffRole(user.role)) throw notFound();
  const c = await ctx.repos.claims.get(id);
  if (!c) throw notFound();
  const letter = letterOf(c);
  if (!letter) throw notFound();
  return letter;
}

// ---- the insured person: appeal and the letter of their own claims (/api/me only) ----

async function myClaim(ctx: AuthCtx, id: string): Promise<ClaimRow> {
  const { user } = ctx;
  if (user.role !== 'insured') throw forbidden();
  const me = user.insuredId ? await ctx.repos.insured.get(user.insuredId) : null;
  if (!me) throw notFound();
  // Own claims and the claims of the family the signed-in person may see (a child, an adult who allowed it).
  return (await myClaimOf(ctx, me, id)).c;
}

export async function appeal(ctx: AuthCtx, id: string, body: unknown): Promise<{ ok: true }> {
  const { user } = ctx;
  const c = await myClaim(ctx, id);
  if (c.appeal) throw conflict('srv.claim.alreadyAppealed');
  if (c.status !== 'rejected' && c.decision?.kind !== 'partial') throw conflict('srv.claim.appealOnlyRejected');
  const { text } = validate(appealSchema, body);
  await ctx.repos.claims.update(c.id, { appeal: { at: nowIso(ctx), by: 'insured', text, status: 'open' }, updatedAt: nowIso(ctx) });
  await audit(ctx, user, 'claim_appealed', { targetType: 'claim', targetId: c.id, targetLabel: c.number });
  return { ok: true as const };
}

export async function myClaimLetter(ctx: AuthCtx, id: string): Promise<ClaimLetter> {
  const letter = letterOf(await myClaim(ctx, id));
  if (!letter) throw notFound();
  return letter;
}

// ---- reports ----

export async function reserveReport(ctx: AuthCtx, qs: URLSearchParams): Promise<ReserveReport> {
  const { user } = ctx;
  if (!can(user, 'claims.reserves') && !can(user, 'claims.reserves', { sub: 'read' })) throw forbidden();
  const raw = qs.get('date');
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : isoDay(ctx.now());
  const assignments = await ctx.repos.assignments.list();
  const entries: { c: ClaimRow; reserve: number; assistance: string | null; assistanceLabel: string }[] = [];
  for (const c of await ctx.repos.claims.list()) {
    const reserve = reserveOnDate(c, date);
    if (reserve <= 0) continue;
    const i = await ctx.repos.insured.get(c.insuredId);
    const a = i ? assistanceOn(assignments, i.policyId, c.serviceDate) : null;
    entries.push({ c, reserve, assistance: a, assistanceLabel: a ? ((await assistanceName(ctx, a)) ?? t('srv.dash.assistance')) : t('srv.noAssistance') });
  }
  return {
    date,
    total: entries.reduce((s, e) => s + e.reserve, 0),
    claims: entries.length,
    byClient: reportRows(entries.map((e) => ({ key: e.c.clientId, label: e.c.clientName, reserve: e.reserve }))),
    byAssistance: reportRows(entries.map((e) => ({ key: e.assistance ?? 'mig', label: e.assistanceLabel, reserve: e.reserve }))),
    byCategory: reportRows(entries.map((e) => ({ key: e.c.category, label: CLAIM_CATEGORY_LABEL[e.c.category], reserve: e.reserve }))),
  };
}

/** The claims register as CSV text (the adapter sends it as a file `claims-register-<date>.csv`). */
export async function claimsRegister(ctx: AuthCtx, qs: URLSearchParams): Promise<{ csv: string; fileName: string }> {
  const { user } = ctx;
  if (!isStaffRole(user.role) || !can(user, 'claims.read') || !can(user, 'exports.create')) throw forbidden();
  const from = qs.get('from');
  const list = (await ctx.repos.claims.list()).filter((c) => !from || c.createdAt.slice(0, 10) >= from);
  // No PINFL and no phones in the register (LIFECYCLE_SPEC §13); cells are escaped against CSV injection.
  const csv = toCsv(
    ['number', 'createdAt', 'serviceDate', 'client', 'insured', 'category', 'source', 'status', 'amountClaimed', 'amountApproved', 'reserve', 'decision', 'clause', 'flags'],
    list.map((c) => [
      c.number,
      c.createdAt.slice(0, 10),
      c.serviceDate,
      c.clientName,
      c.insuredName,
      CLAIM_CATEGORY_LABEL[c.category],
      c.source,
      CLAIM_STATUS_LABEL[c.status],
      String(c.amountClaimed),
      c.amountApproved === undefined ? '' : String(c.amountApproved),
      String(currentReserve(c)),
      c.decision ? DECISION_KIND_LABEL[c.decision.kind] : '',
      c.decision?.clauseId ? clauseLabel(c.decision.clauseId) : '',
      (c.flags ?? []).filter((f) => !f.dismissed).map((f) => f.code).join(' '),
    ]),
  );
  await audit(ctx, user, 'export', { targetType: 'export', targetLabel: `Журнал убытков: ${list.length} строк` });
  return { csv: `\ufeff${csv}`, fileName: `claims-register-${isoDay(ctx.now())}.csv` };
}
