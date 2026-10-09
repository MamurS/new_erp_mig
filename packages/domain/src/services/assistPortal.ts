/*
 * Assistance company portal (/api/assist/...), ASSISTANCE_SPEC §6. Every endpoint resolves the assistance
 * from the session and checks the scope of the record on the date of the event: foreign records are 404,
 * records of a former client are read-only. The actions shared with the integration API (letter decisions,
 * sub-registry lines, clinic payments, rebills) are exported for ./integrationAssistance.ts.
 */
import { z } from 'zod';
import { msg } from '@mig/i18n';
import type { Appointment, AssistanceAssignment, MedicalRecordEntry, Rebill, Registry, SessionUser, UUID, Visit } from '@mig/contracts';
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
  GuaranteeView,
  MedicalGrant,
  RebillSummary,
  RebillView,
  RevealResponse,
  SubRegistrySummary,
  SubRegistryView,
} from '@mig/contracts/dto';
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
} from '@mig/contracts/forms';
import { can, type Action } from '../auth/permissions';
import { assistanceScope, CASE_SLA_MINUTES, CASE_TYPE_LABEL } from '../assistance';
import { registryStatusAfterReview, VISIT_TTL_MS } from '../clinics';
import { isAssistRole, SPECIALTY_LABEL } from '../labels';
import { formatMoney } from '../lib/format';
import { formatPhoneFull, maskBirthDate, maskPhone, maskPinfl } from '../lib/mask';
import { randomId, randomToken } from '../lib/random';
import { matchesSearch } from '../lib/searchNormalize';
import { DAY, isoDay, parseIso, tzIso } from '../lib/time';
import { PROGRAMS } from '../programs';
import type { AssistUserRow, AssistanceCaseRow, GuaranteeRow, InsuredRow } from '../store/db';
import { audit, conflict, DomainError, forbidden, insuredLabel, notFound, requirePermission, systemRepos, todayIso, validate, type AuditActor, type AuthCtx, type BaseCtx } from './kernel';
import { q, type Qs } from './list';
import { loadParams, type ParamsView } from './params';
import { assignmentsOf, assistanceOf, authorityLimitOf, kpiOf, linesOf, recomputeRebill, rebillStatusAfterReview, requireAssistanceScope, requireInsuredOf, rosterOf, settleRegistry, subStatus, subTotals, upsertDraftRebill } from './assistance';
import {
  clinicOf,
  clinicResponseMinutes,
  createAppointment,
  emitWebhook,
  isOverdueRequest,
  priceListOf,
  pushEvent,
  recomputeRegistry,
  refreshStoredGuarantee,
  respondToAppointment,
  toGuaranteeView,
} from './clinic';
import { createGuarantee } from './clinicPortal';
import type { PartnerScope } from './partnerIntegration';
import { principalOf } from './family';
import { fieldLabel, MEDICAL_TTL, medicalRecords } from './insured';
import { limitsFor } from './views';
import { canonicalJson } from '../lib/json';

export interface AssistCtx {
  user: SessionUser;
  assistanceId: UUID;
}

/** The signed-in assistance user (403 for anyone else) and, optionally, a permission of the role. */
export function requireAssist(ctx: AuthCtx, action?: Action, sub?: string): AssistCtx {
  const { user } = ctx;
  if (!isAssistRole(user.role) || !user.assistanceId) throw forbidden();
  if (action) requirePermission(user, action, { assistanceId: user.assistanceId, ...(sub ? { sub } : {}) });
  return { user, assistanceId: user.assistanceId };
}

// ---------------------------------------------------------------- helpers

/** Scope of records of policies on their event dates, with the assignments loaded once. */
async function scopeChecker(ctx: BaseCtx, assistanceId: UUID): Promise<(policyId: UUID, at: string) => 'full' | 'read' | 'none'> {
  const assignments: AssistanceAssignment[] = await assignmentsOf(ctx);
  const today = todayIso(ctx);
  return (policyId, at) => assistanceScope(assignments, assistanceId, policyId, at.slice(0, 10), today);
}

async function clinicAnswerDue(ctx: BaseCtx, a: Appointment, P: ParamsView): Promise<string> {
  return tzIso(parseIso(a.createdAt) + (await clinicResponseMinutes(ctx, a.clinicId, P)) * 60_000);
}

async function toItem(ctx: BaseCtx, i: InsuredRow, access: 'full' | 'read'): Promise<AssistInsuredItem> {
  const p = await ctx.repos.policies.get(i.policyId);
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
    relation: i.relation,
    ...(i.principalId ? { principalName: (await principalOf(ctx, i))?.fullName } : {}),
    access,
  };
}

function caseView(c: AssistanceCaseRow, assistanceId: UUID, scopeOn: (policyId: UUID, at: string) => 'full' | 'read' | 'none'): AssistCaseView | null {
  if (c.assistanceId !== assistanceId) return null;
  const s = scopeOn(c.policyId, c.createdAt);
  if (s === 'none') return null;
  const { policyId: _p, createdById: _c, resolvedAt: _r, ...rest } = c;
  return { ...rest, access: s };
}

async function caseViewOf(ctx: BaseCtx, c: AssistanceCaseRow, assistanceId: UUID): Promise<AssistCaseView | null> {
  return caseView(c, assistanceId, await scopeChecker(ctx, assistanceId));
}

async function toSubSummary(ctx: BaseCtx, r: Registry, payer: UUID, P: ParamsView): Promise<SubRegistrySummary> {
  const lines = linesOf(r, payer);
  const clinic = await clinicOf(ctx, r.clinicId);
  return {
    id: r.id,
    clinicId: r.clinicId,
    clinicName: clinic.name,
    clinicLegalForm: clinic.legalForm,
    period: r.period,
    status: subStatus(r, lines),
    source: r.source,
    submittedAt: r.submittedAt,
    lineCount: lines.length,
    pendingCount: lines.filter((l) => l.status === 'pending').length,
    disputedCount: lines.filter((l) => l.status === 'disputed').length,
    unpaidCount: lines.filter((l) => l.status === 'accepted' && !l.payment).length,
    totals: subTotals(lines),
    ...(r.submittedAt ? { reviewDueAt: tzIso(parseIso(r.submittedAt) + P.dmsParam('subRegistryReviewDays') * DAY) } : {}),
  };
}

async function toSubView(ctx: BaseCtx, r: Registry, payer: UUID): Promise<SubRegistryView> {
  const lines = linesOf(r, payer);
  const guaranteeChecks: SubRegistryView['guaranteeChecks'] = {};
  for (const l of lines) {
    if (!l.guaranteeNumber) continue;
    const g = await ctx.repos.guarantees.first({ where: { number: l.guaranteeNumber, clinicId: r.clinicId } });
    const approved = g?.approvedAmount ?? null;
    guaranteeChecks[l.id] = { approvedAmount: approved, ok: approved !== null && l.amount <= approved };
  }
  return { ...(await toSubSummary(ctx, r, payer, await loadParams(ctx))), lines, guaranteeChecks };
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

/** A rebill with fresh checks, fee and totals (saved when they changed) and the names of the people. */
export async function toRebillView(ctx: BaseCtx, b: Rebill): Promise<RebillView> {
  // Checks and the fee are recomputed by the system on every read; names of MIG staff are shown to the assistance.
  const sys = systemRepos(ctx, 'rebill view: recomputed checks and fee, names of the MIG staff who accepted and paid');
  const before = canonicalJson(b);
  await recomputeRebill(ctx, b);
  if (canonicalJson(b) !== before) await sys.rebills.put(b);
  const P = await loadParams(ctx);
  const name = async (id?: string) => (id ? (await sys.staff.get(id))?.fullName : undefined);
  const a = await assistanceOf(ctx, b.assistanceId);
  return {
    ...b,
    assistanceName: a.name,
    assistanceLegalForm: a.legalForm,
    ...(b.submittedAt ? { reviewDueAt: addWorkdays(b.submittedAt, P.dmsParam('rebillReviewWorkdays')) } : {}),
    ...(b.acceptedById ? { acceptedByName: await name(b.acceptedById) } : {}),
    ...(b.paidById ? { paidByName: await name(b.paidById) } : {}),
  };
}

export async function toRebillSummary(ctx: BaseCtx, b: Rebill): Promise<RebillSummary> {
  const { lines, ...rest } = await toRebillView(ctx, b);
  return { ...rest, lineCount: lines.length, flaggedCount: lines.filter((l) => l.checks.length > 0).length };
}

const userView = (u: AssistUserRow): AssistUserView => ({ id: u.id, email: u.email, fullName: u.fullName, role: u.role, active: u.active, lastLoginAt: u.lastLoginAt });

/** A letter of the assistance within its scope (404 otherwise). */
export async function guaranteeOfAssistance(ctx: BaseCtx, assistanceId: UUID, id: UUID): Promise<GuaranteeRow> {
  const g = await ctx.repos.guarantees.first({ where: { id, assistanceId } });
  if (!g || !g.policyId || (await scopeChecker(ctx, assistanceId))(g.policyId, g.createdAt) === 'none') throw notFound();
  return g;
}

/** A submitted registry with lines of the assistance (404 otherwise). */
export async function ownRegistry(ctx: BaseCtx, assistanceId: UUID, id: UUID): Promise<Registry> {
  const r = await ctx.repos.registries.first({ where: { id, status: { ne: 'draft' } } });
  if (!r || !linesOf(r, assistanceId).length) throw notFound();
  return r;
}

export async function ownRebill(ctx: BaseCtx, assistanceId: UUID, id: UUID): Promise<Rebill> {
  const b = await ctx.repos.rebills.first({ where: { id, assistanceId } });
  if (!b) throw notFound();
  return b;
}

/** Appointments of people whose policy was assigned to the assistance when the request was made. */
export async function appointmentsOf(ctx: BaseCtx, assistanceId: UUID): Promise<Appointment[]> {
  // The scope is the assignment on the date of the request (also a former assistance, read-only): checked here and,
  // for the company's users, by RLS (app.assist_scope_of over appointments, app.assist_access over insured).
  const r = ctx.repos;
  const people = new Map((await r.insured.list()).map((i) => [i.id, i]));
  const scopeOn = await scopeChecker(ctx, assistanceId);
  return (await r.appointments.list()).filter((a) => {
    const who = people.get(a.insuredId);
    return !!who && scopeOn(who.policyId, a.createdAt) !== 'none';
  });
}

/** A case of the assistance linked to the person (404 when the id is given but is not one). */
async function linkedCase(ctx: BaseCtx, assistanceId: UUID, insuredId: UUID, caseId: UUID | undefined): Promise<AssistanceCaseRow | null> {
  const c = caseId ? await ctx.repos.cases.first({ where: { id: caseId, assistanceId, insuredId } }) : null;
  if (caseId && !c) throw notFound();
  return c;
}

// ---------------------------------------------------------------- shared actions (portal and API)

type GuaranteeDecision = z.infer<typeof assistGuaranteeDecisionSchema>;

/** A decision of the assistance on a letter; `g` is changed and saved. */
export async function decideAsAssistance(ctx: BaseCtx, g: GuaranteeRow, actor: AuditActor, input: GuaranteeDecision, authorityLimit: number, at: string): Promise<void> {
  if (input.action === 'approve') {
    // Above the authority limit the assistance gives an opinion and escalates to MIG (§5.2).
    if (input.amount > authorityLimit) throw new DomainError(409, 'conflict', 'srv.assist.overAuthority', { params: { limit: formatMoney(authorityLimit) } });
    g.approvals = [{ byId: actor.id, byName: actor.displayName, at }];
    g.approvedAmount = input.amount;
    g.validUntil = input.validUntil;
    g.status = 'approved';
    g.reason = undefined;
    g.decidedBy = 'assistance';
    g.decidedAt = at;
    await ctx.repos.guarantees.put(g);
    await emitWebhook(ctx, g.clinicId, 'guarantee.decided', g.id);
    await pushEvent(ctx, g.clinicId, `Гарантийное письмо ${g.number} одобрено ассистансом`);
    await audit(ctx, actor, 'guarantee_decided', { targetType: 'guarantee', targetId: g.id, targetLabel: g.number, reason: 'Одобрено ассистансом' });
  } else if (input.action === 'reject') {
    g.status = 'rejected';
    g.reason = input.reason;
    g.decidedBy = 'assistance';
    g.decidedAt = at;
    await ctx.repos.guarantees.put(g);
    await emitWebhook(ctx, g.clinicId, 'guarantee.decided', g.id);
    await pushEvent(ctx, g.clinicId, `Гарантийное письмо ${g.number} отклонено ассистансом`);
    await audit(ctx, actor, 'guarantee_decided', { targetType: 'guarantee', targetId: g.id, targetLabel: g.number, reason: 'Отклонено ассистансом' });
  } else if (input.action === 'request_info') {
    g.status = 'info_requested';
    g.reason = input.reason;
    await ctx.repos.guarantees.put(g);
    await emitWebhook(ctx, g.clinicId, 'guarantee.documents_requested', g.id);
    await pushEvent(ctx, g.clinicId, `По ${g.number} нужны документы`);
    await audit(ctx, actor, 'guarantee_decided', { targetType: 'guarantee', targetId: g.id, targetLabel: g.number, reason: 'Запрошены документы' });
  } else {
    g.escalated = true;
    g.assistanceOpinion = input.reason;
    await ctx.repos.guarantees.put(g);
    await pushEvent(ctx, g.clinicId, `${g.number} передано на решение в МИГ`);
    await audit(ctx, actor, 'guarantee_escalated', { targetType: 'guarantee', targetId: g.id, targetLabel: g.number, reason: input.reason });
  }
}

/** A decision of the assistance on a line of its sub-registry; `r` is changed and saved. */
export async function decideLine(ctx: BaseCtx, r: Registry, lineId: string, assistanceId: UUID, actor: AuditActor, input: { decision: 'accept' } | { decision: 'reject'; reason: string }): Promise<void> {
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
    const g = line.guaranteeNumber ? await ctx.repos.guarantees.first({ where: { number: line.guaranteeNumber, clinicId: r.clinicId } }) : null;
    if (g && g.status === 'approved') await ctx.repos.guarantees.update(g.id, { status: 'used' });
  } else {
    line.status = 'rejected';
    line.rejectionReason = input.reason;
  }
  r.status = registryStatusAfterReview(r.lines);
  recomputeRegistry(r);
  await ctx.repos.registries.put(r);
  await audit(ctx, actor, 'registry_line_decided', { targetType: 'registry', targetId: r.id, targetLabel: `Реестр ${r.period}`, reason: input.decision === 'accept' ? 'Строка принята ассистансом' : 'Строка отклонена ассистансом' });
  if (wasPending && !mine().some((l) => l.status === 'pending' || l.status === 'disputed')) {
    await emitWebhook(ctx, r.clinicId, 'registry.reviewed', r.id);
    await pushEvent(ctx, r.clinicId, `${(await assistanceOf(ctx, assistanceId)).name} проверил свои строки реестра за ${r.period}`);
  }
}

/** The assistance paid the clinic for accepted lines of its sub-registry; `r` is changed and saved. */
export async function recordPayment(
  ctx: BaseCtx,
  r: Registry,
  assistanceId: UUID,
  actor: AuditActor,
  input: { lineIds: string[]; paidAt: string; amount?: number; orderNumber: string },
): Promise<void> {
  const lines = input.lineIds.map((id) => r.lines.find((l) => l.id === id && l.payer === assistanceId));
  if (lines.some((l) => !l)) throw notFound();
  if (lines.some((l) => l!.status !== 'accepted')) throw conflict('srv.registry.payAcceptedOnly');
  if (lines.some((l) => l!.payment)) throw conflict('srv.registry.somePaid');
  if (input.paidAt > todayIso(ctx)) throw new DomainError(422, 'validation', 'srv.payment.dateFuture', { fields: { paidAt: msg('srv.payment.dateFuture') } });
  const total = lines.reduce((s, l) => s + l!.amount, 0);
  if (input.amount !== undefined && input.amount !== total) {
    throw new DomainError(422, 'validation', 'srv.payment.amountMismatch', { params: { total: formatMoney(total) }, fields: { amount: msg('srv.payment.expected', { total: formatMoney(total) }) } });
  }
  for (const l of lines) l!.payment = { paidAt: input.paidAt, amount: l!.amount, orderNumber: input.orderNumber };
  const wasPaid = r.status === 'paid';
  settleRegistry(r, ctx.now());
  recomputeRegistry(r);
  await ctx.repos.registries.put(r);
  await audit(ctx, actor, 'clinic_payment_recorded', { targetType: 'registry', targetId: r.id, targetLabel: `Реестр ${r.period}`, reason: `${lines.length} строк, ${formatMoney(total)}, п/п ${input.orderNumber}` });
  await pushEvent(ctx, r.clinicId, `Оплачено ассистансом ${(await assistanceOf(ctx, assistanceId)).name}: ${formatMoney(total)} (${input.paidAt.split('-').reverse().join('.')})`);
  if (!wasPaid && r.status === 'paid') await emitWebhook(ctx, r.clinicId, 'registry.paid', r.id);
}

/** Sends a draft rebill to MIG; `b` is changed and saved. */
export async function submitRebill(ctx: BaseCtx, b: Rebill, actor: AuditActor): Promise<void> {
  if (b.status !== 'draft') throw conflict('srv.rebill.alreadySent');
  if (!b.lines.length) throw new DomainError(422, 'validation', 'srv.rebill.empty');
  await recomputeRebill(ctx, b);
  b.status = 'submitted';
  b.submittedAt = tzIso(ctx.now());
  await ctx.repos.rebills.put(b);
  await audit(ctx, actor, 'rebill_submitted', { targetType: 'rebill', targetId: b.id, targetLabel: b.number });
}

/** Disputes a rejected line of a rebill; `b` is changed and saved. */
export async function disputeRebillLine(ctx: BaseCtx, b: Rebill, lineId: string, comment: string): Promise<void> {
  const line = b.lines.find((l) => l.id === lineId);
  if (!line) throw notFound();
  if (b.status === 'paid') throw conflict('srv.rebill.alreadyPaid');
  if (line.status !== 'rejected') throw conflict('srv.rebill.disputeRejectedOnly');
  line.status = 'disputed';
  line.disputeComment = comment;
  b.status = rebillStatusAfterReview(b.lines);
  await ctx.repos.rebills.put(b);
}

// ---------------------------------------------------------------- endpoints: desktop

export async function overview(ctx: AuthCtx): Promise<AssistOverview> {
  const { user, assistanceId } = requireAssist(ctx);
  // The desktop counters are the same for every role of the company (app.fact_assist_desktop_counters: RLS shows
  // each table to some roles only); the queue items are role-specific, from the tables the role reads.
  const r = ctx.repos;
  const a = await assistanceOf(ctx, assistanceId);
  const P = await loadParams(ctx);
  const now = ctx.now();
  const counters = await r.facts.assistDesktopCounters(assistanceId, now, todayIso(ctx), P.dmsParam('clinicResponseMinutes'));
  const queue: AssistQueueItem[] = [];
  const cases = (await r.cases.list({ where: { assistanceId } })).filter((c) => c.status !== 'resolved');
  const appts: Appointment[] = [];
  if (user.role === 'asst_operator') {
    for (const x of await appointmentsOf(ctx, assistanceId)) {
      if (x.status === 'requested' && parseIso(x.startsAt) > now - 3600_000 && (await isOverdueRequest(ctx, x, now, P))) appts.push(x);
    }
  }
  const letters = await r.guarantees.list({ where: { assistanceId } });
  const gps = letters.filter((g) => g.status === 'requested' && !g.escalated);
  const regs = (await r.registries.list({ where: { status: { ne: 'draft' } } })).filter((x) => linesOf(x, assistanceId).length);
  const rebills = await r.rebills.list({ where: { assistanceId } });
  if (user.role === 'asst_operator' || user.role === 'asst_doctor') {
    for (const c of cases) queue.push({ id: c.id, kind: 'case', title: `${c.number} · ${CASE_TYPE_LABEL[c.type]}`, subtitle: c.insuredName, dueAt: c.slaDueAt, to: `/assist/cases/${c.id}` });
  }
  if (user.role === 'asst_operator') {
    for (const x of appts) queue.push({ id: x.id, kind: 'appointment', title: msg('srv.assistQ.noResponse', { specialty: SPECIALTY_LABEL[x.specialty] }), subtitle: `${x.insuredName} · ${x.clinicName}`, dueAt: x.startsAt, to: '/assist/appointments' });
  }
  if (user.role === 'asst_doctor') {
    for (const g of gps) queue.push({ id: g.id, kind: 'guarantee', title: `${g.number} · ${g.serviceName}`, subtitle: `${g.insuredName} · ${formatMoney(g.estimatedCost)}`, dueAt: tzIso(parseIso(g.createdAt) + DAY), to: `/assist/guarantees/${g.id}` });
    for (const g of letters.filter((x) => x.escalated && x.status === 'requested')) {
      queue.push({ id: g.id, kind: 'escalation', title: msg('srv.assistQ.toMig', { number: g.number }), subtitle: msg('srv.assistQ.awaitingMig', { name: g.insuredName }), to: `/assist/guarantees/${g.id}` });
    }
  }
  if (user.role === 'asst_doctor' || user.role === 'asst_billing') {
    for (const x of regs) {
      const s = await toSubSummary(ctx, x, assistanceId, P);
      const toReview = s.pendingCount + s.disputedCount;
      if (user.role === 'asst_doctor' && toReview) {
        queue.push({ id: x.id, kind: 'registry', title: msg('srv.assistQ.registry', { clinic: s.clinicName, period: x.period }), subtitle: msg('srv.assistQ.linesInReview', { count: toReview }), dueAt: tzIso(parseIso(x.submittedAt ?? tzIso(now)) + 5 * DAY), to: `/assist/registries/${x.id}` });
      }
      if (user.role === 'asst_billing' && s.unpaidCount) {
        queue.push({ id: x.id, kind: 'registry', title: msg('srv.assistQ.payment', { clinic: s.clinicName, period: x.period }), subtitle: msg('srv.assistQ.unpaidLines', { count: s.unpaidCount }), to: `/assist/registries/${x.id}` });
      }
    }
  }
  if (user.role === 'asst_billing') {
    for (const b of rebills.filter((x) => x.status === 'draft' || (x.lines.some((l) => l.status === 'rejected') && x.status !== 'paid'))) {
      queue.push({ id: b.id, kind: 'rebill', title: msg('srv.assistQ.rebill', { number: b.number }), subtitle: msg(b.status === 'draft' ? 'srv.assistQ.rebillDraft' : 'srv.assistQ.rebillRejected'), to: `/assist/rebills/${b.id}` });
    }
  }
  return {
    assistance: { id: a.id, name: a.name, legalForm: a.legalForm, phone24x7: a.phone24x7, integrationMode: a.integrationMode },
    authorityLimit: authorityLimitOf(a, P),
    queue: queue.sort((x, y) => ((x.dueAt ?? '9') < (y.dueAt ?? '9') ? -1 : 1)),
    counters: {
      openCases: counters.openCases,
      slaBreaches: counters.casesPastSla + counters.overdueRequests,
      guaranteesPending: counters.guaranteesPending,
      linesPending: counters.linesPending,
      rebillsInReview: counters.rebillsInReview,
    },
    kpi: await kpiOf(ctx, a, now),
  };
}

// ---------------------------------------------------------------- endpoints: insured persons

export async function searchInsured(ctx: AuthCtx, qs: Qs): Promise<AssistInsuredItem[]> {
  const { assistanceId } = requireAssist(ctx, 'assist.insured.search');
  const term = q(qs);
  const digits = term.replace(/\D/g, '');
  const policies = new Map((await ctx.repos.policies.list()).map((p) => [p.id, p.number.toLowerCase()]));
  const list = (await rosterOf(ctx, assistanceId))
    .filter((i) => !term || matchesSearch(term, i.fullName, policies.get(i.policyId)) || (digits.length >= 4 && i.phone.replace(/\D/g, '').includes(digits)))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'))
    .slice(0, 50);
  const out: AssistInsuredItem[] = [];
  for (const i of list) out.push(await toItem(ctx, i, 'full'));
  return out;
}

export async function insuredDetail(ctx: AuthCtx, id: UUID): Promise<AssistInsuredDetail> {
  const { assistanceId } = requireAssist(ctx, 'assist.insured.search');
  const r = ctx.repos;
  const { i, access } = await requireInsuredOf(ctx, assistanceId, id);
  const p = (await r.policies.get(i.policyId))!;
  const scopeOn = await scopeChecker(ctx, assistanceId);
  const guarantees: GuaranteeView[] = [];
  for (const g of await r.guarantees.list({ where: { insuredId: i.id, assistanceId } })) guarantees.push(await toGuaranteeView(ctx, g));
  return {
    ...(await toItem(ctx, i, access)),
    policyId: p.id,
    policyStart: p.startDate,
    policyEnd: p.endDate,
    limits: await limitsFor(ctx, i),
    cases: (await r.cases.list({ where: { insuredId: i.id } }))
      .map((c) => caseView(c, assistanceId, scopeOn))
      .filter((c): c is AssistCaseView => !!c)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    appointments: (await appointmentsOf(ctx, assistanceId)).filter((a) => a.insuredId === i.id).sort((a, b) => (a.startsAt < b.startsAt ? 1 : -1)),
    guarantees,
  };
}

export async function revealPii(ctx: AuthCtx, id: UUID, body: unknown): Promise<RevealResponse> {
  const { user, assistanceId } = requireAssist(ctx, 'assist.insured.reveal_pii');
  const { i, access } = await requireInsuredOf(ctx, assistanceId, id);
  if (access !== 'full') throw new DomainError(403, 'forbidden', 'srv.assist.clientTransferred');
  const { field, reason } = validate(revealSchema, body);
  const value = field === 'pinfl' ? i.pinfl : field === 'phone' ? formatPhoneFull(i.phone) : field === 'birthDate' ? i.birthDate.split('-').reverse().join('.') : i.email;
  await audit(ctx, user, 'reveal_pii', { targetType: 'insured', targetId: i.id, targetLabel: insuredLabel(i.id), reason: `${fieldLabel(field)}: ${reason}` });
  return { value, expiresInSec: 30 };
}

export async function revealCopied(ctx: AuthCtx, id: UUID, body: unknown): Promise<{ ok: true }> {
  const { user, assistanceId } = requireAssist(ctx, 'assist.insured.reveal_pii');
  const { i } = await requireInsuredOf(ctx, assistanceId, id);
  const { field } = validate(z.object({ field: piiField }), body);
  await audit(ctx, user, 'reveal_pii', { targetType: 'insured', targetId: i.id, targetLabel: insuredLabel(i.id), reason: `Копирование: ${fieldLabel(field)}` });
  return { ok: true as const };
}

export async function medicalAccess(ctx: AuthCtx, id: UUID, body: unknown): Promise<MedicalGrant> {
  const { user, assistanceId } = requireAssist(ctx, 'assist.medical.read');
  const { i, access } = await requireInsuredOf(ctx, assistanceId, id);
  if (access !== 'full') throw new DomainError(403, 'forbidden', 'srv.assist.clientTransferred');
  const { reason } = validate(medicalAccessSchema, body);
  const now = ctx.now();
  const grant = { id: randomToken(24), userId: user.id, insuredId: i.id, expiresAt: now + MEDICAL_TTL };
  await ctx.repos.grants.removeWhere({ expiresAt: { lte: now } });
  await ctx.repos.grants.insert(grant);
  await audit(ctx, user, 'open_medical', { targetType: 'insured', targetId: i.id, targetLabel: insuredLabel(i.id), reason });
  return { grantId: grant.id, expiresAt: tzIso(grant.expiresAt) };
}

/** `grantId`: the X-Medical-Grant header. */
export async function medical(ctx: AuthCtx, id: UUID, grantId: string): Promise<MedicalRecordEntry[]> {
  const { user, assistanceId } = requireAssist(ctx, 'assist.medical.read');
  const { i } = await requireInsuredOf(ctx, assistanceId, id);
  const g = grantId ? await ctx.repos.grants.get(grantId) : null;
  if (!g || g.userId !== user.id || g.insuredId !== i.id || g.expiresAt < ctx.now()) throw new DomainError(403, 'forbidden', 'srv.medcard.accessExpired');
  return medicalRecords(ctx, i);
}

// ---------------------------------------------------------------- endpoints: cases

export async function listCases(ctx: AuthCtx, qs: URLSearchParams): Promise<AssistCaseView[]> {
  const { assistanceId } = requireAssist(ctx, 'assist.cases.manage');
  const status = qs.get('status');
  const type = qs.get('type');
  const [sortKey, sortDir] = (qs.get('sort') ?? '').split(':');
  const scopeOn = await scopeChecker(ctx, assistanceId);
  return (await ctx.repos.cases.list())
    .map((c) => caseView(c, assistanceId, scopeOn))
    .filter((c): c is AssistCaseView => !!c)
    .filter((c) => (!status || status.split(',').includes(c.status)) && (!type || c.type === type))
    .sort((a, b) => {
      // Explicit sort by a column; otherwise open cases first, newest first.
      if (sortKey === 'number' || sortKey === 'createdAt') {
        const x = a[sortKey];
        const y = b[sortKey];
        return (x < y ? -1 : x > y ? 1 : 0) * (sortDir === 'desc' ? -1 : 1);
      }
      return (a.status === 'resolved') === (b.status === 'resolved') ? (a.createdAt < b.createdAt ? 1 : -1) : a.status === 'resolved' ? 1 : -1;
    });
}

export async function getCase(ctx: AuthCtx, id: UUID): Promise<AssistCaseView> {
  const { assistanceId } = requireAssist(ctx, 'assist.cases.manage');
  const c = await ctx.repos.cases.get(id);
  const view = c && (await caseViewOf(ctx, c, assistanceId));
  if (!view) throw notFound();
  return view;
}

/** A new case of the assistance (portal and API: `channel`, the creator). */
export async function openCase(ctx: BaseCtx, assistanceId: UUID, i: InsuredRow, input: { type: AssistanceCaseRow['type']; channel: AssistanceCaseRow['channel']; description: string }, createdById: UUID): Promise<AssistanceCaseRow> {
  const now = ctx.now();
  const n = await ctx.repos.seq.next('case');
  const P = await loadParams(ctx);
  const c: AssistanceCaseRow = {
    id: randomId(),
    number: P.nextDocNumber('case', { year: new Date(now).getFullYear(), n }),
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
    createdById,
  };
  await ctx.repos.cases.insert(c, { at: 'start' });
  return c;
}

export async function createCase(ctx: AuthCtx, body: unknown): Promise<AssistCaseView | null> {
  const { user, assistanceId } = requireAssist(ctx, 'assist.cases.manage');
  const input = validate(caseCreateSchema, body);
  const { i } = await requireInsuredOf(ctx, assistanceId, input.insuredId);
  await requireAssistanceScope(ctx, assistanceId, i.policyId, isoDay(ctx.now()), 'write');
  const c = await openCase(ctx, assistanceId, i, input, user.id);
  await audit(ctx, user, 'case_created', { targetType: 'case', targetId: c.id, targetLabel: c.number });
  return caseViewOf(ctx, c, assistanceId);
}

/** Status and resolution of a case; saved and returned. */
export async function changeCase(ctx: BaseCtx, c: AssistanceCaseRow, input: { status: AssistanceCaseRow['status']; resolution?: string }): Promise<AssistanceCaseRow> {
  return ctx.repos.cases.update(c.id, {
    status: input.status,
    ...(input.resolution ? { resolution: input.resolution } : {}),
    resolvedAt: input.status === 'resolved' ? tzIso(ctx.now()) : undefined,
  });
}

export async function updateCase(ctx: AuthCtx, id: UUID, body: unknown): Promise<AssistCaseView | null> {
  const { assistanceId } = requireAssist(ctx, 'assist.cases.manage');
  const c = await ctx.repos.cases.first({ where: { id, assistanceId } });
  if (!c) throw notFound();
  await requireAssistanceScope(ctx, assistanceId, c.policyId, c.createdAt.slice(0, 10), 'write');
  const input = validate(caseUpdateSchema, body);
  return caseViewOf(ctx, await changeCase(ctx, c, input), assistanceId);
}

// ---------------------------------------------------------------- endpoints: appointments

export async function listAppointments(ctx: AuthCtx, view: string | null): Promise<AssistAppointment[]> {
  const { assistanceId } = requireAssist(ctx, 'assist.appointments.manage');
  const v = view ?? 'requests';
  const now = ctx.now();
  const P = await loadParams(ctx);
  const list: AssistAppointment[] = [];
  for (const a of await appointmentsOf(ctx, assistanceId)) {
    if (!(v === 'requests' ? a.status === 'requested' && parseIso(a.startsAt) > now - 3600_000 : parseIso(a.startsAt) > now - 30 * DAY)) continue;
    list.push({ ...a, overdue: await isOverdueRequest(ctx, a, now, P), slaDueAt: await clinicAnswerDue(ctx, a, P) });
  }
  return list.sort((a, b) => (a.overdue === b.overdue ? (a.startsAt < b.startsAt ? -1 : 1) : a.overdue ? -1 : 1));
}

export async function createAssistAppointment(ctx: AuthCtx, body: unknown): Promise<Appointment> {
  const { assistanceId } = requireAssist(ctx, 'assist.appointments.manage');
  const input = validate(assistAppointmentSchema, body);
  const { i } = await requireInsuredOf(ctx, assistanceId, input.insuredId);
  await requireAssistanceScope(ctx, assistanceId, i.policyId, todayIso(ctx), 'write');
  const c = await linkedCase(ctx, assistanceId, i.id, input.caseId);
  const a = await createAppointment(ctx, i, input);
  if (c) await ctx.repos.cases.update(c.id, { links: { ...c.links, appointmentId: a.id }, ...(c.status === 'open' ? { status: 'in_progress' as const } : {}) });
  return a;
}

export type AppointmentAnswerKind = 'confirm' | 'reschedule' | 'decline';

/** An appointment request of the assistance's person that the clinic left unanswered too long (404 otherwise; 409 while the clinic may still answer). */
export async function overdueAppointmentOf(ctx: BaseCtx, assistanceId: UUID, id: UUID, conflictError: () => Error): Promise<Appointment> {
  const a = (await appointmentsOf(ctx, assistanceId)).find((x) => x.id === id);
  if (!a) throw notFound();
  // The clinic answers first; the assistance steps in when the clinic did not answer in time (§5.1).
  if (!(await isOverdueRequest(ctx, a))) throw conflictError();
  const who = (await ctx.repos.insured.get(a.insuredId))!;
  await requireAssistanceScope(ctx, assistanceId, who.policyId, a.createdAt.slice(0, 10), 'write');
  return a;
}

/** `body` is not read for `confirm`. */
export async function answerAppointment(ctx: AuthCtx, kind: AppointmentAnswerKind, id: UUID, body: unknown): Promise<AssistAppointment> {
  const { assistanceId } = requireAssist(ctx, 'assist.appointments.manage');
  const a = await overdueAppointmentOf(ctx, assistanceId, id, () => conflict('srv.assist.clinicCanAnswer'));
  if (kind === 'confirm') respondToAppointment(a, 'operator', { kind }, ctx.now());
  else if (kind === 'reschedule') respondToAppointment(a, 'operator', { kind, startsAt: validate(z.object({ startsAt: z.string().trim().min(10).max(40) }), body).startsAt }, ctx.now());
  else respondToAppointment(a, 'operator', { kind, reason: validate(declineAppointmentSchema, body).reason }, ctx.now());
  await ctx.repos.appointments.put(a);
  await pushEvent(ctx, a.clinicId, `Ассистанс ответил на заявку вместо клиники`);
  return { ...a, overdue: false, slaDueAt: await clinicAnswerDue(ctx, a, await loadParams(ctx)) };
}

// ---------------------------------------------------------------- endpoints: chat with insured persons

export async function chatThreads(ctx: AuthCtx): Promise<AssistChatThread[]> {
  const { assistanceId } = requireAssist(ctx, 'assist.appointments.manage');
  const roster = new Map((await rosterOf(ctx, assistanceId)).map((i) => [i.id, i]));
  const now = ctx.now();
  const threads = new Map<string, AssistChatThread>();
  for (const m of await ctx.repos.chat.list()) {
    const who = roster.get(m.insuredId);
    if (!who || parseIso(m.visibleAt) > now) continue;
    const prev = threads.get(who.id);
    if (!prev || prev.lastAt <= m.at) threads.set(who.id, { insuredId: who.id, insuredName: who.fullName, lastText: m.text.slice(0, 120), lastAt: m.at, unanswered: m.from === 'insured' });
  }
  return [...threads.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
}

export async function chatMessages(ctx: AuthCtx, insuredId: UUID): Promise<AssistChatMessage[]> {
  const { assistanceId } = requireAssist(ctx, 'assist.appointments.manage');
  const { i, access } = await requireInsuredOf(ctx, assistanceId, insuredId);
  if (access !== 'full') throw notFound();
  const now = ctx.now();
  return (await ctx.repos.chat.list({ where: { insuredId: i.id } })).filter((m) => parseIso(m.visibleAt) <= now).map((m) => ({ id: m.id, from: m.from, text: m.text, at: m.at }));
}

export async function sendChat(ctx: AuthCtx, insuredId: UUID, body: unknown): Promise<AssistChatMessage> {
  const { assistanceId } = requireAssist(ctx, 'assist.appointments.manage');
  const { i, access } = await requireInsuredOf(ctx, assistanceId, insuredId);
  if (access !== 'full') throw notFound();
  const { text } = validate(chatSchema, body);
  const at = tzIso(ctx.now());
  const m = { id: randomId(), insuredId: i.id, from: 'operator' as const, text, at, visibleAt: at };
  await ctx.repos.chat.insert(m);
  return { id: m.id, from: m.from, text, at };
}

// ---------------------------------------------------------------- endpoints: guarantee letters

function requireGuaranteeReader(user: SessionUser): void {
  if (!can(user, 'assist.guarantees.decide') && user.role !== 'asst_operator') throw forbidden();
}

/** Letters of the assistance within its scope, expiry refreshed, in storage order. */
export async function lettersOf(ctx: BaseCtx, assistanceId: UUID): Promise<GuaranteeRow[]> {
  const scopeOn = await scopeChecker(ctx, assistanceId);
  const out: GuaranteeRow[] = [];
  for (const g of await ctx.repos.guarantees.list({ where: { assistanceId } })) {
    if (g.policyId && scopeOn(g.policyId, g.createdAt) !== 'none') out.push(await refreshStoredGuarantee(ctx, g));
  }
  return out;
}

export async function listGuarantees(ctx: AuthCtx, status: string | null): Promise<GuaranteeView[]> {
  const { user, assistanceId } = requireAssist(ctx);
  requireGuaranteeReader(user);
  const list = (await lettersOf(ctx, assistanceId)).filter((g) => !status || status.split(',').includes(g.status)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const out: GuaranteeView[] = [];
  for (const g of list) out.push(await toGuaranteeView(ctx, g));
  return out;
}

/** A letter requested on a call: the operator directs the patient to a clinic (§5.2). */
export async function requestGuaranteeOnCall(ctx: AuthCtx, body: unknown): Promise<GuaranteeView> {
  const { user, assistanceId } = requireAssist(ctx, 'assist.cases.manage');
  const r = ctx.repos;
  const input = validate(assistGuaranteeRequestSchema, body);
  const { i } = await requireInsuredOf(ctx, assistanceId, input.insuredId);
  await requireAssistanceScope(ctx, assistanceId, i.policyId, todayIso(ctx), 'write');
  const clinic = await r.clinics.get(input.clinicId);
  if (!clinic) throw notFound();
  const c = await linkedCase(ctx, assistanceId, i.id, input.caseId);
  const svc = (await priceListOf(ctx, clinic.id)).find((p) => p.code === input.serviceCode);
  if (!svc?.requiresGuarantee) throw new DomainError(422, 'validation', 'srv.guarantee.notNeeded', { fields: { serviceCode: msg('srv.guarantee.chooseService') } });
  // The referral opens a visit in the clinic: the clinic sees the patient and the letter, as after its own check.
  const now = ctx.now();
  const visit: Visit = { id: randomId(), clinicId: clinic.id, insuredId: i.id, openedById: user.id, method: 'policy', openedAt: tzIso(now), expiresAt: tzIso(now + VISIT_TTL_MS) };
  await r.visits.insert(visit);
  const actor = { id: user.id, clinicId: clinic.id, displayName: user.displayName, role: user.role, assistanceId };
  // The letter belongs to the clinic of the referral; the assistance company writes it for its own current client
  // (RLS of guarantees: the company's letters of a policy it serves today).
  const g = await createGuarantee(ctx, actor, { visitId: visit.id, serviceCode: svc.code, icd10: input.icd10, estimatedCost: input.estimatedCost, comment: input.comment || undefined }, `ассистанс, ${user.displayName}`);
  if (c) await r.cases.update(c.id, { links: { ...c.links, guaranteeId: g.id }, ...(c.status === 'open' ? { status: 'in_progress' as const } : {}) });
  return toGuaranteeView(ctx, g);
}

export async function getGuarantee(ctx: AuthCtx, id: UUID): Promise<GuaranteeView> {
  const { user, assistanceId } = requireAssist(ctx);
  requireGuaranteeReader(user);
  return toGuaranteeView(ctx, await guaranteeOfAssistance(ctx, assistanceId, id));
}

export async function decideGuarantee(ctx: AuthCtx, id: UUID, body: unknown): Promise<GuaranteeView> {
  const { user, assistanceId } = requireAssist(ctx, 'assist.guarantees.decide');
  const g = await guaranteeOfAssistance(ctx, assistanceId, id);
  await requireAssistanceScope(ctx, assistanceId, g.policyId!, g.createdAt.slice(0, 10), 'write');
  if (g.escalated) throw conflict('srv.guarantee.escalated');
  if (g.status !== 'requested') throw conflict(g.status === 'info_requested' ? 'srv.guarantee.awaitingDocs' : 'srv.decision.alreadyMade');
  const input = validate(assistGuaranteeDecisionSchema, body);
  const limit = authorityLimitOf(await assistanceOf(ctx, assistanceId), await loadParams(ctx));
  await decideAsAssistance(ctx, g, user, input, limit, tzIso(ctx.now()));
  return toGuaranteeView(ctx, g);
}

// ---------------------------------------------------------------- endpoints: own sub-registries

/** Submitted registries with lines of the assistance, in storage order. */
export async function registriesOf(ctx: BaseCtx, assistanceId: UUID): Promise<Registry[]> {
  return (await ctx.repos.registries.list({ where: { status: { ne: 'draft' } } })).filter((r) => linesOf(r, assistanceId).length);
}

export async function listRegistries(ctx: AuthCtx): Promise<SubRegistrySummary[]> {
  const { assistanceId } = requireAssist(ctx, 'assist.registries.review');
  const P = await loadParams(ctx);
  const out: SubRegistrySummary[] = [];
  for (const r of (await registriesOf(ctx, assistanceId)).sort((a, b) => ((a.submittedAt ?? '') < (b.submittedAt ?? '') ? 1 : -1))) out.push(await toSubSummary(ctx, r, assistanceId, P));
  return out;
}

export async function getRegistry(ctx: AuthCtx, id: UUID): Promise<SubRegistryView> {
  const { assistanceId } = requireAssist(ctx, 'assist.registries.review');
  return toSubView(ctx, await ownRegistry(ctx, assistanceId, id), assistanceId);
}

const lineDecisionSchema = z.discriminatedUnion('decision', [z.object({ decision: z.literal('accept') }), z.object({ decision: z.literal('reject'), reason: z.string().trim().min(3, 'Минимум 3 символа').max(300) })]);

export async function decideRegistryLine(ctx: AuthCtx, id: UUID, lineId: UUID, body: unknown): Promise<SubRegistryView> {
  const { user, assistanceId } = requireAssist(ctx, 'assist.registries.review');
  const r = await ownRegistry(ctx, assistanceId, id);
  const input = validate(lineDecisionSchema, body);
  await decideLine(ctx, r, lineId, assistanceId, user, input);
  return toSubView(ctx, r, assistanceId);
}

export async function payRegistry(ctx: AuthCtx, id: UUID, body: unknown): Promise<SubRegistryView> {
  const { user, assistanceId } = requireAssist(ctx, 'assist.clinic_payments.record');
  const r = await ownRegistry(ctx, assistanceId, id);
  const input = validate(clinicPaymentSchema, body);
  await recordPayment(ctx, r, assistanceId, user, input);
  return toSubView(ctx, r, assistanceId);
}

// ---------------------------------------------------------------- endpoints: rebills to MIG

export async function listRebills(ctx: AuthCtx): Promise<RebillSummary[]> {
  const { assistanceId } = requireAssist(ctx, 'assist.rebills.submit');
  const out: RebillSummary[] = [];
  for (const b of (await ctx.repos.rebills.list({ where: { assistanceId } })).sort((a, b) => (a.period < b.period ? 1 : -1))) out.push(await toRebillSummary(ctx, b));
  return out;
}

export async function getRebill(ctx: AuthCtx, id: UUID): Promise<RebillView> {
  const { assistanceId } = requireAssist(ctx, 'assist.rebills.submit');
  return toRebillView(ctx, await ownRebill(ctx, assistanceId, id));
}

export async function createRebill(ctx: AuthCtx, body: unknown): Promise<RebillView> {
  const { assistanceId } = requireAssist(ctx, 'assist.rebills.submit');
  const input = validate(rebillCreateSchema, body);
  if (input.period > todayIso(ctx).slice(0, 7)) throw new DomainError(422, 'validation', 'srv.period.notStarted', { fields: { period: msg('srv.period.notStarted') } });
  return toRebillView(ctx, await upsertDraftRebill(ctx, assistanceId, input.period, input.lineIds));
}

export async function sendRebill(ctx: AuthCtx, id: UUID): Promise<RebillView> {
  const { user, assistanceId } = requireAssist(ctx, 'assist.rebills.submit');
  const b = await ownRebill(ctx, assistanceId, id);
  await submitRebill(ctx, b, user);
  return toRebillView(ctx, b);
}

export async function disputeLine(ctx: AuthCtx, id: UUID, lineId: UUID, body: unknown): Promise<RebillView> {
  const { user, assistanceId } = requireAssist(ctx, 'assist.rebills.submit');
  const b = await ownRebill(ctx, assistanceId, id);
  const { comment } = validate(rebillDisputeSchema, body);
  await disputeRebillLine(ctx, b, lineId, comment);
  await audit(ctx, user, 'rebill_line_decided', { targetType: 'rebill', targetId: b.id, targetLabel: b.number, reason: 'Оспорено ассистансом' });
  return toRebillView(ctx, b);
}

// ---------------------------------------------------------------- endpoints: network clinics

export async function clinics(ctx: AuthCtx): Promise<AssistClinic[]> {
  const { assistanceId } = requireAssist(ctx);
  const out: AssistClinic[] = [];
  for (const c of await ctx.repos.clinics.list()) {
    out.push({
      clinicId: c.id,
      clinicName: c.name,
      clinicLegalForm: c.legalForm,
      city: c.district,
      specialties: c.specialties,
      ownPrices: await ctx.repos.clinicContracts.exists({ clinicId: c.id, payer: assistanceId }),
      priceList: await priceListOf(ctx, c.id, assistanceId),
    });
  }
  return out;
}

// ---------------------------------------------------------------- endpoints: users (asst_admin)

export async function listUsers(ctx: AuthCtx): Promise<AssistUserView[]> {
  const { assistanceId } = requireAssist(ctx, 'assist.users.manage');
  return (await ctx.repos.assistUsers.list({ where: { assistanceId } })).map(userView);
}

/** `initialPassword`: the demo password of invited users (the mock signs in with it). */
export async function inviteUser(ctx: AuthCtx, body: unknown, opts: { initialPassword: string }): Promise<AssistUserView> {
  const { user, assistanceId } = requireAssist(ctx, 'assist.users.manage');
  const r = ctx.repos;
  const input = validate(assistUserInviteSchema, body);
  if ((await r.assistUsers.exists({ email: input.email })) || (await r.staff.exists({ email: input.email })) || (await r.clinicUsers.exists({ email: input.email }))) {
    throw new DomainError(409, 'conflict', 'srv.users.emailTaken', { fields: { email: msg('srv.users.emailInUse') } });
  }
  const row: AssistUserRow = { id: randomId(), ...input, password: opts.initialPassword, assistanceId, active: true, createdAt: tzIso(ctx.now()) };
  await r.assistUsers.insert(row);
  await audit(ctx, user, 'role_change', { targetType: 'user', targetId: row.id, targetLabel: row.fullName });
  return userView(row);
}

export async function patchUser(ctx: AuthCtx, id: UUID, body: unknown): Promise<AssistUserView> {
  const { user, assistanceId } = requireAssist(ctx, 'assist.users.manage');
  const r = ctx.repos;
  const u = await r.assistUsers.first({ where: { id, assistanceId } });
  if (!u) throw notFound();
  if (u.id === user.id) throw conflict('srv.assistUsers.self');
  const patch = validate(assistUserPatchSchema, body);
  const saved = await r.assistUsers.update(u.id, { ...(patch.role ? { role: patch.role } : {}), ...(patch.active !== undefined ? { active: patch.active } : {}) });
  if (patch.active === false) await r.sessions.removeWhere({ userId: u.id });
  await audit(ctx, user, patch.active === false ? 'user_deactivate' : 'role_change', { targetType: 'user', targetId: u.id, targetLabel: u.fullName });
  return userView(saved);
}

// ---------------------------------------------------------------- integration settings (asst_admin)

/** The partner behind /api/assist/integration: the assistance of the session. */
export async function integrationPartner(ctx: AuthCtx): Promise<{ actor: SessionUser; partnerId: UUID; partnerType: 'assistance'; mode: AssistOverview['assistance']['integrationMode'] }> {
  const { user, assistanceId } = requireAssist(ctx, 'assist.integration.manage');
  const a = await assistanceOf(ctx, assistanceId);
  return { actor: user, partnerId: assistanceId, partnerType: 'assistance', mode: a.integrationMode };
}

// ---------------------------------------------------------------- integration settings (asst_admin)

/** Whose integration settings an assistance admin manages (the shared partner service, partnerIntegration.ts). */
export async function integrationScope(ctx: AuthCtx): Promise<PartnerScope> {
  const { user } = ctx;
  if (!isAssistRole(user.role) || !user.assistanceId) throw forbidden();
  requirePermission(user, 'assist.integration.manage', { assistanceId: user.assistanceId });
  const a = await ctx.repos.assistances.get(user.assistanceId);
  if (!a) throw notFound();
  return { actor: user, partnerId: user.assistanceId, partnerType: 'assistance', mode: a.integrationMode };
}
