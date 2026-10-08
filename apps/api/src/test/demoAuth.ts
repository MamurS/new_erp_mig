/*
 * TEST FIXTURE ONLY — the mock's own sign-in on the API: the sign-in routes of the table (demo password, demo
 * code), the ids of the `sessions` table in the cookie `mig_session` (as the mock keeps them) and the mock's idle
 * rules. The conformance test uses it so both sides sign in with the same services and the same random numbers;
 * the deployment uses Supabase Auth and BFF sessions (auth/bff.ts). server.ts never builds this.
 */
import { DEMO_PASSWORD } from '@mig/domain/auth/demo';
import { readCookie } from '@mig/domain/http/csrf';
import { resolveSession } from '@mig/domain/services/session';
import { claimsOf } from '../db';
import type { AuthAdapter } from '../sessions';
import { DEV_SESSION_COOKIE } from '../auth/cookies';

const cookie = (v: string, maxAge0 = false) => `${DEV_SESSION_COOKIE}=${v}; Path=/; HttpOnly; SameSite=Strict${maxAge0 ? '; Max-Age=0' : ''}`;

export function demoAuth(): AuthAdapter {
  return {
    async authenticate(_tx, base, req) {
      const id = readCookie(req.header('cookie'), DEV_SESSION_COOKIE);
      const ctx = await resolveSession(base, id, { background: req.header('X-Background') === '1' });
      return { ctx, claims: claimsOf(ctx.user) };
    },
    routes: {},
    expiredCookies: () => [],
    issueCookie: (sessionId) => cookie(sessionId),
    clearedCookie: () => cookie('', true),
    demoPassword: DEMO_PASSWORD,
  };
}
