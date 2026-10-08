/*
 * Integration API for clinic MIS (/api/integration/v1), CLINIC_SPEC §6. Same data and rules as the
 * cabinet (./clinic). OAuth 2.0 client credentials, scopes, 60 requests/min per key, Idempotency-Key
 * for POST, X-Request-Id on every response, RFC 9457 problem+json errors, call log without parameters
 * or bodies (path templates only). The partner API authenticates with its own bearer tokens, not
 * sessions: `runApi` is the whole pipeline, the adapter only passes the request's headers and turns
 * the ApiResult into an HTTP answer.
 */
import type { ZodTypeAny } from 'zod';
import type { Appointment, GuaranteeLetter, IntegrationScope, PartnerType, Registry, UUID, Visit, CoverageCheckResult } from '@mig/contracts';
import {
  appointmentQuery,
  coverageCheckRequest,
  declineRequest,
  guaranteeCreateRequest,
  integrationAppointment,
  registryCreateRequest,
  rescheduleRequest,
  slotsPutRequest,
  tokenRequest,
  tokenResponse,
  type Problem,
} from '@mig/contracts/integration';
import { hasKey, translate, unpack, type I18nKey } from '@mig/i18n';
import { ACCESS_TOKEN_TTL_SEC, API_RATE_PER_MINUTE, IDEMPOTENCY_TTL_MS } from '../clinics';
import { randomId, randomToken } from '../lib/random';
import { isoDay, parseIso, tzIso } from '../lib/time';
import { sha256Hex } from '../lib/webhook';
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
import { DomainError, validate, type BaseCtx } from './kernel';

// ---------------------------------------------------------------- problems (RFC 9457)

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

/** An error of the partner API: the problem type slug, a Russian detail, field errors and extra headers. */
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

export const notFoundProblem = () => new ApiProblem(404, 'not_found', 'Не найдено');

/** A packed message (msg()) as Russian text; anything else is returned as is. */
function ruText(packed: string): string {
  const { key, params } = unpack(packed);
  return hasKey(key) ? translate('ru', key as I18nKey, params) : packed;
}

export function problemOf(e: unknown): ApiProblem {
  if (e instanceof ApiProblem) return e;
  if (e instanceof DomainError) {
    // The partner API is not localized: problem details are in Russian (the default locale).
    const fields = e.fields ? Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k, ruText(v)])) : undefined;
    return new ApiProblem(e.status, e.code, translate('ru', e.key, e.params), fields);
  }
  return new ApiProblem(500, 'server', 'Внутренняя ошибка сервера');
}

/** What the adapter sends: a JSON value (`json`) or an already serialized JSON body (`text`). */
export interface ApiResult {
  status: number;
  headers: Record<string, string>;
  json?: unknown;
  text?: string;
}

export function problemResult(e: unknown, requestId: string): ApiResult {
  const p = problemOf(e);
  const body: Problem = {
    type: `https://mig.uz/problems/${p.slug}`,
    title: TITLES[p.status] ?? 'Error',
    status: p.status,
    detail: p.message,
    ...(p.errors ? { errors: p.errors } : {}),
  };
  return { status: p.status, json: body, headers: { 'Content-Type': 'application/problem+json', 'X-Request-Id': requestId, ...p.headers } };
}

// ---------------------------------------------------------------- the pipeline

/** A partner's call after authentication: the key and the actor its actions are recorded under. */
export interface ApiCall {
  ctx: BaseCtx;
  client: IntegrationClientRow;
  actor: ClinicActor;
}

export interface ApiRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  /** Path template for the call log (no ids). */
  template: string;
  scope: IntegrationScope;
  /** The contract of the answer: a body that does not match it is a server error. */
  response: ZodTypeAny | null;
  partner: PartnerType;
}

/** What the adapter reads from the HTTP request. */
export interface ApiRequestMeta {
  authorization: string | null;
  /** The caller's address (in the mock: the X-Test-Client-IP header). */
  ip: string | null;
  idempotencyKey: string | null;
  pathname: string;
  /** When the request arrived (before the adapter's simulated latency), for the call log. */
  startedAt: number;
}

export interface ApiOutput {
  status?: number;
  body: unknown;
}

function actorFor(client: IntegrationClientRow): ClinicActor {
  return { id: client.id, clinicId: client.clinicId, displayName: `API: ${client.name}`, role: 'clinic_admin' };
}

export function ipAllowed(list: string[], ip: string | null): boolean {
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

async function logCall(ctx: BaseCtx, client: IntegrationClientRow, method: string, pathTemplate: string, status: number, startedAt: number, max?: number): Promise<void> {
  await ctx.repos.apiLogs.insert(
    { id: randomId(), clinicId: client.clinicId, clientId: client.clientId, at: tzIso(startedAt), method, pathTemplate, status, latencyMs: ctx.now() - startedAt },
    { at: 'start' },
  );
  if (max !== undefined) {
    const extra = await ctx.repos.apiLogs.list({ offset: max });
    if (extra.length) await ctx.repos.apiLogs.removeWhere({ id: { in: extra.map((l) => l.id) } });
  }
}

/** The key of a bearer token, checked for the route's partner type, scope, IP list and rate limit. */
async function authenticate(ctx: BaseCtx, route: ApiRoute, req: ApiRequestMeta, found: (client: IntegrationClientRow) => void): Promise<IntegrationClientRow> {
  const r = ctx.repos;
  const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.authorization ?? '');
  if (!m) throw new ApiProblem(401, 'invalid_token', 'Нужен заголовок Authorization: Bearer <access_token>', undefined, { 'WWW-Authenticate': 'Bearer' });
  const hash = await sha256Hex(m[1]!);
  const token = await r.accessTokens.first({ where: { tokenHash: hash, expiresAt: { gt: ctx.now() } } });
  const client = token ? await r.integrationClients.get(token.clientRowId) : null;
  if (!token || !client || client.revokedAt) {
    throw new ApiProblem(401, 'invalid_token', 'Токен недействителен, истёк или ключ отозван', undefined, { 'WWW-Authenticate': 'Bearer error="invalid_token"' });
  }
  found(client);
  // Keys belong to a partner: clinic methods are closed to assistance keys and vice versa.
  if ((client.partnerType ?? 'clinic') !== route.partner) throw new ApiProblem(403, 'wrong_partner', 'Метод недоступен ключу этого типа партнёра');
  if (!token.scopes.includes(route.scope)) throw new ApiProblem(403, 'insufficient_scope', `Нужна область доступа ${route.scope}`);
  if (!ipAllowed(client.ipAllowlist, req.ip)) throw new ApiProblem(403, 'ip_not_allowed', 'Запрос с адреса, которого нет в списке разрешённых');
  const now = ctx.now();
  await r.apiCalls.removeWhere({ at: { lte: now - 60_000 } });
  const recent = await r.apiCalls.list({ where: { clientRowId: client.id } });
  if (recent.length >= API_RATE_PER_MINUTE) {
    const retry = Math.max(1, Math.ceil((recent[0]!.at + 60_000 - now) / 1000));
    throw new ApiProblem(429, 'rate_limited', `Не больше ${API_RATE_PER_MINUTE} запросов в минуту на ключ`, undefined, { 'Retry-After': String(retry) });
  }
  await r.apiCalls.insert({ clientRowId: client.id, at: now });
  client.lastUsedAt = tzIso(now);
  await r.integrationClients.update(client.id, { lastUsedAt: client.lastUsedAt });
  return client;
}

/**
 * One call of the partner API: authentication, the idempotent replay of a POST, the method itself,
 * the contract check of its answer, problem+json for every error and the call log.
 */
export async function runApi(ctx: BaseCtx, route: ApiRoute, req: ApiRequestMeta, fn: (call: ApiCall) => Promise<ApiOutput> | ApiOutput): Promise<ApiResult> {
  const requestId = randomId();
  let client: IntegrationClientRow | undefined;
  let status = 500;
  try {
    const key = await authenticate(ctx, route, req, (c) => (client = c));
    const now = ctx.now();
    const idemKey = route.method === 'POST' && req.idempotencyKey ? `${key.id}|${route.method}|${req.pathname}|${req.idempotencyKey.slice(0, 128)}` : null;
    if (idemKey) {
      await ctx.repos.idempotency.removeWhere({ at: { lte: now - IDEMPOTENCY_TTL_MS } });
      const prev = await ctx.repos.idempotency.get(idemKey);
      if (prev) {
        status = prev.status;
        return { status: prev.status, text: prev.body, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId, 'Idempotency-Replayed': 'true' } };
      }
    }
    const out = await fn({ ctx, client: key, actor: actorFor(key) });
    if (route.response) {
      const check = route.response.safeParse(out.body);
      if (!check.success) throw new Error('Response does not match the contract');
    }
    status = out.status ?? 200;
    const bodyText = JSON.stringify(out.body);
    if (idemKey) await ctx.repos.idempotency.insert({ key: idemKey, status, body: bodyText, at: now });
    return { status, text: bodyText, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId } };
  } catch (e) {
    const res = problemResult(e, requestId);
    status = res.status;
    return res;
  } finally {
    if (client) await logCall(ctx, client, route.method, route.template, status, req.startedAt, 2000);
  }
}

/** POST /oauth/token: client credentials → a short-lived bearer token. `readBody`: the form or JSON body. */
export async function issueToken(ctx: BaseCtx, readBody: () => Promise<unknown>, startedAt: number): Promise<ApiResult> {
  const r = ctx.repos;
  const requestId = randomId();
  let client: IntegrationClientRow | null = null;
  let status = 200;
  try {
    const input = validate(tokenRequest, await readBody());
    client = await r.integrationClients.first({ where: { clientId: input.client_id } });
    const ok = client && !client.revokedAt && (await sha256Hex(input.client_secret)) === client.secretHash;
    if (!ok || !client) throw new ApiProblem(401, 'invalid_client', 'Неверный client_id или client_secret, либо ключ отозван');
    const granted: string[] = client.scopes;
    const requested = input.scope ? input.scope.split(/\s+/).filter(Boolean) : client.scopes;
    const scopes = requested.filter((s) => granted.includes(s));
    if (!scopes.length) throw new ApiProblem(400, 'invalid_scope', 'Запрошенные области доступа не выданы этому ключу');
    const token = randomToken(32);
    await r.accessTokens.removeWhere({ expiresAt: { lte: ctx.now() } });
    await r.accessTokens.insert({ tokenHash: await sha256Hex(token), clientRowId: client.id, scopes, expiresAt: ctx.now() + ACCESS_TOKEN_TTL_SEC * 1000 });
    await r.integrationClients.update(client.id, { lastUsedAt: tzIso(ctx.now()) });
    const body = tokenResponse.parse({ access_token: token, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_SEC, scope: scopes.join(' ') });
    return { status: 200, json: body, headers: { 'X-Request-Id': requestId, 'Cache-Control': 'no-store' } };
  } catch (e) {
    const res = problemResult(e, requestId);
    status = res.status;
    return res;
  } finally {
    if (client) await logCall(ctx, client, 'POST', '/oauth/token', status, startedAt);
  }
}

// ---------------------------------------------------------------- views and lists

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

/** Cursor pages: the cursor is the base64 offset. */
export function page<T>(items: T[], cursor: string | undefined, limit: number): { items: T[]; nextCursor: string | null } {
  const offset = cursor && /^\d+$/.test(atob(cursor)) ? Number(atob(cursor)) : 0;
  const slice = items.slice(offset, offset + limit);
  return { items: slice, nextCursor: offset + limit < items.length ? btoa(String(offset + limit)) : null };
}

// ---------------------------------------------------------------- endpoints (clinic keys)

export async function coverageCheck({ ctx, actor }: ApiCall, body: unknown): Promise<{ body: CoverageCheckResult }> {
  const input = validate(coverageCheckRequest, body);
  const result = await checkPatient(ctx, input, actor, 'api');
  await pushEvent(ctx, actor.clinicId, 'МИС проверила пациента, открыт визит');
  return { body: result };
}

export async function getVisit({ ctx, actor }: ApiCall, visitId: UUID): Promise<{ body: Visit }> {
  return { body: await requireVisit(ctx, actor.clinicId, visitId) };
}

export async function listAppointments({ ctx, actor }: ApiCall, qs: URLSearchParams): Promise<ApiOutput> {
  const q = validate(appointmentQuery, Object.fromEntries(qs));
  const list = (await ctx.repos.appointments.list({ where: { clinicId: actor.clinicId } }))
    .filter((a) => !q.status || a.status === q.status)
    .filter((a) => !q.from || isoDay(parseIso(a.startsAt)) >= q.from)
    .filter((a) => !q.to || isoDay(parseIso(a.startsAt)) <= q.to)
    .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))
    .map(toIntegrationAppointment);
  return { body: page(list, q.cursor, q.limit) };
}

/** confirm / reschedule / decline a request of a patient from the MIS. */
export async function answerAppointment({ ctx, actor }: ApiCall, kind: 'confirm' | 'reschedule' | 'decline', id: UUID, body: unknown): Promise<ApiOutput> {
  const a = await appointmentOfClinic(ctx, actor.clinicId, id);
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
export async function putSlots({ ctx, actor }: ApiCall, body: unknown): Promise<ApiOutput> {
  const { slots } = validate(slotsPutRequest, body);
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

export async function requestGuarantee({ ctx, actor }: ApiCall, body: unknown): Promise<{ status: number; body: GuaranteeLetter }> {
  const input = validate(guaranteeCreateRequest, body);
  return { status: 201, body: await toGuaranteeLetter(ctx, await createGuarantee(ctx, actor, input, actor.displayName)) };
}

export async function getGuarantee({ ctx, actor }: ApiCall, id: UUID): Promise<{ body: GuaranteeLetter }> {
  const g = await ctx.repos.guarantees.first({ where: { id, clinicId: actor.clinicId } });
  if (!g) throw notFoundProblem();
  return { body: await toGuaranteeLetter(ctx, g) };
}

/** Documents for a letter; with a comment (3+ characters) an «нужны документы» letter goes back to review. */
export async function guaranteeDocuments({ ctx, actor }: ApiCall, id: UUID, form: { comment: string | null; files: readonly UploadedFile[] } | null): Promise<{ body: GuaranteeLetter }> {
  const g = await ctx.repos.guarantees.first({ where: { id, clinicId: actor.clinicId } });
  if (!g) throw notFoundProblem();
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
export async function createRegistry({ ctx, actor }: ApiCall, body: unknown): Promise<{ status: number; body: Registry }> {
  const input = validate(registryCreateRequest, body);
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

export async function getRegistry({ ctx, actor }: ApiCall, id: UUID): Promise<{ body: Registry }> {
  return { body: await registryOfClinic(ctx, actor.clinicId, id) };
}

export async function disputeRegistryLine({ ctx, actor }: ApiCall, id: UUID, lineId: UUID, body: unknown): Promise<{ body: Registry }> {
  const r = await registryOfClinic(ctx, actor.clinicId, id);
  await disputeLine(ctx, r, lineId, body);
  return { body: r };
}

export async function payments({ ctx, actor }: ApiCall, qs: URLSearchParams): Promise<ApiOutput> {
  const period = qs.get('period');
  const items = (await ctx.repos.registries.list({ where: { clinicId: actor.clinicId, status: 'paid' } }))
    .filter((r) => !period || r.period === period)
    .sort((a, b) => (a.period < b.period ? 1 : -1))
    .map((r) => ({ registryId: r.id, period: r.period, amount: r.totals.paid, paidAt: r.paidAt! }));
  return { body: page(items, qs.get('cursor') ?? undefined, Math.min(100, Number(qs.get('limit')) || 50)) };
}
