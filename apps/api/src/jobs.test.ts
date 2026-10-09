/*
 * Background jobs (BACKEND_SPEC §10) against the local database: the worker takes what pg_cron queues and runs it
 * with the same service code as the mock; the database jobs clean up expired sessions and attempt counters and
 * verify the audit chain.
 *
 * Needs DATABASE_URL and the Supabase stack (CI job `api`); skipped otherwise.
 */
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JOBS } from '@mig/domain/services/jobs';
import { msg } from '@mig/i18n';
import { API_JOBS, type JobSummary } from '@mig/domain/services/jobRunner';
import { SYSTEM_ACTOR, type BaseCtx } from '@mig/domain/services/kernel';
import { isoDay, tzIso } from '@mig/domain/lib/time';
import type { Db } from '@mig/domain/store/db';
import { devAesPiiCrypto } from '@mig/domain/store/piiAes';
import { DEMO_STAFF } from '@mig/seed/credentials';
import { createSeed } from '@mig/seed/seed';
import { buildApp } from './app';
import { SESSION_COOKIE } from './auth/cookies';
import { createWorker, type Worker } from './jobs/worker';
import { withSystemDb } from './systemDb';
import { hasSupabase, testBff, testStack, type TestStack } from './test/supabase';
import {
  fastifyClient,
  hasDb,
  loadSeed,
  signIn as signInAs,
  testDeps,
  testPool,
  type Client,
} from './test/support';

const T = Math.floor(Date.now() / 60_000) * 60_000;
const email = (role: string) => DEMO_STAFF.find((s) => s.role === role)!.email;

describe.skipIf(!hasDb || !hasSupabase)('background jobs', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let api: Client;
  let stack: TestStack;
  let worker: Worker;
  let d: Db;
  const crypto = devAesPiiCrypto();
  const n = async (sql: string, params: unknown[] = []) => Number((await pool.query(sql, params)).rows[0].n);

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
    });
    api = fastifyClient(app, { cookie: SESSION_COOKIE });
    worker = createWorker({ pool, crypto, identity: stack.identity });
  });

  afterAll(async () => {
    await worker?.stop();
    await app?.close();
    await pool?.end();
  });

  it('every api job of the schedule has its service, and the catalog of the database is the schedule', async () => {
    for (const j of JOBS.filter((x) => x.runner === 'api')) expect(Object.keys(API_JOBS)).toContain(j.name);
    const { rows } = await pool.query('select name, cron, runner from app.job_catalog order by name');
    expect(rows).toEqual(
      JOBS.map((j) => ({ name: j.name, cron: j.cron, runner: j.runner })).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    );
  });

  it('cleanup: idle BFF sessions, expired sign-in challenges, old attempt counters and lockouts', async () => {
    const stale = await signInAs(api, { email: email('operator') }, SESSION_COOKIE);
    const fresh = await signInAs(api, { email: email('legal') }, SESSION_COOKIE);
    const op = d.staff.find((s) => s.email === email('operator'))!;
    await pool.query(
      `update public.app_sessions set last_activity = now() - interval '40 minutes' where user_id = $1`,
      [op.id],
    );
    await api.call('POST', '/auth/login', { body: { email: email('accountant'), password: 'Demo-2026!' } });
    await pool.query(`update public.app_auth_challenges set expires_at = now() - interval '1 minute'`);
    const ms = Date.now();
    await pool.query(
      `insert into public.login_failures (key, "at") values ('email:old@x.uz', $1), ('email:new@x.uz', $2)`,
      [ms - 2 * 86_400_000, ms],
    );
    await pool.query(
      `insert into public.lockouts (key, until) values ('email:gone@x.uz', $1), ('email:kept@x.uz', $2)`,
      [ms - 1000, ms + 600_000],
    );
    const out = (await worker.runJob('cleanup-expired')) as { job_cleanup_expired: Record<string, number> };
    expect(out.job_cleanup_expired.app_sessions).toBeGreaterThanOrEqual(1);
    expect(await n(`select count(*)::int as n from public.app_sessions where user_id = $1`, [op.id])).toBe(0);
    expect(
      await n(`select count(*)::int as n from public.app_auth_challenges where expires_at < now()`),
    ).toBe(0);
    expect(
      await n(
        `select count(*)::int as n from public.login_failures where key in ('email:old@x.uz', 'email:new@x.uz')`,
      ),
    ).toBe(1);
    expect(
      await n(
        `select count(*)::int as n from public.lockouts where key in ('email:gone@x.uz', 'email:kept@x.uz')`,
      ),
    ).toBe(1);
    expect((await api.call('GET', '/dashboard', { session: stale })).status).toBe(401);
    expect((await api.call('GET', '/contracts', { session: fresh })).status).toBe(200);
  });

  it('deadline reminders: the queued job notifies the executor and the author once', async () => {
    const sales = await signInAs(api, { email: email('sales_manager') }, SESSION_COOKIE);
    const t = await api.call('POST', '/tasks', {
      session: sales,
      body: {
        toRole: 'underwriter',
        action: 'quote_calculate',
        subjectType: 'deal',
        subjectId: d.deals[0]!.id,
        comment: 'Срочно',
      },
    });
    const id = (t.body as { id: string }).id;
    await pool.query(`update public.tasks set due_at = now() - interval '1 hour' where id = $1`, [id]);
    const author = d.staff.find((s) => s.email === email('sales_manager'))!;
    const before = await n(`select count(*)::int as n from public.notifications where user_id = $1`, [
      author.id,
    ]);
    await pool.query(`select app.enqueue_job('task-deadlines')`);
    const tick = await worker.tick();
    expect(tick.jobs).toEqual([
      {
        name: 'task-deadlines',
        ok: true,
        summary: expect.objectContaining({ notifications: expect.any(Number) }),
      },
    ]);
    expect(
      (await pool.query(`select overdue_sent from public.tasks where id = $1`, [id])).rows[0].overdue_sent,
    ).toBe(true);
    expect(
      await n(`select count(*)::int as n from public.notifications where user_id = $1`, [author.id]),
    ).toBeGreaterThan(before);
    expect(
      await n(
        `select count(*)::int as n from app.job_queue where name = 'task-deadlines' and done_at is not null and error is null`,
      ),
    ).toBe(1);
    // Once: a second run adds nothing for this request.
    const again = await n(`select count(*)::int as n from public.notifications where user_id = $1`, [
      author.id,
    ]);
    await worker.runJob('task-deadlines');
    expect(
      await n(`select count(*)::int as n from public.notifications where user_id = $1`, [author.id]),
    ).toBe(again);
  });

  it('every api job runs with the system context; a failing job is recorded, not retried in a loop', async () => {
    for (const j of JOBS.filter((x) => x.runner === 'api'))
      await pool.query(`select app.enqueue_job($1)`, [j.name]);
    await pool.query(`select app.enqueue_job('no-such-job')`);
    const tick = await worker.tick();
    expect(
      tick.jobs
        .filter((j) => j.ok)
        .map((j) => j.name)
        .sort(),
    ).toEqual(
      JOBS.filter((x) => x.runner === 'api')
        .map((j) => j.name)
        .sort(),
    );
    expect(tick.jobs.find((j) => j.name === 'no-such-job')).toEqual({ name: 'no-such-job', ok: false });
    expect(await n(`select count(*)::int as n from app.job_queue where taken_at is null`)).toBe(0);
    expect(
      await n(
        `select count(*)::int as n from app.job_queue where name = 'no-such-job' and error is not null`,
      ),
    ).toBe(1);
  });

  it('the audit chain check: unbroken after the API wrote to it; a break notifies every MIG admin', async () => {
    expect(await worker.runJob('audit-chain-check')).toEqual({ job_verify_audit_chain: true });
    const admins = d.staff.filter((s) => s.role === 'admin' && s.active).map((s) => s.id);
    const c = await pool.connect();
    try {
      // Tampering needs the table owner to switch the append-only guard off: exactly what the check must catch.
      await c.query('alter table public.audit_log disable trigger user');
      await c.query(
        `update public.audit_log set reason = 'tampered' where id = (select id from public.audit_log order by chain_seq limit 1 offset 3)`,
      );
      await c.query('alter table public.audit_log enable trigger user');
    } finally {
      c.release();
    }
    expect(await worker.runJob('audit-chain-check')).toEqual({ job_verify_audit_chain: false });
    expect(
      await n(
        `select count(distinct user_id)::int as n from public.notifications where text = 'srv.auditChainBroken' and user_id = any($1::uuid[])`,
        [admins],
      ),
    ).toBe(admins.length);
  });

  // ---- each job's action happens once (stage 1.5): two runs of the worker, the rows of one ----

  /** A worker on the test clock (the services' `now`; SQL `now()` stays real). */
  let clock = T;
  const timed = () => createWorker({ pool, crypto, now: () => clock });
  const sys = <R>(fn: (ctx: BaseCtx) => Promise<R>) => withSystemDb(pool, { crypto, now: () => clock }, fn);
  const twice = async (name: string) => {
    const w = timed();
    return [(await w.runJob(name)) as JobSummary, (await w.runJob(name)) as JobSummary] as const;
  };
  const notesOf = (text: string) =>
    n(`select count(*)::int as n from public.notifications where text = $1`, [text]);
  const activeStaff = (role: string) => d.staff.filter((s) => s.role === role && s.active).length;

  it('job marks are the system’s alone: a signed-in role cannot read or write them', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local role authenticated');
      await expect(c.query('select count(*) from app.job_marks')).rejects.toThrow(/permission denied/);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  it('sla-reminders: an overdue claim and a case notify their queues once; a new breach again', async () => {
    clock = T;
    const claim = d.claims.find((c) => c.status === 'new' && c.handledBy !== 'assistance' && !c.opinion)!;
    const kase = d.cases[0]!;
    await sys(async (ctx) => {
      await ctx.repos.claims.update(claim.id, { slaDueAt: tzIso(T - 3600_000) });
      await ctx.repos.cases.update(kase.id, { status: 'open', slaDueAt: tzIso(T - 3600_000) });
    });
    const claimText = msg('next.notify.slaClaim', { number: claim.number });
    const caseText = msg('next.notify.slaCase', { number: kase.number });
    const [first, second] = await twice('sla-reminders');
    expect(first.claims).toBeGreaterThan(0);
    expect(Object.values(second).every((v) => v === 0)).toBe(true);
    expect(await notesOf(claimText)).toBe(activeStaff('claims_officer'));
    const caseTo =
      d.assistUsers.filter(
        (u) =>
          u.assistanceId === kase.assistanceId &&
          u.active &&
          (u.role === 'asst_operator' || u.role === 'asst_doctor'),
      ).length + activeStaff('operator');
    expect(await notesOf(caseText)).toBe(caseTo);
    expect(
      await n(`select count(*)::int as n from app.job_marks where job = 'sla-reminders' and subject = $1`, [
        `claim:${claim.id}`,
      ]),
    ).toBe(1);
    // A new deadline that passes too: notified again, once.
    await sys((ctx) => ctx.repos.claims.update(claim.id, { slaDueAt: tzIso(T + 3600_000) }));
    clock = T + 2 * 3600_000;
    await twice('sla-reminders');
    expect(await notesOf(claimText)).toBe(2 * activeStaff('claims_officer'));
  });

  it('sales-reminders: an idle lead and an unanswered offer notify the manager once', async () => {
    clock = T;
    const deal = d.deals.find((x) => x.stage === 'lead')!;
    const kp = d.kp.find((k) => k.status === 'sent')!;
    await pool.query(`delete from public.deal_events where deal_id = $1`, [deal.id]);
    await sys(async (ctx) => {
      await ctx.repos.deals.update(deal.id, { updatedAt: tzIso(T - 10 * 86_400_000) });
      await ctx.repos.kp.update(kp.id, { sentAt: tzIso(T - 6 * 86_400_000) });
    });
    const client = d.clients.find((c) => c.id === deal.clientId)!;
    const leadText = msg('next.notify.leadIdle', { days: 7, subject: `${deal.number} · ${client.name}` });
    // The run of every job above may have told about the seed's state already: a changed state is told once more.
    const kpText = msg('next.notify.kpNoAnswer', { number: kp.number, days: 5, client: kp.clientName });
    const kpBefore = await notesOf(kpText);
    const leadBefore = await notesOf(leadText);
    const [first, second] = await twice('sales-reminders');
    expect(first.idleLeads).toBeGreaterThan(0);
    expect(first.offersWithoutAnswer).toBeGreaterThan(0);
    expect(second).toEqual({ idleLeads: 0, offersWithoutAnswer: 0 });
    expect(
      await n(`select count(*)::int as n from public.notifications where text = $1 and user_id = $2`, [
        leadText,
        deal.ownerId,
      ]),
    ).toBe(leadBefore + 1);
    expect(await notesOf(kpText)).toBe(kpBefore + 1);
  });

  it('renewal-deals: one renewal deal per expiring policy', async () => {
    clock = T;
    const client = d.clients.find(
      (c) => c.activePolicyId && !d.deals.some((x) => x.clientId === c.id && x.type === 'renewal'),
    )!;
    await sys((ctx) =>
      ctx.repos.policies.update(client.activePolicyId!, {
        status: 'active',
        endDate: isoDay(T + 20 * 86_400_000),
      }),
    );
    const [first, second] = await twice('renewal-deals');
    expect(first.renewalDeals).toBeGreaterThan(0);
    expect(second).toEqual({ renewalDeals: 0 });
    const { rows } = await pool.query(
      `select type, stage, owner_id from public.deals where previous_policy_id = $1`,
      [client.activePolicyId],
    );
    expect(rows).toEqual([{ type: 'renewal', stage: 'lead', owner_id: expect.any(String) }]);
    expect(
      await n(
        `select count(*)::int as n from public.notifications where user_id = $1 and text like 'next.notify.renewalDeal%'`,
        [rows[0].owner_id],
      ),
    ).toBeGreaterThan(0);
  });

  it('contract-lifecycle: coming into force and expiry once, audited as the system', async () => {
    const c = d.contracts.find((x) => x.status === 'signing')!;
    await sys((ctx) =>
      ctx.repos.contracts.update(c.id, {
        status: 'signed',
        params: {
          ...c.params,
          activationRule: 'on_start_date',
          startDate: isoDay(T + 86_400_000),
          endDate: isoDay(T + 30 * 86_400_000),
        },
      }),
    );
    clock = T + 2 * 86_400_000;
    const [first, second] = await twice('contract-lifecycle');
    expect(first.activated).toBe(1);
    expect(second).toEqual({ activated: 0, contractsExpired: 0, policiesExpired: 0 });
    expect(await n(`select count(*)::int as n from public.policies where contract_id = $1`, [c.id])).toBe(1);
    expect(
      await n(
        `select count(*)::int as n from public.audit_log where action = 'contract_activated' and target_id = $1 and actor_id = $2`,
        [c.id, SYSTEM_ACTOR.id],
      ),
    ).toBe(1);
    clock = T + 45 * 86_400_000;
    const [later, again] = await twice('contract-lifecycle');
    expect(later.contractsExpired).toBe(1);
    expect(later.policiesExpired).toBeGreaterThan(0);
    expect(again).toEqual({ activated: 0, contractsExpired: 0, policiesExpired: 0 });
    expect(
      (await pool.query(`select status from public.contracts where id = $1`, [c.id])).rows[0].status,
    ).toBe('expired');
    expect(
      await n(
        `select count(*)::int as n from public.audit_log where action = 'contract_expired' and target_id = $1`,
        [c.id],
      ),
    ).toBe(1);
    expect(
      await n(
        `select count(*)::int as n from public.audit_log a join public.policies p on p.id::text = a.target_id where a.action = 'policy_expired' and p.contract_id = $1`,
        [c.id],
      ),
    ).toBe(1);
  });

  it('child-age-limit: one request to the underwriter per child and limit', async () => {
    clock = T;
    const child = d.insured.find((i) => i.relation === 'child')!;
    await pool.query(`delete from public.policy_changes where insured_id = $1`, [child.id]);
    await sys((ctx) =>
      ctx.repos.insured.update(child.id, { status: 'active', isStudent: false, birthDate: '2000-03-01' }),
    );
    const [first, second] = await twice('child-age-limit');
    expect(first.ageLimitRequests).toBeGreaterThan(0);
    expect(second).toEqual({ ageLimitRequests: 0 });
    const { rows } = await pool.query(
      `select to_role, status, created_by_id from public.tasks where link = $1`,
      [`/staff/insured/${child.id}`],
    );
    expect(rows).toEqual([{ to_role: 'underwriter', status: 'open', created_by_id: SYSTEM_ACTOR.id }]);
    expect(
      (await pool.query(`select status from public.insured where id = $1`, [child.id])).rows[0].status,
    ).toBe('active');
    expect(
      await n(`select count(*)::int as n from public.notifications where user_id = $1`, [SYSTEM_ACTOR.id]),
    ).toBe(0);
  });

  it('cleanup: test SMS codes after five minutes and job marks after their keeping period', async () => {
    await pool.query(
      `insert into app.test_phone_codes (phone, code, "at") values ('998907779901', '123456', now() - interval '6 minutes'), ('998907779902', '123456', now())`,
    );
    await pool.query(
      `insert into app.job_marks (job, subject, occurrence, "at") values ('t', 'old', '1', now() - interval '401 days'), ('t', 'new', '1', now())`,
    );
    const out = (await worker.runJob('cleanup-expired')) as { job_cleanup_expired: Record<string, number> };
    expect(out.job_cleanup_expired.test_phone_codes).toBeGreaterThanOrEqual(1);
    expect(out.job_cleanup_expired.job_marks).toBe(1);
    expect(
      await n(`select count(*)::int as n from app.test_phone_codes where phone like '99890777990%'`),
    ).toBe(1);
    expect(await n(`select count(*)::int as n from app.job_marks where job = 't'`)).toBe(1);
    await pool.query(`delete from app.test_phone_codes where phone like '99890777990%'`);
  });
});
