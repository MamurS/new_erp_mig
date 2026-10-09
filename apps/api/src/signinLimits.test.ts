/*
 * Sign-in limits are per account, not per address (stage 1.5): a whole office signs in from one IP, so wrong codes of
 * one account lock that account only — 20 wrong TOTP codes in a row: the account answers 429 (also at the password
 * step, to whoever knows the password), the colleagues behind the same address sign in.
 *
 * Needs DATABASE_URL and the Supabase stack (CI job `api`); skipped otherwise.
 */
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { devAesPiiCrypto } from '@mig/domain/store/piiAes';
import { DEMO_PASSWORD } from '@mig/seed/credentials';
import { createSeed } from '@mig/seed/seed';
import { buildApp } from './app';
import { AuthApiError, GoTrue } from './auth/gotrue';
import { SESSION_COOKIE } from './auth/cookies';
import { hasSupabase, SUPABASE, testBff, testStack } from './test/supabase';
import { fastifyClient, hasDb, loadSeed, signIn, testDeps, testPool, type Client } from './test/support';

describe.skipIf(!hasDb || !hasSupabase)('sign-in limits per account behind one office address', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let api: Client;
  const crypto = devAesPiiCrypto();

  beforeAll(async () => {
    pool = testPool();
    await loadSeed(pool, createSeed({ now: Date.now() }));
    const stack = testStack(pool, crypto);
    app = await buildApp({ pool, crypto, deps: testDeps(), auth: testBff(pool, crypto, stack), storage: stack.storage });
    api = fastifyClient(app, { cookie: SESSION_COOKIE });
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('a rate limit of Supabase Auth per address is «try again in a minute», never a wrong code of the account', async () => {
    const stack = testStack(pool, crypto);
    // Supabase Auth answering 429 to the TOTP challenge (its limit per IP), as for a crowded office address.
    class Busy extends GoTrue {
      override async challenge(): Promise<never> {
        throw new AuthApiError(429, 'over_request_rate_limit', 'Request rate limit reached');
      }
    }
    const busy = await buildApp({ pool, crypto, deps: testDeps(), auth: testBff(pool, crypto, stack, { gotrue: new Busy({ url: SUPABASE!.url, serviceKey: SUPABASE!.serviceKey }) }), storage: stack.storage });
    try {
      const c = fastifyClient(busy, { cookie: SESSION_COOKIE });
      const start = await c.call('POST', '/auth/login', { body: { email: 'legal@demo.mig.uz', password: DEMO_PASSWORD } });
      expect(start.status).toBe(200);
      const code = await c.call('POST', '/auth/otp', { body: { challengeId: (start.body as { challengeId: string }).challengeId, code: '000000' } });
      expect(code.status).toBe(429);
      expect((code.body as { key: string }).key).toBe('srv.auth.busy');
      const { rows } = await pool.query(`select count(*)::int as n from public.login_failures`);
      expect(rows[0].n).toBe(0);
    } finally {
      await busy.close();
    }
  });

  it('20 wrong codes in a row lock that account; the others from the same IP sign in', async () => {
    const victim = 'operator@demo.mig.uz';
    const statuses: number[] = [];
    let challengeId: string | null = null;
    let tries = 0;
    // As an attacker would: a code step takes «Попыток входа до блокировки» codes, then a new password step.
    for (let i = 0; i < 20; i++) {
      if (!challengeId) {
        const start = await api.call('POST', '/auth/login', { body: { email: victim, password: DEMO_PASSWORD } });
        if (start.status !== 200) {
          statuses.push(start.status);
          continue;
        }
        challengeId = (start.body as { challengeId: string }).challengeId;
        tries = 0;
      }
      const r = await api.call('POST', '/auth/otp', { body: { challengeId, code: '123457' } });
      statuses.push(r.status);
      tries += 1;
      if (r.status !== 401 || tries >= 5) challengeId = null;
    }
    // «Попыток входа до блокировки» (5 within 10 minutes): five wrong codes, then the account is locked.
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5).every((s) => s === 429)).toBe(true);
    // Even with the right password and code the account waits for the lock to end.
    const again = await api.call('POST', '/auth/login', { body: { email: victim, password: DEMO_PASSWORD } });
    expect(again.status).toBe(429);
    // The colleagues behind the same address are not affected.
    for (const email of ['underwriter@demo.mig.uz', 'accountant@demo.mig.uz', 'sales@demo.mig.uz', 'admin@demo.mig.uz']) {
      const sid = await signIn(api, { email }, SESSION_COOKIE);
      expect((await api.call('GET', '/auth/me', { session: sid })).status).toBe(200);
    }
    // The lock is the account's, recorded once.
    const { rows } = await pool.query(`select count(*)::int as n from public.lockouts`);
    expect(rows[0].n).toBe(1);
  });
});
