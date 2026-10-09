/*
 * Integration API for clinic MIS (/api/integration/v1), CLINIC_SPEC §6. Same data and rules as the
 * cabinet (./clinic). The framework (OAuth client credentials, scopes, 60 requests/min per key,
 * Idempotency-Key for POST, X-Request-Id, RFC 9457 problem+json, the call log) is ./integrationKit.ts,
 * shared with the assistance API; every endpoint here is an `ApiHandler` of a clinic key.
 */
import type { CoverageCheckResult, GuaranteeLetter, Registry, Visit } from '@mig/contracts';
import { appointmentQuery, coverageCheckRequest, declineRequest, guaranteeCreateRequest, registryCreateRequest, rescheduleRequest, slotsPutRequest } from '@mig/contracts/integration';
import { randomId } from '../lib/random';
import { isoDay, parseIso, tzIso } from '../lib/time';
import type { IntegrationClientRow } from '../store/db';
import {
  appointmentOfClinic,
  buildLine,
  checkPatient,
  lineProblems,
  pushEvent,
  recomputeRegistry,
  registryOfClinic,
  requireVisit,
  respondToAppointment,
  submitRegistry,
  toGuaranteeLetter,
  type ClinicActor,
} from './clinic';
import { attachGuaranteeFiles, createGuarantee, disputeLine, type UploadedFile } from './clinicPortal';
import { ApiProblem, apiNotFound, page, pageWindow, ruText, toIntegrationAppointment, windowPage, type ApiCallCtx } from './integrationKit';
import { dayRange } from './list';
import { validate } from './kernel';

type ApiOutput = { status?: number; body: unknown };

/** The actor a clinic key's actions are recorded under. */
function actorFor(client: IntegrationClientRow): ClinicActor {
  return { id: client.id, clinicId: client.clinicId, displayName: `API: ${client.name}`, role: 'clinic_admin' };
}

// ---------------------------------------------------------------- endpoints (clinic keys)

export async function coverageCheck(ctx: ApiCallCtx): Promise<{ body: CoverageCheckResult }> {
  const actor = actorFor(ctx.client);
  const input = validate(coverageCheckRequest, ctx.json());
  const result = await checkPatient(ctx, input, actor, 'api');
  await pushEvent(ctx, actor.clinicId, 'МИС проверила пациента, открыт визит');
  return { body: result };
}

export async function getVisit(ctx: ApiCallCtx): Promise<{ body: Visit }> {
  return { body: await requireVisit(ctx, ctx.client.clinicId, ctx.pathParam('visitId')) };
}

export async function listAppointments(ctx: ApiCallCtx): Promise<ApiOutput> {
  const q = validate(appointmentQuery, Object.fromEntries(ctx.query));
  const from = q.from ? dayRange(q.from) : null;
  const to = q.to ? dayRange(q.to) : null;
  if ((q.from && !from) || (q.to && !to)) {
    // A date that only looks like one (2026-02-30): compared as text, as the days of the appointments are.
    const list = (await ctx.repos.appointments.list({ where: { clinicId: ctx.client.clinicId, ...(q.status ? { status: q.status } : {}) }, orderBy: [['startsAt', 'asc']] }))
      .filter((a) => !q.from || isoDay(parseIso(a.startsAt)) >= q.from)
      .filter((a) => !q.to || isoDay(parseIso(a.startsAt)) <= q.to)
      .map(toIntegrationAppointment);
    return { body: page(list, q.cursor, q.limit) };
  }
  // `isoDay(startsAt) >= from` and `<= to`: from the start of the first day to the end of the last one.
  const rows = await ctx.repos.appointments.list({
    where: { clinicId: ctx.client.clinicId, ...(q.status ? { status: q.status } : {}), startsAt: { ...(from ? { gte: from.gte } : {}), ...(to ? { lt: to.lt } : {}) } },
    orderBy: [['startsAt', 'asc']],
    ...pageWindow(q.cursor, q.limit),
  });
  return { body: windowPage(rows.map(toIntegrationAppointment), q.cursor, q.limit) };
}

/** confirm / reschedule / decline a request of a patient from the MIS. */
export async function answerAppointment(ctx: ApiCallCtx, kind: 'confirm' | 'reschedule' | 'decline'): Promise<ApiOutput> {
  const id = ctx.pathParam('id');
  const body = kind === 'confirm' ? undefined : ctx.json();
  const a = await appointmentOfClinic(ctx, ctx.client.clinicId, id);
  if (kind === 'confirm') respondToAppointment(a, 'clinic', { kind }, ctx.now());
  else if (kind === 'reschedule') {
    const { startsAt } = validate(rescheduleRequest, body);
    respondToAppointment(a, 'clinic', { kind, startsAt }, ctx.now());
  } else {
    const { reason } = validate(declineRequest, body);
    respondToAppointment(a, 'clinic', { kind, reason }, ctx.now());
  }
  await ctx.repos.appointments.put(a);
  return { body: toIntegrationAppointment(a) };
}

/** The MIS replaces the clinic's slots for the period its list covers. */
export async function putSlots(ctx: ApiCallCtx): Promise<ApiOutput> {
  const actor = actorFor(ctx.client);
  const { slots } = validate(slotsPutRequest, ctx.json());
  const days = slots.map((s) => isoDay(parseIso(s.startsAt))).sort();
  const from = days[0] ?? null;
  const to = days[days.length - 1] ?? null;
  if (from && to) {
    const replaced = (await ctx.repos.misSlots.list({ where: { clinicId: actor.clinicId } })).filter((s) => isoDay(parseIso(s.startsAt)) >= from && isoDay(parseIso(s.startsAt)) <= to);
    if (replaced.length) await ctx.repos.misSlots.removeWhere({ clinicId: actor.clinicId, startsAt: { in: replaced.map((s) => s.startsAt) } });
  }
  await ctx.repos.misSlots.insertMany(slots.map((s) => ({ clinicId: actor.clinicId, specialty: s.specialty, startsAt: tzIso(parseIso(s.startsAt)), durationMin: s.durationMin, doctorRef: s.doctorRef })));
  await pushEvent(ctx, actor.clinicId, `МИС передала расписание: ${slots.length} слотов`);
  return { body: { replaced: slots.length, from, to } };
}

export async function requestGuarantee(ctx: ApiCallCtx): Promise<{ status: number; body: GuaranteeLetter }> {
  const actor = actorFor(ctx.client);
  const input = validate(guaranteeCreateRequest, ctx.json());
  return { status: 201, body: await toGuaranteeLetter(ctx, await createGuarantee(ctx, actor, input, actor.displayName)) };
}

export async function getGuarantee(ctx: ApiCallCtx): Promise<{ body: GuaranteeLetter }> {
  const g = await ctx.repos.guarantees.first({ where: { id: ctx.pathParam('id'), clinicId: ctx.client.clinicId } });
  if (!g) throw apiNotFound();
  return { body: await toGuaranteeLetter(ctx, g) };
}

/**
 * Documents for a letter; with a comment (3+ characters) an «нужны документы» letter goes back to review.
 * `form`: the multipart form as the adapter read it (null when the body is not multipart).
 */
export async function guaranteeDocuments(ctx: ApiCallCtx, form: { comment: string | null; files: readonly UploadedFile[] } | null): Promise<{ body: GuaranteeLetter }> {
  const g = await ctx.repos.guarantees.first({ where: { id: ctx.pathParam('id'), clinicId: ctx.client.clinicId } });
  if (!g) throw apiNotFound();
  if (g.status !== 'requested' && g.status !== 'info_requested') throw new ApiProblem(409, 'conflict', 'По этому письму уже принято решение');
  if (!form) throw new ApiProblem(400, 'invalid_form', 'Ожидается multipart/form-data с полем files');
  await attachGuaranteeFiles(ctx, g, form.files);
  const comment = form.comment;
  if (g.status === 'info_requested' && typeof comment === 'string' && comment.trim().length >= 3) {
    g.infoComment = comment.trim().slice(0, 1000);
    g.status = 'requested';
    await ctx.repos.guarantees.update(g.id, { infoComment: g.infoComment, status: g.status });
  }
  return { body: await toGuaranteeLetter(ctx, g) };
}

/** A registry from the MIS: checked line by line, then sent at once. */
export async function createRegistry(ctx: ApiCallCtx): Promise<{ status: number; body: Registry }> {
  const actor = actorFor(ctx.client);
  const input = validate(registryCreateRequest, ctx.json());
  const errors: Record<string, string> = {};
  const lines = [];
  for (const [i, l] of input.lines.entries()) {
    if (!l.serviceDate.startsWith(input.period)) {
      errors[`lines[${i}]`] = `Дата услуги вне периода ${input.period}`;
      continue;
    }
    try {
      const line = await buildLine(ctx, actor.clinicId, l);
      const problems = await lineProblems(ctx, actor.clinicId, line);
      if (problems.length) errors[`lines[${i}]`] = problems.map(ruText).join('; ');
      lines.push(line);
    } catch {
      errors[`lines[${i}]`] = 'Визит не найден в вашей клинике';
    }
  }
  if (Object.keys(errors).length) throw new ApiProblem(422, 'validation', 'Реестр не прошёл проверки', errors);
  const reg: Registry = { id: randomId(), clinicId: actor.clinicId, period: input.period, status: 'draft', source: 'api', lines, totals: { claimed: 0, accepted: 0, rejected: 0, paid: 0 } };
  recomputeRegistry(reg);
  await ctx.repos.registries.insert(reg);
  await submitRegistry(ctx, reg, actor);
  return { status: 201, body: { ...reg } };
}

export async function getRegistry(ctx: ApiCallCtx): Promise<{ body: Registry }> {
  return { body: await registryOfClinic(ctx, ctx.client.clinicId, ctx.pathParam('id')) };
}

export async function disputeRegistryLine(ctx: ApiCallCtx): Promise<{ body: Registry }> {
  const id = ctx.pathParam('id');
  const lineId = ctx.pathParam('lineId');
  const body = ctx.json();
  const r = await registryOfClinic(ctx, ctx.client.clinicId, id);
  await disputeLine(ctx, r, lineId, body);
  return { body: r };
}

export async function payments(ctx: ApiCallCtx): Promise<ApiOutput> {
  const qs = ctx.query;
  const period = qs.get('period');
  const cursor = qs.get('cursor') ?? undefined;
  const limit = Math.min(100, Number(qs.get('limit')) || 50);
  const rows = await ctx.repos.registries.list({
    where: { clinicId: ctx.client.clinicId, status: 'paid', ...(period ? { period } : {}) },
    orderBy: [['period', 'desc']],
    ties: 'desc',
    ...pageWindow(cursor, limit),
  });
  return { body: windowPage(rows.map((r) => ({ registryId: r.id, period: r.period, amount: r.totals.paid, paidAt: r.paidAt! })), cursor, limit) };
}
