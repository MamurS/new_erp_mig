/*
 * Claims settlement (LIFECYCLE_SPEC §13): medical opinion, decisions within the officer's authority and
 * approval above it, reserves, fraud flags, appeals, the decision letter, reserve report and claims register.
 */
import { http, HttpResponse } from 'msw';
import type { ClaimDecision, SessionUser } from '@/shared/types';
import type { ClaimLetter, ReserveReport, ReserveReportRow } from '@/shared/types/dto';
import { can } from '@/shared/auth/permissions';
import { isStaffRole } from '@/shared/domain/labels';
import { canApproveDecision, decisionNeedsApproval, decisionProblem, DECISION_KIND_LABEL, authorityAmount } from '@/shared/domain/settlement';
import { CLAIM_CATEGORY_LABEL, CLAIM_STATUS_LABEL } from '@/shared/domain/claims';
import { clauseByRef, clauseLabel, DECISION_CLAUSES } from '@/features/documents/templates';
import {
  appealResolveSchema,
  appealSchema,
  claimDecideSchema,
  decisionRejectSchema,
  flagDismissSchema,
  opinionRequestSchema,
  opinionSchema,
  reserveSchema,
} from '@/shared/schemas/forms';
import { toCsv } from '@/shared/lib/csv';
import { db, type ClaimRow, type Db } from '../db';
import { API, audit, body, conflict, forbidden, HttpError, notFound, param, requirePermission, requireSession, route, type Ctx } from '../http';
import { toClaimDetail } from '../views';
import { assistanceName } from '../assistance-core';
import { assistanceOn } from '@/shared/domain/assistance';
import { applyDecision, currentReserve, nowIso, reserveOnDate } from '../settlement-core';
import { isoDay } from '../time';

function staffClaim(ctx: Ctx, action: Parameters<typeof can>[1], sub?: string): { user: SessionUser; d: Db; c: ClaimRow } {
  const { user } = requireSession(ctx.request);
  if (!isStaffRole(user.role)) throw forbidden();
  requirePermission(user, action, sub ? { sub } : undefined);
  const d = db();
  const c = d.claims.find((x) => x.id === param(ctx, 'id'));
  if (!c) throw notFound();
  return { user, d, c };
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

export const settlementHandlers = [
  http.post(
    `${API}/claims/:id/request-opinion`,
    route(async (ctx) => {
      const { user, d, c } = staffClaim(ctx, 'claims.decide');
      if (c.status !== 'new' && c.status !== 'review') throw conflict('srv.claim.opinionOnlyInReview');
      const { question } = await body(ctx.request, opinionRequestSchema);
      const at = nowIso();
      c.opinion = { requestedAt: at, requestedByName: user.displayName, ...(question ? { question } : {}) };
      c.history.push({ at, actorName: user.displayName, from: c.status, to: 'medical_review', comment: question ? `Вопрос врачу: ${question}` : 'Запрошено заключение врача' });
      c.status = 'medical_review';
      c.updatedAt = at;
      audit(user, 'claim_opinion_requested', { targetType: 'claim', targetId: c.id, targetLabel: c.number });
      return toClaimDetail(d, c, user);
    }),
  ),
  http.post(
    `${API}/claims/:id/opinion`,
    route(async (ctx) => {
      const { user, d, c } = staffClaim(ctx, 'claims.medical_opinion');
      if (!c.opinion || c.opinion.text) throw conflict('srv.claim.opinionNotRequested');
      const input = await body(ctx.request, opinionSchema);
      const at = nowIso();
      // The doctor gives a medical opinion, not a decision: the claim returns to the claims officer.
      c.opinion = { ...c.opinion, text: input.text, recommendation: input.recommendation, byName: user.displayName, at };
      c.history.push({ at, actorName: user.displayName, from: c.status, to: 'review', comment: 'Медицинское заключение дано' });
      c.status = 'review';
      c.updatedAt = at;
      audit(user, 'claim_opinion_given', { targetType: 'claim', targetId: c.id, targetLabel: c.number });
      return toClaimDetail(d, c, user);
    }),
  ),
  http.post(
    `${API}/claims/:id/decide`,
    route(async (ctx) => {
      const { user, d, c } = staffClaim(ctx, 'claims.decide');
      const reopening = c.appeal?.status === 'open';
      if (!reopening && c.status !== 'new' && c.status !== 'review') throw conflict(c.status === 'medical_review' ? 'srv.claim.awaitingOpinion' : 'srv.decision.alreadyMade');
      if (c.pendingDecision) throw conflict('srv.claim.decisionPending');
      const input = await body(ctx.request, claimDecideSchema);
      const problem = decisionProblem(input.kind, input.amount, c.amountClaimed, input.clauseRef, input.reason, isClause);
      if (problem) throw new HttpError(422, 'validation', problem, { [problem.startsWith('Укажите пункт') ? 'clauseRef' : problem.startsWith('Опишите') ? 'reason' : 'amount']: problem });
      const staff = d.staff.find((s) => s.id === user.id)!;
      const decision: ClaimDecision = {
        kind: input.kind,
        amount: input.amount,
        ...(input.clauseRef ? { clauseId: input.clauseRef } : {}),
        reason: input.reason,
        byId: user.id,
        byName: user.displayName,
        at: nowIso(),
      };
      if (decisionNeedsApproval(input.kind, input.amount, c.amountClaimed, staff.authority)) {
        // Above the officer's authority: someone of the same role with more authority approves (§2, §13).
        c.pendingDecision = { ...decision, required: authorityAmount(input.kind, input.amount, c.amountClaimed) };
        if (c.status === 'new') {
          c.history.push({ at: decision.at, actorName: user.displayName, from: 'new', to: 'review' });
          c.status = 'review';
        }
        c.updatedAt = decision.at;
        audit(user, 'claim_decision_escalated', { targetType: 'claim', targetId: c.id, targetLabel: `${c.number}: ${DECISION_KIND_LABEL[input.kind]} ${input.amount}` });
        return toClaimDetail(d, c, user);
      }
      if (reopening) c.appeal = { ...c.appeal!, status: 'resolved', resolution: `Решение пересмотрено: ${DECISION_KIND_LABEL[input.kind]}`, resolvedAt: decision.at };
      if (c.status === 'rejected' || c.status === 'approved') c.status = 'review';
      applyDecision(c, decision, user);
      audit(user, 'claim_decided', { targetType: 'claim', targetId: c.id, targetLabel: `${c.number}: ${DECISION_KIND_LABEL[input.kind]} ${input.amount}`, reason: input.reason || undefined });
      return toClaimDetail(d, c, user);
    }),
  ),
  http.post(
    `${API}/claims/:id/decision/approve`,
    route((ctx) => {
      const { user, d, c } = staffClaim(ctx, 'claims.decide');
      const pending = c.pendingDecision;
      if (!pending) throw conflict('srv.claim.decisionNotPending');
      const staff = d.staff.find((s) => s.id === user.id)!;
      if (pending.byId === user.id) throw new HttpError(403, 'forbidden', 'srv.claim.fourEyes');
      if (!canApproveDecision(staff, pending)) throw new HttpError(403, 'forbidden', 'srv.claim.overAuthority');
      const { required: _r, ...decision } = pending;
      applyDecision(c, { ...decision, approvedByName: user.displayName }, { id: pending.byId, displayName: pending.byName });
      audit(user, 'claim_decided', { targetType: 'claim', targetId: c.id, targetLabel: `${c.number}: согласовано решение ${pending.byName}`, reason: pending.reason || undefined });
      return toClaimDetail(d, c, user);
    }),
  ),
  http.post(
    `${API}/claims/:id/decision/reject`,
    route(async (ctx) => {
      const { user, d, c } = staffClaim(ctx, 'claims.decide');
      const pending = c.pendingDecision;
      if (!pending) throw conflict('srv.claim.decisionNotPending');
      const staff = d.staff.find((s) => s.id === user.id)!;
      if (!canApproveDecision(staff, pending)) throw forbidden();
      const { comment } = await body(ctx.request, decisionRejectSchema);
      c.pendingDecision = undefined;
      c.history.push({ at: nowIso(), actorName: user.displayName, from: c.status, to: 'review', comment: `Согласование не дано: ${comment}` });
      c.updatedAt = nowIso();
      audit(user, 'claim_decision_rejected', { targetType: 'claim', targetId: c.id, targetLabel: c.number, reason: comment });
      return toClaimDetail(d, c, user);
    }),
  ),
  http.patch(
    `${API}/claims/:id/reserve`,
    route(async (ctx) => {
      const { user, d, c } = staffClaim(ctx, 'claims.reserves');
      if (!['new', 'review', 'medical_review', 'approved', 'to_pay'].includes(c.status)) throw conflict('srv.claim.reserveClosed');
      const input = await body(ctx.request, reserveSchema);
      const from = currentReserve(c);
      c.reserveHistory = [...(c.reserveHistory ?? []), { at: nowIso(), byName: user.displayName, from, to: input.amount, reason: input.reason }];
      audit(user, 'claim_reserve_changed', { targetType: 'claim', targetId: c.id, targetLabel: `${c.number}: ${from} → ${input.amount}`, reason: input.reason });
      return toClaimDetail(d, c, user);
    }),
  ),
  http.post(
    `${API}/claims/:id/flags/:flagId/dismiss`,
    route(async (ctx) => {
      const { user, d, c } = staffClaim(ctx, 'claims.decide');
      const flagId = param(ctx, 'flagId');
      const f = c.flags?.find((x) => x.id === flagId);
      if (!f) throw notFound();
      if (f.dismissed) throw conflict('srv.claim.flagDismissed');
      const { comment } = await body(ctx.request, flagDismissSchema);
      f.dismissed = { byName: user.displayName, at: nowIso(), comment };
      audit(user, 'claim_flag_dismissed', { targetType: 'claim', targetId: c.id, targetLabel: `${c.number}: ${f.code}`, reason: comment });
      return toClaimDetail(d, c, user);
    }),
  ),
  http.post(
    `${API}/claims/:id/appeal/resolve`,
    route(async (ctx) => {
      const { user, d, c } = staffClaim(ctx, 'claims.decide');
      if (c.appeal?.status !== 'open') throw conflict('srv.claim.noOpenAppeal');
      const { resolution } = await body(ctx.request, appealResolveSchema);
      c.appeal = { ...c.appeal, status: 'resolved', resolution, resolvedAt: nowIso() };
      audit(user, 'claim_appeal_resolved', { targetType: 'claim', targetId: c.id, targetLabel: c.number, reason: resolution });
      return toClaimDetail(d, c, user);
    }),
  ),
  http.get(
    `${API}/claims/:id/letter`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'claims.read');
      if (!isStaffRole(user.role)) throw notFound();
      const c = db().claims.find((x) => x.id === param(ctx, 'id'));
      if (!c) throw notFound();
      const letter = letterOf(c);
      if (!letter) throw notFound();
      return letter;
    }),
  ),
  // ---- the insured person: appeal and the letter of their own claims (/api/me only) ----
  http.post(
    `${API}/me/claims/:id/appeal`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      if (user.role !== 'insured') throw forbidden();
      const d = db();
      const c = d.claims.find((x) => x.id === param(ctx, 'id') && x.insuredId === user.insuredId);
      if (!c) throw notFound();
      if (c.appeal) throw conflict('srv.claim.alreadyAppealed');
      if (c.status !== 'rejected' && c.decision?.kind !== 'partial') throw conflict('srv.claim.appealOnlyRejected');
      const { text } = await body(ctx.request, appealSchema);
      c.appeal = { at: nowIso(), by: 'insured', text, status: 'open' };
      c.updatedAt = nowIso();
      audit(user, 'claim_appealed', { targetType: 'claim', targetId: c.id, targetLabel: c.number });
      return { ok: true as const };
    }),
  ),
  http.get(
    `${API}/me/claims/:id/letter`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      if (user.role !== 'insured') throw forbidden();
      const c = db().claims.find((x) => x.id === param(ctx, 'id') && x.insuredId === user.insuredId);
      const letter = c ? letterOf(c) : null;
      if (!letter) throw notFound();
      return letter;
    }),
  ),
  // ---- reports ----
  http.get(
    `${API}/reports/reserves`,
    route(({ request, url }) => {
      const { user } = requireSession(request);
      if (!can(user, 'claims.reserves') && !can(user, 'claims.reserves', { sub: 'read' })) throw forbidden();
      const d = db();
      const raw = url.searchParams.get('date');
      const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : isoDay(Date.now());
      const entries = d.claims
        .map((c) => ({ c, reserve: reserveOnDate(c, date) }))
        .filter((x) => x.reserve > 0)
        .map(({ c, reserve }) => {
          const i = d.insured.find((x) => x.id === c.insuredId);
          const a = i ? assistanceOn(d.assignments, i.policyId, c.serviceDate) : null;
          return { c, reserve, assistance: a, assistanceLabel: a ? (assistanceName(d, a) ?? 'Ассистанс') : 'Без ассистанса (МИГ)' };
        });
      const out: ReserveReport = {
        date,
        total: entries.reduce((s, e) => s + e.reserve, 0),
        claims: entries.length,
        byClient: reportRows(entries.map((e) => ({ key: e.c.clientId, label: e.c.clientName, reserve: e.reserve }))),
        byAssistance: reportRows(entries.map((e) => ({ key: e.assistance ?? 'mig', label: e.assistanceLabel, reserve: e.reserve }))),
        byCategory: reportRows(entries.map((e) => ({ key: e.c.category, label: CLAIM_CATEGORY_LABEL[e.c.category], reserve: e.reserve }))),
      };
      return out;
    }),
  ),
  http.get(
    `${API}/reports/claims-register`,
    route(({ request, url }) => {
      const { user } = requireSession(request);
      if (!isStaffRole(user.role) || !can(user, 'claims.read') || !can(user, 'exports.create')) throw forbidden();
      const d = db();
      const from = url.searchParams.get('from');
      const list = d.claims.filter((c) => !from || c.createdAt.slice(0, 10) >= from);
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
      audit(user, 'export', { targetType: 'export', targetLabel: `Журнал убытков: ${list.length} строк` });
      return new HttpResponse(`\ufeff${csv}`, {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="claims-register-${isoDay(Date.now())}.csv"`, 'Cache-Control': 'no-store' },
      });
    }),
  ),
];

