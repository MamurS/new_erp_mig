/*
 * The API as production runs it (APP_ENV=production, assembled like server.ts): no demo routes, no test MFA
 * code, no bearer sessions, the `__Host-` cookie, SMS codes never in the log, development keys refused.
 *
 * Needs DATABASE_URL and the Supabase stack (CI job `api`); skipped otherwise.
 */
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_CODE, DEMO_PASSWORD } from '@mig/domain/auth/demo';
import { devTotpSecret, totpCode } from '@mig/domain/auth/devMfa';
import { DEMO_CLINIC_USERS, DEMO_STAFF } from '@mig/seed/credentials';
import { createSeed } from '@mig/seed/seed';
import { assemble, type Assembled } from './assemble';
import { signHook } from './auth/sms';
import { readEnv } from './env';
import { hasSupabase, SUPABASE } from './test/supabase';
import { fastifyClient, hasDb, loadSeed, testPool, type Client } from './test/support';

const T = Math.floor(Date.now() / 60_000) * 60_000;
const hookSecret = `v1,whsec_${randomBytes(32).toString('base64')}`;

describe.skipIf(!hasDb || !hasSupabase)('production mode', () => {
  let pool: pg.Pool;
  let api: Assembled;
  let client: Client;
  const logged: { msg: string; data: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    pool = testPool();
    await loadSeed(pool, createSeed({ now: T }));
    const env = readEnv({
      APP_ENV: 'production',
      DATABASE_URL: process.env.DATABASE_URL,
      SUPABASE_URL: SUPABASE!.url,
      SUPABASE_SERVICE_ROLE_KEY: SUPABASE!.serviceKey,
      PII_KEYS: `7:${randomBytes(32).toString('base64')}`,
      PII_HMAC_KEY: randomBytes(32).toString('hex'),
      SESSION_SECRET: randomBytes(32).toString('hex'),
      SMS_HOOK_SECRET: hookSecret,
      WORKER: 'off',
    });
    api = await assemble(env, { pool, log: (msg, data = {}) => logged.push({ msg, data }) });
    client = fastifyClient(api.app);
  });

  afterAll(async () => {
    await api?.app.close();
    await pool?.end();
  });

  it('has no demo routes', async () => {
    const routes = api.app.printRoutes();
    expect(routes).not.toContain('__demo');
    expect((await client.call('POST', '/__demo/mis-card')).status).toBe(404);
    expect((await client.call('GET', '/__demo/mis-card')).status).toBe(404);
  });

  it('accepts no demo code and no bearer session; the cookie is __Host-mig_session', async () => {
    const who = DEMO_STAFF.find((s) => s.role === 'operator')!;
    const id = createSeed({ now: T }).staff.find((s) => s.email === who.email)!.id;
    const start = await client.call('POST', '/auth/login', {
      body: { email: who.email, password: DEMO_PASSWORD },
    });
    expect(start.status).toBe(200);
    const challengeId = (start.body as { challengeId: string }).challengeId;
    if (totpCode(devTotpSecret(id)) !== DEMO_CODE)
      expect(
        (await client.call('POST', '/auth/otp', { body: { challengeId, code: DEMO_CODE } })).status,
      ).toBe(401);
    const ok = await client.call('POST', '/auth/otp', {
      body: { challengeId, code: totpCode(devTotpSecret(id)) },
    });
    expect(ok.status).toBe(200);
    expect(ok.body).not.toHaveProperty('sessionId');
    const cookie = String(ok.headers['set-cookie']);
    expect(cookie).toMatch(/^__Host-mig_session=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Strict$/);
    const value = /^__Host-mig_session=([^;]+)/.exec(cookie)![1]!;
    expect(
      (await client.call('GET', '/auth/me', { headers: { authorization: `Bearer ${value}` } })).status,
    ).toBe(401);
    expect(
      (await client.call('GET', '/auth/me', { headers: { cookie: `__Host-mig_session=${value}` } })).status,
    ).toBe(200);
    expect(
      (await client.call('GET', '/auth/me', { headers: { cookie: `mig_session=${value}` } })).status,
    ).toBe(401);
  });

  it('a clinic user signs in only with the real TOTP code', async () => {
    const u = createSeed({ now: T }).clinicUsers.find((x) => x.email === DEMO_CLINIC_USERS[0]!.email)!;
    const start = await client.call('POST', '/auth/login', {
      body: { email: u.email, password: DEMO_PASSWORD },
    });
    const challengeId = (start.body as { challengeId: string }).challengeId;
    expect(
      (await client.call('POST', '/auth/otp', { body: { challengeId, code: totpCode(devTotpSecret(u.id)) } }))
        .status,
    ).toBe(200);
  });

  it('the SMS log adapter never writes the code; the hook needs the production secret', async () => {
    const body = JSON.stringify({ user: { phone: '998901234567' }, sms: { otp: '482913' } });
    const ts = Math.floor(Date.now() / 1000);
    const ok = await client.call('POST', '/api/hooks/send-sms', {
      raw: { contentType: 'application/json', text: body },
      noCsrf: true,
      headers: {
        'webhook-id': 'm',
        'webhook-timestamp': String(ts),
        'webhook-signature': signHook(hookSecret, 'm', ts, body),
      },
    });
    expect(ok.status).toBe(200);
    const line = logged.filter((l) => l.msg === 'sms').at(-1)!;
    expect(JSON.stringify(line)).not.toContain('482913');
    expect(JSON.stringify(line)).not.toContain('901234567');
    const dev = await client.call('POST', '/api/hooks/send-sms', {
      raw: { contentType: 'application/json', text: body },
      noCsrf: true,
      headers: {
        'webhook-id': 'm',
        'webhook-timestamp': String(ts),
        'webhook-signature': signHook('v1,whsec_bWlnLWRtcyBkZXYtb25seSBzbXMgaG9vayBzZWNyZXQ=', 'm', ts, body),
      },
    });
    expect(dev.status).toBe(401);
  });
});
