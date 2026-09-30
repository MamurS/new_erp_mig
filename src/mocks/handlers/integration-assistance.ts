/*
 * Integration API for assistance companies (/api/integration/v1/assistance/...), ASSISTANCE_SPEC §8.
 * The same framework as for clinics (OAuth, scopes, idempotency, problem+json, log) with keys of
 * partner type `assistance`; the rules are the portal's (shared functions of ./assist).
 */
import { http } from 'msw';
import type { Appointment, UUID } from '@/shared/types';
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
  guaranteeList,
  guaranteeQuery,
  insuredLimits,
  integrationAppointment,
  lineDecideRequest,
  appointmentList,
  rebill as rebillSchema,
  rebillCreateRequest,
  registry as registrySchema,
  registryList,
  registryQuery,
  rescheduleRequest,
  rosterPage,
  rosterQuery,
} from '@/shared/integration/schemas';
import { assistanceScope, CASE_SLA_MINUTES } from '@/shared/domain/assistance';
import type { AssistanceCaseRow, Db } from '../db';
import { validate } from '../http';
import { randomId } from '../rng';
import { isoDay, parseIso, tzIso } from '../time';
import { limitsFor } from '../views';
import { assistanceOf, linesOf, requireAssistanceScope, requireInsuredOf, rosterOf, subStatus, subTotals, todayIso, upsertDraftRebill } from '../assistance-core';
import { isOverdueRequest, refreshGuarantee, respondToAppointment, toGuaranteeLetter } from '../clinic-core';
import { ApiProblem, apiRoute, BASE, page, pathParam, readJson, toIntegrationAppointment, type ApiCtx, type Handler } from './integration';
import { decideAsAssistance, decideLine, disputeRebillLine, recordPayment, submitRebill } from './assist';

const AB = `${BASE}/assistance`;
const notFound = () => new ApiProblem(404, 'not_found', 'Не найдено');

function partner(ctx: ApiCtx) {
  const assistanceId = ctx.client.clinicId;
  const a = assistanceOf(ctx.d, assistanceId);
  const actor = { id: ctx.client.id, displayName: `API: ${ctx.client.name}`, role: 'asst_admin' as const, assistanceId };
  return { assistanceId, a, actor };
}

const route = (method: 'GET' | 'POST' | 'PATCH', template: string, scope: Parameters<typeof apiRoute>[2], response: Parameters<typeof apiRoute>[3], fn: Handler) =>
  apiRoute(method, template, scope, response, fn, 'assistance');

const scopeOn = (d: Db, assistanceId: UUID, policyId: UUID, at: string) => assistanceScope(d.assignments, assistanceId, policyId, at.slice(0, 10), todayIso());

function limitsOut(d: Db, insuredId: UUID) {
  const i = d.insured.find((x) => x.id === insuredId)!;
  return limitsFor(d, i).map((l) => ({ category: l.category, limit: l.limit, used: l.used, reserved: l.reserved ?? 0, left: Math.max(0, l.limit - l.used - (l.reserved ?? 0)) }));
}

function caseOut(c: AssistanceCaseRow) {
  const { policyId: _p, createdById: _c, resolvedAt: _r, assistanceId: _a, ...rest } = c;
  return assistanceCase.parse(rest);
}

function subRegistry(_d: Db, r: Db['registries'][number], assistanceId: UUID) {
  const lines = linesOf(r, assistanceId);
  return registrySchema.parse({ ...r, lines, status: subStatus(r, lines), totals: subTotals(lines) });
}

function rebillOut(_d: Db, b: Db['rebills'][number]) {
  const { acceptedById: _a, paidById: _p, ...rest } = b;
  return rebillSchema.parse(rest);
}

function ownAppointments(d: Db, assistanceId: UUID): Appointment[] {
  const people = new Map(d.insured.map((i) => [i.id, i]));
  return d.appointments.filter((a) => {
    const who = people.get(a.insuredId);
    return !!who && scopeOn(d, assistanceId, who.policyId, a.createdAt) !== 'none';
  });
}

export const integrationAssistanceHandlers = [
  // ---- roster ----
  http.get(
    `${AB}/roster`,
    route('GET', '/assistance/roster', 'roster:read', rosterPage, (ctx) => {
      const { assistanceId } = partner(ctx);
      const q = validate(rosterQuery, Object.fromEntries(ctx.url.searchParams));
      const since = q.updatedSince ? parseIso(q.updatedSince) : 0;
      const items = rosterOf(ctx.d, assistanceId)
        .map((i) => ({ i, updatedAt: i.addedAt }))
        .filter((x) => parseIso(x.updatedAt) >= since)
        .sort((a, b) => (a.i.fullName < b.i.fullName ? -1 : 1))
        .map(({ i, updatedAt }) => {
          const p = ctx.d.policies.find((x) => x.id === i.policyId)!;
          return {
            insuredId: i.id,
            fullName: i.fullName,
            birthDate: i.birthDate,
            policyNumber: p.number,
            program: p.program,
            status: i.status,
            insuredFrom: i.insuredFrom,
            ...(i.excludedFrom ? { excludedFrom: i.excludedFrom } : {}),
            limits: limitsOut(ctx.d, i.id),
            updatedAt: tzIso(parseIso(updatedAt)),
          };
        });
      return { body: page(items, q.cursor, q.limit) };
    }),
  ),
  http.get(
    `${AB}/insured/:id/limits`,
    route('GET', '/assistance/insured/{id}/limits', 'roster:read', insuredLimits, (ctx) => {
      const { assistanceId } = partner(ctx);
      const { i, access } = requireInsuredOf(ctx.d, assistanceId, pathParam(ctx, 'id'));
      if (access !== 'full') throw notFound();
      return { body: { insuredId: i.id, limits: limitsOut(ctx.d, i.id) } };
    }),
  ),

  // ---- cases ----
  http.post(
    `${AB}/cases`,
    route('POST', '/assistance/cases', 'cases:write', assistanceCase, async (ctx) => {
      const { assistanceId, actor } = partner(ctx);
      const input = validate(caseCreateRequest, await readJson(ctx.request));
      const { i } = requireInsuredOf(ctx.d, assistanceId, input.insuredId);
      requireAssistanceScope(ctx.d, assistanceId, i.policyId, todayIso(), 'write');
      const now = Date.now();
      ctx.d.caseSeq += 1;
      const c: AssistanceCaseRow = {
        id: randomId(),
        number: `ОБР-${new Date(now).getFullYear()}-${String(ctx.d.caseSeq).padStart(6, '0')}`,
        assistanceId,
        insuredId: i.id,
        insuredName: i.fullName,
        policyId: i.policyId,
        type: input.type,
        channel: 'phone',
        status: 'open',
        slaDueAt: tzIso(now + CASE_SLA_MINUTES[input.type] * 60_000),
        description: input.description,
        links: {},
        createdAt: tzIso(now),
        createdById: actor.id,
      };
      ctx.d.cases.unshift(c);
      return { status: 201, body: caseOut(c) };
    }),
  ),
  http.patch(
    `${AB}/cases/:id`,
    route('PATCH', '/assistance/cases/{id}', 'cases:write', assistanceCase, async (ctx) => {
      const { assistanceId } = partner(ctx);
      const c = ctx.d.cases.find((x) => x.id === pathParam(ctx, 'id') && x.assistanceId === assistanceId);
      if (!c || scopeOn(ctx.d, assistanceId, c.policyId, c.createdAt) === 'none') throw notFound();
      requireAssistanceScope(ctx.d, assistanceId, c.policyId, c.createdAt.slice(0, 10), 'write');
      const input = validate(caseUpdateRequest, await readJson(ctx.request));
      c.status = input.status;
      if (input.resolution) c.resolution = input.resolution;
      c.resolvedAt = input.status === 'resolved' ? tzIso(Date.now()) : undefined;
      return { body: caseOut(c) };
    }),
  ),

  // ---- appointments ----
  http.get(
    `${AB}/appointments`,
    route('GET', '/assistance/appointments', 'appointments:write', appointmentList, (ctx) => {
      const { assistanceId } = partner(ctx);
      const q = validate(assistAppointmentQuery, Object.fromEntries(ctx.url.searchParams));
      const items = ownAppointments(ctx.d, assistanceId)
        .filter((a) => !q.status || a.status === q.status)
        .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))
        .map(toIntegrationAppointment);
      return { body: page(items, q.cursor, q.limit) };
    }),
  ),
  ...(['confirm', 'reschedule', 'decline'] as const).map((kind) =>
    http.post(
      `${AB}/appointments/:id/${kind}`,
      route('POST', `/assistance/appointments/{id}/${kind}`, 'appointments:write', integrationAppointment, async (ctx) => {
        const { assistanceId } = partner(ctx);
        const a = ownAppointments(ctx.d, assistanceId).find((x) => x.id === pathParam(ctx, 'id'));
        if (!a) throw notFound();
        if (!isOverdueRequest(ctx.d, a)) throw new ApiProblem(409, 'conflict', 'Клиника ещё может ответить: ассистанс отвечает после истечения срока клиники');
        const who = ctx.d.insured.find((x) => x.id === a.insuredId)!;
        requireAssistanceScope(ctx.d, assistanceId, who.policyId, a.createdAt.slice(0, 10), 'write');
        if (kind === 'confirm') respondToAppointment(a, 'operator', { kind });
        else if (kind === 'reschedule') respondToAppointment(a, 'operator', { kind, startsAt: validate(rescheduleRequest, await readJson(ctx.request)).startsAt });
        else respondToAppointment(a, 'operator', { kind, reason: validate(declineRequest, await readJson(ctx.request)).reason });
        return { body: toIntegrationAppointment(a) };
      }),
    ),
  ),

  // ---- guarantee letters ----
  http.get(
    `${AB}/guarantees`,
    route('GET', '/assistance/guarantees', 'guarantees:decide', guaranteeList, (ctx) => {
      const { assistanceId } = partner(ctx);
      const q = validate(guaranteeQuery, Object.fromEntries(ctx.url.searchParams));
      const items = ctx.d.guarantees
        .filter((g) => g.assistanceId === assistanceId && g.policyId && scopeOn(ctx.d, assistanceId, g.policyId, g.createdAt) !== 'none')
        .map((g) => refreshGuarantee(g))
        .filter((g) => !q.status || g.status === q.status)
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
        .map((g) => guaranteeLetter.parse(toGuaranteeLetter(g)));
      return { body: page(items, q.cursor, q.limit) };
    }),
  ),
  http.post(
    `${AB}/guarantees/:id/decide`,
    route('POST', '/assistance/guarantees/{id}/decide', 'guarantees:decide', guaranteeLetter, async (ctx) => {
      const { assistanceId, a, actor } = partner(ctx);
      const g = ctx.d.guarantees.find((x) => x.id === pathParam(ctx, 'id') && x.assistanceId === assistanceId);
      if (!g || !g.policyId || scopeOn(ctx.d, assistanceId, g.policyId, g.createdAt) === 'none') throw notFound();
      requireAssistanceScope(ctx.d, assistanceId, g.policyId, g.createdAt.slice(0, 10), 'write');
      if (g.escalated) throw new ApiProblem(409, 'conflict', 'Письмо передано в МИГ');
      if (g.status !== 'requested') throw new ApiProblem(409, 'conflict', 'Решение уже принято');
      const input = validate(guaranteeDecideRequest, await readJson(ctx.request));
      const decision =
        input.decision === 'approve'
          ? { action: 'approve' as const, amount: input.amount!, validUntil: input.validUntil! }
          : input.decision === 'reject'
            ? { action: 'reject' as const, reason: input.reason! }
            : { action: 'escalate' as const, reason: input.reason! };
      await decideAsAssistance(ctx.d, g, actor, decision, a.contract.guaranteeAuthorityLimit, tzIso(Date.now()));
      return { body: guaranteeLetter.parse(toGuaranteeLetter(g)) };
    }),
  ),

  // ---- registries: own lines ----
  http.get(
    `${AB}/registries`,
    route('GET', '/assistance/registries', 'registries:review', registryList, (ctx) => {
      const { assistanceId } = partner(ctx);
      const q = validate(registryQuery, Object.fromEntries(ctx.url.searchParams));
      const items = ctx.d.registries
        .filter((r) => r.status !== 'draft' && linesOf(r, assistanceId).length)
        .map((r) => subRegistry(ctx.d, r, assistanceId))
        .filter((r) => !q.status || r.status === q.status)
        .sort((a, b) => ((a.submittedAt ?? '') < (b.submittedAt ?? '') ? -1 : 1));
      return { body: page(items, q.cursor, q.limit) };
    }),
  ),
  http.post(
    `${AB}/registries/:id/lines/:lineId/decide`,
    route('POST', '/assistance/registries/{id}/lines/{lineId}/decide', 'registries:review', registrySchema, async (ctx) => {
      const { assistanceId, actor } = partner(ctx);
      const r = ctx.d.registries.find((x) => x.id === pathParam(ctx, 'id') && x.status !== 'draft');
      if (!r || !linesOf(r, assistanceId).length) throw notFound();
      const input = validate(lineDecideRequest, await readJson(ctx.request));
      await decideLine(ctx.d, r, pathParam(ctx, 'lineId'), assistanceId, actor, input.decision === 'accept' ? { decision: 'accept' } : { decision: 'reject', reason: input.reason! });
      return { body: subRegistry(ctx.d, r, assistanceId) };
    }),
  ),
  http.post(
    `${AB}/registries/:id/payments`,
    route('POST', '/assistance/registries/{id}/payments', 'payments:write', registrySchema, async (ctx) => {
      const { assistanceId, actor } = partner(ctx);
      const r = ctx.d.registries.find((x) => x.id === pathParam(ctx, 'id') && x.status !== 'draft');
      if (!r || !linesOf(r, assistanceId).length) throw notFound();
      const input = validate(clinicPaymentRequest, await readJson(ctx.request));
      await recordPayment(ctx.d, r, assistanceId, actor, { lineIds: input.lineIds, paidAt: input.paidAt, amount: input.amount, orderNumber: input.paymentOrderNumber });
      return { body: subRegistry(ctx.d, r, assistanceId) };
    }),
  ),

  // ---- rebills ----
  http.post(
    `${AB}/rebills`,
    route('POST', '/assistance/rebills', 'rebills:write', rebillSchema, async (ctx) => {
      const { assistanceId, actor } = partner(ctx);
      const input = validate(rebillCreateRequest, await readJson(ctx.request));
      if (input.period > isoDay(Date.now()).slice(0, 7)) throw new ApiProblem(422, 'validation', 'Период ещё не наступил', { period: 'Период ещё не наступил' });
      // A rebill sent through the API is final: it is created and submitted to MIG at once.
      const b = upsertDraftRebill(ctx.d, assistanceId, input.period, input.lineIds);
      submitRebill(ctx.d, b, actor);
      return { status: 201, body: rebillOut(ctx.d, b) };
    }),
  ),
  http.get(
    `${AB}/rebills/:id`,
    route('GET', '/assistance/rebills/{id}', 'rebills:write', rebillSchema, (ctx) => {
      const { assistanceId } = partner(ctx);
      const b = ctx.d.rebills.find((x) => x.id === pathParam(ctx, 'id') && x.assistanceId === assistanceId);
      if (!b) throw notFound();
      return { body: rebillOut(ctx.d, b) };
    }),
  ),
  http.post(
    `${AB}/rebills/:id/lines/:lineId/dispute`,
    route('POST', '/assistance/rebills/{id}/lines/{lineId}/dispute', 'rebills:write', rebillSchema, async (ctx) => {
      const { assistanceId } = partner(ctx);
      const b = ctx.d.rebills.find((x) => x.id === pathParam(ctx, 'id') && x.assistanceId === assistanceId);
      if (!b) throw notFound();
      const { comment } = validate(disputeRequest, await readJson(ctx.request));
      disputeRebillLine(b, pathParam(ctx, 'lineId'), comment);
      return { body: rebillOut(ctx.d, b) };
    }),
  ),
];
