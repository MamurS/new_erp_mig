/*
 * The background worker (BACKEND_SPEC §10): pg_cron schedules every job of packages/domain/src/services/jobs.ts;
 * `db` jobs run inside Postgres, `api` jobs become rows of `app.job_queue` that this worker takes and runs with
 * the system context through the same service code as the mock (services/jobRunner.ts). It also drains the
 * identity sync queue (jobs/identity.ts), sends invitation e-mails (services/system/invitations.ts), fills the phone
 * tails of older insured rows (jobs/phoneTail.ts) and, with Storage, deletes the objects of removed file rows every pass and
 * sweeps orphan objects once a day (files/gc.ts).
 *
 * Runs inside the API process (WORKER=inline, the default) or as its own process (`node apps/api/dist/worker.js`,
 * WORKER=off on the API servers). Several workers may run: rows are taken with `for update skip locked`.
 */
import type pg from 'pg';
import { JOBS } from '@mig/domain/services/jobs';
import { runApiJob, type JobSummary } from '@mig/domain/services/jobRunner';
import { edoEvents } from '@mig/domain/services/lifecycle';
import { sendInvitations, type Mailer } from '@mig/domain/services/system/invitations';
import type { BlobStore } from '@mig/domain/store/blob';
import type { PiiCrypto } from '@mig/domain/store/pii';
import { storageGc, type StorageGc } from '../files/gc';
import { backfillPhoneTails } from './phoneTail';
import { withSystemDb } from '../systemDb';
import type { IdentitySync } from './identity';

export interface WorkerOptions {
  pool: pg.Pool;
  crypto: PiiCrypto;
  identity?: IdentitySync;
  /** Storage: objects of removed file rows are deleted, orphans swept daily. */
  storage?: Pick<BlobStore, 'remove'>;
  /** The services' clock (tests pin it). */
  now?: () => number;
  intervalMs?: number;
  /** Invitation e-mails (the SMTP of MIG) and where their links lead. */
  mail?: { mailer: Mailer; baseUrl: string };
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

export interface Worker {
  /** One pass: the identity queue, then every pending job. */
  tick(): Promise<{
    jobs: { name: string; ok: boolean; summary?: JobSummary }[];
    identities: { synced: number; failed: number };
    /** Contracts that got a client signature from the EDO operator this pass. */
    edo: number;
    /** Invitation e-mails sent (and failed, retried later) this pass. */
    invitations?: { sent: number; failed: number };
    /** Insured rows that got the HMAC of their phone's tail (rows written before the column). */
    phoneTails: number;
    storage?: { removed: number; failed: number; orphans?: { removed: number; failed: number } };
  }>;
  /** The Storage collector (with `storage`). */
  gc: StorageGc | null;
  /** Runs a job now with the system context (also what a queued row runs). */
  runJob(name: string): Promise<unknown>;
  start(): void;
  stop(): Promise<void>;
}

export function createWorker(o: WorkerOptions): Worker {
  const log = o.log ?? (() => undefined);
  let timer: ReturnType<typeof setInterval> | null = null;
  let running: Promise<unknown> | null = null;
  const gc = o.storage ? storageGc({ pool: o.pool, storage: o.storage, log }) : null;
  let lastSweep = 0;

  async function runJob(name: string): Promise<unknown> {
    const job = JOBS.find((j) => j.name === name);
    if (!job) throw new Error(`Unknown job ${name}`);
    if (job.runner === 'db') {
      const { rows } = await o.pool.query(job.sql!);
      return rows[0];
    }
    return withSystemDb(o.pool, { crypto: o.crypto, now: o.now }, (ctx) => runApiJob(ctx, name));
  }

  async function takeJob(): Promise<{ id: string; name: string } | null> {
    const { rows } = await o.pool.query<{ id: string; name: string }>(
      `update app.job_queue q set taken_at = now()
         where q.id = (select id from app.job_queue where taken_at is null order by id limit 1 for update skip locked)
       returning q.id::text as id, q.name`,
    );
    return rows[0] ?? null;
  }

  async function tick() {
    const identities = o.identity ? await o.identity.runPending() : { synced: 0, failed: 0 };
    const jobs: { name: string; ok: boolean; summary?: JobSummary }[] = [];
    for (let job = await takeJob(); job; job = await takeJob()) {
      try {
        const summary = (await runJob(job.name)) as JobSummary;
        await o.pool.query(`update app.job_queue set done_at = now(), error = null where id = $1::bigint`, [
          job.id,
        ]);
        jobs.push({ name: job.name, ok: true, summary });
        log('job done', { job: job.name, ...summary });
      } catch (e) {
        const why = e instanceof Error ? e.message.slice(0, 500) : 'error';
        await o.pool.query(`update app.job_queue set done_at = now(), error = $2 where id = $1::bigint`, [
          job.id,
          why,
        ]);
        jobs.push({ name: job.name, ok: false });
        log('job failed', { job: job.name });
      }
    }
    let storage: Awaited<ReturnType<Worker['tick']>>['storage'];
    if (gc) {
      storage = await gc.drain();
      const now = Date.now();
      if (now - lastSweep >= 24 * 3600_000) {
        lastSweep = now;
        storage.orphans = await gc.sweepOrphans();
      }
    }
    // The EDO operator is polled every pass (signatures arrive seconds after the send, not on a schedule).
    const edo = await withSystemDb(o.pool, { crypto: o.crypto, now: o.now }, (ctx) => edoEvents(ctx));
    if (edo) log('edo signatures', { contracts: edo });
    // Invitation e-mails leave on the next pass after the account is created (counts only in the log).
    let invitations: { sent: number; failed: number } | undefined;
    if (o.mail) {
      const { mailer, baseUrl } = o.mail;
      invitations = await withSystemDb(o.pool, { crypto: o.crypto, now: o.now }, (ctx) => sendInvitations(ctx, mailer, baseUrl));
      if (invitations.sent || invitations.failed) log('invitation e-mails', invitations);
    }
    const phoneTails = await backfillPhoneTails(o.pool, o.crypto);
    if (phoneTails) log('phone tails filled', { rows: phoneTails });
    return { jobs, identities, edo, ...(invitations ? { invitations } : {}), phoneTails, ...(storage ? { storage } : {}) };
  }

  return {
    tick,
    runJob,
    gc,
    start() {
      if (timer) return;
      timer = setInterval(() => {
        if (running) return;
        running = tick()
          .catch((e: unknown) => log('worker tick failed', { reason: e instanceof Error ? e.name : 'error' }))
          .finally(() => {
            running = null;
          });
      }, o.intervalMs ?? 10_000);
      timer.unref?.();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      await running;
    },
  };
}
