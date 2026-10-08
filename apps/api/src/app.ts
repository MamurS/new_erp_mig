/*
 * The Fastify adapter (BACKEND_SPEC §4.3): every route of the shared table (packages/domain/src/http/routes.ts)
 * is registered here, the request is read by the same reader as in the mock (a Fetch `Request` built from the
 * raw body), the service runs with Postgres repositories inside one request transaction with row-level
 * security (db.ts), and results and DomainErrors become the same HTTP answers as in the mock.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type pg from 'pg';
import { routeRequest, type RouteRequest } from '@mig/domain/http/request';
import { demoRoutes } from '@mig/domain/http/demoRoutes';
import { ROUTES, type RawResult, type RouteDef, type RouteDeps } from '@mig/domain/http/routes';
import { runApiCall, TEST_IP_HEADER } from '@mig/domain/services/integrationKit';
import { DomainError, type AuthCtx, type BaseCtx } from '@mig/domain/services/kernel';
import { postgresRepos } from '@mig/domain/store/postgres';
import type { PiiCrypto } from '@mig/domain/store/pii';
import { RequestTx } from './db';
import { bearerSessions, type SessionStore } from './sessions';

export interface AppOptions {
  pool: pg.Pool;
  crypto: PiiCrypto;
  deps: RouteDeps;
  /** Demo routes (`/api/__demo/*`): ci and staging only, never production. */
  demoRoutes?: { insuredPhone: string } | null;
  /** DEV/CI ONLY: the demo password of every account (no Supabase Auth in part 1). */
  demoPassword?: string;
  /** The clock of the services (tests pin it). */
  now?: () => number;
  logger?: boolean;
  /** How a request finds its person (part 1: bearer sessions of the `sessions` table). */
  sessions?: SessionStore;
  /** Called with every unexpected error (tests collect them). */
  onError?: (e: unknown, route: string) => void;
}

const INTERNAL = { code: 'server', key: 'errors.internal' } as const;
const NOT_FOUND = { code: 'not_found', key: 'errors.notFound' } as const;

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

export async function buildApp(o: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: o.logger ?? false, bodyLimit: 30 * 1024 * 1024, trustProxy: true });
  // Bodies are read by the shared reader (JSON, text, multipart): Fastify only hands over the bytes.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  const now = o.now ?? (() => Date.now());
  const sessions = o.sessions ?? bearerSessions();

  /** Runs one request in its transaction; DomainErrors keep what was written (as in the mock), other errors roll back. */
  async function inTx<T>(fn: (tx: RequestTx, base: BaseCtx) => Promise<T>): Promise<T> {
    const tx = await RequestTx.begin(o.pool);
    const system = postgresRepos(tx.system(), { crypto: o.crypto, privileged: true, demoPassword: o.demoPassword });
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
  async function signIn(tx: RequestTx, base: BaseCtx, req: RouteRequest): Promise<AuthCtx> {
    const { ctx, claims } = await sessions.authenticate(base, req);
    await tx.asUser(claims);
    const repos = postgresRepos(tx, { crypto: o.crypto, demoPassword: o.demoPassword });
    return { ...ctx, repos, system: base.system };
  }

  function register(r: RouteDef): void {
    app.route({
      method: r.method,
      url: `/api${r.path}`,
      handler: async (request, reply) => {
        const startedAt = Date.now();
        const req = routeRequest(fetchRequest(request), request.params as Record<string, string>, startedAt);
        if (r.auth === 'partner') {
          // The partner API: its own bearer tokens; the partner is not a person of RLS (part 1: system, scoped by the key).
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
          const out = await inTx(async (tx, base) => {
            if (r.auth === 'none') return r.call(base, req, o.deps, () => signIn(tx, base, req));
            return r.call(await signIn(tx, base, req), req, o.deps);
          });
          if (r.result === 'raw') return sendRaw(reply, out as RawResult);
          if (out === undefined) return reply.code(204).send();
          return reply
            .code(r.result === 201 ? 201 : 200)
            .type('application/json')
            .send(JSON.stringify(out));
        } catch (e) {
          if (e instanceof DomainError) return reply.code(e.status).type('application/json').send(JSON.stringify(e.body()));
          request.log.error({ err: e, route: `${r.method} ${r.path}` }, 'request failed');
          o.onError?.(e, `${r.method} ${r.path}`);
          return reply.code(500).type('application/json').send(JSON.stringify(INTERNAL));
        }
      },
    });
  }

  for (const r of ROUTES) register(r);
  if (o.demoRoutes) for (const r of demoRoutes(o.demoRoutes)) register(r);

  // Unknown routes behave like the mock: 404 with the API error body.
  app.setNotFoundHandler((_req, reply) => reply.code(404).type('application/json').send(JSON.stringify(NOT_FOUND)));
  app.setErrorHandler((err: { statusCode?: number }, _req, reply) => {
    const status = err.statusCode === 413 ? 413 : err.statusCode && err.statusCode < 500 ? 400 : 500;
    const body = status === 413 ? { code: 'validation', key: 'errors.tooLarge' } : status === 400 ? { code: 'validation', key: 'errors.badJson' } : INTERNAL;
    return reply.code(status).type('application/json').send(JSON.stringify(body));
  });
  return app;
}
