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
import { API_JOBS } from '@mig/domain/services/jobRunner';
import type { Db } from '@mig/domain/store/db';
import { devAesPiiCrypto } from '@mig/domain/store/piiAes';
import { DEMO_STAFF } from '@mig/seed/credentials';
import { createSeed } from '@mig/seed/seed';
import { buildApp } from './app';
import { SESSION_COOKIE } from './auth/cookies';
import { createWorker, type Worker } from './jobs/worker';
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
});
