/*
 * Test support of the API: the database fixture (the seed loaded for a chosen «now»), an in-process adapter of
 * the route table over the memory repositories (the conformance test's reference), and one request interface
 * over both (memory and the Fastify app) so the same scenario runs on each.
 */
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { DEMO_CODE, DEMO_PASSWORD } from '@mig/domain/auth/demo';
import { routeRequest } from '@mig/domain/http/request';
import { ROUTES, signedInBody, type RawResult, type RouteDef, type RouteDeps } from '@mig/domain/http/routes';
import { CSRF_HEADER, CSRF_VALUE, hasCsrfHeader, needsCsrf, readCookie } from '@mig/domain/http/csrf';
import { runApiCall, TEST_IP_HEADER } from '@mig/domain/services/integrationKit';
import { DomainError, type BaseCtx } from '@mig/domain/services/kernel';
import { resolveSession } from '@mig/domain/services/session';
import type { Db } from '@mig/domain/store/db';
import { memoryRepos } from '@mig/domain/store/memory';
import { loadSeed } from '../jobs/seedLoad';
import { createMockProvider } from '@mig/domain/lib/aiProvider';
import { createHelpProvider, helpDir } from '../help';

export const DATABASE_URL = process.env.DATABASE_URL ?? '';
/** The suites that need Postgres are skipped without DATABASE_URL (they run in the CI job `api`). */
export const hasDb = DATABASE_URL !== '';

export function testPool(): pg.Pool {
  return new pg.Pool({ connectionString: DATABASE_URL, max: 4, application_name: 'mig-api-test' });
}

/** The seed loader (jobs/seedLoad.ts) the suites use for their own «now». */
export { loadSeed };

/** The dependencies both sides of a comparison share. */
export function testDeps(): RouteDeps {
  return {
    aiProvider: () => createMockProvider({ latency: false }),
    help: createHelpProvider(helpDir(), false) as RouteDeps['help'],
    receiptPng: async () => new Uint8Array([137, 80, 78, 71]),
    invitePassword: DEMO_PASSWORD,
  };
}

export interface Answer {
  status: number;
  contentType: string;
  /** Response headers (lower-case names; `set-cookie` as a list). */
  headers: Record<string, string | string[]>;
  /** Parsed JSON, or the text of anything else. */
  body: unknown;
  text: string;
}

export interface CallOptions {
  body?: unknown;
  /** A raw body (text, CSV, a serialized multipart form) with its content type. */
  raw?: { contentType: string; text: string | Uint8Array };
  headers?: Record<string, string>;
  session?: string;
  /** Leave out the CSRF header of mutating requests (the Fastify client adds it by default). */
  noCsrf?: boolean;
}

/** One request interface over an adapter. */
export interface Client {
  call(method: string, path: string, o?: CallOptions): Promise<Answer>;
}

function answerOf(status: number, contentType: string, text: string, headers: Record<string, string | string[]> = {}): Answer {
  let body: unknown = text;
  if (contentType.includes('json') && text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status, contentType, body, text, headers };
}

/** The session cookie a client presents: the BFF's `__Host-mig_session` or `mig_session` (the mock, the demo fixture). */
export type SessionAs = { cookie: string };
const DEMO_COOKIE: SessionAs = { cookie: 'mig_session' };

function headersOf(o: CallOptions, as: SessionAs = DEMO_COOKIE): Record<string, string> {
  const h: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.session) h.cookie = [h.cookie, `${as.cookie}=${o.session}`].filter(Boolean).join('; ');
  if (o.raw) h['content-type'] = o.raw.contentType;
  else if (o.body !== undefined) h['content-type'] = 'application/json';
  return h;
}

const bodyOf = (o: CallOptions): string | Uint8Array | undefined => (o.raw ? o.raw.text : o.body !== undefined ? JSON.stringify(o.body) : undefined);

/** A multipart form serialized once (the same bytes and boundary for both sides of a comparison). */
export async function multipart(form: FormData): Promise<{ contentType: string; text: Uint8Array }> {
  const r = new Response(form);
  return { contentType: r.headers.get('content-type') ?? '', text: new Uint8Array(await r.arrayBuffer()) };
}

/** The Fastify app through `inject`; mutating requests carry the CSRF header of the web app unless `noCsrf`. */
export function fastifyClient(app: FastifyInstance, as: SessionAs = DEMO_COOKIE): Client {
  return {
    async call(method, path, o = {}) {
      const body = bodyOf(o);
      const payload = body instanceof Uint8Array ? Buffer.from(body) : body;
      const headers = headersOf(o, as);
      if (method !== 'GET' && !o.noCsrf) headers['x-requested-with'] = 'mig-web';
      const r = await app.inject({ method: method as 'GET', url: path.startsWith('/api/') ? path : `/api${path}`, headers, ...(payload !== undefined ? { payload } : {}) });
      return answerOf(r.statusCode, String(r.headers['content-type'] ?? ''), r.body, r.headers as Record<string, string | string[]>);
    },
  };
}

/** The value of a `Set-Cookie` of an answer (null when the cookie is not set). */
export function cookieOf(a: Answer, name: string): string | null {
  const all = a.headers['set-cookie'];
  for (const c of Array.isArray(all) ? all : all ? [all] : []) {
    const m = new RegExp(`^${name.replace(/[-]/g, '\\-')}=([^;]*)`).exec(c);
    if (m) return m[1] ?? '';
  }
  return null;
}

const compiled = ROUTES.map((r) => ({ r, re: new RegExp(`^${r.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`) }));

function match(method: string, pathname: string): { r: RouteDef; params: Record<string, string> } | null {
  for (const { r, re } of compiled) {
    if (r.method !== method) continue;
    const m = re.exec(pathname);
    if (m) return { r, params: Object.fromEntries(Object.entries(m.groups ?? {}).map(([k, v]) => [k, decodeURIComponent(v)])) };
  }
  return null;
}

/** The route table over the memory repositories, in process (what the MSW adapter does, minus MSW). */
export function memoryClient(db: Db, deps: RouteDeps, now: () => number): Client {
  const base = (): BaseCtx => ({ repos: memoryRepos(() => db), now, env: { demo: false } });
  const json = (status: number, v: unknown): Answer => answerOf(status, 'application/json', v === undefined ? '' : JSON.stringify(v));
  const raw = (r: RawResult): Answer => answerOf(r.status, r.headers['Content-Type'] ?? '', r.body === null ? '' : typeof r.body === 'string' ? r.body : new TextDecoder().decode(r.body));
  return {
    async call(method, path, o = {}) {
      const url = new URL(`http://api.local/api${path}`);
      const found = match(method, url.pathname.slice(4));
      const body = bodyOf(o);
      const headers = headersOf(o);
      if (method !== 'GET' && !o.noCsrf) headers[CSRF_HEADER] = CSRF_VALUE;
      const request = new Request(url, { method, headers, ...(body !== undefined ? { body: body as NonNullable<RequestInit['body']> } : {}) });
      if (!found) return json(404, { code: 'not_found', key: 'errors.notFound' });
      const { r, params } = found;
      if (needsCsrf(r) && !hasCsrfHeader(request.headers)) return json(403, { code: 'forbidden', key: 'errors.csrf' });
      const startedAt = now();
      const req = routeRequest(request, params, startedAt);
      if (r.auth === 'partner') {
        const a = await runApiCall(
          base(),
          r.spec,
          {
            path: url.pathname,
            params,
            query: req.query,
            authorization: req.header('authorization'),
            ip: req.header(TEST_IP_HEADER),
            idempotencyKey: req.header('Idempotency-Key'),
            bodyText: await req.text(),
            startedAt,
          },
          (c) => r.call(c, req),
        );
        return raw(a);
      }
      const sid = readCookie(req.header('cookie'), DEMO_COOKIE.cookie);
      const session = () => resolveSession(base(), sid, { background: req.header('X-Background') === '1' });
      try {
        const out = r.auth === 'none' ? await r.call(base(), req, deps, session) : await r.call(await session(), req, deps);
        if (r.session === 'start') {
          const { sessionId, body: user } = signedInBody(out);
          return { ...json(200, user), headers: { 'set-cookie': [`${DEMO_COOKIE.cookie}=${sessionId}; Path=/; HttpOnly; SameSite=Strict`] } };
        }
        if (r.result === 'raw') return raw(out as RawResult);
        if (out === undefined) return answerOf(204, '', '');
        return json(r.result === 201 ? 201 : 200, out);
      } catch (e) {
        if (e instanceof DomainError) return json(e.status, e.body());
        return json(500, { code: 'server', key: 'errors.internal' });
      }
    },
  };
}

export type Who = { email: string } | { phone: string };

/**
 * Signs in (password or phone, then the demo code) and returns the value of the session cookie `cookie` (the BFF's
 * `__Host-mig_session`; `mig_session` of the demo fixture and the memory reference by default).
 */
export async function signIn(c: Client, who: Who, cookie: string = DEMO_COOKIE.cookie): Promise<string> {
  const start = 'email' in who ? await c.call('POST', '/auth/login', { body: { email: who.email, password: DEMO_PASSWORD } }) : await c.call('POST', '/auth/phone', { body: { phone: who.phone } });
  if (start.status !== 200) throw new Error(`sign-in failed: ${start.status} ${start.text}`);
  const { challengeId } = start.body as { challengeId: string };
  const done = await c.call('POST', 'email' in who ? '/auth/otp' : '/auth/phone/verify', { body: { challengeId, code: DEMO_CODE } });
  if (done.status !== 200) throw new Error(`code failed: ${done.status} ${done.text}`);
  const v = cookieOf(done, cookie);
  if (!v) throw new Error('no session cookie');
  return v;
}
