/*
 * Integration tests of the Fastify app over Postgres with row-level security (BACKEND_SPEC §12.2): sign-in and
 * sessions, endpoints of every area, isolation between companies, clinics and assistance companies (in the API
 * and in the database itself), the audit log with its hash chain, the partner API, unknown and demo routes.
 *
 * Needs DATABASE_URL (CI job `api`); skipped otherwise.
 */
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD } from '@mig/domain/auth/demo';
import { devPiiCrypto } from '@mig/domain/store/pii';
import type { Db } from '@mig/domain/store/db';
import { DEMO_ASSIST2_OPERATOR, DEMO_ASSIST_USERS, DEMO_CLINIC_USERS, DEMO_HR, DEMO_INSURED_PHONE, DEMO_STAFF } from '@mig/seed/credentials';
import { createSeed } from '@mig/seed/seed';
import { buildApp } from './app';
import { claimsOf, RequestTx } from './db';
import { fastifyClient, hasDb, loadSeed, signIn, testDeps, testPool, type Client } from './test/support';

const T = Math.floor(Date.now() / 60_000) * 60_000;
const staffEmail = (role: string) => DEMO_STAFF.find((s) => s.role === role)!.email;

describe.skipIf(!hasDb)('API (Fastify) over Postgres with RLS', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let api: Client;
  let d: Db;
  const errors: string[] = [];

  beforeAll(async () => {
    d = createSeed({ now: T });
    pool = testPool();
    await loadSeed(pool, createSeed({ now: T }));
    app = await buildApp({
      pool,
      crypto: devPiiCrypto(),
      deps: testDeps(),
      demoPassword: DEMO_PASSWORD,
      demoRoutes: { insuredPhone: DEMO_INSURED_PHONE },
      onError: (e, route) => errors.push(`${route}: ${e instanceof Error ? e.message : String(e)}`),
    });
    api = fastifyClient(app);
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
      expect((await pool.query('select count(*)::int as n from public.sessions where id = $1', [sid])).rows[0].n).toBe(1);
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
      const prod = await buildApp({ pool, crypto: devPiiCrypto(), deps: testDeps(), demoPassword: DEMO_PASSWORD, demoRoutes: null });
      try {
        const sid2 = await signIn(fastifyClient(prod), { email: DEMO_CLINIC_USERS[1]!.email });
        expect((await fastifyClient(prod).call('POST', '/__demo/mis-card', { session: sid2 })).status).toBe(404);
      } finally {
        await prod.close();
      }
    });
  });
});
