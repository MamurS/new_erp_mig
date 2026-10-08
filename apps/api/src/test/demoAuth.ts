/*
 * TEST FIXTURE ONLY — the mock's own sign-in on the API: the sign-in routes of the table (demo password, demo
 * code), bearer session ids of the `sessions` table and the mock's idle rules. The conformance test uses it so
 * both sides sign in with the same services and the same random numbers; the deployment uses Supabase Auth and
 * BFF sessions (auth/bff.ts). server.ts never builds this.
 */
import { DEMO_PASSWORD } from '@mig/domain/auth/demo';
import { resolveSession } from '@mig/domain/services/session';
import { claimsOf } from '../db';
import type { AuthAdapter } from '../sessions';

export function demoAuth(): AuthAdapter {
  return {
    async authenticate(_tx, base, req) {
      const bearer = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(req.header('authorization') ?? '')?.[1] ?? null;
      const ctx = await resolveSession(base, bearer, { background: req.header('X-Background') === '1' });
      return { ctx, claims: claimsOf(ctx.user) };
    },
    routes: {},
    expiredCookies: () => [],
    demoPassword: DEMO_PASSWORD,
  };
}
