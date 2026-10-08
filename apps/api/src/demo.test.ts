/*
 * The server analogs of the mock's demo knobs (demo.ts) in APP_ENV=ci, assembled like server.ts: the demo reset (the
 * seed for the server's «now», the XSS variant, people stay signed in), «Имитировать сбои сети», the test clock and
 * «Войти как…» (a real Supabase sign-in behind the BFF cookie). Production has none of them (production.test.ts).
 *
 * Needs DATABASE_URL and the Supabase stack (CI job `api`); skipped otherwise.
 */
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_ASSIST2_OPERATOR, DEMO_INSURED_PHONE, DEMO_STAFF } from '@mig/seed/credentials';
import { createSeed } from '@mig/seed/seed';
import { assemble, type Assembled } from './assemble';
import { SESSION_COOKIE } from './auth/cookies';
import { readEnv } from './env';
import { hasSupabase, SUPABASE } from './test/supabase';
import { cookieOf, fastifyClient, hasDb, loadSeed, testPool, type Client } from './test/support';

const MIN = 60_000;
const operator = DEMO_STAFF.find((s) => s.role === 'operator')!.email;

describe.skipIf(!hasDb || !hasSupabase)('demo knobs of ci/staging', () => {
  let pool: pg.Pool;
  let api: Assembled;
  let client: Client;

  const loginAs = async (login: string) => {
    const r = await client.call('POST', '/__demo/login-as', { body: { login } });
    return { status: r.status, body: r.body as { user?: { role: string } }, cookie: cookieOf(r, SESSION_COOKIE) };
  };
  const xssClients = async () => (await pool.query(`select count(*)::int as n from public.clients where name like '<img%'`)).rows[0].n as number;

  beforeAll(async () => {
    pool = testPool();
    await loadSeed(pool, createSeed({ now: Date.now() }));
    const env = readEnv({
      APP_ENV: 'ci',
      DATABASE_URL: process.env.DATABASE_URL,
      SUPABASE_URL: SUPABASE!.url,
      SUPABASE_SERVICE_ROLE_KEY: SUPABASE!.serviceKey,
      WORKER: 'off',
    });
    api = await assemble(env, { pool, log: () => undefined });
    client = fastifyClient(api.app, { cookie: SESSION_COOKIE });
  });

  afterAll(async () => {
    await api?.app.close();
    await pool?.end();
  });

  it('«Войти как…» signs in as a demo account only, with a real session cookie and no id in the answer', async () => {
    const staff = await loginAs(operator);
    expect(staff.status).toBe(200);
    expect(Object.keys(staff.body)).toEqual(['user']);
    expect(staff.body.user?.role).toBe('operator');
    expect((await client.call('GET', '/auth/me', { session: staff.cookie! })).status).toBe(200);
    const insured = await loginAs(DEMO_INSURED_PHONE);
    expect(insured.body.user?.role).toBe('insured');
    // Not a «Войти как…» account (and no account at all): 404, nothing signed in.
    expect((await loginAs(DEMO_ASSIST2_OPERATOR.email)).status).toBe(404);
    expect((await loginAs('nobody@example.com')).status).toBe(404);
    expect((await client.call('POST', '/__demo/login-as', { body: { login: operator }, noCsrf: true })).status).toBe(403);
    // Switching ends the session it replaces.
    const next = await client.call('POST', '/__demo/login-as', { body: { login: DEMO_INSURED_PHONE }, session: staff.cookie! });
    expect(next.status).toBe(200);
    expect((await client.call('GET', '/auth/me', { session: staff.cookie! })).status).toBe(401);
  });

  it('reset: the seed again for the server time, the XSS variant on request; people stay signed in; CSRF', async () => {
    const { cookie } = await loginAs(operator);
    await pool.query(`update public.clients set name = 'changed by a test' where id = (select id from public.clients order by _pos limit 1)`);
    const xss = await client.call('POST', '/__demo/reset', { body: { xss: true } });
    expect(xss.status).toBe(200);
    expect(await xssClients()).toBe(1);
    expect((await pool.query(`select count(*)::int as n from public.clients where name = 'changed by a test'`)).rows[0].n).toBe(0);
    expect((await client.call('GET', '/auth/me', { session: cookie! })).status).toBe(200);
    const started = Date.now();
    expect((await client.call('POST', '/__demo/reset', { body: {} })).status).toBe(200);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(await xssClients()).toBe(0);
    expect((await client.call('POST', '/__demo/reset', { body: {}, noCsrf: true })).status).toBe(403);
    expect((await client.call('POST', '/__demo/reset', { body: { xss: 'yes' } })).status).toBe(400);
  });

  it('«Имитировать сбои сети»: some requests answer 500, never the demo routes; off again', async () => {
    const { cookie } = await loginAs(operator);
    expect((await client.call('POST', '/__demo/failures', { body: { enabled: true } })).body).toEqual({ ok: true, enabled: true });
    const statuses: number[] = [];
    for (let i = 0; i < 80; i++) statuses.push((await client.call('GET', '/auth/me', { session: cookie! })).status);
    expect(statuses).toContain(500);
    expect(statuses).toContain(200);
    for (let i = 0; i < 20; i++) expect((await client.call('GET', '/__demo/failures')).status).toBe(200);
    expect((await client.call('POST', '/__demo/failures', { body: { enabled: false } })).status).toBe(200);
    for (let i = 0; i < 20; i++) expect((await client.call('GET', '/auth/me', { session: cookie! })).status).toBe(200);
  });

  it('the test clock moves the services’ «now»: idle limits follow it; back to the real time', async () => {
    const { cookie } = await loginAs(operator);
    const before = (await client.call('GET', '/__demo/clock')).body as { now: number; offsetMs: number };
    expect(before.offsetMs).toBe(0);
    const moved = (await client.call('POST', '/__demo/clock', { body: { advanceMs: 16 * MIN + 2_000 } })).body as { now: number; offsetMs: number };
    expect(moved.offsetMs).toBe(16 * MIN + 2_000);
    expect(moved.now - Date.now()).toBeGreaterThan(16 * MIN);
    // A staff session is idle for 15 minutes plus a minute of grace by the server's clock.
    expect((await client.call('GET', '/auth/me', { session: cookie! })).status).toBe(401);
    expect((await client.call('POST', '/__demo/clock', { body: { offsetMs: 0 } })).status).toBe(200);
    const again = await loginAs(operator);
    expect((await client.call('GET', '/auth/me', { session: again.cookie! })).status).toBe(200);
    expect((await client.call('POST', '/__demo/clock', { body: { advanceMs: -1 } })).status).toBe(400);
  });
});
