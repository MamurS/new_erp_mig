/*
 * The MSW adapter's plumbing (the routes themselves are the shared table, packages/domain/src/http/routes.ts,
 * turned into MSW handlers by ./handlers/index.ts): the service context over the in-memory database, the
 * session of a request, latency, failure injection, error mapping and persistence.
 */
import { delay, HttpResponse, type DefaultBodyType, type HttpResponseResolver, type PathParams } from 'msw';
import type { ApiError } from '@mig/contracts';
import { db } from './db';
import { mockConfig } from './config';
import { saveSessions, scheduleSaveDb } from './persist';
import { DomainError as HttpError, type AuthCtx, type BaseCtx } from '@mig/domain/services/kernel';
import { resolveSession } from '@mig/domain/services/session';
import { memoryRepos } from '@mig/domain/store/memory';
import { routeRequest } from '@mig/domain/http/request';

// The mock answers only at the API address. A pattern with any prefix before /api would also catch
// the dev server's own modules (/src/shared/api/queries/params.ts) and answer them with a 404.
function apiBase(): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api';
  if (/^https?:\/\//.test(base)) return base.replace(/\/$/, '');
  return typeof location !== 'undefined' ? `${location.origin}${base}` : `*${base}`;
}
export const API = apiBase();

// Errors, validation and list helpers are shared with the API server (packages/domain/src/services).
export { DomainError as HttpError, unauthorized, forbidden, notFound, conflict, messageKey, errorOf as httpErrorOf, validate } from '@mig/domain/services/kernel';

export function errorResponse(e: HttpError): Response {
  return HttpResponse.json(e.body(), { status: e.status });
}

// ---------- the service adapter ----------
/** The repositories over the in-memory database (the same services run on Postgres in the API). */
export const repos = memoryRepos(db);

export function baseCtx(): BaseCtx {
  return { repos, now: () => Date.now(), env: { demo: import.meta.env.VITE_DEMO_MODE === 'true' } };
}

function bearer(request: Request): string | null {
  const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(request.headers.get('authorization') ?? '');
  return m?.[1] ?? null;
}

/** The signed-in person of the request (401 otherwise), as the services' context. */
export function authCtx(request: Request): Promise<AuthCtx> {
  return resolveSession(baseCtx(), bearer(request), { background: request.headers.get('X-Background') === '1' });
}

export interface Ctx {
  request: Request;
  params: PathParams;
  url: URL;
  /** When the request arrived (before the simulated latency). */
  startedAt: number;
}

function isMutation(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

/**
 * Wraps a handler with latency, failure injection, error mapping and persistence.
 * `noFailures`: the simulated 500s never hit this route (the demo controls themselves).
 * `writes`: a GET that changes data, persisted like a mutation.
 */
export function route(
  fn: (ctx: Ctx) => Promise<unknown> | unknown,
  opts: { noFailures?: boolean; writes?: boolean } = {},
): HttpResponseResolver<PathParams, DefaultBodyType, DefaultBodyType> {
  return async ({ request, params }) => {
    const startedAt = Date.now();
    const [lo, hi] = mockConfig.latency;
    if (hi > 0) await delay(lo + Math.floor(Math.random() * (hi - lo)));
    const url = new URL(request.url);
    if (mockConfig.failures && !opts.noFailures && Math.random() < 0.1) {
      return HttpResponse.json(
        { code: 'server', key: 'errors.server' } satisfies ApiError,
        { status: 500 },
      );
    }
    try {
      const out = await fn({ request, params, url, startedAt });
      if (out instanceof Response) return out;
      if (out === undefined) return new HttpResponse(null, { status: 204 });
      return HttpResponse.json(out as DefaultBodyType);
    } catch (e) {
      if (e instanceof HttpError) return errorResponse(e);
      return HttpResponse.json(
        { code: 'server', key: 'errors.internal' } satisfies ApiError,
        { status: 500 },
      );
    } finally {
      const d = db();
      saveSessions(d);
      if (isMutation(request.method) || opts.writes) scheduleSaveDb(db);
    }
  };
}

// ---------- request body ----------
/** The JSON body with the route table's rules (mock-only demo endpoints). */
export function readJson(request: Request): Promise<unknown> {
  return routeRequest(request, {}).json();
}
