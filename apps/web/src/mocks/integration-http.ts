/*
 * MSW plumbing of the partner API (/api/integration/v1), for clinic and assistance keys alike: the pipeline
 * itself (bearer tokens, scopes, rate limit, idempotency, problem+json, call log) is the service
 * `runApiCall` (packages/domain/src/services/integrationKit.ts). This adapter reads the request parts,
 * simulates latency, turns the ApiAnswer into a Response and persists the in-memory database.
 */
import { delay, HttpResponse, type PathParams } from 'msw';
import type { IntegrationScope, PartnerType } from '@mig/contracts';
import type { ZodTypeAny } from 'zod';
import { issueToken, parseJsonBody, runApiCall, TEST_IP_HEADER, type ApiAnswer, type ApiCallCtx } from '@mig/domain/services/integrationKit';
import { db } from './db';
import { API, baseCtx } from './http';
import { mockConfig } from './config';
import { saveSessions, scheduleSaveDb } from './persist';

export const BASE = `${API}/integration/v1`;

export { TEST_IP_HEADER };

/** An endpoint: the service call; `request` is there only for bodies that are not JSON (multipart). */
export type Handler = (c: ApiCallCtx, request: Request) => Promise<{ status?: number; body: unknown }>;

function toResponse(a: ApiAnswer): Response {
  return new HttpResponse(a.body, { status: a.status, headers: a.headers });
}

/** Persists what the call changed (every call writes the call log). */
function persist(): void {
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
      const answer = await runApiCall(
        baseCtx(),
        { method, template, scope, response, partner },
        {
          path: url.pathname,
          params,
          query: url.searchParams,
          authorization: request.headers.get('authorization'),
          ip: request.headers.get(TEST_IP_HEADER),
          idempotencyKey: request.headers.get('Idempotency-Key'),
          // A copy: a multipart endpoint still reads the request itself.
          bodyText: await request.clone().text(),
          startedAt,
        },
        (c) => fn(c, request),
      );
      return toResponse(answer);
    } finally {
      persist();
    }
  };
}

/** POST /oauth/token: the client credentials come as a form or as JSON. */
export async function tokenRoute({ request }: { request: Request }): Promise<Response> {
  const startedAt = Date.now();
  try {
    const form = (request.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded');
    const text = await request.text();
    return toResponse(await issueToken(baseCtx(), () => (form ? Object.fromEntries(new URLSearchParams(text)) : parseJsonBody(text)), startedAt));
  } finally {
    persist();
  }
}
