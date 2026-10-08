/*
 * The partner integration API's framework as a service (CLINIC_SPEC §6, ASSISTANCE_SPEC §8): OAuth bearer
 * tokens, partner type and scopes of the key, IP allowlist, 60 requests/min per key, Idempotency-Key for
 * POST, RFC 9457 problem+json errors, the call log (path templates only). An adapter passes the raw request
 * parts (`ApiInput`) and turns the `ApiAnswer` into an HTTP response; nothing here knows about HTTP objects.
 */
import type { ZodTypeAny } from 'zod';
import type { Appointment, IntegrationScope, PartnerType, Role, UUID } from '@mig/contracts';
import { integrationAppointment, type Problem } from '@mig/contracts/integration';
import { hasKey, translate, unpack, type I18nKey } from '@mig/i18n';
import { API_RATE_PER_MINUTE, IDEMPOTENCY_TTL_MS } from '../clinics';
import { randomId } from '../lib/random';
import { tzIso } from '../lib/time';
import { sha256Hex } from '../lib/webhook';
import type { IntegrationClientRow } from '../store/db';
import { audit, conflict, DomainError, type BaseCtx } from './kernel';
import { pushEvent } from './clinic';

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

/** An error of the partner API: a problem+json answer (the partner API is not localized: Russian text). */
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

export function problemOf(e: unknown): ApiProblem {
  if (e instanceof ApiProblem) return e;
  if (e instanceof DomainError) {
    // The partner API is not localized: problem details are in Russian (the default locale).
    const fields = e.fields ? Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k, ruText(v)])) : undefined;
    return new ApiProblem(e.status, e.code, translate('ru', e.key, e.params), fields);
  }
  return new ApiProblem(500, 'server', 'Внутренняя ошибка сервера');
}

/** What an HTTP adapter sends back. */
export interface ApiAnswer {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export function problemAnswer(p: ApiProblem, requestId: string): ApiAnswer {
  const body: Problem = {
    type: `https://mig.uz/problems/${p.slug}`,
    title: TITLES[p.status] ?? 'Error',
    status: p.status,
    detail: p.message,
    ...(p.errors ? { errors: p.errors } : {}),
  };
  return { status: p.status, headers: { 'Content-Type': 'application/problem+json', 'X-Request-Id': requestId, ...p.headers }, body: JSON.stringify(body) };
}

export const apiNotFound = () => new ApiProblem(404, 'not_found', 'Не найдено');

/** Header used only by tests and the sandbox to stand for the caller's IP (CLINIC_SPEC §6.2). */
export const TEST_IP_HEADER = 'X-Test-Client-IP';

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

/** Raw parts of a partner API request, as the adapter read them. */
export interface ApiInput {
  /** URL path (the idempotency key includes it). */
  path: string;
  params: Readonly<Record<string, string | readonly string[] | undefined>>;
  query: URLSearchParams;
  authorization: string | null;
  /** The caller's IP (TEST_IP_HEADER in the mock). */
  ip: string | null;
  idempotencyKey: string | null;
  /** The request body as text ('' when there is none). */
  bodyText: string;
}

/** What an endpoint of the partner API gets: the storage, the key that called and the request. */
export interface ApiCallCtx extends BaseCtx {
  client: IntegrationClientRow;
  input: ApiInput;
  query: URLSearchParams;
  /** The JSON body (400/413 problems otherwise); read only when the endpoint needs it. */
  json(): unknown;
  /** A UUID path parameter; anything else is 404. */
  pathParam(key: string): string;
}

export type ApiHandler = (c: ApiCallCtx) => Promise<{ status?: number; body: unknown }>;

export interface ApiSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  /** Path template for the log (no ids). */
  template: string;
  scope: IntegrationScope;
  /** Contract of the success body (a mismatch is a 500). */
  response: ZodTypeAny | null;
  partner: PartnerType;
}

export function pathParamOf(params: ApiInput['params'], key: string): string {
  const v = params[key];
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw apiNotFound();
  return v;
}

export function parseJsonBody(text: string): unknown {
  if (text.length > 5_000_000) throw new ApiProblem(413, 'too_large', 'Слишком большой запрос');
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new ApiProblem(400, 'invalid_json', 'Некорректный JSON');
  }
}

/** Keeps the newest `max` rows of the call log. */
async function trimLogs(ctx: BaseCtx, max: number): Promise<void> {
  const extra = await ctx.repos.apiLogs.list({ offset: max });
  if (extra.length) await ctx.repos.apiLogs.removeWhere({ id: { in: extra.map((r) => r.id) } });
}

/** Runs one partner API call: authentication, checks, idempotency, the endpoint and the log. Never throws. */
export async function runApiCall(ctx: BaseCtx, spec: ApiSpec, input: ApiInput, fn: ApiHandler): Promise<ApiAnswer> {
  const r = ctx.repos;
  const requestId = randomId();
  const started = ctx.now();
  let client: IntegrationClientRow | null = null;
  let status = 500;
  try {
    const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(input.authorization ?? '');
    if (!m) throw new ApiProblem(401, 'invalid_token', 'Нужен заголовок Authorization: Bearer <access_token>', undefined, { 'WWW-Authenticate': 'Bearer' });
    const hash = await sha256Hex(m[1]!);
    const stored = await r.accessTokens.get(hash);
    const token = stored && stored.expiresAt > ctx.now() ? stored : null;
    client = token ? await r.integrationClients.get(token.clientRowId) : null;
    if (!token || !client || client.revokedAt) {
      client = null;
      throw new ApiProblem(401, 'invalid_token', 'Токен недействителен, истёк или ключ отозван', undefined, { 'WWW-Authenticate': 'Bearer error="invalid_token"' });
    }
    // Keys belong to a partner: clinic methods are closed to assistance keys and vice versa.
    if ((client.partnerType ?? 'clinic') !== spec.partner) throw new ApiProblem(403, 'wrong_partner', 'Метод недоступен ключу этого типа партнёра');
    if (!token.scopes.includes(spec.scope)) throw new ApiProblem(403, 'insufficient_scope', `Нужна область доступа ${spec.scope}`);
    if (!ipAllowed(client.ipAllowlist, input.ip)) throw new ApiProblem(403, 'ip_not_allowed', 'Запрос с адреса, которого нет в списке разрешённых');
    const now = ctx.now();
    await r.apiCalls.removeWhere({ at: { lte: now - 60_000 } });
    const recent = await r.apiCalls.list({ where: { clientRowId: client.id } });
    if (recent.length >= API_RATE_PER_MINUTE) {
      const retry = Math.max(1, Math.ceil((recent[0]!.at + 60_000 - now) / 1000));
      throw new ApiProblem(429, 'rate_limited', `Не больше ${API_RATE_PER_MINUTE} запросов в минуту на ключ`, undefined, { 'Retry-After': String(retry) });
    }
    await r.apiCalls.insert({ clientRowId: client.id, at: now });
    client = await r.integrationClients.update(client.id, { lastUsedAt: tzIso(now) });

    const idemKey = spec.method === 'POST' && input.idempotencyKey ? `${client.id}|${spec.method}|${input.path}|${input.idempotencyKey.slice(0, 128)}` : null;
    if (idemKey) {
      await r.idempotency.removeWhere({ at: { lte: now - IDEMPOTENCY_TTL_MS } });
      const prev = await r.idempotency.get(idemKey);
      if (prev) {
        status = prev.status;
        return { status: prev.status, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId, 'Idempotency-Replayed': 'true' }, body: prev.body };
      }
    }
    const callCtx: ApiCallCtx = {
      ...ctx,
      client,
      input,
      query: input.query,
      json: () => parseJsonBody(input.bodyText),
      pathParam: (key) => pathParamOf(input.params, key),
    };
    const out = await fn(callCtx);
    if (spec.response) {
      const check = spec.response.safeParse(out.body);
      if (!check.success) throw new Error('Response does not match the contract');
    }
    status = out.status ?? 200;
    const bodyText = JSON.stringify(out.body);
    if (idemKey) await r.idempotency.insert({ key: idemKey, status, body: bodyText, at: now });
    return { status, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId }, body: bodyText };
  } catch (e) {
    const p = problemOf(e);
    status = p.status;
    return problemAnswer(p, requestId);
  } finally {
    if (client) {
      await r.apiLogs.insert(
        {
          id: randomId(),
          clinicId: client.clinicId,
          clientId: client.clientId,
          at: tzIso(started),
          method: spec.method,
          pathTemplate: spec.template,
          status,
          latencyMs: ctx.now() - started,
        },
        { at: 'start' },
      );
      await trimLogs(ctx, 2000);
    }
  }
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

/** Cursor pages of the partner API (the cursor is the offset, base64). */
export function page<T>(items: T[], cursor: string | undefined, limit: number): { items: T[]; nextCursor: string | null } {
  const offset = cursor && /^\d+$/.test(atob(cursor)) ? Number(atob(cursor)) : 0;
  const slice = items.slice(offset, offset + limit);
  return { items: slice, nextCursor: offset + limit < items.length ? btoa(String(offset + limit)) : null };
}

/** Revokes an API key of a partner: issued tokens stop working at once. Returns the saved key. */
export async function revokeKey(ctx: BaseCtx, k: IntegrationClientRow, actor: { id: UUID; displayName: string; role: Role; assistanceId?: UUID }): Promise<IntegrationClientRow> {
  if (k.revokedAt) throw conflict('srv.apiKeys.alreadyRevoked');
  const saved = await ctx.repos.integrationClients.update(k.id, { revokedAt: tzIso(ctx.now()) });
  // Already issued tokens stop working immediately.
  await ctx.repos.accessTokens.removeWhere({ clientRowId: k.id });
  await audit(ctx, actor, 'integration_key_revoked', { targetType: 'integration', targetId: k.id, targetLabel: k.name });
  await pushEvent(ctx, k.clinicId, `Ключ API «${k.name}» отозван`);
  return saved;
}
