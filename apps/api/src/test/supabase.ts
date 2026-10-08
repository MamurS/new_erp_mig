/*
 * The Supabase stack of the API tests (Auth, Storage behind Kong): SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from
 * the environment (CI sets them from `supabase status`), or — against the local stack (DATABASE_URL on
 * 127.0.0.1:54322) — read once from `npx supabase status -o json`. The suites that need it are skipped without it.
 */
import { execFileSync } from 'node:child_process';
import type pg from 'pg';
import { DEMO_PASSWORD } from '@mig/domain/auth/demo';
import type { PiiCrypto } from '@mig/domain/store/pii';
import { bffAuth, type BffOptions } from '../auth/bff';
import { cookiePolicy } from '../auth/cookies';
import { GoTrue } from '../auth/gotrue';
import { JwtVerifier } from '../auth/jwt';
import { DEV_SESSION_SECRET } from '../env';
import { supabaseStorage, type SupabaseStorage } from '../files/storage';
import { identitySync, type IdentitySync } from '../jobs/identity';
import { DATABASE_URL } from './support';

function discover(): { url: string; serviceKey: string } | null {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
    return { url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY };
  if (!/127\.0\.0\.1:54322|localhost:54322/.test(DATABASE_URL)) return null;
  try {
    const out = execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 60_000,
    });
    const s = JSON.parse(out.slice(out.indexOf('{'))) as { API_URL?: string; SERVICE_ROLE_KEY?: string };
    return s.API_URL && s.SERVICE_ROLE_KEY ? { url: s.API_URL, serviceKey: s.SERVICE_ROLE_KEY } : null;
  } catch {
    return null;
  }
}

export const SUPABASE = DATABASE_URL ? discover() : null;
export const hasSupabase = SUPABASE !== null;

export interface TestStack {
  gotrue: GoTrue;
  jwt: JwtVerifier;
  storage: SupabaseStorage;
  identity: IdentitySync;
}

export function testStack(pool: pg.Pool, crypto: PiiCrypto): TestStack {
  if (!SUPABASE) throw new Error('No Supabase stack for the tests');
  const gotrue = new GoTrue({ url: SUPABASE.url, serviceKey: SUPABASE.serviceKey });
  return {
    gotrue,
    jwt: new JwtVerifier({ jwksUrl: `${gotrue.base}/.well-known/jwks.json` }),
    storage: supabaseStorage({ url: SUPABASE.url, serviceKey: SUPABASE.serviceKey }),
    identity: identitySync({ pool, crypto, gotrue, demoPassword: DEMO_PASSWORD, testMfa: true }),
  };
}

/** The deployment's sign-in for the tests: test MFA mode, the `__Host-` cookie, no bearer path unless asked. */
export function testBff(pool: pg.Pool, crypto: PiiCrypto, stack: TestStack, o: Partial<BffOptions> = {}) {
  return bffAuth({
    pool,
    gotrue: stack.gotrue,
    jwt: stack.jwt,
    crypto,
    sessionSecret: DEV_SESSION_SECRET,
    cookie: cookiePolicy(false),
    testMfa: true,
    bearerCompat: false,
    syncIdentity: stack.identity.syncOne,
    ensureDemoFactor: stack.identity.ensureDemoFactor,
    now: () => Date.now(),
    ...o,
  });
}
