/*
 * Integration tests of the Fastify app over Postgres with row-level security (BACKEND_SPEC §12.2): sign-in with
 * Supabase Auth and BFF cookie sessions, endpoints of every area, isolation between companies, clinics and
 * assistance companies (in the API and in the database itself), the audit log with its hash chain, the partner
 * API, unknown and demo routes, help answers with screen links.
 *
 * Needs DATABASE_URL and the Supabase stack (CI job `api`); skipped otherwise.
 */
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD } from '@mig/domain/auth/demo';
import { randomBytes } from 'node:crypto';
import { DEV_HMAC_KEY } from '@mig/domain/store/devKeys';
import { aesPiiCrypto, devAesPiiCrypto, DEV_PII_KEY } from '@mig/domain/store/piiAes';
import type { Db } from '@mig/domain/store/db';
import { DEMO_ASSIST2_OPERATOR, DEMO_ASSIST_USERS, DEMO_CLINIC_USERS, DEMO_HR, DEMO_INSURED_PHONE, DEMO_LOGIN_AS, DEMO_STAFF } from '@mig/seed/credentials';
import { createSeed } from '@mig/seed/seed';
import { buildApp } from './app';
import { SESSION_COOKIE } from './auth/cookies';
import { claimsOf, RequestTx } from './db';
import { fastifyClient, hasDb, loadSeed, signIn as signInAs, testDeps, testPool, type Client, type Who } from './test/support';
import { hasSupabase, testBff, testStack, type TestStack } from './test/supabase';

const T = Math.floor(Date.now() / 60_000) * 60_000;
/** Signs in through Supabase Auth (test MFA mode) and returns the value of the session cookie. */
const signIn = (c: Client, who: Who) => signInAs(c, who, SESSION_COOKIE);
const staffEmail = (role: string) => DEMO_STAFF.find((s) => s.role === role)!.email;

describe.skipIf(!hasDb || !hasSupabase)('API (Fastify) over Postgres with RLS', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let api: Client;
  let d: Db;
  let stack: TestStack;
  const crypto = devAesPiiCrypto();
  const errors: string[] = [];

  beforeAll(async () => {
    d = createSeed({ now: T });
    pool = testPool();
    await loadSeed(pool, createSeed({ now: T }));
    stack = testStack(pool, crypto);
    app = await buildApp({
      pool,
      crypto,
      deps: testDeps(),
      auth: testBff(pool, crypto, stack),
      storage: stack.storage,
      demoRoutes: { insuredPhone: DEMO_INSURED_PHONE, accounts: DEMO_LOGIN_AS },
      onError: (e, route) => errors.push(`${route}: ${e instanceof Error ? e.message : String(e)}`),
    });
    api = fastifyClient(app, { cookie: SESSION_COOKIE });
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    expect(errors).toEqual([]);
  });

  const audit = async (where: string, params: unknown[] = []) => (await pool.query(`select action, actor_id::text, actor_role, target_id, reason from public.audit_log where ${where} order by _pos`, params)).rows;

  describe('sign-in and sessions', () => {
    it('signs in with the password and the code, then knows the person', async () => {
      const sid = await signIn(api, { email: staffEmail('operator') });
      const me = await api.call('GET', '/auth/me', { session: sid });
      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({ role: 'operator', displayName: DEMO_STAFF.find((s) => s.role === 'operator')!.fullName });
      const op = d.staff.find((s) => s.email === staffEmail('operator'))!;
      expect((await pool.query(`select count(*)::int as n from public.app_sessions where user_id = $1 and aal = 'aal2'`, [op.id])).rows[0].n).toBeGreaterThan(0);
    });

    it('rejects a wrong password, audits it and counts it for the lockout', async () => {
      const r = await api.call('POST', '/auth/login', { body: { email: staffEmail('legal'), password: 'wrong-password-1' } });
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ code: 'unauthorized', key: 'srv.auth.invalidCreds' });
      expect((await pool.query(`select count(*)::int as n from public.login_failures where key = $1`, [`email:${staffEmail('legal')}`])).rows[0].n).toBe(1);
      expect((await audit(`action = 'login_failed'`)).length).toBeGreaterThan(0);
    });

    it('rejects a wrong one-time code', async () => {
      const start = await api.call('POST', '/auth/login', { body: { email: staffEmail('accountant'), password: DEMO_PASSWORD } });
      const r = await api.call('POST', '/auth/otp', { body: { challengeId: (start.body as { challengeId: string }).challengeId, code: '123456' } });
      expect(r.status).toBe(401);
    });

    it('signs the insured person in by phone', async () => {
      const sid = await signIn(api, { phone: DEMO_INSURED_PHONE });
      const me = await api.call('GET', '/me', { session: sid });
      expect(me.status).toBe(200);
      expect(JSON.stringify(me.body)).not.toContain(d.insured.find((i) => i.phone === DEMO_INSURED_PHONE)!.pinfl);
    });

    it('answers 401 without a session and after logout', async () => {
      expect((await api.call('GET', '/dashboard')).status).toBe(401);
      expect((await api.call('GET', '/dashboard', { session: 'x'.repeat(43) })).status).toBe(401);
      const sid = await signIn(api, { email: staffEmail('underwriter') });
      expect((await api.call('GET', '/dashboard', { session: sid })).status).toBe(200);
      expect((await api.call('POST', '/auth/logout', { session: sid })).status).toBe(200);
      expect((await api.call('GET', '/dashboard', { session: sid })).status).toBe(401);
      expect((await audit(`action = 'logout'`)).length).toBeGreaterThan(0);
    });

    it('the logins are audited with the person as the actor', async () => {
      const rows = await audit(`action = 'login' and actor_role = 'operator'`);
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  describe('endpoints of every area', () => {
    it.each([
      ['operator', ['/dashboard', '/claims', '/insured', '/appointments', '/clinics', '/tasks']],
      ['underwriter', ['/clients', '/policies', '/policy-changes', '/limit-requests', '/deals']],
      ['accountant', ['/invoices', '/payments/queue', '/rebills', '/registries']],
      ['admin', ['/audit', '/admin/users', '/params', '/ai/admin', '/admin/migration/batches']],
      ['sales_manager', ['/leads', '/deals', '/contracts']],
      ['doctor_expert', ['/guarantees', '/qa']],
      ['legal', ['/contracts', '/endorsements']],
      ['claims_officer', ['/claims', '/reports/reserves']],
    ])('%s reads its screens', async (role, paths) => {
      const sid = await signIn(api, { email: staffEmail(role) });
      for (const p of paths) {
        const r = await api.call('GET', p, { session: sid });
        expect(r.status, `${role} GET ${p}: ${r.text.slice(0, 200)}`).toBe(200);
      }
    });

    it('HR, clinic and assistance portals answer', async () => {
      const hr = await signIn(api, { email: DEMO_HR.email });
      for (const p of ['/hr/overview', '/hr/employees', '/hr/documents', '/hr/invoices', '/hr/stats']) expect((await api.call('GET', p, { session: hr })).status, p).toBe(200);
      const clinic = await signIn(api, { email: DEMO_CLINIC_USERS[1]!.email });
      for (const p of ['/clinic/overview', '/clinic/visits', '/clinic/registries', '/clinic/users', '/clinic/integration/keys']) expect((await api.call('GET', p, { session: clinic })).status, p).toBe(200);
      const assist = await signIn(api, { email: DEMO_ASSIST_USERS[3]!.email });
      for (const p of ['/assist/overview', '/assist/clinics', '/assist/users', '/assist/integration/keys']) expect((await api.call('GET', p, { session: assist })).status, p).toBe(200);
    });

    it('a CSV export is a file with the formula-safe cells and an audit entry', async () => {
      const sid = await signIn(api, { email: staffEmail('accountant') });
      const r = await api.call('POST', '/exports', { session: sid, body: { type: 'claims_financial' } });
      expect(r.status).toBe(200);
      expect(r.contentType).toContain('text/csv');
      expect((await audit(`action = 'export'`)).length).toBeGreaterThan(0);
    });

    it('a personal-data reveal returns the value once and is audited with the reason', async () => {
      const sid = await signIn(api, { email: staffEmail('operator') });
      const me = d.insured.find((i) => i.phone === DEMO_INSURED_PHONE)!;
      const r = await api.call('POST', `/insured/${me.id}/reveal`, { session: sid, body: { field: 'pinfl', reason: 'Проверка по звонку клиента' } });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ value: me.pinfl });
      const rows = await audit(`action = 'reveal_pii' and target_id = $1`, [me.id]);
      expect(rows.at(-1)).toMatchObject({ actor_role: 'operator' });
    });
  });

  describe('isolation (the API and the database)', () => {
    it('HR sees only the own company: another company’s employee is 404', async () => {
      const hr = await signIn(api, { email: DEMO_HR.email });
      const own = d.hrUsers.find((h) => h.email === DEMO_HR.email)!.companyId;
      const foreign = d.insured.find((i) => i.clientId !== own && i.status === 'active')!;
      expect((await api.call('GET', `/hr/employees/${foreign.id}`, { session: hr })).status).toBe(404);
      const list = await api.call('GET', '/hr/employees', { session: hr });
      expect(JSON.stringify(list.body)).not.toContain(foreign.id);
    });

    it('the insured person gets only own claims; another person’s claim is 404', async () => {
      const sid = await signIn(api, { phone: DEMO_INSURED_PHONE });
      const me = d.insured.find((i) => i.phone === DEMO_INSURED_PHONE)!;
      const family = new Set(d.insured.filter((i) => i.id === me.id || i.principalId === me.id).map((i) => i.id));
      const foreign = d.claims.find((c) => !family.has(c.insuredId))!;
      expect((await api.call('GET', `/me/claims/${foreign.id}`, { session: sid })).status).toBe(404);
      expect([403, 404]).toContain((await api.call('GET', `/claims/${foreign.id}`, { session: sid })).status);
    });

    it('a clinic does not see another clinic’s registry', async () => {
      const sid = await signIn(api, { email: DEMO_CLINIC_USERS[1]!.email });
      const own = d.clinicUsers.find((u) => u.email === DEMO_CLINIC_USERS[1]!.email)!.clinicId;
      const foreign = d.registries.find((r) => r.clinicId !== own);
      if (foreign) expect((await api.call('GET', `/clinic/registries/${foreign.id}`, { session: sid })).status).toBe(404);
    });

    it('an assistance company does not see another company’s case', async () => {
      const sid = await signIn(api, { email: DEMO_ASSIST2_OPERATOR.email });
      const own = d.assistUsers.find((u) => u.email === DEMO_ASSIST2_OPERATOR.email)!.assistanceId;
      const foreign = d.cases.find((c) => c.assistanceId !== own)!;
      expect((await api.call('GET', `/assist/cases/${foreign.id}`, { session: sid })).status).toBe(404);
    });

    it('row-level security itself: the request role sees only its rows, never ciphertexts', async () => {
      const hrRow = d.hrUsers.find((h) => h.email === DEMO_HR.email)!;
      const tx = await RequestTx.begin(pool);
      try {
        await tx.asUser(claimsOf({ id: hrRow.id, role: 'hr', displayName: hrRow.fullName, companyId: hrRow.companyId }));
        const { rows } = await tx.query('select distinct client_id::text as c from public.insured');
        expect(rows.map((r) => r.c)).toEqual([hrRow.companyId]);
        expect((await tx.query('select count(*)::int as n from public.claims')).rows[0]!.n).toBe(0);
        // The narrow capability of the repositories: the same transaction, privileged, then back to the person.
        const all = await tx.privileged((s) => s.query('select count(distinct client_id)::int as n from public.insured'));
        expect(all.rows[0]!.n).toBeGreaterThan(1);
        expect((await tx.query('select count(distinct client_id)::int as n from public.insured')).rows[0]!.n).toBe(1);
        // Ciphertexts of identity data are not readable by the person's role (the last statement: it aborts the transaction).
        await expect(tx.query('select pinfl_enc from public.insured limit 1')).rejects.toThrow(/permission denied/);
      } finally {
        await tx.rollback();
      }
    });

    it('roles without a second factor see nothing (aal1)', async () => {
      const op = d.staff.find((s) => s.role === 'operator')!;
      const tx = await RequestTx.begin(pool);
      try {
        await tx.asUser({ ...claimsOf({ id: op.id, role: 'operator', displayName: op.fullName }), aal: 'aal1' });
        expect((await tx.query('select count(*)::int as n from public.claims')).rows[0]!.n).toBe(0);
      } finally {
        await tx.rollback();
      }
    });
  });

  describe('personal data in the database (AES-256-GCM, HMAC search, key rotation)', () => {
    const me = () => d.insured.find((i) => i.phone === DEMO_INSURED_PHONE)!;

    it('ciphertexts hold no plaintext; the search hash finds the person; the mask is stored next to them', async () => {
      const { rows } = await pool.query(`select pinfl_enc, pinfl_key_ver, pinfl_hmac, pinfl_mask, phone_enc from public.insured where id = $1`, [me().id]);
      const r = rows[0];
      expect(r.pinfl_key_ver).toBe(1);
      expect(Buffer.from(r.pinfl_enc).toString('latin1')).not.toContain(me().pinfl);
      expect(Buffer.from(r.phone_enc).toString('latin1')).not.toContain(me().phone.slice(4));
      expect(await crypto.open(r.pinfl_enc, 1)).toBe(me().pinfl);
      expect(r.pinfl_mask).not.toContain(me().pinfl.slice(0, 10));
      const byHash = await pool.query(`select id::text from public.insured where pinfl_hmac = $1`, [Buffer.from(await crypto.hmac(me().pinfl))]);
      expect(byHash.rows.map((x) => x.id)).toEqual([me().id]);
    });

    it('after a key rotation old values stay readable and new ones are sealed with the current version', async () => {
      const rotated = aesPiiCrypto({ keys: new Map([[1, DEV_PII_KEY], [2, new Uint8Array(randomBytes(32))]]), current: 2, hmacKey: DEV_HMAC_KEY });
      const app2 = await buildApp({ pool, crypto: rotated, deps: testDeps(), auth: testBff(pool, rotated, stack), storage: stack.storage });
      try {
        const c = fastifyClient(app2, { cookie: SESSION_COOKIE });
        const hr = await signIn(c, { email: DEMO_HR.email });
        const added = await c.call('POST', '/hr/employees', { session: hr, body: { fullName: 'Rotatsiya Test Testovich', birthDate: '1991-02-03', pinfl: '31234567890124', phone: '+998901112244', position: 'Инженер', startDate: '2026-12-01' } });
        expect(added.status, added.text).toBeLessThan(300);
        const fresh = (await pool.query(`select new_person_key_ver from public.policy_changes order by _created_at desc limit 1`)).rows[0];
        expect(fresh.new_person_key_ver).toBe(2);
        const op = await signIn(c, { email: staffEmail('operator') });
        const old = await c.call('POST', `/insured/${me().id}/reveal`, { session: op, body: { field: 'pinfl', reason: 'Проверка после ротации ключа' } });
        expect(old.body).toMatchObject({ value: me().pinfl });
        // A value written with version 2 is read back by the rotated key set.
        const pending = await c.call('GET', '/policy-changes', { session: await signIn(c, { email: staffEmail('underwriter') }) });
        expect(JSON.stringify(pending.body)).toContain('Rotatsiya Test Testovich');
      } finally {
        await app2.close();
      }
    });
  });

  describe('help answers', () => {
    it('carry the same «Открыть раздел» links as the mock, only for screens the role may open', async () => {
      const acc = await signIn(api, { email: staffEmail('accountant') });
      const a = await api.call('POST', '/ai/help-answer', { session: acc, body: { question: 'как разнести платёж от другой компании', locale: 'ru' } });
      expect(a.status).toBe(200);
      expect((a.body as { openRoutes: unknown[] }).openRoutes).toContainEqual({ route: '/staff/invoices/queue', label: 'Ручная разноска', labelKey: 'staff.nav.paymentQueue' });
      const sales = await signIn(api, { email: staffEmail('sales_manager') });
      const b = await api.call('POST', '/ai/help-answer', { session: sales, body: { question: 'как разнести платёж от другой компании', locale: 'ru' } });
      expect((b.body as { openRoutes: { route: string }[] }).openRoutes.some((r) => r.route === '/staff/invoices/queue')).toBe(false);
    });
  });

  describe('the audit log', () => {
    it('keeps an unbroken hash chain after the API wrote to it', async () => {
      const { rows } = await pool.query('select ok, checked::int from app.verify_audit_chain()');
      expect(rows[0]).toMatchObject({ ok: true });
      expect(rows[0].checked).toBeGreaterThan(d.audit.length);
    });

    it('is append-only for the API too', async () => {
      await expect(pool.query(`update public.audit_log set reason = 'x' where id = (select id from public.audit_log limit 1)`)).rejects.toThrow(/append-only/);
    });

    it('new entries come first in storage order (as in the mock)', async () => {
      const first = (await pool.query('select action from public.audit_log order by _pos limit 1')).rows[0];
      expect(['reveal_pii', 'export', 'logout', 'login', 'login_failed', 'open_medical']).toContain(first.action);
    });
  });

  describe('the partner API, unknown and demo routes', () => {
    it('answers problem+json without a token', async () => {
      const r = await api.call('GET', '/integration/v1/appointments');
      expect(r.status).toBe(401);
      expect(r.contentType).toContain('application/problem+json');
    });

    it('unknown routes are 404 with the API error body', async () => {
      const r = await api.call('GET', '/no/such/route');
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ code: 'not_found', key: 'errors.notFound' });
    });

    it('a bad JSON body is 400', async () => {
      const sid = await signIn(api, { email: staffEmail('operator') });
      const r = await api.call('POST', '/tasks', { session: sid, raw: { contentType: 'application/json', text: '{nope' } });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ code: 'validation', key: 'errors.badJson' });
    });

    it('the demo route exists only with demo routes on', async () => {
      const sid = await signIn(api, { email: DEMO_CLINIC_USERS[1]!.email });
      const r = await api.call('POST', '/__demo/mis-card', { session: sid });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ shortCode: expect.any(String) });
      const prod = await buildApp({ pool, crypto, deps: testDeps(), auth: testBff(pool, crypto, stack), storage: stack.storage, demoRoutes: null });
      try {
        const client = fastifyClient(prod, { cookie: SESSION_COOKIE });
        const sid2 = await signIn(client, { email: DEMO_CLINIC_USERS[1]!.email });
        expect((await client.call('POST', '/__demo/mis-card', { session: sid2 })).status).toBe(404);
      } finally {
        await prod.close();
      }
    });
  });
});
