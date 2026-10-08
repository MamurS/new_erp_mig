/*
 * How a request finds its person. Part 1 (TEMPORARY): the mock's server-side sessions in the `sessions` table,
 * `Authorization: Bearer <sessionId>`, sign-in by the demo password and code (the auth routes of the table).
 * Part 2 plugs in another `SessionStore`: the BFF cookie `__Host-mig_session` with Supabase Auth tokens, the
 * CSRF header and `aal` from Supabase MFA. The rest of the adapter does not change.
 */
import type { RouteRequest } from '@mig/domain/http/request';
import type { AuthCtx, BaseCtx } from '@mig/domain/services/kernel';
import { resolveSession } from '@mig/domain/services/session';
import { claimsOf, type Claims } from './db';

export interface SessionStore {
  /**
   * The person of the request (401 DomainError otherwise) and their claims. `system`: the context over the
   * system repositories of the request transaction (sessions are not readable by the person).
   */
  authenticate(system: BaseCtx, req: RouteRequest): Promise<{ ctx: AuthCtx; claims: Claims }>;
}

function bearer(req: RouteRequest): string | null {
  const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.header('authorization') ?? '');
  return m?.[1] ?? null;
}

/** TEMPORARY (part 1): bearer session ids of the `sessions` table, idle timeouts as in the mock. */
export function bearerSessions(): SessionStore {
  return {
    async authenticate(system, req) {
      const ctx = await resolveSession(system, bearer(req), { background: req.header('X-Background') === '1' });
      return { ctx, claims: claimsOf(ctx.user) };
    },
  };
}
