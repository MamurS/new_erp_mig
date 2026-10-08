/*
 * The MSW adapter: every route of the shared table (packages/domain/src/http/routes.ts) becomes an MSW
 * handler. Parsing, the service call and the answer are the table's; what stays here are the mock-only
 * knobs: latency, failure injection, persistence of the in-memory database and the mock's dependencies
 * (AI provider latency, the help guide bundled by Vite, receipts drawn on a canvas).
 */
import { delay, http, HttpResponse, type HttpHandler } from 'msw';
import { DEMO_PASSWORD } from '@mig/seed/credentials';
import { createMockProvider } from '@mig/domain/lib/aiProvider';
import { routeRequest } from '@mig/domain/http/request';
import { PARTNER_BASE, ROUTES, routeKey, signedInBody, type RawResult, type RouteDef, type RouteDeps } from '@mig/domain/http/routes';
import { needsCsrf } from '@mig/domain/http/csrf';
import { runApiCall, TEST_IP_HEADER } from '@mig/domain/services/integrationKit';
import { API, authCtx, baseCtx, endSession, notFound, route, startSession } from '../http';
import { mockConfig } from '../config';
import { db } from '../db';
import { saveSessions, scheduleSaveDb } from '../persist';
import { renderReceiptPng } from '../receipt';
import { guideProvider } from '../help-provider';

export { TEST_IP_HEADER };

export const deps: RouteDeps = {
  aiProvider: () => createMockProvider({ latency: mockConfig.latency[1] > 0 }),
  help: guideProvider as RouteDeps['help'],
  receiptPng: renderReceiptPng,
  invitePassword: DEMO_PASSWORD,
};

/** Mock-only behaviour of single routes. */
const KNOBS: Record<string, { after?: () => Promise<void> }> = {
  // The receipt «recognition» takes a moment on screen.
  'POST /me/claims/recognize': {
    after: async () => {
      if (mockConfig.latency[1] > 0) await delay(1000);
    },
  },
};

function rawResponse(r: RawResult): Response {
  return new HttpResponse(r.body, { status: r.status, headers: r.headers });
}

/** Persists what a partner call changed (every call writes the call log). */
function persist(): void {
  saveSessions(db());
  scheduleSaveDb(db);
}

function latency(): Promise<void> | undefined {
  const [lo, hi] = mockConfig.latency;
  return hi > 0 ? delay(lo + Math.floor(Math.random() * (hi - lo))) : undefined;
}

const METHOD = { GET: http.get, POST: http.post, PUT: http.put, PATCH: http.patch, DELETE: http.delete } as const;

/** One route of the table as an MSW handler. `noFailures`: the simulated 500s never hit it (demo controls). */
export function toMsw(r: RouteDef, opts: { noFailures?: boolean } = {}): HttpHandler {
  const path = `${API}${r.path}`;
  const knob = KNOBS[routeKey(r)];
  if (r.auth === 'partner') {
    // The partner API: its own tokens and problem+json answers (runApiCall never throws); no failure injection.
    return METHOD[r.method](path, async ({ request, params }) => {
      const startedAt = Date.now();
      await latency();
      const req = routeRequest(request, params, startedAt);
      try {
        const answer = await runApiCall(
          baseCtx(),
          r.spec,
          {
            path: req.url.pathname,
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
        return new HttpResponse(answer.body, { status: answer.status, headers: answer.headers });
      } finally {
        persist();
      }
    });
  }
  if (r.path.startsWith(`${PARTNER_BASE}/`)) {
    // The token endpoint of the partner API: no latency, no failure injection, its own answers.
    return METHOD[r.method](path, async ({ request, params }) => {
      const req = routeRequest(request, params);
      try {
        return rawResponse((await (r as Extract<RouteDef, { auth: 'none' }>).call(baseCtx(), req, deps, () => authCtx(request))) as RawResult);
      } finally {
        persist();
      }
    });
  }
  return METHOD[r.method](
    path,
    route(
      async ({ request, params, startedAt }) => {
        const req = routeRequest(request, params, startedAt);
        let out: unknown;
        if (r.auth === 'none') out = await r.call(baseCtx(), req, deps, () => authCtx(request));
        else out = await r.call(await authCtx(request), req, deps);
        await knob?.after?.();
        if (r.session === 'start') {
          // The session id goes into the «cookie» (http.ts), the answer carries the person only — as on the API.
          const { sessionId, body } = signedInBody(out);
          return HttpResponse.json(body as never, { headers: startSession(sessionId) });
        }
        if (r.session === 'end') return HttpResponse.json(out as never, { headers: endSession(request) });
        if (r.result === 'raw') return rawResponse(out as RawResult);
        if (r.result === 201) return HttpResponse.json(out as never, { status: 201 });
        return out;
      },
      { csrf: needsCsrf(r), ...(r.writes ? { writes: true } : {}), ...(opts.noFailures ? { noFailures: true } : {}) },
    ),
  );
}

/*
 * Demo-only endpoints (`./demo`) are not listed here: the browser worker imports them dynamically
 * with VITE_DEMO_MODE, and the test server adds them itself, so a build without the flag has none of their code.
 */
export const handlers = [
  ...ROUTES.map((r) => toMsw(r)),
  // Unknown API routes behave like a real server: 404.
  http.all(
    `${API}/*`,
    route(() => {
      throw notFound();
    }),
  ),
];
