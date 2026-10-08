/*
 * MIG side of assistance companies (ASSISTANCE_SPEC §7): list and card of companies, contracts, assignment
 * of an assistance to a policy from a date, review (curator) and payment (accountant) of rebills with
 * four-eyes, the quality-control queue of doctor experts and the report by assistance.
 */
import { msg, t } from '@mig/i18n';
import type { AssistanceCase, AssistanceCompany, IntegrationClient, QaSample, Rebill, SessionUser, UUID } from '@mig/contracts';
import type { AssignmentView, AssistanceCardView, AssistanceListItem, AssistanceReportRow, QaSampleView, RebillSummary, RebillView } from '@mig/contracts/dto';
import { assignmentSchema, assistanceContractSchema, assistanceCreateSchema, complaintResolutionSchema, qaReviewSchema, rebillLineDecisionSchema } from '@mig/contracts/forms';
import { can } from '../auth/permissions';
import { assistanceOn } from '../assistance';
import { legalNameCollator } from '../config/legalForms';
import { randomId } from '../lib/random';
import { DAY, isoDay, parseIso, tzIso } from '../lib/time';
import type { AssistanceCaseRow } from '../store/db';
import { audit, conflict, DomainError, forbidden, notFound, requirePermission, todayIso, validate, type AuthCtx, type BaseCtx, requireStaff } from './kernel';
import { byLegalForm, byLegalName, filterLegalForm, sortBy, type Qs } from './list';
import { assistanceName, assistanceOf, claimsFromRebill, ensureQaSample, feeOf, kpiOf, notifyAssistance, rebillStatusAfterReview, rosterOf, syncAssistance } from './assistance';
import { toRebillSummary, toRebillView } from './assistPortal';
import { revokeKey, toClientView } from './partnerIntegration';
import { assistanceLegalFormOf, clientLegalFormOf } from './views';

const caseOut = ({ policyId: _p, createdById: _c, resolvedAt: _r, ...c }: AssistanceCaseRow): AssistanceCase => c;

async function listItem(ctx: BaseCtx, a: AssistanceCompany, now: number): Promise<AssistanceListItem> {
  const roster = await rosterOf(ctx, a.id);
  return {
    id: a.id,
    name: a.name,
    legalForm: a.legalForm,
    phone24x7: a.phone24x7,
    integrationMode: a.integrationMode,
    contractNumber: a.contract.number,
    insuredCount: roster.filter((i) => i.status === 'active').length,
    clientsCount: new Set(roster.map((i) => i.clientId)).size,
    kpi: await kpiOf(ctx, a, now),
    rebillsToReview: await ctx.repos.rebills.count({ assistanceId: a.id, status: { in: ['submitted', 'in_review'] } }),
    slaBreaches: (await ctx.repos.cases.list({ where: { assistanceId: a.id, status: { ne: 'resolved' } } })).filter((c) => parseIso(c.slaDueAt) < now).length,
  };
}

async function qaView(ctx: BaseCtx, s: QaSample): Promise<QaSampleView> {
  return {
    ...s,
    assistanceName: (await assistanceName(ctx, s.assistanceId)) ?? '—',
    assistanceLegalForm: await assistanceLegalFormOf(ctx, s.assistanceId),
    ...(s.reviewedById ? { reviewedByName: (await ctx.repos.staff.get(s.reviewedById))?.fullName } : {}),
  };
}

async function assignmentViews(ctx: BaseCtx, policyId: UUID): Promise<AssignmentView[]> {
  const out: AssignmentView[] = [];
  for (const a of (await ctx.repos.assignments.list({ where: { policyId } })).sort((x, y) => (x.from < y.from ? 1 : -1))) {
    out.push({ ...a, assistanceName: await assistanceName(ctx, a.assistanceId), setByName: (await ctx.repos.staff.get(a.setById))?.fullName ?? '—' });
  }
  return out;
}

async function rebillOf(ctx: BaseCtx, id: UUID): Promise<Rebill> {
  const b = await ctx.repos.rebills.first({ where: { id, status: { ne: 'draft' } } });
  if (!b) throw notFound();
  return b;
}

async function reportByAssistance(ctx: BaseCtx): Promise<AssistanceReportRow[]> {
  const r = ctx.repos;
  const today = todayIso(ctx);
  const assignments = await r.assignments.list();
  const allPolicies = await r.policies.list();
  const insured = await r.insured.list();
  const claims = await r.claims.list();
  const rebills = await r.rebills.list({ where: { status: { ne: 'draft' } } });
  const rows: AssistanceReportRow[] = [];
  const groups: (string | null)[] = [...(await r.assistances.list()).map((a) => a.id), null];
  for (const id of groups) {
    const policies = allPolicies.filter((p) => p.status !== 'draft' && assistanceOn(assignments, p.id, p.endDate < today ? p.endDate : today) === id);
    const ids = new Set(policies.map((p) => p.id));
    const people = insured.filter((i) => ids.has(i.policyId));
    const personIds = new Set(people.map((i) => i.id));
    const premium = policies.reduce((s, p) => s + p.premium, 0);
    const paid = claims.filter((c) => personIds.has(c.insuredId) && (c.status === 'approved' || c.status === 'to_pay' || c.status === 'paid')).reduce((s, c) => s + (c.amountApproved ?? c.amountClaimed), 0);
    const fee = id ? rebills.filter((b) => b.assistanceId === id).reduce((s, b) => s + b.fee.amount, 0) : 0;
    const insuredCount = people.filter((i) => i.status === 'active').length;
    rows.push({
      assistanceId: id,
      name: id ? ((await assistanceName(ctx, id)) ?? '—') : t('srv.noAssistance'),
      legalForm: await assistanceLegalFormOf(ctx, id),
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

// ---------------------------------------------------------------- companies

export async function listAssistances(ctx: AuthCtx, qs: Qs): Promise<AssistanceListItem[]> {
  requireStaff(ctx);
  const now = ctx.now();
  const items: AssistanceListItem[] = [];
  for (const a of await ctx.repos.assistances.list()) items.push(await listItem(ctx, a, now));
  const rows = filterLegalForm(items, qs, (a) => a.legalForm);
  return sortBy(rows, qs, {
    name: byLegalName((a) => a.name),
    legalForm: byLegalForm((a) => a.legalForm),
    insuredCount: (a) => a.insuredCount,
    clientsCount: (a) => a.clientsCount,
  });
}

/** `initialPassword`: the demo password of the first admin (the mock signs in with it). */
export async function createAssistance(ctx: AuthCtx, body: unknown, opts: { initialPassword: string }): Promise<AssistanceListItem> {
  const user = requireStaff(ctx);
  requirePermission(user, 'assistance.manage');
  const r = ctx.repos;
  const input = validate(assistanceCreateSchema, body);
  if ((await r.assistUsers.exists({ email: input.admin.email })) || (await r.staff.exists({ email: input.admin.email }))) {
    throw new DomainError(409, 'conflict', 'srv.users.emailTaken', { fields: { 'admin.email': msg('srv.users.emailInUse') } });
  }
  const a: AssistanceCompany = {
    id: randomId(),
    name: input.name,
    legalForm: input.legalForm,
    phone24x7: input.phone24x7,
    integrationMode: input.integrationMode,
    contract: { number: input.contractNumber, validFrom: todayIso(ctx), validTo: isoDay(ctx.now() + 365 * DAY), ...input.contract },
  };
  await r.assistances.insert(a);
  await r.assistUsers.insert({ id: randomId(), ...input.admin, role: 'asst_admin', password: opts.initialPassword, assistanceId: a.id, active: true, createdAt: tzIso(ctx.now()) });
  await audit(ctx, user, 'role_change', { targetType: 'assistance', targetId: a.id, targetLabel: a.name, assistanceId: a.id });
  return listItem(ctx, a, ctx.now());
}

export async function card(ctx: AuthCtx, id: UUID): Promise<AssistanceCardView> {
  const user = requireStaff(ctx);
  const r = ctx.repos;
  const a = await assistanceOf(ctx, id);
  const now = ctx.now();
  const since = now - DAY;
  const roster = await rosterOf(ctx, a.id);
  const assignments = await r.assignments.list();
  const today = todayIso(ctx);
  const clients = new Map<string, AssistanceCardView['clients'][number]>();
  for (const p of await r.policies.list()) {
    if (assistanceOn(assignments, p.id, today) !== a.id) continue;
    const from = assignments.filter((x) => x.policyId === p.id && x.assistanceId === a.id).sort((x, y) => (x.from < y.from ? 1 : -1))[0]?.from ?? p.startDate;
    clients.set(p.clientId, { id: p.clientId, name: p.clientName, legalForm: (await clientLegalFormOf(ctx, p.clientId)) ?? 'other', insuredCount: roster.filter((i) => i.policyId === p.id && i.status === 'active').length, policyNumber: p.number, from });
  }
  const hooks = await r.webhookDeliveries.list({ where: { clinicId: a.id } });
  const insuredCount = roster.filter((i) => i.status === 'active').length;
  const month = isoDay(now).slice(0, 7);
  const monthFee = (await feeOf(ctx, a, month, 0)).amount;
  const rebills: RebillSummary[] = [];
  for (const b of (await r.rebills.list({ where: { assistanceId: a.id, status: { ne: 'draft' } } })).sort((x, y) => (x.period < y.period ? 1 : -1))) rebills.push(await toRebillSummary(ctx, b));
  const qa: QaSampleView[] = [];
  for (const s of await r.qaSamples.list({ where: { assistanceId: a.id } })) qa.push(await qaView(ctx, s));
  return {
    assistance: a,
    kpi: await kpiOf(ctx, a, now),
    insuredCount,
    clients: [...clients.values()].sort((x, y) => legalNameCollator.compare(x.name, y.name)),
    users: (await r.assistUsers.list({ where: { assistanceId: a.id } })).map((u) => ({ id: u.id, email: u.email, fullName: u.fullName, role: u.role, active: u.active, lastLoginAt: u.lastLoginAt })),
    keys: (await r.integrationClients.list({ where: { clinicId: a.id } })).map(({ secretHash: _h, ...k }): IntegrationClient => k),
    webhooks: {
      endpoints: await r.webhooks.count({ clinicId: a.id }),
      retrying: hooks.filter((w) => w.status === 'retrying').length,
      failed24h: hooks.filter((w) => w.status === 'failed' && parseIso(w.lastAttemptAt) >= since).length,
    },
    apiErrors24h: (await r.apiLogs.list({ where: { clinicId: a.id, status: { gte: 400 } } })).filter((l) => parseIso(l.at) >= since).length,
    rebills,
    qa,
    audit: can(user, 'audit.read') ? await r.audit.list({ where: { assistanceId: a.id }, limit: 50 }) : [],
    feePerInsured: a.contract.feeModel === 'pepm' ? a.contract.feeValue : insuredCount ? Math.round(monthFee / insuredCount) : null,
    attention: (await r.cases.list({ where: { assistanceId: a.id, status: { ne: 'resolved' } } })).filter((c) => c.type === 'complaint' || parseIso(c.slaDueAt) < now).map(caseOut),
  };
}

// ---------------------------------------------------------------- cases: the curator reads them and handles complaints (§5.1, §10)

export async function listCases(ctx: AuthCtx, id: UUID, qs: URLSearchParams): Promise<AssistanceCase[]> {
  const user = requireStaff(ctx);
  requirePermission(user, 'assist.cases.manage', { sub: 'read' });
  const a = await assistanceOf(ctx, id);
  const status = qs.get('status');
  const type = qs.get('type');
  return (await ctx.repos.cases.list({ where: { assistanceId: a.id } }))
    .filter((c) => (!status || status.split(',').includes(c.status)) && (!type || c.type === type))
    .sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))
    .slice(0, 200)
    .map(caseOut);
}

export async function resolveComplaint(ctx: AuthCtx, id: UUID, caseId: UUID, body: unknown): Promise<AssistanceCase> {
  const user = requireStaff(ctx);
  requirePermission(user, 'assist.cases.manage', { sub: 'complaint' });
  const a = await assistanceOf(ctx, id);
  const c = await ctx.repos.cases.first({ where: { id: caseId, assistanceId: a.id } });
  if (!c) throw notFound();
  if (c.type !== 'complaint') throw conflict('srv.cases.complaintsOnly');
  if (c.status === 'resolved') throw conflict('srv.cases.complaintClosed');
  const { resolution } = validate(complaintResolutionSchema, body);
  const saved = await ctx.repos.cases.update(c.id, { status: 'resolved', resolution: `Куратор МИГ: ${resolution}`, resolvedAt: tzIso(ctx.now()) });
  await audit(ctx, user, 'complaint_resolved', { targetType: 'case', targetId: c.id, targetLabel: c.number, reason: resolution, assistanceId: a.id });
  return caseOut(saved);
}

export async function updateContract(ctx: AuthCtx, id: UUID, body: unknown): Promise<AssistanceCompany> {
  const user = requireStaff(ctx);
  requirePermission(user, 'assistance.manage');
  const a = await assistanceOf(ctx, id);
  const input = validate(assistanceContractSchema, body);
  // The form sends the whole contract: an omitted authority removes the individual value (the DMS parameter applies).
  const { guaranteeAuthorityLimit: _old, ...keep } = a.contract;
  const saved = await ctx.repos.assistances.update(a.id, { contract: { ...keep, ...input } });
  await audit(ctx, user, 'role_change', { targetType: 'assistance', targetId: a.id, targetLabel: `${a.name}: договор`, assistanceId: a.id });
  return saved;
}

export async function revokeAssistanceKey(ctx: AuthCtx, id: UUID, keyId: UUID): Promise<IntegrationClient> {
  const user = requireStaff(ctx);
  requirePermission(user, 'assist.integration.manage', { sub: 'revoke_keys' });
  const a = await assistanceOf(ctx, id);
  const k = await ctx.repos.integrationClients.first({ where: { id: keyId, clinicId: a.id } });
  if (!k) throw notFound();
  return toClientView(await revokeKey(ctx, k, user));
}

// ---------------------------------------------------------------- assignment of a policy (underwriter)

export async function policyAssignments(ctx: AuthCtx, policyId: UUID): Promise<AssignmentView[]> {
  const user = requireStaff(ctx);
  if (!can(user, 'policies.read') && !can(user, 'clients.read')) throw forbidden();
  const p = await ctx.repos.policies.get(policyId);
  if (!p) throw notFound();
  return assignmentViews(ctx, p.id);
}

export async function assignPolicy(ctx: AuthCtx, policyId: UUID, body: unknown): Promise<AssignmentView[]> {
  const user = requireStaff(ctx);
  requirePermission(user, 'assistance.assign');
  const r = ctx.repos;
  const p = await r.policies.get(policyId);
  if (!p) throw notFound();
  if (p.status === 'expired') throw conflict('srv.assignment.policyExpired');
  const input = validate(assignmentSchema, body);
  if (input.assistanceId) await assistanceOf(ctx, input.assistanceId);
  // Only from a date: new requests from that date go to the new assistance (§3).
  const first = p.status === 'draft' ? p.startDate : todayIso(ctx);
  if (input.from < first || input.from > p.endDate) {
    throw new DomainError(422, 'validation', 'srv.assignment.dateRange', { fields: { from: msg('srv.assignment.dateRange') } });
  }
  const current = assistanceOn(await r.assignments.list({ where: { policyId: p.id } }), p.id, input.from);
  if (current === input.assistanceId) throw conflict('srv.assignment.alreadyAssigned');
  const dayBefore = isoDay(parseIso(input.from) - DAY);
  await r.assignments.removeWhere({ policyId: p.id, from: { gte: input.from } });
  await r.assignments.updateWhere({ policyId: p.id, to: { isNull: true } }, { to: dayBefore });
  await r.assignments.updateWhere({ policyId: p.id, to: { gte: input.from } }, { to: dayBefore });
  await r.assignments.insert({ policyId: p.id, assistanceId: input.assistanceId, from: input.from, setById: user.id, setAt: tzIso(ctx.now()) });
  await syncAssistance(ctx);
  await audit(ctx, user, 'assistance_assigned', {
    targetType: 'policy',
    targetId: p.id,
    targetLabel: `${p.number}: ${(await assistanceName(ctx, input.assistanceId)) ?? 'без ассистанса'} с ${input.from.split('-').reverse().join('.')}`,
    ...(input.assistanceId ? { assistanceId: input.assistanceId } : {}),
  });
  await notifyAssistance(ctx, current, 'policy.unassigned', p.id);
  await notifyAssistance(ctx, input.assistanceId, 'policy.assigned', p.id);
  return assignmentViews(ctx, p.id);
}

// ---------------------------------------------------------------- rebills: review (curator) and payment (accountant)

function requireRebillReader(user: SessionUser): void {
  if (!can(user, 'rebills.review') && !can(user, 'rebills.pay')) throw forbidden();
}

export async function listRebills(ctx: AuthCtx, qs: URLSearchParams): Promise<RebillSummary[]> {
  const user = requireStaff(ctx);
  requireRebillReader(user);
  const status = qs.get('status');
  const assistanceId = qs.get('assistanceId');
  const list = (await ctx.repos.rebills.list({ where: { status: { ne: 'draft' } } }))
    .filter((b) => (!status || status.split(',').includes(b.status)) && (!assistanceId || b.assistanceId === assistanceId))
    .sort((a, b) => ((a.submittedAt ?? '') < (b.submittedAt ?? '') ? 1 : -1));
  const out: RebillSummary[] = [];
  for (const b of list) out.push(await toRebillSummary(ctx, b));
  return out;
}

export async function getRebill(ctx: AuthCtx, id: UUID): Promise<RebillView> {
  const user = requireStaff(ctx);
  requireRebillReader(user);
  return toRebillView(ctx, await rebillOf(ctx, id));
}

export async function decideRebillLine(ctx: AuthCtx, id: UUID, lineId: UUID, body: unknown): Promise<RebillView> {
  const user = requireStaff(ctx);
  requirePermission(user, 'rebills.review');
  const b = await rebillOf(ctx, id);
  if (b.status === 'paid') throw conflict('srv.rebill.alreadyPaid');
  const line = b.lines.find((l) => l.id === lineId);
  if (!line) throw notFound();
  if (line.status !== 'pending' && line.status !== 'disputed') throw conflict('srv.lines.alreadyDecided');
  const input = validate(rebillLineDecisionSchema, body);
  if (input.decision === 'accept') {
    line.status = 'accepted';
    line.rejectionReason = undefined;
  } else {
    line.status = 'rejected';
    line.rejectionReason = input.reason;
  }
  b.status = rebillStatusAfterReview(b.lines);
  // Review finished: the curator is the acceptor (four-eyes with the payer).
  if (b.status !== 'in_review') b.acceptedById = user.id;
  await ctx.repos.rebills.put(b);
  await audit(ctx, user, 'rebill_line_decided', { targetType: 'rebill', targetId: b.id, targetLabel: b.number, reason: input.decision === 'accept' ? 'Строка принята' : `Отклонена: ${input.reason}`, assistanceId: b.assistanceId });
  if (b.status !== 'in_review') {
    // Accepted lines become claims.
    await claimsFromRebill(ctx, b, user.displayName);
    await notifyAssistance(ctx, b.assistanceId, 'rebill.reviewed', b.id);
  }
  return toRebillView(ctx, b);
}

export async function payRebill(ctx: AuthCtx, id: UUID): Promise<RebillView> {
  const user = requireStaff(ctx);
  requirePermission(user, 'rebills.pay');
  const r = ctx.repos;
  const b = await rebillOf(ctx, id);
  if (b.status !== 'accepted' && b.status !== 'partially_accepted') throw conflict('srv.rebill.payReviewedOnly');
  // Four-eyes: the person who accepted the rebill cannot pay it (§5.5, §13.4).
  if (!can(user, 'rebills.pay', { createdById: b.acceptedById })) throw new DomainError(409, 'conflict', 'srv.rebill.fourEyes');
  const paidAt = tzIso(ctx.now());
  b.status = 'paid';
  b.paidById = user.id;
  b.paidAt = paidAt;
  await r.rebills.put(b);
  const ids = new Set(b.lines.filter((l) => l.status === 'accepted').map((l) => l.registryLineId));
  for (const c of await r.claims.list({ where: { registryLineId: { isNull: false }, status: { ne: 'paid' } } })) {
    if (!c.registryLineId || !ids.has(c.registryLineId)) continue;
    await r.claims.update(c.id, { history: [...c.history, { at: paidAt, actorName: user.displayName, from: c.status, to: 'paid' }], status: 'paid', updatedAt: paidAt });
  }
  await audit(ctx, user, 'rebill_paid', { targetType: 'rebill', targetId: b.id, targetLabel: b.number, assistanceId: b.assistanceId });
  await notifyAssistance(ctx, b.assistanceId, 'rebill.paid', b.id);
  return toRebillView(ctx, b);
}

// ---------------------------------------------------------------- quality control (doctor expert)

export async function qaQueue(ctx: AuthCtx, qs: URLSearchParams): Promise<QaSampleView[]> {
  const user = requireStaff(ctx);
  requirePermission(user, 'qa.review');
  await ensureQaSample(ctx);
  const status = qs.get('status') ?? 'pending';
  const assistanceId = qs.get('assistanceId');
  const list = (await ctx.repos.qaSamples.list())
    .filter((s) => (status === 'all' || (status === 'pending' ? !s.verdict : !!s.verdict)) && (!assistanceId || s.assistanceId === assistanceId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const out: QaSampleView[] = [];
  for (const s of list) out.push(await qaView(ctx, s));
  return out;
}

export async function reviewQa(ctx: AuthCtx, id: UUID, body: unknown): Promise<QaSampleView> {
  const user = requireStaff(ctx);
  requirePermission(user, 'qa.review');
  const s = await ctx.repos.qaSamples.get(id);
  if (!s) throw notFound();
  if (s.verdict) throw conflict('srv.quality.alreadyRated');
  const input = validate(qaReviewSchema, body);
  const saved = await ctx.repos.qaSamples.update(s.id, { verdict: input.verdict, comment: input.comment || undefined, reviewedById: user.id });
  await audit(ctx, user, 'qa_reviewed', { targetType: 'assistance', targetId: s.assistanceId, targetLabel: s.subject.label, reason: input.verdict === 'agree' ? 'Согласен' : 'Не согласен', assistanceId: s.assistanceId });
  if (input.verdict === 'disagree') await notifyAssistance(ctx, s.assistanceId, 'qa.disagreement', s.id);
  return qaView(ctx, saved);
}

// ---------------------------------------------------------------- report

export async function reportByAssistanceFor(ctx: AuthCtx): Promise<AssistanceReportRow[]> {
  const user = requireStaff(ctx);
  requirePermission(user, 'reports.read');
  return reportByAssistance(ctx);
}
