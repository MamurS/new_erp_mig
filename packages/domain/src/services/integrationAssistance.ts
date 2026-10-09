/*
 * Integration API for assistance companies (/api/integration/v1/assistance/...), ASSISTANCE_SPEC §8. The
 * same framework as for clinics (./integrationKit.ts: OAuth, scopes, idempotency, problem+json, log) with
 * keys of partner type `assistance`; the rules are the portal's (shared actions of ./assistPortal.ts).
 * Every endpoint is an `ApiHandler`: it gets the key that called and the request, and returns the body.
 */
import type { AssistanceCompany, Rebill, Registry, UUID } from '@mig/contracts';
import {
  assistAppointmentQuery,
  assistanceCase,
  caseCreateRequest,
  caseUpdateRequest,
  clinicPaymentRequest,
  declineRequest,
  disputeRequest,
  guaranteeDecideRequest,
  guaranteeLetter,
  guaranteeQuery,
  lineDecideRequest,
  rebill as rebillSchema,
  rebillCreateRequest,
  registry as registrySchema,
  registryQuery,
  rescheduleRequest,
  rosterQuery,
} from '@mig/contracts/integration';
import { assistanceScope } from '../assistance';
import { isoDay, parseIso, tzIso } from '../lib/time';
import type { AssistanceCaseRow, InsuredRow } from '../store/db';
import { todayIso, validate, type AuditActor, type BaseCtx } from './kernel';
import { loadParams, type ParamsView } from './params';
import { assistanceOf, authorityLimitOf, linesOf, requireAssistanceScope, requireInsuredOf, rosterOf, subStatus, subTotals, upsertDraftRebill } from './assistance';
import { respondToAppointment, toGuaranteeLetter } from './clinic';
import { appointmentsOf, changeCase, decideAsAssistance, decideLine, disputeRebillLine, lettersOf, openCase, overdueAppointmentOf, recordPayment, registriesOf, submitRebill, type AppointmentAnswerKind } from './assistPortal';
import { ApiProblem, apiNotFound, page, pageWindow, toIntegrationAppointment, windowPage, type ApiCallCtx } from './integrationKit';
import { NOTHING, tsBound } from './list';
import type { Where } from '../store/query';
import { limitsFor } from './views';

/** The assistance of the key (it must exist) and the actor of its audit entries. */
async function partner(c: ApiCallCtx): Promise<{ assistanceId: UUID; actor: AuditActor; a: AssistanceCompany }> {
  const assistanceId = c.client.clinicId;
  const a = await assistanceOf(c, assistanceId);
  return {
    a, assistanceId, actor: { id: c.client.id, displayName: `API: ${c.client.name}`, role: 'asst_admin', assistanceId } };
}

async function limitsOut(ctx: BaseCtx, i: InsuredRow, P?: ParamsView) {
  return (await limitsFor(ctx, i, P)).map((l) => ({ category: l.category, limit: l.limit, used: l.used, reserved: l.reserved ?? 0, left: Math.max(0, l.limit - l.used - (l.reserved ?? 0)) }));
}

function caseOut(c: AssistanceCaseRow) {
  const { policyId: _p, createdById: _c, resolvedAt: _r, assistanceId: _a, ...rest } = c;
  return assistanceCase.parse(rest);
}

function subRegistry(r: Registry, assistanceId: UUID) {
  const lines = linesOf(r, assistanceId);
  return registrySchema.parse({ ...r, lines, status: subStatus(r, lines), totals: subTotals(lines) });
}

function rebillOut(b: Rebill) {
  const { acceptedById: _a, paidById: _p, ...rest } = b;
  return rebillSchema.parse(rest);
}

async function ownRegistryOf(c: ApiCallCtx, assistanceId: UUID): Promise<Registry> {
  const r = await c.repos.registries.first({ where: { id: c.pathParam('id'), status: { ne: 'draft' } } });
  if (!r || !linesOf(r, assistanceId).length) throw apiNotFound();
  return r;
}

async function ownRebillOf(c: ApiCallCtx, assistanceId: UUID): Promise<Rebill> {
  const b = await c.repos.rebills.first({ where: { id: c.pathParam('id'), assistanceId } });
  if (!b) throw apiNotFound();
  return b;
}

// ---------------------------------------------------------------- roster

export async function roster(c: ApiCallCtx) {
  const { assistanceId } = await partner(c);
  const q = validate(rosterQuery, Object.fromEntries(c.query));
  const since = q.updatedSince ? parseIso(q.updatedSince) : 0;
  const P = await loadParams(c);
  // Exclusions change a person after they were added: the latest change counts (`updatedAt ?? addedAt >= since`).
  const changed: Where<InsuredRow> | undefined = Number.isNaN(since)
    ? (NOTHING as Where<InsuredRow>)
    : since
      ? { $or: [{ updatedAt: { gte: tsBound(since) } }, { updatedAt: { isNull: true }, addedAt: { gte: tsBound(since) } }] }
      : undefined;
  const rows = await rosterOf(c, assistanceId, { where: changed, orderBy: [['fullName', 'asc']], ...pageWindow(q.cursor, q.limit) });
  // Limits are computed for the requested page only (the rest of the item does not depend on them).
  const { items: pageOf, nextCursor } = windowPage(
    rows.map((i) => ({ i, updatedAt: i.updatedAt ?? i.addedAt })),
    q.cursor,
    q.limit,
  );
  const policies = new Map((await c.repos.policies.getMany([...new Set(pageOf.map((x) => x.i.policyId))])).map((p) => [p.id, p]));
  const items = [];
  for (const { i, updatedAt } of pageOf) {
    const p = policies.get(i.policyId)!;
    items.push({
      insuredId: i.id,
      fullName: i.fullName,
      birthDate: i.birthDate,
      policyNumber: p.number,
      program: p.program,
      status: i.status,
      insuredFrom: i.insuredFrom,
      ...(i.excludedFrom ? { excludedFrom: i.excludedFrom } : {}),
      limits: await limitsOut(c, i, P),
      updatedAt: tzIso(parseIso(updatedAt)),
    });
  }
  return { body: { items, nextCursor } };
}

export async function insuredLimits(c: ApiCallCtx) {
  const { assistanceId } = await partner(c);
  const { i, access } = await requireInsuredOf(c, assistanceId, c.pathParam('id'));
  if (access !== 'full') throw apiNotFound();
  return { body: { insuredId: i.id, limits: await limitsOut(c, i) } };
}

// ---------------------------------------------------------------- cases

export async function createCase(c: ApiCallCtx) {
  const { assistanceId, actor } = await partner(c);
  const input = validate(caseCreateRequest, c.json());
  const { i } = await requireInsuredOf(c, assistanceId, input.insuredId);
  await requireAssistanceScope(c, assistanceId, i.policyId, todayIso(c), 'write');
  const created = await openCase(c, assistanceId, i, { ...input, channel: 'phone' }, actor.id);
  return { status: 201, body: caseOut(created) };
}

export async function updateCase(c: ApiCallCtx) {
  const { assistanceId } = await partner(c);
  const found = await c.repos.cases.first({ where: { id: c.pathParam('id'), assistanceId } });
  const today = todayIso(c);
  if (!found || assistanceScope(await c.repos.assignments.list({ where: { policyId: found.policyId } }), assistanceId, found.policyId, found.createdAt.slice(0, 10), today) === 'none') throw apiNotFound();
  await requireAssistanceScope(c, assistanceId, found.policyId, found.createdAt.slice(0, 10), 'write');
  const input = validate(caseUpdateRequest, c.json());
  return { body: caseOut(await changeCase(c, found, input)) };
}

// ---------------------------------------------------------------- appointments

export async function listAppointments(c: ApiCallCtx) {
  const { assistanceId } = await partner(c);
  const q = validate(assistAppointmentQuery, Object.fromEntries(c.query));
  const items = (await appointmentsOf(c, assistanceId, { where: q.status ? { status: q.status } : {}, orderBy: [['startsAt', 'asc']] })).map(toIntegrationAppointment);
  return { body: page(items, q.cursor, q.limit) };
}

export async function answerAppointment(c: ApiCallCtx, kind: AppointmentAnswerKind) {
  const { assistanceId } = await partner(c);
  const a = await overdueAppointmentOf(c, assistanceId, c.pathParam('id'), () => new ApiProblem(409, 'conflict', 'Клиника ещё может ответить: ассистанс отвечает после истечения срока клиники'));
  if (kind === 'confirm') respondToAppointment(a, 'operator', { kind }, c.now());
  else if (kind === 'reschedule') respondToAppointment(a, 'operator', { kind, startsAt: validate(rescheduleRequest, c.json()).startsAt }, c.now());
  else respondToAppointment(a, 'operator', { kind, reason: validate(declineRequest, c.json()).reason }, c.now());
  await c.repos.appointments.put(a);
  return { body: toIntegrationAppointment(a) };
}

// ---------------------------------------------------------------- guarantee letters

export async function listGuarantees(c: ApiCallCtx) {
  const { assistanceId } = await partner(c);
  const q = validate(guaranteeQuery, Object.fromEntries(c.query));
  // The status after the lazy expiry (lettersOf refreshes every letter it reads).
  const list = (await lettersOf(c, assistanceId, { orderBy: [['createdAt', 'asc']] })).filter((g) => !q.status || g.status === q.status);
  const items = [];
  for (const g of list) items.push(guaranteeLetter.parse(await toGuaranteeLetter(c, g)));
  return { body: page(items, q.cursor, q.limit) };
}

export async function decideGuarantee(c: ApiCallCtx) {
  const { assistanceId, actor, a } = await partner(c);
  const id = c.pathParam('id');
  const g = (await lettersOf(c, assistanceId)).find((x) => x.id === id);
  if (!g) throw apiNotFound();
  await requireAssistanceScope(c, assistanceId, g.policyId!, g.createdAt.slice(0, 10), 'write');
  if (g.escalated) throw new ApiProblem(409, 'conflict', 'Письмо передано в МИГ');
  if (g.status !== 'requested') throw new ApiProblem(409, 'conflict', 'Решение уже принято');
  const input = validate(guaranteeDecideRequest, c.json());
  const decision =
    input.decision === 'approve'
      ? { action: 'approve' as const, amount: input.amount!, validUntil: input.validUntil! }
      : input.decision === 'reject'
        ? { action: 'reject' as const, reason: input.reason! }
        : { action: 'escalate' as const, reason: input.reason! };
  await decideAsAssistance(c, g, actor, decision, authorityLimitOf(a, await loadParams(c)), tzIso(c.now()));
  return { body: guaranteeLetter.parse(await toGuaranteeLetter(c, g)) };
}

// ---------------------------------------------------------------- registries: own lines

export async function listRegistries(c: ApiCallCtx) {
  const { assistanceId } = await partner(c);
  const q = validate(registryQuery, Object.fromEntries(c.query));
  // The status of the company's part of a registry depends on its lines.
  const items = (await registriesOf(c, assistanceId, { orderBy: [{ field: 'submittedAt', nulls: 'first' }] })).map((r) => subRegistry(r, assistanceId)).filter((r) => !q.status || r.status === q.status);
  return { body: page(items, q.cursor, q.limit) };
}

export async function decideRegistryLine(c: ApiCallCtx) {
  const { assistanceId, actor } = await partner(c);
  const r = await ownRegistryOf(c, assistanceId);
  const input = validate(lineDecideRequest, c.json());
  await decideLine(c, r, c.pathParam('lineId'), assistanceId, actor, input.decision === 'accept' ? { decision: 'accept' } : { decision: 'reject', reason: input.reason! });
  return { body: subRegistry(r, assistanceId) };
}

export async function payRegistry(c: ApiCallCtx) {
  const { assistanceId, actor } = await partner(c);
  const r = await ownRegistryOf(c, assistanceId);
  const input = validate(clinicPaymentRequest, c.json());
  await recordPayment(c, r, assistanceId, actor, { lineIds: input.lineIds, paidAt: input.paidAt, amount: input.amount, orderNumber: input.paymentOrderNumber });
  return { body: subRegistry(r, assistanceId) };
}

// ---------------------------------------------------------------- rebills

export async function createRebill(c: ApiCallCtx) {
  const { assistanceId, actor } = await partner(c);
  const input = validate(rebillCreateRequest, c.json());
  if (input.period > isoDay(c.now()).slice(0, 7)) throw new ApiProblem(422, 'validation', 'Период ещё не наступил', { period: 'Период ещё не наступил' });
  // A rebill sent through the API is final: it is created and submitted to MIG at once.
  const b = await upsertDraftRebill(c, assistanceId, input.period, input.lineIds);
  await submitRebill(c, b, actor);
  return { status: 201, body: rebillOut(b) };
}

export async function getRebill(c: ApiCallCtx) {
  const { assistanceId } = await partner(c);
  return { body: rebillOut(await ownRebillOf(c, assistanceId)) };
}

export async function disputeLine(c: ApiCallCtx) {
  const { assistanceId } = await partner(c);
  const b = await ownRebillOf(c, assistanceId);
  const { comment } = validate(disputeRequest, c.json());
  await disputeRebillLine(c, b, c.pathParam('lineId'), comment);
  return { body: rebillOut(b) };
}
