/*
 * Sign-in with Supabase Auth and BFF sessions (BACKEND_SPEC §7) against the local stack: TOTP (test MFA mode and
 * real codes), first-time enrolment, phone codes, the session cookie's flags, CSRF, idle limits per role,
 * background requests, server-side token refresh, logout and «Выйти на всех устройствах», role changes followed
 * by Supabase Auth, the Send SMS hook, invitations and the identity sync.
 *
 * Needs DATABASE_URL and the Supabase stack (CI job `api`); skipped otherwise.
 */
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_CODE, DEMO_PASSWORD } from '@mig/domain/auth/demo';
import { devFactorId, devTotpSecret, totpCode } from '@mig/domain/auth/devMfa';
import type { Db } from '@mig/domain/store/db';
import { devAesPiiCrypto } from '@mig/domain/store/piiAes';
import { DEMO_ASSIST_USERS, DEMO_HR, DEMO_INSURED_PHONE, DEMO_STAFF } from '@mig/seed/credentials';
import { createSeed } from '@mig/seed/seed';
import { buildApp, type AppOptions } from './app';
import { SESSION_COOKIE } from './auth/cookies';
import { GoTrue } from './auth/gotrue';
import { logSms, signHook } from './auth/sms';
import { DEV_SMS_HOOK_SECRET } from './env';
import { identitySync } from './jobs/identity';
import { hasSupabase, SUPABASE, testBff, testStack, type TestStack } from './test/supabase';
import {
  cookieOf,
  fastifyClient,
  hasDb,
  loadSeed,
  signIn as signInAs,
  testDeps,
  testPool,
  type Client,
  type Who,
} from './test/support';

const T = Math.floor(Date.now() / 60_000) * 60_000;
const MIN = 60_000;
const email = (role: string) => DEMO_STAFF.find((s) => s.role === role)!.email;

describe.skipIf(!hasDb || !hasSupabase)('sign-in with Supabase Auth and BFF sessions', () => {
  let pool: pg.Pool;
  let stack: TestStack;
  let d: Db;
  const crypto = devAesPiiCrypto();
  const apps: FastifyInstance[] = [];
  const errors: string[] = [];
  const sms = logSms({ revealCodes: true, log: () => undefined });
  let clock = T;

  /** An app over the shared stack; `bff` options override the test defaults. */
  async function makeApp(
    bff: Parameters<typeof testBff>[3] = {},
    o: Partial<AppOptions> = {},
  ): Promise<Client> {
    const app = await buildApp({
      pool,
      crypto,
      deps: testDeps(),
      auth: testBff(pool, crypto, stack, { now: () => clock, ...bff }),
      storage: stack.storage,
      smsHook: { secret: DEV_SMS_HOOK_SECRET, sender: sms },
      now: () => clock,
      onError: (e, route) => errors.push(`${route}: ${e instanceof Error ? e.message : String(e)}`),
      ...o,
    });
    apps.push(app);
    return fastifyClient(app, { cookie: SESSION_COOKIE });
  }
  const signIn = (c: Client, who: Who) => signInAs(c, who, SESSION_COOKIE);
  /** The seeded row of a demo staff account (ids come from the seed). */
  const staff = (mail: string) => d.staff.find((s) => s.email === mail)!;
  let api: Client;

  beforeAll(async () => {
    d = createSeed({ now: T });
    pool = testPool();
    await loadSeed(pool, createSeed({ now: T }));
    stack = testStack(pool, crypto);
    api = await makeApp();
  });

  afterAll(async () => {
    for (const a of apps) await a.close();
    await pool?.end();
    expect(errors).toEqual([]);
  });

  describe('sign-in', () => {
    it('password, then the TOTP code: an HttpOnly, Secure, SameSite=Strict __Host- cookie and no token in the body', async () => {
      const start = await api.call('POST', '/auth/login', {
        body: { email: email('operator'), password: DEMO_PASSWORD },
      });
      expect(start.status).toBe(200);
      const done = await api.call('POST', '/auth/otp', {
        body: { challengeId: (start.body as { challengeId: string }).challengeId, code: DEMO_CODE },
      });
      expect(done.status).toBe(200);
      expect(done.body).toEqual({ user: expect.objectContaining({ role: 'operator' }) });
      const set = String(done.headers['set-cookie']);
      expect(set).toMatch(
        /^__Host-mig_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict$/,
      );
      expect(set).not.toMatch(/Domain=/i);
      // The session is a server-side row: second factor done, tokens sealed, nothing readable as a JWT.
      const row = (
        await pool.query(
          `select aal, encode(access_enc, 'escape') as a from public.app_sessions where user_id = $1 order by created_at desc limit 1`,
          [staff(email('operator')).id],
        )
      ).rows[0];
      expect(row.aal).toBe('aal2');
      expect(row.a).not.toContain('eyJ');
      const me = await api.call('GET', '/auth/me', { session: cookieOf(done, SESSION_COOKIE)! });
      expect(me.body).toMatchObject({ role: 'operator' });
    });

    it('a wrong password and a wrong code are 401 and count towards the lockout of the DMS parameters', async () => {
      expect(
        (await api.call('POST', '/auth/login', { body: { email: email('legal'), password: 'Wrong-pass-1' } }))
          .status,
      ).toBe(401);
      const start = await api.call('POST', '/auth/login', {
        body: { email: email('legal'), password: DEMO_PASSWORD },
      });
      const challengeId = (start.body as { challengeId: string }).challengeId;
      const codes: number[] = [];
      for (let i = 0; i < 5; i++)
        codes.push((await api.call('POST', '/auth/otp', { body: { challengeId, code: '111111' } })).status);
      expect(codes.slice(0, 4)).toEqual([401, 401, 401, 401]);
      // The fifth failure locks the account key of the code step (loginMaxAttempts = 5).
      expect([401, 429]).toContain(codes[4]);
      expect(
        (
          await pool.query(`select count(*)::int as n from public.lockouts where key = $1`, [
            `challenge:${staff(email('legal')).id}`,
          ])
        ).rows[0].n,
      ).toBe(1);
    });

    it('production has no test MFA mode: 000000 is refused, the real TOTP code of the factor works', async () => {
      const prod = await makeApp({ testMfa: false, ensureDemoFactor: undefined });
      const who = staff(email('accountant'));
      const start = await prod.call('POST', '/auth/login', {
        body: { email: who.email, password: DEMO_PASSWORD },
      });
      const challengeId = (start.body as { challengeId: string }).challengeId;
      if (totpCode(devTotpSecret(who.id)) !== DEMO_CODE)
        expect(
          (await prod.call('POST', '/auth/otp', { body: { challengeId, code: DEMO_CODE } })).status,
        ).toBe(401);
      const ok = await prod.call('POST', '/auth/otp', {
        body: { challengeId, code: totpCode(devTotpSecret(who.id)) },
      });
      expect(ok.status).toBe(200);
    });

    it('a person without a factor enrols one at the first sign-in (otpauth URI), then signs in with its code', async () => {
      const prod = await makeApp({ testMfa: false, ensureDemoFactor: undefined });
      const who = d.assistUsers.find((u) => u.email === DEMO_ASSIST_USERS[2]!.email)!;
      await pool.query(`delete from auth.mfa_factors where user_id = $1`, [who.id]);
      try {
        const start = await prod.call('POST', '/auth/login', {
          body: { email: who.email, password: DEMO_PASSWORD },
        });
        const body = start.body as { challengeId: string; totpEnrollment: { uri: string; secret: string } };
        expect(body.totpEnrollment.uri).toMatch(/^otpauth:\/\/totp\//);
        const ok = await prod.call('POST', '/auth/otp', {
          body: { challengeId: body.challengeId, code: totpCode(body.totpEnrollment.secret) },
        });
        expect(ok.status).toBe(200);
        expect(
          (
            await pool.query(
              `select count(*)::int as n from auth.mfa_factors where user_id = $1 and status = 'verified'`,
              [who.id],
            )
          ).rows[0].n,
        ).toBe(1);
      } finally {
        await pool.query(`delete from auth.mfa_factors where user_id = $1`, [who.id]);
        await stack.identity.ensureDemoFactor(who.id);
      }
    });

    it('the insured person signs in by phone (aal1); an unknown number gets a challenge that never succeeds', async () => {
      const sid = await signIn(api, { phone: DEMO_INSURED_PHONE });
      expect((await api.call('GET', '/me', { session: sid })).status).toBe(200);
      const me = d.insured.find((i) => i.phone === DEMO_INSURED_PHONE)!;
      expect(
        (await pool.query(`select aal from public.app_sessions where user_id = $1 limit 1`, [me.userId]))
          .rows[0].aal,
      ).toBe('aal1');
      const unknown = await api.call('POST', '/auth/phone', { body: { phone: '+998977777777' } });
      expect(unknown.status).toBe(200);
      const verify = await api.call('POST', '/auth/phone/verify', {
        body: { challengeId: (unknown.body as { challengeId: string }).challengeId, code: DEMO_CODE },
      });
      expect(verify.status).toBe(401);
    });

    it('the session is the cookie only: no id in the answer, a bearer header is not a session', async () => {
      const start = await api.call('POST', '/auth/login', {
        body: { email: email('doctor_expert'), password: DEMO_PASSWORD },
      });
      const done = await api.call('POST', '/auth/otp', {
        body: { challengeId: (start.body as { challengeId: string }).challengeId, code: DEMO_CODE },
      });
      expect(Object.keys(done.body as object)).toEqual(['user']);
      const secret = cookieOf(done, SESSION_COOKIE)!;
      expect(secret).toBeTruthy();
      expect((await api.call('GET', '/auth/me', { session: secret })).status).toBe(200);
      expect(
        (await api.call('GET', '/auth/me', { headers: { authorization: `Bearer ${secret}` } })).status,
      ).toBe(401);
    });
  });

  describe('CSRF', () => {
    it('a mutating request without X-Requested-With: mig-web is 403, with it the request goes through', async () => {
      const sid = await signIn(api, { email: email('sales_manager') });
      const body = {
        toRole: 'underwriter',
        action: 'quote_calculate',
        subjectType: 'deal',
        subjectId: d.deals[0]!.id,
        comment: 'CSRF check',
      };
      const denied = await api.call('POST', '/tasks', { session: sid, body, noCsrf: true });
      expect(denied.status).toBe(403);
      expect(denied.body).toEqual({ code: 'forbidden', key: 'errors.csrf' });
      expect(
        (
          await api.call('POST', '/tasks', {
            session: sid,
            body,
            headers: { 'x-requested-with': 'XMLHttpRequest' },
            noCsrf: true,
          })
        ).status,
      ).toBe(403);
      expect((await api.call('POST', '/tasks', { session: sid, body })).status).toBe(200);
      expect(
        (
          await api.call('POST', '/auth/login', {
            body: { email: email('operator'), password: DEMO_PASSWORD },
            noCsrf: true,
          })
        ).status,
      ).toBe(403);
      expect((await api.call('POST', '/auth/logout', { session: sid, noCsrf: true })).status).toBe(403);
      // Reads need no header; the partner API has its own tokens and no cookies.
      expect((await api.call('GET', '/tasks/mine', { session: sid })).status).toBe(200);
      const partner = await api.call('POST', '/integration/v1/coverage/check', { body: {}, noCsrf: true });
      expect(partner.status).toBe(401);
      expect(partner.contentType).toContain('application/problem+json');
    });
  });

  describe('sessions on the server', () => {
    it('idle limits per role: staff 15 minutes, the insured 30 (plus a minute of grace); the cookie is cleared', async () => {
      clock = T;
      const op = await signIn(api, { email: email('operator') });
      const ins = await signIn(api, { phone: DEMO_INSURED_PHONE });
      clock = T + 16 * MIN + 1000;
      const expired = await api.call('GET', '/dashboard', { session: op });
      expect(expired.status).toBe(401);
      expect(String(expired.headers['set-cookie'])).toMatch(/^__Host-mig_session=; .*Max-Age=0/);
      expect((await api.call('GET', '/me', { session: ins })).status).toBe(200);
      clock = T + 16 * MIN + 31 * MIN + 2000;
      expect((await api.call('GET', '/me', { session: ins })).status).toBe(401);
      clock = T;
    });

    it('X-Background: 1 does not extend the activity', async () => {
      clock = T;
      const quiet = await signIn(api, { email: email('underwriter') });
      const active = await signIn(api, { email: email('underwriter') });
      clock = T + 10 * MIN;
      expect(
        (await api.call('GET', '/notifications', { session: quiet, headers: { 'x-background': '1' } }))
          .status,
      ).toBe(200);
      expect((await api.call('GET', '/notifications', { session: active })).status).toBe(200);
      clock = T + 17 * MIN;
      expect((await api.call('GET', '/dashboard', { session: quiet })).status).toBe(401);
      expect((await api.call('GET', '/dashboard', { session: active })).status).toBe(200);
      clock = T;
    });

    it('the server refreshes an access token that is about to expire', async () => {
      const sid = await signIn(api, { email: email('claims_officer') });
      const who = staff(email('claims_officer'));
      const before = (
        await pool.query(`select access_enc from public.app_sessions where user_id = $1`, [who.id])
      ).rows[0].access_enc as Buffer;
      await pool.query(
        `update public.app_sessions set access_expires_at = now() - interval '1 second' where user_id = $1`,
        [who.id],
      );
      expect((await api.call('GET', '/claims', { session: sid })).status).toBe(200);
      const after = (
        await pool.query(
          `select access_enc, access_expires_at > now() as fresh from public.app_sessions where user_id = $1`,
          [who.id],
        )
      ).rows[0];
      expect(after.fresh).toBe(true);
      expect(Buffer.from(after.access_enc).equals(before)).toBe(false);
    });

    it('logout ends this session; «Выйти на всех устройствах» ends all of them and the Supabase sessions', async () => {
      const a = await signIn(api, { email: DEMO_HR.email });
      const b = await signIn(api, { email: DEMO_HR.email });
      const out = await api.call('POST', '/auth/logout', { session: a });
      expect(out.status).toBe(200);
      expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
      expect((await api.call('GET', '/hr/overview', { session: a })).status).toBe(401);
      expect((await api.call('GET', '/hr/overview', { session: b })).status).toBe(200);
      const c = await signIn(api, { email: DEMO_HR.email });
      expect((await api.call('POST', '/auth/logout?all=1', { session: b })).status).toBe(200);
      expect((await api.call('GET', '/hr/overview', { session: b })).status).toBe(401);
      expect((await api.call('GET', '/hr/overview', { session: c })).status).toBe(401);
      const hr = d.hrUsers.find((h) => h.email === DEMO_HR.email)!;
      expect(
        (await pool.query(`select count(*)::int as n from public.app_sessions where user_id = $1`, [hr.id]))
          .rows[0].n,
      ).toBe(0);
      expect(
        (await pool.query(`select count(*)::int as n from auth.sessions where user_id = $1`, [hr.id])).rows[0]
          .n,
      ).toBe(0);
    });

    it('a role change reaches the token: Supabase Auth is synced and the claims follow the account', async () => {
      const admin = await signIn(api, { email: email('admin') });
      const target = DEMO_STAFF.find((s) => s.email === 'claims-head@demo.mig.uz')!;
      const id = d.staff.find((s) => s.email === target.email)!.id;
      const sid = await signIn(api, { email: target.email });
      try {
        // Changed behind the API's back (the identity queue is not run): the next request syncs and refreshes.
        await pool.query(`update public.staff set role = 'operator' where id = $1`, [id]);
        const me = await api.call('GET', '/auth/me', { session: sid });
        expect(me.status).toBe(200);
        expect(me.body).toMatchObject({ role: 'operator' });
        expect((await stack.gotrue.adminGetUser(id))?.app_metadata?.role).toBe('operator');
      } finally {
        await pool.query(`update public.staff set role = 'claims_officer' where id = $1`, [id]);
        await stack.identity.syncOne(id);
      }
      // Deactivation by the admin ends the person's sessions at once.
      const sid2 = await signIn(api, { email: target.email });
      expect(
        (await api.call('PATCH', `/admin/users/${id}`, { session: admin, body: { active: false } })).status,
      ).toBe(200);
      expect((await api.call('GET', '/auth/me', { session: sid2 })).status).toBe(401);
      await stack.identity.runPending();
      expect((await stack.gotrue.adminGetUser(id))?.banned_until).toBeTruthy();
      expect(
        (await api.call('PATCH', `/admin/users/${id}`, { session: admin, body: { active: true } })).status,
      ).toBe(200);
      await stack.identity.runPending();
      expect((await stack.gotrue.adminGetUser(id))?.banned_until ?? null).toBeNull();
    });
  });

  describe('accounts in Supabase Auth', () => {
    it('a user created by the admin is provisioned with app_metadata and signs in (development: demo password, demo factor)', async () => {
      const admin = await signIn(api, { email: email('admin') });
      const created = await api.call('POST', '/admin/users', {
        session: admin,
        body: { email: 'new.operator@demo.mig.uz', fullName: 'Novikov Ivan Petrovich', role: 'operator' },
      });
      expect(created.status).toBe(201);
      const id = (created.body as { id: string }).id;
      expect(
        (await pool.query(`select count(*)::int as n from app.identity_sync where user_id = $1`, [id]))
          .rows[0].n,
      ).toBe(1);
      const run = await stack.identity.runPending();
      const left = (
        await pool.query(
          `select user_id::text, last_error from app.identity_sync where last_error is not null`,
        )
      ).rows;
      expect(left).toEqual([]);
      expect(run.failed).toBe(0);
      const u = await stack.gotrue.adminGetUser(id);
      expect(u?.app_metadata).toMatchObject({ role: 'operator' });
      expect(u?.app_metadata).not.toHaveProperty('company_id');
      expect(
        (await pool.query(`select count(*)::int as n from auth.mfa_factors where id = $1`, [devFactorId(id)]))
          .rows[0].n,
      ).toBe(1);
      const sid = await signIn(api, { email: 'new.operator@demo.mig.uz' });
      expect((await api.call('GET', '/auth/me', { session: sid })).body).toMatchObject({
        id,
        role: 'operator',
      });
    });

    it('production creates the e-mail account confirmed and without a password (our invitation e-mail sets it)', async () => {
      const calls: { method: string; path: string; body: unknown }[] = [];
      const fake: typeof fetch = async (input, init) => {
        const url = new URL(String(input));
        calls.push({
          method: init?.method ?? 'GET',
          path: url.pathname + url.search,
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        if (url.pathname.includes('/admin/users/') && (init?.method ?? 'GET') === 'GET')
          return new Response('{"msg":"User not found"}', { status: 404 });
        return new Response('{"id":"x"}', { status: 200 });
      };
      const sync = identitySync({
        pool,
        crypto,
        gotrue: new GoTrue({ url: SUPABASE!.url, serviceKey: SUPABASE!.serviceKey, fetch: fake }),
        testMfa: false,
      });
      const hr = d.hrUsers[0]!;
      await sync.syncOne(hr.id);
      expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
        `GET /auth/v1/admin/users/${hr.id}`,
        'POST /auth/v1/admin/users',
      ]);
      // Confirmed, without a password: the person sets it with the link of our invitation e-mail.
      expect(calls[1]!.body).toMatchObject({
        id: hr.id,
        email: hr.email,
        email_confirm: true,
        app_metadata: { role: 'hr', company_id: hr.companyId, clinic_id: null },
      });
      expect(calls[1]!.body).not.toHaveProperty('password');
    });
  });

  describe('the Send SMS hook', () => {
    const body = JSON.stringify({ user: { id: 'u', phone: '998901234567' }, sms: { otp: '482913' } });
    const now = () => Math.floor(Date.now() / 1000);

    it('a signed call hands the code to the SMS adapter', async () => {
      const ts = now();
      const r = await api.call('POST', '/api/hooks/send-sms', {
        raw: { contentType: 'application/json', text: body },
        noCsrf: true,
        headers: {
          'webhook-id': 'msg_1',
          'webhook-timestamp': String(ts),
          'webhook-signature': signHook(DEV_SMS_HOOK_SECRET, 'msg_1', ts, body),
        },
      });
      expect(r.status).toBe(200);
      expect(sms.sent.at(-1)).toEqual({ phone: '998901234567', text: expect.stringContaining('482913') });
    });

    it.each([
      ['without a signature', {}],
      ['with a wrong signature', { 'webhook-signature': 'v1,AAAA' }],
      [
        'signed with another secret',
        {
          'webhook-signature': signHook(
            `v1,whsec_${Buffer.from('x'.repeat(32)).toString('base64')}`,
            'msg_1',
            Math.floor(Date.now() / 1000),
            body,
          ),
        },
      ],
    ])('is refused %s', async (_label, h) => {
      const before = sms.sent.length;
      const r = await api.call('POST', '/api/hooks/send-sms', {
        raw: { contentType: 'application/json', text: body },
        noCsrf: true,
        headers: { 'webhook-id': 'msg_1', 'webhook-timestamp': String(Math.floor(Date.now() / 1000)), ...h },
      });
      expect(r.status).toBe(401);
      expect(sms.sent.length).toBe(before);
    });

    it('an old timestamp is refused (replay)', async () => {
      const ts = now() - 3600;
      const r = await api.call('POST', '/api/hooks/send-sms', {
        raw: { contentType: 'application/json', text: body },
        noCsrf: true,
        headers: {
          'webhook-id': 'msg_1',
          'webhook-timestamp': String(ts),
          'webhook-signature': signHook(DEV_SMS_HOOK_SECRET, 'msg_1', ts, body),
        },
      });
      expect(r.status).toBe(401);
    });
  });
});
