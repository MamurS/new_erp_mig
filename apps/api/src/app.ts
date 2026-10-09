/*
 * The Fastify adapter (BACKEND_SPEC §4.3): every route of the shared table (packages/domain/src/http/routes.ts)
 * is registered here, the request is read by the same reader as in the mock (a Fetch `Request` built from the
 * raw body), the service runs with Postgres repositories inside one request transaction with row-level
 * security (db.ts), and results and DomainErrors become the same HTTP answers as in the mock.
 *
 * Around the table (BACKEND_SPEC §7, §8):
 * - who the person is and how sign-in works comes from the `AuthAdapter` (sessions.ts: Supabase Auth with BFF
 *   cookie sessions in the deployment), which also answers the sign-in routes of the table itself;
 * - CSRF: every mutating request of the portals must carry `X-Requested-With: mig-web` (403 otherwise); the
 *   partner API (its own bearer tokens) and the signed Supabase hook are not cookie-authenticated and exempt;
 * - API-only routes: `POST /api/hooks/send-sms` (Supabase Auth → SMS adapter), `GET /api/files/:id/link` (a
 *   60-second signed link after the same rights check as the download) and `GET /api/files/signed?token=…`.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type pg from 'pg';
import { routeRequest, type RouteRequest } from '@mig/domain/http/request';
import { CSRF_HEADER, CSRF_VALUE, needsCsrf } from '@mig/domain/http/csrf';
import { demoRoutes, type DemoRouteOptions } from '@mig/domain/http/demoRoutes';
import { ROUTES, routeKey, signedInBody, type RawResult, type RouteDef, type RouteDeps } from '@mig/domain/http/routes';
import { fileAccess } from '@mig/domain/services/claims';
import { runApiCall, TEST_IP_HEADER } from '@mig/domain/services/integrationKit';
import { DomainError, type AuthCtx, type BaseCtx } from '@mig/domain/services/kernel';
import type { BlobStore } from '@mig/domain/store/blob';
import { postgresRepos } from '@mig/domain/store/postgres';
import type { PiiCrypto } from '@mig/domain/store/pii';
import { HookSignatureError, handleSendSmsHook, verifyHook, type SmsSender, type TestPhoneCodes } from './auth/sms';
import { RequestTx } from './db';
import type { SupabaseStorage } from './files/storage';
import type { AuthAdapter, AuthAnswer, RequestMeta } from './sessions';
import { FAILURE_RATE, registerDemoControls, type DemoControls } from './demo';

export interface AppOptions {
  pool: pg.Pool;
  crypto: PiiCrypto;
  deps: RouteDeps;
  /** Who the person is, and the sign-in routes (sessions.ts). */
  auth: AuthAdapter;
  /** Where file bytes live (Supabase Storage); `redeem` serves the signed links. */
  storage?: BlobStore & Partial<Pick<SupabaseStorage, 'redeem'>>;
  /** The Send SMS hook of Supabase Auth: its secret (`v1,whsec_…`) and the SMS adapter. */
  smsHook?: { secret: string; sender: SmsSender; testCodes?: TestPhoneCodes | null };
  /** Demo routes (`/api/__demo/*`): development, ci and staging only, never production. */
  demoRoutes?: DemoRouteOptions | null;
  /** With the demo routes: the server's demo knobs (reset, failure simulation, test clock; demo.ts). */
  demo?: DemoControls | null;
  /** The clock of the services (tests pin it). */
  now?: () => number;
  /** Fastify's request log: off, on (info), or a level (LOG_LEVEL). */
  logger?: boolean | { level: string };
  /** Called with every unexpected error (tests collect them). */
  onError?: (e: unknown, route: string) => void;
}

const INTERNAL = { code: 'server', key: 'errors.internal' } as const;
const NOT_FOUND = { code: 'not_found', key: 'errors.notFound' } as const;
const CSRF = { code: 'forbidden', key: 'errors.csrf' } as const;
/** The header every mutating request of the web app sends (BACKEND_SPEC §7). */
export { CSRF_HEADER, CSRF_VALUE };
/** How long a signed file link lives. */
export const SIGNED_LINK_SEC = 60;

/** A Fetch `Request` over what Fastify received: the shared reader parses it exactly like the mock. */
function fetchRequest(req: FastifyRequest): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const x of v) headers.append(k, x);
    else headers.set(k, String(v));
  }
  const body = req.body instanceof Buffer && req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined;
  return new Request(`http://api.local${req.url}`, { method: req.method, headers, body: body as Uint8Array<ArrayBuffer> | undefined });
}

function sendRaw(reply: FastifyReply, r: RawResult): FastifyReply {
  reply.code(r.status).headers(r.headers);
  if (r.body === null) return reply.send();
  return reply.send(typeof r.body === 'string' ? r.body : Buffer.from(r.body));
}

const json = (reply: FastifyReply, status: number, body: unknown) => reply.code(status).type('application/json').send(JSON.stringify(body));


const metaOf = (req: FastifyRequest): RequestMeta => ({ ip: req.ip, userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null });

export async function buildApp(o: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: o.logger ?? false, bodyLimit: 30 * 1024 * 1024, trustProxy: true });
  // Bodies are read by the shared reader (JSON, text, multipart): Fastify only hands over the bytes.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  const now = o.now ?? (() => Date.now());
  const auth = o.auth;
  const repoOptions = { crypto: o.crypto, demoPassword: auth.demoPassword, blobs: o.storage };

  /** Runs one request in its transaction; DomainErrors keep what was written (as in the mock), other errors roll back. */
  async function inTx<T>(fn: (tx: RequestTx, base: BaseCtx) => Promise<T>): Promise<T> {
    const tx = await RequestTx.begin(o.pool);
    const system = postgresRepos(tx.system(), { ...repoOptions, privileged: true });
    const base: BaseCtx = { repos: system, now, env: { demo: !!o.demoRoutes }, system: { repos: system } };
    try {
      const out = await fn(tx, base);
      await tx.commit();
      return out;
    } catch (e) {
      if (e instanceof DomainError) await tx.commit();
      else await tx.rollback();
      throw e;
    }
  }

  /** The session of the request (system repositories), then the transaction switches to the person. */
  async function signIn(tx: RequestTx, base: BaseCtx, req: RouteRequest, meta: RequestMeta): Promise<AuthCtx> {
    const { ctx, claims } = await auth.authenticate(tx, base, req, meta);
    await tx.asUser(claims);
    const repos = postgresRepos(tx, repoOptions);
    return { ...ctx, repos, system: base.system };
  }

  /** A DomainError or an unexpected error as the API answers it. */
  function fail(request: FastifyRequest, reply: FastifyReply, req: RouteRequest, e: unknown, route: string): FastifyReply {
    if (e instanceof DomainError) {
      if (e.status === 401) for (const c of auth.expiredCookies(req, e)) reply.header('set-cookie', c);
      return json(reply, e.status, e.body());
    }
    request.log.error({ err: e, route }, 'request failed');
    o.onError?.(e, route);
    return json(reply, 500, INTERNAL);
  }

  function send(reply: FastifyReply, a: AuthAnswer): FastifyReply {
    for (const c of a.cookies ?? []) reply.header('set-cookie', c);
    return json(reply, a.status ?? 200, a.body);
  }

  function register(r: RouteDef): void {
    const own = auth.routes[routeKey(r)];
    app.route({
      method: r.method,
      url: `/api${r.path}`,
      handler: async (request, reply) => {
        const startedAt = Date.now();
        const req = routeRequest(fetchRequest(request), request.params as Record<string, string>, startedAt);
        if (needsCsrf(r) && req.header(CSRF_HEADER) !== CSRF_VALUE) return json(reply, 403, CSRF);
        // «Имитировать сбои сети» of the demo deployment (never production): as the mock, not the demo routes or the partner API.
        if (o.demo?.failures && r.auth !== 'partner' && !r.path.startsWith('/__demo/') && Math.random() < FAILURE_RATE)
          return json(reply, 500, { code: 'server', key: 'errors.server' });
        const meta = metaOf(request);
        if (r.auth === 'partner') {
          // The partner API: its own bearer tokens; the partner is not a person of RLS (system, scoped by the key).
          const answer = await inTx(async (_tx, base) =>
            runApiCall(
              base,
              r.spec,
              {
                path: req.url.pathname,
                params: req.params,
                query: req.query,
                authorization: req.header('authorization'),
                ip: req.header(TEST_IP_HEADER),
                idempotencyKey: req.header('Idempotency-Key'),
                bodyText: await req.text(),
                startedAt,
              },
              (c) => r.call(c, req),
            ),
          );
          return sendRaw(reply, answer);
        }
        try {
          if (own) return send(reply, await inTx((tx, base) => own(tx, base, req, meta)));
          const out = await inTx(async (tx, base) => {
            if (r.auth === 'none') return r.call(base, req, o.deps, () => signIn(tx, base, req, meta));
            return r.call(await signIn(tx, base, req, meta), req, o.deps);
          });
          if (r.session === 'start') {
            // A sign-in of the table itself (the adapter did not answer it): the id goes into the cookie only.
            const { sessionId, body } = signedInBody(out);
            if (!auth.issueCookie) throw new Error(`${routeKey(r)}: the auth adapter cannot issue a session cookie`);
            return send(reply, { body, cookies: [auth.issueCookie(sessionId)] });
          }
          if (r.session === 'end' && auth.clearedCookie) reply.header('set-cookie', auth.clearedCookie());
          if (r.result === 'raw') return sendRaw(reply, out as RawResult);
          if (out === undefined) return reply.code(204).send();
          return json(reply, r.result === 201 ? 201 : 200, out);
        } catch (e) {
          return fail(request, reply, req, e, `${r.method} ${r.path}`);
        }
      },
    });
  }

  for (const r of ROUTES) register(r);
  if (o.demoRoutes) for (const r of demoRoutes(o.demoRoutes)) register(r);
  if (o.demoRoutes && o.demo) registerDemoControls(app, { pool: o.pool, controls: o.demo, log: (msg, data) => app.log.info(data ?? {}, msg) });

  // ---------------------------------------------------------------- API-only routes

  const storage = o.storage;
  if (storage) {
    // A link to a file valid for 60 s, after the same rights check as the download (BACKEND_SPEC §8).
    app.get('/api/files/:id/link', async (request, reply) => {
      const req = routeRequest(fetchRequest(request), request.params as Record<string, string>);
      try {
        const out = await inTx(async (tx, base) => {
          const ctx = await signIn(tx, base, req, metaOf(request));
          const f = await fileAccess(ctx, req.id('id'));
          // The person may read this row (fileAccess): where its bytes are is read under the person's RLS.
          const { rows } = await tx.query(`select bucket, object_name::text as name from public.files where id = $1::uuid`, [f.id]);
          const obj = rows[0] as { bucket: string | null; name: string | null } | undefined;
          // A seeded receipt has no stored object: its picture is drawn by the download route itself.
          const url = obj?.bucket && obj.name ? await storage.signedUrl(obj.bucket as never, obj.name, SIGNED_LINK_SEC) : `/api/files/${f.id}`;
          return { url, expiresInSec: SIGNED_LINK_SEC };
        });
        return json(reply, 200, out);
      } catch (e) {
        return fail(request, reply, req, e, 'GET /files/:id/link');
      }
    });
    // The bytes behind a signed link: Storage checks the token and its expiry; no session is needed.
    app.get('/api/files/signed', async (request, reply) => {
      const token = new URL(`http://api.local${request.url}`).searchParams.get('token') ?? '';
      const got = storage.redeem && token.length < 4096 ? await storage.redeem(token) : null;
      if (!got) return json(reply, 404, NOT_FOUND);
      const pdf = got.mime === 'application/pdf';
      reply.code(200).headers({
        'Content-Type': got.mime,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...(pdf ? { 'Content-Disposition': 'attachment; filename="document.pdf"' } : {}),
      });
      return reply.send(Buffer.from(got.bytes));
    });
  }

  const hook = o.smsHook;
  if (hook) {
    // Supabase Auth's «Send SMS» hook: signed with the shared secret (Standard Webhooks), never a browser call.
    app.post('/api/hooks/send-sms', async (request, reply) => {
      const body = request.body instanceof Buffer ? request.body.toString('utf8') : '';
      const h = (n: string) => (typeof request.headers[n] === 'string' ? (request.headers[n] as string) : null);
      try {
        verifyHook(hook.secret, { id: h('webhook-id'), timestamp: h('webhook-timestamp'), signature: h('webhook-signature') }, body);
        await handleSendSmsHook(hook.sender, JSON.parse(body) as unknown, hook.testCodes);
        return json(reply, 200, {});
      } catch (e) {
        const status = e instanceof HookSignatureError ? 401 : 500;
        if (status === 500) o.onError?.(e, 'POST /hooks/send-sms');
        return json(reply, status, { error: { http_code: status, message: status === 401 ? 'invalid signature' : 'the SMS was not sent' } });
      }
    });
  }

  // Unknown routes behave like the mock: 404 with the API error body.
  app.setNotFoundHandler((_req, reply) => json(reply, 404, NOT_FOUND));
  app.setErrorHandler((err: { statusCode?: number }, _req, reply) => {
    const status = err.statusCode === 413 ? 413 : err.statusCode && err.statusCode < 500 ? 400 : 500;
    const body = status === 413 ? { code: 'validation', key: 'errors.tooLarge' } : status === 400 ? { code: 'validation', key: 'errors.badJson' } : INTERNAL;
    return json(reply, status, body);
  });
  return app;
}
