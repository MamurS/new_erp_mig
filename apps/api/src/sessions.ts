/*
 * How a request finds its person and how sign-in works: the `AuthAdapter` of the Fastify adapter (app.ts).
 *
 * - `bffAuth` (auth/bff.ts) — the deployment: Supabase Auth (GoTrue) with TOTP and phone codes, BFF sessions
 *   in `app_sessions` behind the `__Host-mig_session` cookie (BACKEND_SPEC §7);
 * - `demoAuth` (test/demoAuth.ts) — TEST FIXTURE ONLY: the mock's own sign-in (demo password and code, bearer
 *   session ids of the `sessions` table), so the conformance test signs in identically on both sides.
 */
import type { RouteRequest } from '@mig/domain/http/request';
import type { AuthCtx, BaseCtx } from '@mig/domain/services/kernel';
import type { Claims, RequestTx } from './db';

/** Who sent the request (from the proxy-aware Fastify request). */
export interface RequestMeta {
  ip: string;
  userAgent: string | null;
}

/** The answer of a sign-in route the adapter replaces: JSON body, status and cookies to set. */
export interface AuthAnswer {
  status?: number;
  body: unknown;
  cookies?: string[];
}

export type AuthRoute = (tx: RequestTx, base: BaseCtx, req: RouteRequest, meta: RequestMeta) => Promise<AuthAnswer>;

export interface AuthAdapter {
  /**
   * The person of the request (401 DomainError otherwise) and the claims of the database role. `base`: the
   * context over the system repositories of the request transaction (sessions are not readable by the person).
   */
  authenticate(tx: RequestTx, base: BaseCtx, req: RouteRequest, meta: RequestMeta): Promise<{ ctx: AuthCtx; claims: Claims }>;
  /** Routes of the table this adapter answers itself (`METHOD /path` → handler): sign-in, logout. */
  routes: Readonly<Record<string, AuthRoute>>;
  /** `Set-Cookie` headers for an answer 401 to a request that presented a session cookie. */
  expiredCookies(req: RouteRequest): string[];
  /** Virtual `password` of accounts as the repositories read it (the demo fixture only). */
  demoPassword?: string;
}
