/*
 * Integration API for clinic MIS (/api/integration/v1), CLINIC_SPEC §6. Same data and rules as the
 * cabinet (shared clinic-core). OAuth 2.0 client credentials, scopes, 60 requests/min per key,
 * Idempotency-Key for POST, X-Request-Id on every response, RFC 9457 problem+json errors,
 * call log without parameters or bodies (path templates only).
 */
import { delay, http, HttpResponse, type PathParams } from 'msw';
import type { ZodTypeAny } from 'zod';
import type { Appointment, IntegrationScope, PartnerType } from '@/shared/types';
import {
  appointmentList,
  appointmentQuery,
  coverageCheckRequest,
  coverageCheckResult,
  declineRequest,
  disputeRequest,
  guaranteeCreateRequest,
  guaranteeLetter,
  integrationAppointment,
  paymentList,
  registry as registrySchema,
  registryCreateRequest,
  rescheduleRequest,
  slotsPutRequest,
  slotsPutResult,
  tokenRequest,
  tokenResponse,
  visit as visitSchema,
  type Problem,
} from '@/shared/integration/schemas';
import { hasKey, translate, unpack, type I18nKey } from '@/i18n/core';
import { sha256Hex } from '@/shared/integration/webhook';
import { ACCESS_TOKEN_TTL_SEC, API_RATE_PER_MINUTE, IDEMPOTENCY_TTL_MS } from '@/shared/domain/clinics';
import { db, type Db, type IntegrationClientRow } from '../db';
import { API, HttpError, validate } from '../http';
import { mockConfig } from '../config';
import { saveSessions, scheduleSaveDb } from '../persist';
import { randomId, randomToken } from '../rng';
import { isoDay, parseIso, tzIso } from '../time';
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
} from '../clinic-core';
import { attachGuaranteeFiles, createGuarantee } from './clinic';

export const BASE = `${API}/integration/v1`;

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly slug: string,
    detail: string,
    readonly errors?: Record<string, string>,
    readonly headers: Record<string, string> = {},
  ) {
    super(detail);
  }
}

/** A packed message (msg()) as Russian text; anything else is returned as is. */
function ruText(packed: string): string {
  const { key, params } = unpack(packed);
  return hasKey(key) ? translate('ru', key as I18nKey, params) : packed;
}

function problemOf(e: unknown): ApiProblem {
  if (e instanceof ApiProblem) return e;
  if (e instanceof HttpError) {
    // The partner API is not localized: problem details are in Russian (the default locale).
    const fields = e.fields ? Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k, ruText(v)])) : undefined;
    return new ApiProblem(e.status, e.code, translate('ru', e.key, e.params), fields);
  }
  return new ApiProblem(500, 'server', 'Внутренняя ошибка сервера');
}

function problemResponse(p: ApiProblem, requestId: string): Response {
  const body: Problem = {
    type: `https://mig.uz/problems/${p.slug}`,
    title: TITLES[p.status] ?? 'Error',
    status: p.status,
    detail: p.message,
    ...(p.errors ? { errors: p.errors } : {}),
  };
  return HttpResponse.json(body, { status: p.status, headers: { 'Content-Type': 'application/problem+json', 'X-Request-Id': requestId, ...p.headers } });
}

export interface ApiCtx {
  request: Request;
  params: PathParams;
  url: URL;
  d: Db;
  client: IntegrationClientRow;
  actor: ClinicActor;
}

function actorFor(client: IntegrationClientRow): ClinicActor {
  return { id: client.id, clinicId: client.clinicId, displayName: `API: ${client.name}`, role: 'clinic_admin' };
}

export function pathParam(ctx: { params: PathParams }, key: string): string {
  const v = ctx.params[key];
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw new ApiProblem(404, 'not_found', 'Не найдено');
  return v;
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 5_000_000) throw new ApiProblem(413, 'too_large', 'Слишком большой запрос');
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new ApiProblem(400, 'invalid_json', 'Некорректный JSON');
  }
}

function ipAllowed(list: string[], ip: string | null): boolean {
  if (!list.length) return true;
  if (!ip) return false;
  return list.some((entry) => {
    if (!entry.includes('/')) return entry === ip;
    const [net = '', bitsRaw = '32'] = entry.split('/');
    const toInt = (s: string) => s.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !/^\d+\.\d+\.\d+\.\d+$/.test(net)) return false;
    const bits = Number(bitsRaw);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((toInt(ip) & mask) >>> 0) === ((toInt(net) & mask) >>> 0);
  });
}

/** Header used only by tests and the sandbox to stand for the caller's IP (CLINIC_SPEC §6.2). */
export const TEST_IP_HEADER = 'X-Test-Client-IP';

export type Handler = (ctx: ApiCtx) => Promise<{ status?: number; body: unknown }> | { status?: number; body: unknown };

export function apiRoute(method: 'GET' | 'POST' | 'PUT' | 'PATCH', template: string, scope: IntegrationScope, response: ZodTypeAny | null, fn: Handler, partner: PartnerType = 'clinic') {
  return async ({ request, params }: { request: Request; params: PathParams }) => {
    const requestId = randomId();
    const started = Date.now();
    const [lo, hi] = mockConfig.latency;
    if (hi > 0) await delay(lo + Math.floor(Math.random() * (hi - lo)));
    const d = db();
    let client: IntegrationClientRow | undefined;
    let status = 500;
    try {
      const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(request.headers.get('authorization') ?? '');
      if (!m) throw new ApiProblem(401, 'invalid_token', 'Нужен заголовок Authorization: Bearer <access_token>', undefined, { 'WWW-Authenticate': 'Bearer' });
      const hash = await sha256Hex(m[1]!);
      const token = d.accessTokens.find((t) => t.tokenHash === hash && t.expiresAt > Date.now());
      client = token ? d.integrationClients.find((c) => c.id === token.clientRowId) : undefined;
      if (!token || !client || client.revokedAt) {
        client = undefined;
        throw new ApiProblem(401, 'invalid_token', 'Токен недействителен, истёк или ключ отозван', undefined, { 'WWW-Authenticate': 'Bearer error="invalid_token"' });
      }
      // Keys belong to a partner: clinic methods are closed to assistance keys and vice versa.
      if ((client.partnerType ?? 'clinic') !== partner) throw new ApiProblem(403, 'wrong_partner', 'Метод недоступен ключу этого типа партнёра');
      if (!token.scopes.includes(scope)) throw new ApiProblem(403, 'insufficient_scope', `Нужна область доступа ${scope}`);
      if (!ipAllowed(client.ipAllowlist, request.headers.get(TEST_IP_HEADER))) throw new ApiProblem(403, 'ip_not_allowed', 'Запрос с адреса, которого нет в списке разрешённых');
      const now = Date.now();
      d.apiCalls = d.apiCalls.filter((c) => now - c.at < 60_000);
      const recent = d.apiCalls.filter((c) => c.clientRowId === client!.id);
      if (recent.length >= API_RATE_PER_MINUTE) {
        const retry = Math.max(1, Math.ceil((recent[0]!.at + 60_000 - now) / 1000));
        throw new ApiProblem(429, 'rate_limited', `Не больше ${API_RATE_PER_MINUTE} запросов в минуту на ключ`, undefined, { 'Retry-After': String(retry) });
      }
      d.apiCalls.push({ clientRowId: client.id, at: now });
      client.lastUsedAt = tzIso(now);

      const url = new URL(request.url);
      const idemHeader = request.headers.get('Idempotency-Key');
      const idemKey = method === 'POST' && idemHeader ? `${client.id}|${method}|${url.pathname}|${idemHeader.slice(0, 128)}` : null;
      if (idemKey) {
        d.idempotency = d.idempotency.filter((r) => now - r.at < IDEMPOTENCY_TTL_MS);
        const prev = d.idempotency.find((r) => r.key === idemKey);
        if (prev) {
          status = prev.status;
          return new HttpResponse(prev.body, {
            status: prev.status,
            headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId, 'Idempotency-Replayed': 'true' },
          });
        }
      }
      const out = await fn({ request, params, url, d, client, actor: actorFor(client) });
      if (response) {
        const check = response.safeParse(out.body);
        if (!check.success) throw new Error('Response does not match the contract');
      }
      status = out.status ?? 200;
      const bodyText = JSON.stringify(out.body);
      if (idemKey) d.idempotency.push({ key: idemKey, status, body: bodyText, at: now });
      return new HttpResponse(bodyText, { status, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId } });
    } catch (e) {
      const p = problemOf(e);
      status = p.status;
      return problemResponse(p, requestId);
    } finally {
      if (client) {
        d.apiLogs.unshift({
          id: randomId(),
          clinicId: client.clinicId,
          clientId: client.clientId,
          at: tzIso(started),
          method,
          pathTemplate: template,
          status,
          latencyMs: Date.now() - started,
        });
        d.apiLogs = d.apiLogs.slice(0, 2000);
      }
      saveSessions(d);
      scheduleSaveDb(db);
    }
  };
}

export const toIntegrationAppointment = (a: Appointment) =>
  integrationAppointment.parse({
    id: a.id,
    clinicId: a.clinicId,
    insuredName: a.insuredName,
    specialty: a.specialty,
    startsAt: a.startsAt,
    status: a.status,
    createdAt: a.createdAt,
    respondedBy: a.respondedBy,
    proposedStartsAt: a.proposedStartsAt,
  });

export function page<T>(items: T[], cursor: string | undefined, limit: number): { items: T[]; nextCursor: string | null } {
  const offset = cursor && /^\d+$/.test(atob(cursor)) ? Number(atob(cursor)) : 0;
  const slice = items.slice(offset, offset + limit);
  return { items: slice, nextCursor: offset + limit < items.length ? btoa(String(offset + limit)) : null };
}

export const integrationHandlers = [
  http.post(`${BASE}/oauth/token`, async ({ request }) => {
    const requestId = randomId();
    const d = db();
    const started = Date.now();
    let client: IntegrationClientRow | undefined;
    let status = 200;
    try {
      const type = request.headers.get('content-type') ?? '';
      const raw = type.includes('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(await request.text())) : await readJson(request);
      const input = validate(tokenRequest, raw);
      client = d.integrationClients.find((c) => c.clientId === input.client_id);
      const ok = client && !client.revokedAt && (await sha256Hex(input.client_secret)) === client.secretHash;
      if (!ok || !client) throw new ApiProblem(401, 'invalid_client', 'Неверный client_id или client_secret, либо ключ отозван');
      const requested = input.scope ? input.scope.split(/\s+/).filter(Boolean) : client.scopes;
      const scopes = requested.filter((s) => (client!.scopes as string[]).includes(s));
      if (!scopes.length) throw new ApiProblem(400, 'invalid_scope', 'Запрошенные области доступа не выданы этому ключу');
      const token = randomToken(32);
      d.accessTokens = d.accessTokens.filter((t) => t.expiresAt > Date.now());
      d.accessTokens.push({ tokenHash: await sha256Hex(token), clientRowId: client.id, scopes, expiresAt: Date.now() + ACCESS_TOKEN_TTL_SEC * 1000 });
      client.lastUsedAt = tzIso(Date.now());
      const body = tokenResponse.parse({ access_token: token, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_SEC, scope: scopes.join(' ') });
      return HttpResponse.json(body, { headers: { 'X-Request-Id': requestId, 'Cache-Control': 'no-store' } });
    } catch (e) {
      const p = problemOf(e);
      status = p.status;
      return problemResponse(p, requestId);
    } finally {
      if (client) {
        d.apiLogs.unshift({ id: randomId(), clinicId: client.clinicId, clientId: client.clientId, at: tzIso(started), method: 'POST', pathTemplate: '/oauth/token', status, latencyMs: Date.now() - started });
      }
      saveSessions(d);
      scheduleSaveDb(db);
    }
  }),

  http.post(
    `${BASE}/coverage/check`,
    apiRoute('POST', '/coverage/check', 'coverage:check', coverageCheckResult, async ({ request, actor, d }) => {
      const input = validate(coverageCheckRequest, await readJson(request));
      const result = checkPatient(input, actor, 'api');
      pushEvent(d, actor.clinicId, 'МИС проверила пациента, открыт визит');
      return { body: result };
    }),
  ),
  http.get(
    `${BASE}/visits/:visitId`,
    apiRoute('GET', '/visits/{visitId}', 'coverage:check', visitSchema, (ctx) => ({ body: requireVisit(ctx.d, ctx.actor.clinicId, pathParam(ctx, 'visitId')) })),
  ),

  http.get(
    `${BASE}/appointments`,
    apiRoute('GET', '/appointments', 'appointments:read', appointmentList, ({ url, d, actor }) => {
      const q = validate(appointmentQuery, Object.fromEntries(url.searchParams));
      const list = d.appointments
        .filter((a) => a.clinicId === actor.clinicId)
        .filter((a) => !q.status || a.status === q.status)
        .filter((a) => !q.from || isoDay(parseIso(a.startsAt)) >= q.from)
        .filter((a) => !q.to || isoDay(parseIso(a.startsAt)) <= q.to)
        .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))
        .map(toIntegrationAppointment);
      return { body: page(list, q.cursor, q.limit) };
    }),
  ),
  http.post(
    `${BASE}/appointments/:id/confirm`,
    apiRoute('POST', '/appointments/{id}/confirm', 'appointments:write', integrationAppointment, (ctx) => {
      const a = appointmentOfClinic(ctx.d, ctx.actor.clinicId, pathParam(ctx, 'id'));
      return { body: toIntegrationAppointment(respondToAppointment(a, 'clinic', { kind: 'confirm' })) };
    }),
  ),
  http.post(
    `${BASE}/appointments/:id/reschedule`,
    apiRoute('POST', '/appointments/{id}/reschedule', 'appointments:write', integrationAppointment, async (ctx) => {
      const a = appointmentOfClinic(ctx.d, ctx.actor.clinicId, pathParam(ctx, 'id'));
      const { startsAt } = validate(rescheduleRequest, await readJson(ctx.request));
      return { body: toIntegrationAppointment(respondToAppointment(a, 'clinic', { kind: 'reschedule', startsAt })) };
    }),
  ),
  http.post(
    `${BASE}/appointments/:id/decline`,
    apiRoute('POST', '/appointments/{id}/decline', 'appointments:write', integrationAppointment, async (ctx) => {
      const a = appointmentOfClinic(ctx.d, ctx.actor.clinicId, pathParam(ctx, 'id'));
      const { reason } = validate(declineRequest, await readJson(ctx.request));
      return { body: toIntegrationAppointment(respondToAppointment(a, 'clinic', { kind: 'decline', reason })) };
    }),
  ),
  http.put(
    `${BASE}/slots`,
    apiRoute('PUT', '/slots', 'slots:write', slotsPutResult, async ({ request, d, actor }) => {
      const { slots } = validate(slotsPutRequest, await readJson(request));
      const days = slots.map((s) => isoDay(parseIso(s.startsAt))).sort();
      const from = days[0] ?? null;
      const to = days[days.length - 1] ?? null;
      // Replace the clinic's slots for the covered period.
      d.misSlots = d.misSlots.filter((s) => s.clinicId !== actor.clinicId || !from || !to || isoDay(parseIso(s.startsAt)) < from || isoDay(parseIso(s.startsAt)) > to);
      for (const s of slots) d.misSlots.push({ clinicId: actor.clinicId, specialty: s.specialty, startsAt: tzIso(parseIso(s.startsAt)), durationMin: s.durationMin, doctorRef: s.doctorRef });
      pushEvent(d, actor.clinicId, `МИС передала расписание: ${slots.length} слотов`);
      return { body: { replaced: slots.length, from, to } };
    }),
  ),

  http.post(
    `${BASE}/guarantees`,
    apiRoute('POST', '/guarantees', 'guarantees:write', guaranteeLetter, async ({ request, d, actor }) => {
      const input = validate(guaranteeCreateRequest, await readJson(request));
      return { status: 201, body: toGuaranteeLetter(createGuarantee(d, actor, input, actor.displayName)) };
    }),
  ),
  http.get(
    `${BASE}/guarantees/:id`,
    apiRoute('GET', '/guarantees/{id}', 'guarantees:read', guaranteeLetter, (ctx) => {
      const g = ctx.d.guarantees.find((x) => x.id === pathParam(ctx, 'id') && x.clinicId === ctx.actor.clinicId);
      if (!g) throw new ApiProblem(404, 'not_found', 'Не найдено');
      return { body: toGuaranteeLetter(g) };
    }),
  ),
  http.post(
    `${BASE}/guarantees/:id/documents`,
    apiRoute('POST', '/guarantees/{id}/documents', 'guarantees:write', guaranteeLetter, async (ctx) => {
      const g = ctx.d.guarantees.find((x) => x.id === pathParam(ctx, 'id') && x.clinicId === ctx.actor.clinicId);
      if (!g) throw new ApiProblem(404, 'not_found', 'Не найдено');
      if (g.status !== 'requested' && g.status !== 'info_requested') throw new ApiProblem(409, 'conflict', 'По этому письму уже принято решение');
      let form: FormData;
      try {
        form = await ctx.request.formData();
      } catch {
        throw new ApiProblem(400, 'invalid_form', 'Ожидается multipart/form-data с полем files');
      }
      await attachGuaranteeFiles(ctx.d, g, form);
      const comment = form.get('comment');
      if (g.status === 'info_requested' && typeof comment === 'string' && comment.trim().length >= 3) {
        g.infoComment = comment.trim().slice(0, 1000);
        g.status = 'requested';
      }
      return { body: toGuaranteeLetter(g) };
    }),
  ),

  http.post(
    `${BASE}/registries`,
    apiRoute('POST', '/registries', 'registries:write', registrySchema, async ({ request, d, actor }) => {
      const input = validate(registryCreateRequest, await readJson(request));
      const errors: Record<string, string> = {};
      const lines = input.lines.flatMap((l, i) => {
        if (!l.serviceDate.startsWith(input.period)) {
          errors[`lines[${i}]`] = `Дата услуги вне периода ${input.period}`;
          return [];
        }
        try {
          const line = buildLine(d, actor.clinicId, l);
          const problems = lineProblems(d, actor.clinicId, line);
          if (problems.length) errors[`lines[${i}]`] = problems.join('; ');
          return [line];
        } catch {
          errors[`lines[${i}]`] = 'Визит не найден в вашей клинике';
          return [];
        }
      });
      if (Object.keys(errors).length) throw new ApiProblem(422, 'validation', 'Реестр не прошёл проверки', errors);
      const reg = { id: randomId(), clinicId: actor.clinicId, period: input.period, status: 'draft' as const, source: 'api' as const, lines, totals: { claimed: 0, accepted: 0, rejected: 0, paid: 0 } };
      recomputeRegistry(reg);
      d.registries.push(reg);
      submitRegistry(d, reg, actor);
      return { status: 201, body: { ...reg } };
    }),
  ),
  http.get(
    `${BASE}/registries/:id`,
    apiRoute('GET', '/registries/{id}', 'registries:read', registrySchema, (ctx) => ({ body: registryOfClinic(ctx.d, ctx.actor.clinicId, pathParam(ctx, 'id')) })),
  ),
  http.post(
    `${BASE}/registries/:id/lines/:lineId/dispute`,
    apiRoute('POST', '/registries/{id}/lines/{lineId}/dispute', 'registries:write', registrySchema, async (ctx) => {
      const r = registryOfClinic(ctx.d, ctx.actor.clinicId, pathParam(ctx, 'id'));
      const line = r.lines.find((l) => l.id === pathParam(ctx, 'lineId'));
      if (!line) throw new ApiProblem(404, 'not_found', 'Не найдено');
      if (line.status !== 'rejected' || r.status === 'paid') throw new ApiProblem(409, 'conflict', 'Оспорить можно только отклонённую строку неоплаченного реестра');
      line.disputeComment = validate(disputeRequest, await readJson(ctx.request)).comment;
      line.status = 'disputed';
      return { body: r };
    }),
  ),
  http.get(
    `${BASE}/payments`,
    apiRoute('GET', '/payments', 'payments:read', paymentList, ({ url, d, actor }) => {
      const period = url.searchParams.get('period');
      const items = d.registries
        .filter((r) => r.clinicId === actor.clinicId && r.status === 'paid' && (!period || r.period === period))
        .sort((a, b) => (a.period < b.period ? 1 : -1))
        .map((r) => ({ registryId: r.id, period: r.period, amount: r.totals.paid, paidAt: r.paidAt! }));
      return { body: page(items, url.searchParams.get('cursor') ?? undefined, Math.min(100, Number(url.searchParams.get('limit')) || 50)) };
    }),
  ),
];
