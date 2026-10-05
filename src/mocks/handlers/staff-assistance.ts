/*
 * MIG side of assistance companies (ASSISTANCE_SPEC §7): list and card of companies, contracts,
 * assignment of an assistance to a policy from a date, review (curator) and payment (accountant) of
 * rebills with four-eyes, the quality-control queue of doctor experts and the report by assistance.
 */
import { msg, t } from '@/i18n/core';
import { http } from 'msw';
import type { AssistanceCompany, SessionUser } from '@/shared/types';
import type { AssignmentView, AssistanceCardView, AssistanceListItem, AssistanceReportRow, QaSampleView } from '@/shared/types/dto';
import { can } from '@/shared/auth/permissions';
import { isStaffRole } from '@/shared/domain/labels';
import { assistanceOn } from '@/shared/domain/assistance';
import { assignmentSchema, assistanceContractSchema, assistanceCreateSchema, complaintResolutionSchema, qaReviewSchema, rebillLineDecisionSchema } from '@/shared/schemas/forms';
import { db, type Db } from '../db';
import { API, audit, body, byLegalForm, byLegalName, conflict, filterLegalForm, forbidden, HttpError, notFound, param, requirePermission, requireSession, route, sortBy } from '../http';
import { assistanceLegalFormOf, clientLegalFormOf } from '../views';
import { legalNameCollator } from '@/shared/config/legalForms';
import {
  assistanceName,
  assistanceOf,
  claimsFromRebill,
  ensureQaSample,
  feeOf,
  kpiOf,
  notifyAssistance,
  rebillStatusAfterReview,
  rosterOf,
  syncAssistance,
  todayIso,
} from '../assistance-core';
import { randomId } from '../rng';
import { DAY, isoDay, parseIso, tzIso } from '../time';
import { DEMO_PASSWORD } from '../credentials';
import { revokeKey } from './clinic';
import { toRebillSummary, toRebillView } from './assist';

function requireStaff(request: Request): SessionUser {
  const { user } = requireSession(request);
  if (!isStaffRole(user.role)) throw forbidden();
  return user;
}

function listItem(d: Db, a: AssistanceCompany, now: number): AssistanceListItem {
  const roster = rosterOf(d, a.id);
  return {
    id: a.id,
    name: a.name,
    legalForm: a.legalForm,
    phone24x7: a.phone24x7,
    integrationMode: a.integrationMode,
    contractNumber: a.contract.number,
    insuredCount: roster.filter((i) => i.status === 'active').length,
    clientsCount: new Set(roster.map((i) => i.clientId)).size,
    kpi: kpiOf(d, a, now),
    rebillsToReview: d.rebills.filter((b) => b.assistanceId === a.id && (b.status === 'submitted' || b.status === 'in_review')).length,
    slaBreaches: d.cases.filter((c) => c.assistanceId === a.id && c.status !== 'resolved' && parseIso(c.slaDueAt) < now).length,
  };
}

function qaView(d: Db, s: Db['qaSamples'][number]): QaSampleView {
  return { ...s, assistanceName: assistanceName(d, s.assistanceId) ?? '—', assistanceLegalForm: assistanceLegalFormOf(d, s.assistanceId), ...(s.reviewedById ? { reviewedByName: d.staff.find((x) => x.id === s.reviewedById)?.fullName } : {}) };
}

function assignmentViews(d: Db, policyId: string): AssignmentView[] {
  return d.assignments
    .filter((a) => a.policyId === policyId)
    .sort((a, b) => (a.from < b.from ? 1 : -1))
    .map((a) => ({ ...a, assistanceName: assistanceName(d, a.assistanceId), setByName: d.staff.find((s) => s.id === a.setById)?.fullName ?? '—' }));
}

function rebillOf(d: Db, id: string) {
  const b = d.rebills.find((x) => x.id === id && x.status !== 'draft');
  if (!b) throw notFound();
  return b;
}

function reportByAssistance(d: Db): AssistanceReportRow[] {
  const today = todayIso();
  const rows: AssistanceReportRow[] = [];
  const groups: (string | null)[] = [...d.assistances.map((a) => a.id), null];
  for (const id of groups) {
    const policies = d.policies.filter((p) => p.status !== 'draft' && assistanceOn(d.assignments, p.id, p.endDate < today ? p.endDate : today) === id);
    const ids = new Set(policies.map((p) => p.id));
    const people = d.insured.filter((i) => ids.has(i.policyId));
    const personIds = new Set(people.map((i) => i.id));
    const premium = policies.reduce((s, p) => s + p.premium, 0);
    const paid = d.claims.filter((c) => personIds.has(c.insuredId) && (c.status === 'approved' || c.status === 'to_pay' || c.status === 'paid')).reduce((s, c) => s + (c.amountApproved ?? c.amountClaimed), 0);
    const fee = id ? d.rebills.filter((b) => b.assistanceId === id && b.status !== 'draft').reduce((s, b) => s + b.fee.amount, 0) : 0;
    const insuredCount = people.filter((i) => i.status === 'active').length;
    rows.push({
      assistanceId: id,
      name: id ? (assistanceName(d, id) ?? '—') : t('srv.noAssistance'),
      legalForm: assistanceLegalFormOf(d, id),
      insuredCount,
      premium,
      paid,
      lossRatio: premium > 0 ? Math.round((paid / premium) * 1000) / 1000 : null,
      fee,
      feePerInsured: id && insuredCount ? Math.round(fee / insuredCount) : null,
    });
  }
  return rows;
}

export const staffAssistanceHandlers = [
  // ---- companies ----
  http.get(
    `${API}/assistance`,
    route(({ request, url }) => {
      requireStaff(request);
      const d = db();
      const now = Date.now();
      const rows = filterLegalForm(
        d.assistances.map((a) => listItem(d, a, now)),
        url,
        (a) => a.legalForm,
      );
      return sortBy(rows, url, {
        name: byLegalName((a) => a.name),
        legalForm: byLegalForm((a) => a.legalForm),
        insuredCount: (a) => a.insuredCount,
        clientsCount: (a) => a.clientsCount,
      });
    }),
  ),
  http.post(
    `${API}/assistance`,
    route(async ({ request }) => {
      const user = requireStaff(request);
      requirePermission(user, 'assistance.manage');
      const input = await body(request, assistanceCreateSchema);
      const d = db();
      if (d.assistUsers.some((u) => u.email === input.admin.email) || d.staff.some((s) => s.email === input.admin.email)) {
        throw new HttpError(409, 'conflict', 'srv.users.emailTaken', { fields: { 'admin.email': msg('srv.users.emailInUse') } });
      }
      const a: AssistanceCompany = {
        id: randomId(),
        name: input.name,
        legalForm: input.legalForm,
        phone24x7: input.phone24x7,
        integrationMode: input.integrationMode,
        contract: { number: input.contractNumber, validFrom: todayIso(), validTo: isoDay(Date.now() + 365 * DAY), ...input.contract },
      };
      d.assistances.push(a);
      d.assistUsers.push({ id: randomId(), ...input.admin, role: 'asst_admin', password: DEMO_PASSWORD, assistanceId: a.id, active: true, createdAt: tzIso(Date.now()) });
      audit(user, 'role_change', { targetType: 'assistance', targetId: a.id, targetLabel: a.name, assistanceId: a.id });
      return listItem(d, a, Date.now());
    }),
  ),
  http.get(
    `${API}/assistance/:id/card`,
    route((ctx) => {
      const user = requireStaff(ctx.request);
      const d = db();
      const a = assistanceOf(d, param(ctx, 'id'));
      const now = Date.now();
      const since = now - DAY;
      const roster = rosterOf(d, a.id);
      const clients = new Map<string, AssistanceCardView['clients'][number]>();
      for (const p of d.policies) {
        if (assistanceOn(d.assignments, p.id, todayIso()) !== a.id) continue;
        const from = d.assignments.filter((x) => x.policyId === p.id && x.assistanceId === a.id).sort((x, y) => (x.from < y.from ? 1 : -1))[0]?.from ?? p.startDate;
        clients.set(p.clientId, { id: p.clientId, name: p.clientName, legalForm: clientLegalFormOf(d, p.clientId) ?? 'other', insuredCount: roster.filter((i) => i.policyId === p.id && i.status === 'active').length, policyNumber: p.number, from });
      }
      const hooks = d.webhookDeliveries.filter((w) => w.clinicId === a.id);
      const insuredCount = roster.filter((i) => i.status === 'active').length;
      const month = isoDay(now).slice(0, 7);
      const monthFee = feeOf(d, a, month, 0).amount;
      const out: AssistanceCardView = {
        assistance: a,
        kpi: kpiOf(d, a, now),
        insuredCount,
        clients: [...clients.values()].sort((x, y) => legalNameCollator.compare(x.name, y.name)),
        users: d.assistUsers.filter((u) => u.assistanceId === a.id).map((u) => ({ id: u.id, email: u.email, fullName: u.fullName, role: u.role, active: u.active, lastLoginAt: u.lastLoginAt })),
        keys: d.integrationClients.filter((k) => k.clinicId === a.id).map(({ secretHash: _h, ...k }) => k),
        webhooks: {
          endpoints: d.webhooks.filter((w) => w.clinicId === a.id).length,
          retrying: hooks.filter((w) => w.status === 'retrying').length,
          failed24h: hooks.filter((w) => w.status === 'failed' && parseIso(w.lastAttemptAt) >= since).length,
        },
        apiErrors24h: d.apiLogs.filter((l) => l.clinicId === a.id && l.status >= 400 && parseIso(l.at) >= since).length,
        rebills: d.rebills.filter((b) => b.assistanceId === a.id && b.status !== 'draft').sort((x, y) => (x.period < y.period ? 1 : -1)).map((b) => toRebillSummary(d, b)),
        qa: d.qaSamples.filter((s) => s.assistanceId === a.id).map((s) => qaView(d, s)),
        audit: can(user, 'audit.read') ? d.audit.filter((e) => e.assistanceId === a.id).slice(0, 50) : [],
        feePerInsured: a.contract.feeModel === 'pepm' ? a.contract.feeValue : insuredCount ? Math.round(monthFee / insuredCount) : null,
        attention: d.cases
          .filter((c) => c.assistanceId === a.id && c.status !== 'resolved' && (c.type === 'complaint' || parseIso(c.slaDueAt) < now))
          .map(({ policyId: _p, createdById: _c, resolvedAt: _r, ...c }) => c),
      };
      return out;
    }),
  ),
  // ---- cases of the assistance: the curator reads them and handles complaints (§5.1, §10) ----
  http.get(
    `${API}/assistance/:id/cases`,
    route((ctx) => {
      const user = requireStaff(ctx.request);
      requirePermission(user, 'assist.cases.manage', { sub: 'read' });
      const d = db();
      const a = assistanceOf(d, param(ctx, 'id'));
      const status = ctx.url.searchParams.get('status');
      const type = ctx.url.searchParams.get('type');
      return d.cases
        .filter((c) => c.assistanceId === a.id && (!status || status.split(',').includes(c.status)) && (!type || c.type === type))
        .sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))
        .slice(0, 200)
        .map(({ policyId: _p, createdById: _c, resolvedAt: _r, ...c }) => c);
    }),
  ),
  http.post(
    `${API}/assistance/:id/cases/:caseId/complaint`,
    route(async (ctx) => {
      const user = requireStaff(ctx.request);
      requirePermission(user, 'assist.cases.manage', { sub: 'complaint' });
      const d = db();
      const a = assistanceOf(d, param(ctx, 'id'));
      const c = d.cases.find((x) => x.id === param(ctx, 'caseId') && x.assistanceId === a.id);
      if (!c) throw notFound();
      if (c.type !== 'complaint') throw conflict('srv.cases.complaintsOnly');
      if (c.status === 'resolved') throw conflict('srv.cases.complaintClosed');
      const { resolution } = await body(ctx.request, complaintResolutionSchema);
      c.status = 'resolved';
      c.resolution = `Куратор МИГ: ${resolution}`;
      c.resolvedAt = tzIso(Date.now());
      audit(user, 'complaint_resolved', { targetType: 'case', targetId: c.id, targetLabel: c.number, reason: resolution, assistanceId: a.id });
      const { policyId: _p, createdById: _c, resolvedAt: _r, ...out } = c;
      return out;
    }),
  ),
  http.patch(
    `${API}/assistance/:id/contract`,
    route(async (ctx) => {
      const user = requireStaff(ctx.request);
      requirePermission(user, 'assistance.manage');
      const d = db();
      const a = assistanceOf(d, param(ctx, 'id'));
      const input = await body(ctx.request, assistanceContractSchema);
      // The form sends the whole contract: an omitted authority removes the individual value (the DMS parameter applies).
      const { guaranteeAuthorityLimit: _old, ...keep } = a.contract;
      a.contract = { ...keep, ...input };
      audit(user, 'role_change', { targetType: 'assistance', targetId: a.id, targetLabel: `${a.name}: договор`, assistanceId: a.id });
      return a;
    }),
  ),
  http.post(
    `${API}/assistance/:id/keys/:keyId/revoke`,
    route((ctx) => {
      const user = requireStaff(ctx.request);
      requirePermission(user, 'assist.integration.manage', { sub: 'revoke_keys' });
      const d = db();
      const a = assistanceOf(d, param(ctx, 'id'));
      const k = d.integrationClients.find((x) => x.id === param(ctx, 'keyId') && x.clinicId === a.id);
      if (!k) throw notFound();
      revokeKey(d, k, user);
      const { secretHash: _h, ...view } = k;
      return view;
    }),
  ),

  // ---- assignment of a policy (underwriter) ----
  http.get(
    `${API}/policies/:id/assistance`,
    route((ctx) => {
      const user = requireStaff(ctx.request);
      if (!can(user, 'policies.read') && !can(user, 'clients.read')) throw forbidden();
      const d = db();
      const p = d.policies.find((x) => x.id === param(ctx, 'id'));
      if (!p) throw notFound();
      return assignmentViews(d, p.id);
    }),
  ),
  http.post(
    `${API}/policies/:id/assistance`,
    route(async (ctx) => {
      const user = requireStaff(ctx.request);
      requirePermission(user, 'assistance.assign');
      const d = db();
      const p = d.policies.find((x) => x.id === param(ctx, 'id'));
      if (!p) throw notFound();
      if (p.status === 'expired') throw conflict('srv.assignment.policyExpired');
      const input = await body(ctx.request, assignmentSchema);
      if (input.assistanceId) assistanceOf(d, input.assistanceId);
      // Only from a date: new requests from that date go to the new assistance (§3).
      const first = p.status === 'draft' ? p.startDate : todayIso();
      if (input.from < first || input.from > p.endDate) {
        throw new HttpError(422, 'validation', 'srv.assignment.dateRange', { fields: { from: msg('srv.assignment.dateRange') } });
      }
      const current = assistanceOn(d.assignments, p.id, input.from);
      if (current === input.assistanceId) throw conflict('srv.assignment.alreadyAssigned');
      const dayBefore = isoDay(parseIso(input.from) - DAY);
      d.assignments = d.assignments.filter((a) => a.policyId !== p.id || a.from < input.from);
      for (const a of d.assignments) if (a.policyId === p.id && (!a.to || a.to >= input.from)) a.to = dayBefore;
      d.assignments.push({ policyId: p.id, assistanceId: input.assistanceId, from: input.from, setById: user.id, setAt: tzIso(Date.now()) });
      syncAssistance(d);
      audit(user, 'assistance_assigned', {
        targetType: 'policy',
        targetId: p.id,
        targetLabel: `${p.number}: ${assistanceName(d, input.assistanceId) ?? 'без ассистанса'} с ${input.from.split('-').reverse().join('.')}`,
        ...(input.assistanceId ? { assistanceId: input.assistanceId } : {}),
      });
      await notifyAssistance(d, current, 'policy.unassigned', p.id);
      await notifyAssistance(d, input.assistanceId, 'policy.assigned', p.id);
      return assignmentViews(d, p.id);
    }),
  ),

  // ---- rebills: review (curator) and payment (accountant) ----
  http.get(
    `${API}/rebills`,
    route(({ request, url }) => {
      const user = requireStaff(request);
      if (!can(user, 'rebills.review') && !can(user, 'rebills.pay')) throw forbidden();
      const d = db();
      const status = url.searchParams.get('status');
      const assistanceId = url.searchParams.get('assistanceId');
      return d.rebills
        .filter((b) => b.status !== 'draft')
        .filter((b) => (!status || status.split(',').includes(b.status)) && (!assistanceId || b.assistanceId === assistanceId))
        .sort((a, b) => ((a.submittedAt ?? '') < (b.submittedAt ?? '') ? 1 : -1))
        .map((b) => toRebillSummary(d, b));
    }),
  ),
  http.get(
    `${API}/rebills/:id`,
    route((ctx) => {
      const user = requireStaff(ctx.request);
      if (!can(user, 'rebills.review') && !can(user, 'rebills.pay')) throw forbidden();
      const d = db();
      return toRebillView(d, rebillOf(d, param(ctx, 'id')));
    }),
  ),
  http.post(
    `${API}/rebills/:id/lines/:lineId/decision`,
    route(async (ctx) => {
      const user = requireStaff(ctx.request);
      requirePermission(user, 'rebills.review');
      const d = db();
      const b = rebillOf(d, param(ctx, 'id'));
      if (b.status === 'paid') throw conflict('srv.rebill.alreadyPaid');
      const line = b.lines.find((l) => l.id === param(ctx, 'lineId'));
      if (!line) throw notFound();
      if (line.status !== 'pending' && line.status !== 'disputed') throw conflict('srv.lines.alreadyDecided');
      const input = await body(ctx.request, rebillLineDecisionSchema);
      if (input.decision === 'accept') {
        line.status = 'accepted';
        line.rejectionReason = undefined;
      } else {
        line.status = 'rejected';
        line.rejectionReason = input.reason;
      }
      b.status = rebillStatusAfterReview(b.lines);
      audit(user, 'rebill_line_decided', { targetType: 'rebill', targetId: b.id, targetLabel: b.number, reason: input.decision === 'accept' ? 'Строка принята' : `Отклонена: ${input.reason}`, assistanceId: b.assistanceId });
      if (b.status !== 'in_review') {
        // Review finished: the curator is the acceptor (four-eyes with the payer), claims appear.
        b.acceptedById = user.id;
        claimsFromRebill(d, b, user.displayName);
        await notifyAssistance(d, b.assistanceId, 'rebill.reviewed', b.id);
      }
      return toRebillView(d, b);
    }),
  ),
  http.post(
    `${API}/rebills/:id/pay`,
    route(async (ctx) => {
      const user = requireStaff(ctx.request);
      requirePermission(user, 'rebills.pay');
      const d = db();
      const b = rebillOf(d, param(ctx, 'id'));
      if (b.status !== 'accepted' && b.status !== 'partially_accepted') throw conflict('srv.rebill.payReviewedOnly');
      // Four-eyes: the person who accepted the rebill cannot pay it (§5.5, §13.4).
      if (!can(user, 'rebills.pay', { createdById: b.acceptedById })) throw new HttpError(409, 'conflict', 'srv.rebill.fourEyes');
      b.status = 'paid';
      b.paidById = user.id;
      b.paidAt = tzIso(Date.now());
      const ids = new Set(b.lines.filter((l) => l.status === 'accepted').map((l) => l.registryLineId));
      for (const c of d.claims) {
        if (c.registryLineId && ids.has(c.registryLineId) && c.status !== 'paid') {
          c.history.push({ at: b.paidAt, actorName: user.displayName, from: c.status, to: 'paid' });
          c.status = 'paid';
          c.updatedAt = b.paidAt;
        }
      }
      audit(user, 'rebill_paid', { targetType: 'rebill', targetId: b.id, targetLabel: b.number, assistanceId: b.assistanceId });
      await notifyAssistance(d, b.assistanceId, 'rebill.paid', b.id);
      return toRebillView(d, b);
    }),
  ),

  // ---- quality control (doctor expert) ----
  http.get(
    `${API}/qa`,
    route(({ request, url }) => {
      const user = requireStaff(request);
      requirePermission(user, 'qa.review');
      const d = db();
      ensureQaSample(d);
      const status = url.searchParams.get('status') ?? 'pending';
      const assistanceId = url.searchParams.get('assistanceId');
      return d.qaSamples
        .filter((s) => (status === 'all' || (status === 'pending' ? !s.verdict : !!s.verdict)) && (!assistanceId || s.assistanceId === assistanceId))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((s) => qaView(d, s));
    }),
  ),
  http.post(
    `${API}/qa/:id/review`,
    route(async (ctx) => {
      const user = requireStaff(ctx.request);
      requirePermission(user, 'qa.review');
      const d = db();
      const s = d.qaSamples.find((x) => x.id === param(ctx, 'id'));
      if (!s) throw notFound();
      if (s.verdict) throw conflict('srv.quality.alreadyRated');
      const input = await body(ctx.request, qaReviewSchema);
      s.verdict = input.verdict;
      s.comment = input.comment || undefined;
      s.reviewedById = user.id;
      audit(user, 'qa_reviewed', { targetType: 'assistance', targetId: s.assistanceId, targetLabel: s.subject.label, reason: input.verdict === 'agree' ? 'Согласен' : 'Не согласен', assistanceId: s.assistanceId });
      if (input.verdict === 'disagree') await notifyAssistance(d, s.assistanceId, 'qa.disagreement', s.id);
      return qaView(d, s);
    }),
  ),

  // ---- report ----
  http.get(
    `${API}/reports/by-assistance`,
    route(({ request }) => {
      const user = requireStaff(request);
      requirePermission(user, 'reports.read');
      return reportByAssistance(db());
    }),
  ),
];
