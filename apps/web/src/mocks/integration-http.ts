/*
 * MSW plumbing of the partner API (/api/integration/v1): the pipeline itself (bearer tokens, scopes,
 * rate limit, idempotency, problem+json, call log) is the service `runApi`
 * (packages/domain/src/services/integration.ts). This adapter reads the headers, simulates latency,
 * turns the ApiResult into a Response and persists the in-memory database, like `route` in http.ts.
 */
import { delay, HttpResponse, type PathParams } from 'msw';
import type { IntegrationScope, PartnerType } from '@mig/contracts';
import type { ZodTypeAny } from 'zod';
import { ApiProblem, runApi, type ApiCall, type ApiOutput, type ApiResult } from '@mig/domain/services/integration';
import { db, type Db } from './db';
import { API, baseCtx } from './http';
import { mockConfig } from './config';
import { saveSessions, scheduleSaveDb } from './persist';

export const BASE = `${API}/integration/v1`;

/** Header used only by tests and the sandbox to stand for the caller's IP (CLINIC_SPEC §6.2). */
export const TEST_IP_HEADER = 'X-Test-Client-IP';

export interface ApiCtx extends ApiCall {
  request: Request;
  params: PathParams;
  url: URL;
  /** @deprecated The in-memory database, only for the handlers not yet ported to services (integration-assistance.ts). */
  d: Db;
}

export type Handler = (ctx: ApiCtx) => Promise<ApiOutput> | ApiOutput;

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

export function toResponse(r: ApiResult): Response {
  if (r.text !== undefined) return new HttpResponse(r.text, { status: r.status, headers: r.headers });
  return HttpResponse.json(r.json as never, { status: r.status, headers: r.headers });
}

/** Persists what the call changed (mock only). */
export function persist(): void {
  saveSessions(db());
  scheduleSaveDb(db);
}

export function apiRoute(method: 'GET' | 'POST' | 'PUT' | 'PATCH', template: string, scope: IntegrationScope, response: ZodTypeAny | null, fn: Handler, partner: PartnerType = 'clinic') {
  return async ({ request, params }: { request: Request; params: PathParams }) => {
    const startedAt = Date.now();
    const [lo, hi] = mockConfig.latency;
    if (hi > 0) await delay(lo + Math.floor(Math.random() * (hi - lo)));
    const url = new URL(request.url);
    try {
      const result = await runApi(
        baseCtx(),
        { method, template, scope, response, partner },
        { authorization: request.headers.get('authorization'), ip: request.headers.get(TEST_IP_HEADER), idempotencyKey: request.headers.get('Idempotency-Key'), pathname: url.pathname, startedAt },
        (call) => fn({ ...call, request, params, url, d: db() }),
      );
      return toResponse(result);
    } finally {
      persist();
    }
  };
}
