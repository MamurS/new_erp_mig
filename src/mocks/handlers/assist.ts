/*
 * Assistance company portal API (/api/assist/...), ASSISTANCE_SPEC §6. Every handler resolves the
 * assistance from the session and checks the scope of the record on the date of the event
 * (requireAssistanceScope): foreign records are 404, records of a former client are read-only.
 */
import { matchesSearch } from '@/shared/lib/searchNormalize';
import { msg } from '@/i18n/core';
import { http } from 'msw';
import type { Action } from '@/shared/auth/permissions';
import { can } from '@/shared/auth/permissions';
import type { Appointment, Registry, SessionUser, UUID } from '@/shared/types';
import type {
  AssistAppointment,
  AssistCaseView,
  AssistChatMessage,
  AssistChatThread,
  AssistClinic,
  AssistInsuredDetail,
  AssistInsuredItem,
  AssistOverview,
  AssistQueueItem,
  AssistUserView,
  MedicalGrant,
  RebillSummary,
  RebillView,
  RevealResponse,
  SubRegistrySummary,
  SubRegistryView,
} from '@/shared/types/dto';
import { isAssistRole } from '@/shared/domain/labels';
import { assistanceScope, CASE_SLA_MINUTES, CASE_TYPE_LABEL } from '@/shared/domain/assistance';
import { dmsParam, nextDocNumber } from '../params';
import { registryStatusAfterReview } from '@/shared/domain/clinics';
import { SPECIALTY_LABEL } from '@/shared/domain/labels';
import { formatMoney } from '@/shared/lib/format';
import {
  assistAppointmentSchema,
  assistGuaranteeDecisionSchema,
  assistGuaranteeRequestSchema,
  assistUserInviteSchema,
  assistUserPatchSchema,
  caseCreateSchema,
  caseUpdateSchema,
  chatSchema,
  clinicPaymentSchema,
  declineAppointmentSchema,
  medicalAccessSchema,
  piiField,
  rebillCreateSchema,
  rebillDisputeSchema,
  revealSchema,
} from '@/shared/schemas/forms';
import { z } from 'zod';
import { db, type AssistUserRow, type AssistanceCaseRow, type Db, type GuaranteeRow, type InsuredRow } from '../db';
import { API, audit, body, conflict, forbidden, HttpError, insuredLabel, notFound, param, q, requirePermission, requireSession, route } from '../http';
import {
  assistanceOf,
  authorityLimitOf,
  kpiOf,
  linesOf,
  recomputeRebill,
  rebillStatusAfterReview,
  requireAssistanceScope,
  requireInsuredOf,
  rosterOf,
  settleRegistry,
  subStatus,
  subTotals,
  todayIso,
  upsertDraftRebill,
} from '../assistance-core';
import { clinicOf, clinicResponseMinutes, createAppointment, emitWebhook, isOverdueRequest, priceListOf, pushEvent, recomputeRegistry, refreshGuarantee, respondToAppointment, toGuaranteeView } from '../clinic-core';
import { maskBirthDate, maskPhone, maskPinfl, formatPhoneFull } from '../mask';
import { PROGRAMS } from '../programs';
import { randomId, randomToken } from '../rng';
import { DAY, isoDay, parseIso, tzIso } from '../time';
import { limitsFor } from '../views';
import { fieldLabel, medicalRecords } from './insured';
import { createGuarantee } from './clinic';
import { VISIT_TTL_MS } from '@/shared/domain/clinics';
import { DEMO_PASSWORD } from '../credentials';
import { partnerIntegrationHandlers } from './partner-integration';

const A = `${API}/assist`;
function clinicAnswerDue(d: Db, a: Appointment): string {
  return tzIso(parseIso(a.createdAt) + clinicResponseMinutes(d, a.clinicId) * 60_000);
}
const MEDICAL_TTL = 15 * 60_000;

export interface AssistCtx {
  user: SessionUser;
  assistanceId: UUID;
  d: Db;
}

export function requireAssist(request: Request, action?: Action, sub?: string): AssistCtx {
  const { user } = requireSession(request);
  if (!isAssistRole(user.role) || !user.assistanceId) throw forbidden();
  if (action) requirePermission(user, action, { assistanceId: user.assistanceId, ...(sub ? { sub } : {}) });
  return { user, assistanceId: user.assistanceId, d: db() };
}

// ---------------------------------------------------------------- views

function toItem(d: Db, i: InsuredRow, access: 'full' | 'read'): AssistInsuredItem {
  const p = d.policies.find((x) => x.id === i.policyId);
  return {
    id: i.id,
    fullName: i.fullName,
    clientName: i.clientName,
    policyNumber: p?.number ?? '—',
    programName: PROGRAMS[p?.program ?? 'standard'].name,
    status: i.status,
    phoneMasked: maskPhone(i.phone),
    pinflMasked: maskPinfl(i.pinfl),
    birthDateMasked: maskBirthDate(i.birthDate),
    access,
  };
}

/** Scope of a record of a policy on its event date; 'none' hides the record. */
const scopeOn = (d: Db, assistanceId: UUID, policyId: UUID, at: string) => assistanceScope(d.assignments, assistanceId, policyId, at.slice(0, 10), todayIso());

function caseView(d: Db, c: AssistanceCaseRow, assistanceId: UUID): AssistCaseView | null {
  if (c.assistanceId !== assistanceId) return null;
  const s = scopeOn(d, assistanceId, c.policyId, c.createdAt);
  if (s === 'none') return null;
  const { policyId: _p, createdById: _c, resolvedAt: _r, ...rest } = c;
  return { ...rest, access: s };
}

function toSubSummary(d: Db, r: Registry, payer: UUID): SubRegistrySummary {
  const lines = linesOf(r, payer);
  return {
    id: r.id,
    clinicId: r.clinicId,
    clinicName: clinicOf(d, r.clinicId).name,
    clinicLegalForm: clinicOf(d, r.clinicId).legalForm,
    period: r.period,
    status: subStatus(r, lines),
    source: r.source,
    submittedAt: r.submittedAt,
    lineCount: lines.length,
    pendingCount: lines.filter((l) => l.status === 'pending').length,
    disputedCount: lines.filter((l) => l.status === 'disputed').length,
    unpaidCount: lines.filter((l) => l.status === 'accepted' && !l.payment).length,
    totals: subTotals(lines),
    ...(r.submittedAt ? { reviewDueAt: tzIso(parseIso(r.submittedAt) + dmsParam('subRegistryReviewDays') * DAY) } : {}),
  };
}

function toSubView(d: Db, r: Registry, payer: UUID): SubRegistryView {
  const lines = linesOf(r, payer);
  const guaranteeChecks: SubRegistryView['guaranteeChecks'] = {};
  for (const l of lines) {
    if (!l.guaranteeNumber) continue;
    const g = d.guarantees.find((x) => x.number === l.guaranteeNumber && x.clinicId === r.clinicId);
    const approved = g?.approvedAmount ?? null;
    guaranteeChecks[l.id] = { approvedAmount: approved, ok: approved !== null && l.amount <= approved };
  }
  return { ...toSubSummary(d, r, payer), lines, guaranteeChecks };
}

function addWorkdays(fromIso: string, days: number): string {
  let t = parseIso(fromIso);
  let left = days;
  while (left > 0) {
    t += DAY;
    const wd = new Date(t).getDay();
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  return isoDay(t);
}

export function toRebillView(d: Db, b: RebillView | Parameters<typeof recomputeRebill>[1]): RebillView {
  recomputeRebill(d, b);
  const name = (id?: string) => (id ? d.staff.find((s) => s.id === id)?.fullName : undefined);
  return {
    ...b,
    assistanceName: assistanceOf(d, b.assistanceId).name,
    assistanceLegalForm: assistanceOf(d, b.assistanceId).legalForm,
    ...(b.submittedAt ? { reviewDueAt: addWorkdays(b.submittedAt, dmsParam('rebillReviewWorkdays')) } : {}),
    ...(b.acceptedById ? { acceptedByName: name(b.acceptedById) } : {}),
    ...(b.paidById ? { paidByName: name(b.paidById) } : {}),
  };
}

export function toRebillSummary(d: Db, b: Parameters<typeof recomputeRebill>[1]): RebillSummary {
  const { lines, ...rest } = toRebillView(d, b);
  return { ...rest, lineCount: lines.length, flaggedCount: lines.filter((l) => l.checks.length > 0).length };
}

const userView = (u: AssistUserRow): AssistUserView => ({ id: u.id, email: u.email, fullName: u.fullName, role: u.role, active: u.active, lastLoginAt: u.lastLoginAt });

function guaranteeOf(d: Db, assistanceId: UUID, id: UUID): GuaranteeRow {
  const g = d.guarantees.find((x) => x.id === id && x.assistanceId === assistanceId);
  if (!g || !g.policyId || scopeOn(d, assistanceId, g.policyId, g.createdAt) === 'none') throw notFound();
  return g;
}

function ownRegistry(d: Db, assistanceId: UUID, id: UUID): Registry {
  const r = d.registries.find((x) => x.id === id && x.status !== 'draft');
  if (!r || !linesOf(r, assistanceId).length) throw notFound();
  return r;
}

function ownRebill(d: Db, assistanceId: UUID, id: UUID) {
  const b = d.rebills.find((x) => x.id === id && x.assistanceId === assistanceId);
  if (!b) throw notFound();
  return b;
}

function appointmentsOf(d: Db, assistanceId: UUID): Appointment[] {
  const people = new Map(d.insured.map((i) => [i.id, i]));
  return d.appointments.filter((a) => {
    const who = people.get(a.insuredId);
    return !!who && scopeOn(d, assistanceId, who.policyId, a.createdAt) !== 'none';
  });
}

// ---------------------------------------------------------------- handlers

export const assistHandlers = [
  // ---- desktop ----
  http.get(
    `${A}/overview`,
    route(({ request }) => {
      const { user, assistanceId, d } = requireAssist(request);
      const a = assistanceOf(d, assistanceId);
      const now = Date.now();
      const queue: AssistQueueItem[] = [];
      const cases = d.cases.filter((c) => c.assistanceId === assistanceId && c.status !== 'resolved');
      const appts = appointmentsOf(d, assistanceId).filter((x) => x.status === 'requested' && parseIso(x.startsAt) > now - 3600_000 && isOverdueRequest(d, x, now));
      const gps = d.guarantees.filter((g) => g.assistanceId === assistanceId && g.status === 'requested' && !g.escalated);
      const regs = d.registries.filter((r) => r.status !== 'draft' && linesOf(r, assistanceId).length);
      const pendingLines = regs.reduce((s, r) => s + linesOf(r, assistanceId).filter((l) => l.status === 'pending' || l.status === 'disputed').length, 0);
      const rebills = d.rebills.filter((b) => b.assistanceId === assistanceId);
      if (user.role === 'asst_operator' || user.role === 'asst_doctor') {
        for (const c of cases) queue.push({ id: c.id, kind: 'case', title: `${c.number} · ${CASE_TYPE_LABEL[c.type]}`, subtitle: c.insuredName, dueAt: c.slaDueAt, to: `/assist/cases/${c.id}` });
      }
      if (user.role === 'asst_operator') {
        for (const x of appts) queue.push({ id: x.id, kind: 'appointment', title: msg('srv.assistQ.noResponse', { specialty: SPECIALTY_LABEL[x.specialty] }), subtitle: `${x.insuredName} · ${x.clinicName}`, dueAt: x.startsAt, to: '/assist/appointments' });
      }
      if (user.role === 'asst_doctor') {
        for (const g of gps) queue.push({ id: g.id, kind: 'guarantee', title: `${g.number} · ${g.serviceName}`, subtitle: `${g.insuredName} · ${formatMoney(g.estimatedCost)}`, dueAt: tzIso(parseIso(g.createdAt) + DAY), to: `/assist/guarantees/${g.id}` });
        for (const g of d.guarantees.filter((x) => x.assistanceId === assistanceId && x.escalated && x.status === 'requested')) {
          queue.push({ id: g.id, kind: 'escalation', title: msg('srv.assistQ.toMig', { number: g.number }), subtitle: msg('srv.assistQ.awaitingMig', { name: g.insuredName }), to: `/assist/guarantees/${g.id}` });
        }
      }
      if (user.role === 'asst_doctor' || user.role === 'asst_billing') {
        for (const r of regs) {
          const s = toSubSummary(d, r, assistanceId);
          const toReview = s.pendingCount + s.disputedCount;
          if (user.role === 'asst_doctor' && toReview) {
            queue.push({ id: r.id, kind: 'registry', title: msg('srv.assistQ.registry', { clinic: s.clinicName, period: r.period }), subtitle: msg('srv.assistQ.linesInReview', { count: toReview }), dueAt: tzIso(parseIso(r.submittedAt ?? tzIso(now)) + 5 * DAY), to: `/assist/registries/${r.id}` });
          }
          if (user.role === 'asst_billing' && s.unpaidCount) {
            queue.push({ id: r.id, kind: 'registry', title: msg('srv.assistQ.payment', { clinic: s.clinicName, period: r.period }), subtitle: msg('srv.assistQ.unpaidLines', { count: s.unpaidCount }), to: `/assist/registries/${r.id}` });
          }
        }
      }
      if (user.role === 'asst_billing') {
        for (const b of rebills.filter((x) => x.status === 'draft' || x.lines.some((l) => l.status === 'rejected') && x.status !== 'paid')) {
          queue.push({ id: b.id, kind: 'rebill', title: msg('srv.assistQ.rebill', { number: b.number }), subtitle: msg(b.status === 'draft' ? 'srv.assistQ.rebillDraft' : 'srv.assistQ.rebillRejected'), to: `/assist/rebills/${b.id}` });
        }
      }
      const out: AssistOverview = {
        assistance: { id: a.id, name: a.name, legalForm: a.legalForm, phone24x7: a.phone24x7, integrationMode: a.integrationMode },
        authorityLimit: authorityLimitOf(a),
        queue: queue.sort((x, y) => ((x.dueAt ?? '9') < (y.dueAt ?? '9') ? -1 : 1)),
        counters: {
          openCases: cases.length,
          slaBreaches: cases.filter((c) => parseIso(c.slaDueAt) < now).length + appts.length,
          guaranteesPending: gps.length,
          linesPending: pendingLines,
          rebillsInReview: rebills.filter((b) => b.status === 'submitted' || b.status === 'in_review').length,
        },
        kpi: kpiOf(d, a, now),
      };
      return out;
    }),
  ),

  // ---- insured persons ----
  http.get(
    `${A}/insured`,
    route(({ request, url }) => {
      const { assistanceId, d } = requireAssist(request, 'assist.insured.search');
      const term = q(url);
      const digits = term.replace(/\D/g, '');
      const policies = new Map(d.policies.map((p) => [p.id, p.number.toLowerCase()]));
      const list = rosterOf(d, assistanceId)
        .filter((i) => !term || matchesSearch(term, i.fullName, policies.get(i.policyId)) || (digits.length >= 4 && i.phone.replace(/\D/g, '').includes(digits)))
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'))
        .slice(0, 50);
      return list.map((i) => toItem(d, i, 'full'));
    }),
  ),
  http.get(
    `${A}/insured/:id`,
    route((ctx) => {
      const { assistanceId, d } = requireAssist(ctx.request, 'assist.insured.search');
      const { i, access } = requireInsuredOf(d, assistanceId, param(ctx, 'id'));
      const p = d.policies.find((x) => x.id === i.policyId)!;
      const out: AssistInsuredDetail = {
        ...toItem(d, i, access),
        policyId: p.id,
        policyStart: p.startDate,
        policyEnd: p.endDate,
        limits: limitsFor(d, i),
        cases: d.cases
          .filter((c) => c.insuredId === i.id)
          .map((c) => caseView(d, c, assistanceId))
          .filter((c): c is AssistCaseView => !!c)
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
        appointments: appointmentsOf(d, assistanceId)
          .filter((a) => a.insuredId === i.id)
          .sort((a, b) => (a.startsAt < b.startsAt ? 1 : -1)),
        guarantees: d.guarantees.filter((g) => g.insuredId === i.id && g.assistanceId === assistanceId).map((g) => toGuaranteeView(d, g)),
      };
      return out;
    }),
  ),
  http.post(
    `${A}/insured/:id/reveal`,
    route(async (ctx) => {
      const { user, assistanceId, d } = requireAssist(ctx.request, 'assist.insured.reveal_pii');
      const { i, access } = requireInsuredOf(d, assistanceId, param(ctx, 'id'));
      if (access !== 'full') throw new HttpError(403, 'forbidden', 'srv.assist.clientTransferred');
      const { field, reason } = await body(ctx.request, revealSchema);
      const value = field === 'pinfl' ? i.pinfl : field === 'phone' ? formatPhoneFull(i.phone) : field === 'birthDate' ? i.birthDate.split('-').reverse().join('.') : i.email;
      audit(user, 'reveal_pii', { targetType: 'insured', targetId: i.id, targetLabel: insuredLabel(i.id), reason: `${fieldLabel(field)}: ${reason}` });
      const out: RevealResponse = { value, expiresInSec: 30 };
      return out;
    }),
  ),
  http.post(
    `${A}/insured/:id/reveal-copied`,
    route(async (ctx) => {
      const { user, assistanceId, d } = requireAssist(ctx.request, 'assist.insured.reveal_pii');
      const { i } = requireInsuredOf(d, assistanceId, param(ctx, 'id'));
      const { field } = await body(ctx.request, z.object({ field: piiField }));
      audit(user, 'reveal_pii', { targetType: 'insured', targetId: i.id, targetLabel: insuredLabel(i.id), reason: `Копирование: ${fieldLabel(field)}` });
      return { ok: true as const };
    }),
  ),
  http.post(
    `${A}/insured/:id/medical-access`,
    route(async (ctx) => {
      const { user, assistanceId, d } = requireAssist(ctx.request, 'assist.medical.read');
      const { i, access } = requireInsuredOf(d, assistanceId, param(ctx, 'id'));
      if (access !== 'full') throw new HttpError(403, 'forbidden', 'srv.assist.clientTransferred');
      const { reason } = await body(ctx.request, medicalAccessSchema);
      const grant = { id: randomToken(24), userId: user.id, insuredId: i.id, expiresAt: Date.now() + MEDICAL_TTL };
      d.grants = d.grants.filter((g) => g.expiresAt > Date.now());
      d.grants.push(grant);
      audit(user, 'open_medical', { targetType: 'insured', targetId: i.id, targetLabel: insuredLabel(i.id), reason });
      const out: MedicalGrant = { grantId: grant.id, expiresAt: tzIso(grant.expiresAt) };
      return out;
    }),
  ),
  http.get(
    `${A}/insured/:id/medical`,
    route((ctx) => {
      const { user, assistanceId, d } = requireAssist(ctx.request, 'assist.medical.read');
      const { i } = requireInsuredOf(d, assistanceId, param(ctx, 'id'));
      const grantId = ctx.request.headers.get('x-medical-grant') ?? '';
      const g = d.grants.find((x) => x.id === grantId);
      if (!g || g.userId !== user.id || g.insuredId !== i.id || g.expiresAt < Date.now()) throw new HttpError(403, 'forbidden', 'srv.medcard.accessExpired');
      return medicalRecords(i);
    }),
  ),

  // ---- cases ----
  http.get(
    `${A}/cases`,
    route(({ request, url }) => {
      const { assistanceId, d } = requireAssist(request, 'assist.cases.manage');
      const status = url.searchParams.get('status');
      const type = url.searchParams.get('type');
      return d.cases
        .map((c) => caseView(d, c, assistanceId))
        .filter((c): c is AssistCaseView => !!c)
        .filter((c) => (!status || status.split(',').includes(c.status)) && (!type || c.type === type))
        .sort((a, b) => (a.status === 'resolved') === (b.status === 'resolved') ? (a.createdAt < b.createdAt ? 1 : -1) : a.status === 'resolved' ? 1 : -1);
    }),
  ),
  http.get(
    `${A}/cases/:id`,
    route((ctx) => {
      const { assistanceId, d } = requireAssist(ctx.request, 'assist.cases.manage');
      const c = d.cases.find((x) => x.id === param(ctx, 'id'));
      const view = c && caseView(d, c, assistanceId);
      if (!view) throw notFound();
      return view;
    }),
  ),
  http.post(
    `${A}/cases`,
    route(async ({ request }) => {
      const { user, assistanceId, d } = requireAssist(request, 'assist.cases.manage');
      const input = await body(request, caseCreateSchema);
      const { i } = requireInsuredOf(d, assistanceId, input.insuredId);
      const now = Date.now();
      requireAssistanceScope(d, assistanceId, i.policyId, isoDay(now), 'write');
      d.caseSeq += 1;
      const c: AssistanceCaseRow = {
        id: randomId(),
        number: nextDocNumber('case', { year: new Date(now).getFullYear(), n: d.caseSeq }),
        assistanceId,
        insuredId: i.id,
        insuredName: i.fullName,
        policyId: i.policyId,
        type: input.type,
        channel: input.channel,
        status: 'open',
        slaDueAt: tzIso(now + CASE_SLA_MINUTES[input.type] * 60_000),
        description: input.description,
        links: {},
        createdAt: tzIso(now),
        createdById: user.id,
      };
      d.cases.unshift(c);
      audit(user, 'case_created', { targetType: 'case', targetId: c.id, targetLabel: c.number });
      return caseView(d, c, assistanceId);
    }),
  ),
  http.patch(
    `${A}/cases/:id`,
    route(async (ctx) => {
      const { assistanceId, d } = requireAssist(ctx.request, 'assist.cases.manage');
      const c = d.cases.find((x) => x.id === param(ctx, 'id') && x.assistanceId === assistanceId);
      if (!c) throw notFound();
      requireAssistanceScope(d, assistanceId, c.policyId, c.createdAt.slice(0, 10), 'write');
      const input = await body(ctx.request, caseUpdateSchema);
      c.status = input.status;
      if (input.resolution) c.resolution = input.resolution;
      c.resolvedAt = input.status === 'resolved' ? tzIso(Date.now()) : undefined;
      return caseView(d, c, assistanceId);
    }),
  ),

  // ---- appointments ----
  http.get(
    `${A}/appointments`,
    route(({ request, url }) => {
      const { assistanceId, d } = requireAssist(request, 'assist.appointments.manage');
      const view = url.searchParams.get('view') ?? 'requests';
      const now = Date.now();
      const list: AssistAppointment[] = appointmentsOf(d, assistanceId)
        .filter((a) => (view === 'requests' ? a.status === 'requested' && parseIso(a.startsAt) > now - 3600_000 : parseIso(a.startsAt) > now - 30 * DAY))
        .map((a) => ({ ...a, overdue: isOverdueRequest(d, a, now), slaDueAt: clinicAnswerDue(d, a) }))
        .sort((a, b) => (a.overdue === b.overdue ? (a.startsAt < b.startsAt ? -1 : 1) : a.overdue ? -1 : 1));
      return list;
    }),
  ),
  http.post(
    `${A}/appointments`,
    route(async ({ request }) => {
      const { assistanceId, d } = requireAssist(request, 'assist.appointments.manage');
      const input = await body(request, assistAppointmentSchema);
      const { i } = requireInsuredOf(d, assistanceId, input.insuredId);
      requireAssistanceScope(d, assistanceId, i.policyId, todayIso(), 'write');
      const c = input.caseId ? d.cases.find((x) => x.id === input.caseId && x.assistanceId === assistanceId && x.insuredId === i.id) : undefined;
      if (input.caseId && !c) throw notFound();
      const a = await createAppointment(d, i, input);
      if (c) {
        c.links.appointmentId = a.id;
        if (c.status === 'open') c.status = 'in_progress';
      }
      return a;
    }),
  ),
  ...(['confirm', 'reschedule', 'decline'] as const).map((kind) =>
    http.post(
      `${A}/appointments/:id/${kind}`,
      route(async (ctx) => {
        const { assistanceId, d } = requireAssist(ctx.request, 'assist.appointments.manage');
        const a = appointmentsOf(d, assistanceId).find((x) => x.id === param(ctx, 'id'));
        if (!a) throw notFound();
        // The clinic answers first; the assistance steps in when the clinic did not answer in time (§5.1).
        if (!isOverdueRequest(d, a)) throw conflict('srv.assist.clinicCanAnswer');
        const who = d.insured.find((x) => x.id === a.insuredId)!;
        requireAssistanceScope(d, assistanceId, who.policyId, a.createdAt.slice(0, 10), 'write');
        if (kind === 'confirm') respondToAppointment(a, 'operator', { kind });
        else if (kind === 'reschedule') respondToAppointment(a, 'operator', { kind, startsAt: (await body(ctx.request, z.object({ startsAt: z.string().trim().min(10).max(40) }))).startsAt });
        else respondToAppointment(a, 'operator', { kind, reason: (await body(ctx.request, declineAppointmentSchema)).reason });
        pushEvent(d, a.clinicId, `Ассистанс ответил на заявку вместо клиники`);
        return { ...a, overdue: false, slaDueAt: clinicAnswerDue(d, a) };
      }),
    ),
  ),

  // ---- chat with insured persons ----
  http.get(
    `${A}/chat`,
    route(({ request }) => {
      const { assistanceId, d } = requireAssist(request, 'assist.appointments.manage');
      const roster = new Map(rosterOf(d, assistanceId).map((i) => [i.id, i]));
      const now = Date.now();
      const threads = new Map<string, AssistChatThread>();
      for (const m of d.chat) {
        const who = roster.get(m.insuredId);
        if (!who || parseIso(m.visibleAt) > now) continue;
        const prev = threads.get(who.id);
        if (!prev || prev.lastAt <= m.at) threads.set(who.id, { insuredId: who.id, insuredName: who.fullName, lastText: m.text.slice(0, 120), lastAt: m.at, unanswered: m.from === 'insured' });
      }
      return [...threads.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
    }),
  ),
  http.get(
    `${A}/chat/:insuredId`,
    route((ctx) => {
      const { assistanceId, d } = requireAssist(ctx.request, 'assist.appointments.manage');
      const { i, access } = requireInsuredOf(d, assistanceId, param(ctx, 'insuredId'));
      if (access !== 'full') throw notFound();
      const now = Date.now();
      const out: AssistChatMessage[] = d.chat.filter((m) => m.insuredId === i.id && parseIso(m.visibleAt) <= now).map((m) => ({ id: m.id, from: m.from, text: m.text, at: m.at }));
      return out;
    }),
  ),
  http.post(
    `${A}/chat/:insuredId`,
    route(async (ctx) => {
      const { assistanceId, d } = requireAssist(ctx.request, 'assist.appointments.manage');
      const { i, access } = requireInsuredOf(d, assistanceId, param(ctx, 'insuredId'));
      if (access !== 'full') throw notFound();
      const { text } = await body(ctx.request, chatSchema);
      const at = tzIso(Date.now());
      const msg = { id: randomId(), insuredId: i.id, from: 'operator' as const, text, at, visibleAt: at };
      d.chat.push(msg);
      const out: AssistChatMessage = { id: msg.id, from: msg.from, text, at };
      return out;
    }),
  ),

  // ---- guarantee letters ----
  http.get(
    `${A}/guarantees`,
    route(({ request, url }) => {
      const { user, assistanceId, d } = requireAssist(request);
      if (!can(user, 'assist.guarantees.decide') && user.role !== 'asst_operator') throw forbidden();
      const status = url.searchParams.get('status');
      return d.guarantees
        .filter((g) => g.assistanceId === assistanceId && g.policyId && scopeOn(d, assistanceId, g.policyId, g.createdAt) !== 'none')
        .map((g) => refreshGuarantee(g))
        .filter((g) => !status || status.split(',').includes(g.status))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((g) => toGuaranteeView(d, g));
    }),
  ),
  // A letter requested on a call: the operator directs the patient to a clinic (§5.2).
  http.post(
    `${A}/guarantees`,
    route(async ({ request }) => {
      const { user, assistanceId, d } = requireAssist(request, 'assist.cases.manage');
      const input = await body(request, assistGuaranteeRequestSchema);
      const { i } = requireInsuredOf(d, assistanceId, input.insuredId);
      requireAssistanceScope(d, assistanceId, i.policyId, todayIso(), 'write');
      const clinic = d.clinics.find((c) => c.id === input.clinicId);
      if (!clinic) throw notFound();
      const c = input.caseId ? d.cases.find((x) => x.id === input.caseId && x.assistanceId === assistanceId && x.insuredId === i.id) : undefined;
      if (input.caseId && !c) throw notFound();
      const svc = priceListOf(d, clinic.id).find((p) => p.code === input.serviceCode);
      if (!svc?.requiresGuarantee) throw new HttpError(422, 'validation', 'srv.guarantee.notNeeded', { fields: { serviceCode: msg('srv.guarantee.chooseService') } });
      // The referral opens a visit in the clinic: the clinic sees the patient and the letter, as after its own check.
      const now = Date.now();
      const visit = { id: randomId(), clinicId: clinic.id, insuredId: i.id, openedById: user.id, method: 'policy' as const, openedAt: tzIso(now), expiresAt: tzIso(now + VISIT_TTL_MS) };
      d.visits.push(visit);
      const actor = { id: user.id, clinicId: clinic.id, displayName: user.displayName, role: user.role, assistanceId };
      const g = createGuarantee(d, actor, { visitId: visit.id, serviceCode: svc.code, icd10: input.icd10, estimatedCost: input.estimatedCost, comment: input.comment || undefined }, `ассистанс, ${user.displayName}`);
      if (c) {
        c.links.guaranteeId = g.id;
        if (c.status === 'open') c.status = 'in_progress';
      }
      return toGuaranteeView(d, g);
    }),
  ),
  http.get(
    `${A}/guarantees/:id`,
    route((ctx) => {
      const { user, assistanceId, d } = requireAssist(ctx.request);
      if (!can(user, 'assist.guarantees.decide') && user.role !== 'asst_operator') throw forbidden();
      return toGuaranteeView(d, guaranteeOf(d, assistanceId, param(ctx, 'id')));
    }),
  ),
  http.post(
    `${A}/guarantees/:id/decision`,
    route(async (ctx) => {
      const { user, assistanceId, d } = requireAssist(ctx.request, 'assist.guarantees.decide');
      const g = guaranteeOf(d, assistanceId, param(ctx, 'id'));
      requireAssistanceScope(d, assistanceId, g.policyId!, g.createdAt.slice(0, 10), 'write');
      if (g.escalated) throw conflict('srv.guarantee.escalated');
      if (g.status !== 'requested') throw conflict(g.status === 'info_requested' ? 'srv.guarantee.awaitingDocs' : 'srv.decision.alreadyMade');
      const input = await body(ctx.request, assistGuaranteeDecisionSchema);
      const limit = authorityLimitOf(assistanceOf(d, assistanceId));
      const at = tzIso(Date.now());
      await decideAsAssistance(d, g, user, input, limit, at);
      return toGuaranteeView(d, g);
    }),
  ),

  // ---- clinic registries: own sub-registries ----
  http.get(
    `${A}/registries`,
    route(({ request }) => {
      const { assistanceId, d } = requireAssist(request, 'assist.registries.review');
      return d.registries
        .filter((r) => r.status !== 'draft' && linesOf(r, assistanceId).length)
        .sort((a, b) => ((a.submittedAt ?? '') < (b.submittedAt ?? '') ? 1 : -1))
        .map((r) => toSubSummary(d, r, assistanceId));
    }),
  ),
  http.get(
    `${A}/registries/:id`,
    route((ctx) => {
      const { assistanceId, d } = requireAssist(ctx.request, 'assist.registries.review');
      return toSubView(d, ownRegistry(d, assistanceId, param(ctx, 'id')), assistanceId);
    }),
  ),
  http.post(
    `${A}/registries/:id/lines/:lineId/decision`,
    route(async (ctx) => {
      const { user, assistanceId, d } = requireAssist(ctx.request, 'assist.registries.review');
      const r = ownRegistry(d, assistanceId, param(ctx, 'id'));
      const input = await body(ctx.request, z.discriminatedUnion('decision', [z.object({ decision: z.literal('accept') }), z.object({ decision: z.literal('reject'), reason: z.string().trim().min(3, 'Минимум 3 символа').max(300) })]));
      await decideLine(d, r, param(ctx, 'lineId'), assistanceId, user, input);
      return toSubView(d, r, assistanceId);
    }),
  ),
  http.post(
    `${A}/registries/:id/payments`,
    route(async (ctx) => {
      const { user, assistanceId, d } = requireAssist(ctx.request, 'assist.clinic_payments.record');
      const r = ownRegistry(d, assistanceId, param(ctx, 'id'));
      const input = await body(ctx.request, clinicPaymentSchema);
      await recordPayment(d, r, assistanceId, user, input);
      return toSubView(d, r, assistanceId);
    }),
  ),

  // ---- rebills to MIG ----
  http.get(
    `${A}/rebills`,
    route(({ request }) => {
      const { assistanceId, d } = requireAssist(request, 'assist.rebills.submit');
      return d.rebills
        .filter((b) => b.assistanceId === assistanceId)
        .sort((a, b) => (a.period < b.period ? 1 : -1))
        .map((b) => toRebillSummary(d, b));
    }),
  ),
  http.get(
    `${A}/rebills/:id`,
    route((ctx) => {
      const { assistanceId, d } = requireAssist(ctx.request, 'assist.rebills.submit');
      return toRebillView(d, ownRebill(d, assistanceId, param(ctx, 'id')));
    }),
  ),
  http.post(
    `${A}/rebills`,
    route(async ({ request }) => {
      const { assistanceId, d } = requireAssist(request, 'assist.rebills.submit');
      const input = await body(request, rebillCreateSchema);
      if (input.period > todayIso().slice(0, 7)) throw new HttpError(422, 'validation', 'srv.period.notStarted', { fields: { period: msg('srv.period.notStarted') } });
      return toRebillView(d, upsertDraftRebill(d, assistanceId, input.period, input.lineIds));
    }),
  ),
  http.post(
    `${A}/rebills/:id/submit`,
    route((ctx) => {
      const { user, assistanceId, d } = requireAssist(ctx.request, 'assist.rebills.submit');
      const b = ownRebill(d, assistanceId, param(ctx, 'id'));
      submitRebill(d, b, user);
      return toRebillView(d, b);
    }),
  ),
  http.post(
    `${A}/rebills/:id/lines/:lineId/dispute`,
    route(async (ctx) => {
      const { user, assistanceId, d } = requireAssist(ctx.request, 'assist.rebills.submit');
      const b = ownRebill(d, assistanceId, param(ctx, 'id'));
      const { comment } = await body(ctx.request, rebillDisputeSchema);
      disputeRebillLine(b, param(ctx, 'lineId'), comment);
      audit(user, 'rebill_line_decided', { targetType: 'rebill', targetId: b.id, targetLabel: b.number, reason: 'Оспорено ассистансом' });
      return toRebillView(d, b);
    }),
  ),

  // ---- network clinics and their prices for this assistance ----
  http.get(
    `${A}/clinics`,
    route(({ request }) => {
      const { assistanceId, d } = requireAssist(request);
      const out: AssistClinic[] = d.clinics.map((c) => ({
        clinicId: c.id,
        clinicName: c.name,
        clinicLegalForm: c.legalForm,
        city: c.district,
        specialties: c.specialties,
        ownPrices: d.clinicContracts.some((x) => x.clinicId === c.id && x.payer === assistanceId),
        priceList: priceListOf(d, c.id, assistanceId),
      }));
      return out;
    }),
  ),

  // ---- users (asst_admin) ----
  http.get(
    `${A}/users`,
    route(({ request }) => {
      const { assistanceId, d } = requireAssist(request, 'assist.users.manage');
      return d.assistUsers.filter((u) => u.assistanceId === assistanceId).map(userView);
    }),
  ),
  http.post(
    `${A}/users`,
    route(async ({ request }) => {
      const { user, assistanceId, d } = requireAssist(request, 'assist.users.manage');
      const input = await body(request, assistUserInviteSchema);
      if (d.assistUsers.some((u) => u.email === input.email) || d.staff.some((s) => s.email === input.email) || d.clinicUsers.some((u) => u.email === input.email)) {
        throw new HttpError(409, 'conflict', 'srv.users.emailTaken', { fields: { email: msg('srv.users.emailInUse') } });
      }
      const row: AssistUserRow = { id: randomId(), ...input, password: DEMO_PASSWORD, assistanceId, active: true, createdAt: tzIso(Date.now()) };
      d.assistUsers.push(row);
      audit(user, 'role_change', { targetType: 'user', targetId: row.id, targetLabel: row.fullName });
      return userView(row);
    }),
  ),
  http.patch(
    `${A}/users/:id`,
    route(async (ctx) => {
      const { user, assistanceId, d } = requireAssist(ctx.request, 'assist.users.manage');
      const u = d.assistUsers.find((x) => x.id === param(ctx, 'id') && x.assistanceId === assistanceId);
      if (!u) throw notFound();
      if (u.id === user.id) throw conflict('srv.assistUsers.self');
      const patch = await body(ctx.request, assistUserPatchSchema);
      if (patch.role) u.role = patch.role;
      if (patch.active !== undefined) u.active = patch.active;
      if (patch.active === false) d.sessions = d.sessions.filter((s) => s.userId !== u.id);
      audit(user, patch.active === false ? 'user_deactivate' : 'role_change', { targetType: 'user', targetId: u.id, targetLabel: u.fullName });
      return userView(u);
    }),
  ),

  // ---- integration (asst_admin): the same partner framework as clinics ----
  ...partnerIntegrationHandlers(`${A}/integration`, (request) => {
    const { user, assistanceId, d } = requireAssist(request, 'assist.integration.manage');
    const a = assistanceOf(d, assistanceId);
    return { actor: user, partnerId: assistanceId, partnerType: 'assistance' as const, mode: a.integrationMode, d };
  }),
];

// ---------------------------------------------------------------- shared actions (portal and API)

type GuaranteeDecision = z.infer<typeof assistGuaranteeDecisionSchema>;

export async function decideAsAssistance(d: Db, g: GuaranteeRow, actor: Pick<SessionUser, 'id' | 'displayName' | 'role'> & { assistanceId?: string }, input: GuaranteeDecision, authorityLimit: number, at: string): Promise<void> {
  if (input.action === 'approve') {
    // Above the authority limit the assistance gives an opinion and escalates to MIG (§5.2).
    if (input.amount > authorityLimit) throw new HttpError(409, 'conflict', 'srv.assist.overAuthority', { params: { limit: formatMoney(authorityLimit) } });
    g.approvals = [{ byId: actor.id, byName: actor.displayName, at }];
    g.approvedAmount = input.amount;
    g.validUntil = input.validUntil;
    g.status = 'approved';
    g.reason = undefined;
    g.decidedBy = 'assistance';
    g.decidedAt = at;
    await emitWebhook(d, g.clinicId, 'guarantee.decided', g.id);
    pushEvent(d, g.clinicId, `Гарантийное письмо ${g.number} одобрено ассистансом`);
    audit(actor, 'guarantee_decided', { targetType: 'guarantee', targetId: g.id, targetLabel: g.number, reason: 'Одобрено ассистансом' });
  } else if (input.action === 'reject') {
    g.status = 'rejected';
    g.reason = input.reason;
    g.decidedBy = 'assistance';
    g.decidedAt = at;
    await emitWebhook(d, g.clinicId, 'guarantee.decided', g.id);
    pushEvent(d, g.clinicId, `Гарантийное письмо ${g.number} отклонено ассистансом`);
    audit(actor, 'guarantee_decided', { targetType: 'guarantee', targetId: g.id, targetLabel: g.number, reason: 'Отклонено ассистансом' });
  } else if (input.action === 'request_info') {
    g.status = 'info_requested';
    g.reason = input.reason;
    await emitWebhook(d, g.clinicId, 'guarantee.documents_requested', g.id);
    pushEvent(d, g.clinicId, `По ${g.number} нужны документы`);
    audit(actor, 'guarantee_decided', { targetType: 'guarantee', targetId: g.id, targetLabel: g.number, reason: 'Запрошены документы' });
  } else {
    g.escalated = true;
    g.assistanceOpinion = input.reason;
    pushEvent(d, g.clinicId, `${g.number} передано на решение в МИГ`);
    audit(actor, 'guarantee_escalated', { targetType: 'guarantee', targetId: g.id, targetLabel: g.number, reason: input.reason });
  }
}

export async function decideLine(
  d: Db,
  r: Registry,
  lineId: string,
  assistanceId: UUID,
  actor: Pick<SessionUser, 'id' | 'displayName' | 'role'> & { assistanceId?: string },
  input: { decision: 'accept' } | { decision: 'reject'; reason: string },
): Promise<void> {
  const line = r.lines.find((l) => l.id === lineId && l.payer === assistanceId);
  if (!line) throw notFound();
  if (r.status === 'paid') throw conflict('srv.registry.alreadyPaid');
  if (line.status !== 'pending' && line.status !== 'disputed') throw conflict('srv.lines.alreadyDecided');
  const mine = () => linesOf(r, assistanceId);
  const wasPending = mine().some((l) => l.status === 'pending' || l.status === 'disputed');
  if (input.decision === 'accept') {
    // The line uses the limit and the reserve of its letter is released in the same step (§5.3, §13.6).
    line.status = 'accepted';
    line.rejectionReason = undefined;
    const g = line.guaranteeNumber ? d.guarantees.find((x) => x.number === line.guaranteeNumber && x.clinicId === r.clinicId) : undefined;
    if (g && g.status === 'approved') g.status = 'used';
  } else {
    line.status = 'rejected';
    line.rejectionReason = input.reason;
  }
  r.status = registryStatusAfterReview(r.lines);
  recomputeRegistry(r);
  audit(actor, 'registry_line_decided', { targetType: 'registry', targetId: r.id, targetLabel: `Реестр ${r.period}`, reason: input.decision === 'accept' ? 'Строка принята ассистансом' : 'Строка отклонена ассистансом' });
  if (wasPending && !mine().some((l) => l.status === 'pending' || l.status === 'disputed')) {
    await emitWebhook(d, r.clinicId, 'registry.reviewed', r.id);
    pushEvent(d, r.clinicId, `${assistanceOf(d, assistanceId).name} проверил свои строки реестра за ${r.period}`);
  }
}

export async function recordPayment(
  d: Db,
  r: Registry,
  assistanceId: UUID,
  actor: Pick<SessionUser, 'id' | 'displayName' | 'role'> & { assistanceId?: string },
  input: { lineIds: string[]; paidAt: string; amount?: number; orderNumber: string },
): Promise<void> {
  const lines = input.lineIds.map((id) => r.lines.find((l) => l.id === id && l.payer === assistanceId));
  if (lines.some((l) => !l)) throw notFound();
  if (lines.some((l) => l!.status !== 'accepted')) throw conflict('srv.registry.payAcceptedOnly');
  if (lines.some((l) => l!.payment)) throw conflict('srv.registry.somePaid');
  if (input.paidAt > todayIso()) throw new HttpError(422, 'validation', 'srv.payment.dateFuture', { fields: { paidAt: msg('srv.payment.dateFuture') } });
  const total = lines.reduce((s, l) => s + l!.amount, 0);
  if (input.amount !== undefined && input.amount !== total) throw new HttpError(422, 'validation', 'srv.payment.amountMismatch', { params: { total: formatMoney(total) }, fields: { amount: msg('srv.payment.expected', { total: formatMoney(total) }) } });
  for (const l of lines) l!.payment = { paidAt: input.paidAt, amount: l!.amount, orderNumber: input.orderNumber };
  const wasPaid = r.status === 'paid';
  settleRegistry(r);
  recomputeRegistry(r);
  audit(actor, 'clinic_payment_recorded', { targetType: 'registry', targetId: r.id, targetLabel: `Реестр ${r.period}`, reason: `${lines.length} строк, ${formatMoney(total)}, п/п ${input.orderNumber}` });
  pushEvent(d, r.clinicId, `Оплачено ассистансом ${assistanceOf(d, assistanceId).name}: ${formatMoney(total)} (${input.paidAt.split('-').reverse().join('.')})`);
  if (!wasPaid && r.status === 'paid') await emitWebhook(d, r.clinicId, 'registry.paid', r.id);
}

export function submitRebill(d: Db, b: Parameters<typeof recomputeRebill>[1], actor: Pick<SessionUser, 'id' | 'displayName' | 'role'> & { assistanceId?: string }): void {
  if (b.status !== 'draft') throw conflict('srv.rebill.alreadySent');
  if (!b.lines.length) throw new HttpError(422, 'validation', 'srv.rebill.empty');
  recomputeRebill(d, b);
  b.status = 'submitted';
  b.submittedAt = tzIso(Date.now());
  audit(actor, 'rebill_submitted', { targetType: 'rebill', targetId: b.id, targetLabel: b.number });
}

export function disputeRebillLine(b: Parameters<typeof recomputeRebill>[1], lineId: string, comment: string): void {
  const line = b.lines.find((l) => l.id === lineId);
  if (!line) throw notFound();
  if (b.status === 'paid') throw conflict('srv.rebill.alreadyPaid');
  if (line.status !== 'rejected') throw conflict('srv.rebill.disputeRejectedOnly');
  line.status = 'disputed';
  line.disputeComment = comment;
  b.status = rebillStatusAfterReview(b.lines);
}

