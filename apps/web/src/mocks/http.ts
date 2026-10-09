/*
 * The MSW adapter's plumbing (the routes themselves are the shared table, packages/domain/src/http/routes.ts,
 * turned into MSW handlers by ./handlers/index.ts): the service context over the in-memory database, the
 * session of a request, latency, failure injection, error mapping and persistence.
 */
import { delay, HttpResponse, type DefaultBodyType, type HttpResponseResolver, type PathParams } from 'msw';
import type { ApiError } from '@mig/contracts';
import { db } from './db';
import { mockConfig } from './config';
import { mockCookie, saveSessions, scheduleSaveDb, setMockCookie } from './persist';
import { DomainError as HttpError, type AuthCtx, type BaseCtx } from '@mig/domain/services/kernel';
import { resolveSession } from '@mig/domain/services/session';
import { edoEvents, timeClocks } from '@mig/domain/services/lifecycle';
import { sweepDeadlines } from '@mig/domain/services/tasks';
import { sendInvitations } from '@mig/domain/services/system/invitations';
import { mailBaseUrl, mockMailer } from './outbox';
import { memoryRepos } from '@mig/domain/store/memory';
import { routeRequest } from '@mig/domain/http/request';
import { hasCsrfHeader, readCookie } from '@mig/domain/http/csrf';

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

// ---------- the session cookie ----------
/*
 * The same scheme as the API (BACKEND_SPEC §7): the session is a cookie the page's code never sees; the answers of
 * /auth/* carry no session id. The name is the API's local-development cookie (the API itself uses `__Host-…`).
 *
 * - In the browser (and the component tests, `createMockServer({ cookieJar: true })`) the «cookie» is kept on the
 *   mock server's side (persist.ts: mockCookie) — a mocked Set-Cookie would land in document.cookie and MSW's
 *   localStorage store, readable by the page.
 * - In the mock's own tests the mock answers `Set-Cookie: mig_session=…; HttpOnly` and reads the request's `Cookie`
 *   header (its first `mig_session`), so a test can hold several sessions at once, like an HTTP client of the API.
 */
export const MOCK_SESSION_COOKIE = 'mig_session';
let cookieJar = false;

/** The browser's cookie jar on the mock's side (the service worker in the page; component tests). */
export function enableCookieJar(on: boolean): void {
  cookieJar = on;
}

function sessionIdOf(request: Request): string | null {
  return readCookie(request.headers.get('cookie'), MOCK_SESSION_COOKIE) ?? (cookieJar ? mockCookie() : null);
}

/** A sign-in completed: the session cookie for `sessionId` (headers of the answer; none with the jar). */
export function startSession(sessionId: string): Record<string, string> {
  if (cookieJar) {
    setMockCookie(sessionId);
    return {};
  }
  return { 'Set-Cookie': `${MOCK_SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Strict` };
}

/** A logout: the cookie goes (headers of the answer; none with the jar). */
export function endSession(request: Request): Record<string, string> {
  if (cookieJar) {
    setMockCookie(null);
    return {};
  }
  return readCookie(request.headers.get('cookie'), MOCK_SESSION_COOKIE) ? { 'Set-Cookie': `${MOCK_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` } : {};
}

/** The signed-in person of the request (401 otherwise), as the services' context. */
export function authCtx(request: Request): Promise<AuthCtx> {
  return resolveSession(baseCtx(), sessionIdOf(request), { background: request.headers.get('X-Background') === '1' });
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

/*
 * The date clocks (contracts coming into force and expiring, policies, guarantee letters, invoice statuses; deadlines
 * of requests) are background jobs in the API (services/jobs.ts `contract-lifecycle`, `task-deadlines`); reads show
 * the stored state. The mock has no scheduler: before a request it polls EDO, sweeps deadlines and sends invitation
 * e-mails (the API's worker does on every pass), and runs the date clocks once the clock moved by a minute or more —
 * also after a jump of the page's clock (e2e `fastForward`), as the API's demo clock runs the job on a jump.
 */
let clocksAt: number | null = null;
async function runDueClocks(): Promise<boolean> {
  // The EDO operator is polled before every request, as the API's worker polls it every pass; deadlines of requests
  // («Завтра срок», «Просрочен», the API's job `task-deadlines`) are swept too: in memory it costs nothing and a
  // deadline moved by a test is noticed at once.
  const signed = (await edoEvents(baseCtx())) > 0;
  await sweepDeadlines(baseCtx());
  // Invitation e-mails (the API's worker sends them on every pass) go to the mock's outbox.
  const mailed = (await sendInvitations(baseCtx(), mockMailer, mailBaseUrl())).sent > 0;
  const now = Date.now();
  if (clocksAt !== null && now >= clocksAt && now - clocksAt < 60_000) return signed || mailed;
  clocksAt = now;
  await timeClocks(baseCtx());
  return true;
}

/**
 * Wraps a handler with latency, the CSRF rule, failure injection, error mapping and persistence.
 * `csrf`: the request must carry `X-Requested-With: mig-web` (403 otherwise), as on the API.
 * `noFailures`: the simulated 500s never hit this route (the demo controls themselves).
 * `writes`: a GET that changes data, persisted like a mutation.
 */
export function route(
  fn: (ctx: Ctx) => Promise<unknown> | unknown,
  opts: { csrf?: boolean; noFailures?: boolean; writes?: boolean } = {},
): HttpResponseResolver<PathParams, DefaultBodyType, DefaultBodyType> {
  return async ({ request, params }) => {
    const startedAt = Date.now();
    const [lo, hi] = mockConfig.latency;
    if (hi > 0) await delay(lo + Math.floor(Math.random() * (hi - lo)));
    const url = new URL(request.url);
    if (opts.csrf && !hasCsrfHeader(request.headers)) return errorResponse(new HttpError(403, 'forbidden', 'errors.csrf'));
    if (mockConfig.failures && !opts.noFailures && Math.random() < 0.1) {
      return HttpResponse.json(
        { code: 'server', key: 'errors.server' } satisfies ApiError,
        { status: 500 },
      );
    }
    let clocked = false;
    try {
      clocked = await runDueClocks();
      const out = await fn({ request, params, url, startedAt });
      if (out instanceof Response) return out;
      if (out === undefined) return new HttpResponse(null, { status: 204 });
      return HttpResponse.json(out as DefaultBodyType);
    } catch (e) {
      // A 401 leaves the «cookie» alone: a dead id is harmless, and clearing it could hit a session started since.
      if (e instanceof HttpError) return errorResponse(e);
      return HttpResponse.json(
        { code: 'server', key: 'errors.internal' } satisfies ApiError,
        { status: 500 },
      );
    } finally {
      const d = db();
      saveSessions(d);
      if (isMutation(request.method) || opts.writes || clocked) scheduleSaveDb(db);
    }
  };
}

// ---------- request body ----------
/** The JSON body with the route table's rules (mock-only demo endpoints). */
export function readJson(request: Request): Promise<unknown> {
  return routeRequest(request, {}).json();
}
