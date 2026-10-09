/*
 * The `api` jobs of jobs.ts (BACKEND_SPEC §10) as service calls with the system context. The API's worker
 * takes the rows pg_cron puts into `app.job_queue` and runs them here (apps/api/src/jobs/worker.ts), in one
 * transaction per job.
 *
 * Every job does its action once: a second run, or a later one while nothing changed, does nothing. Reminders,
 * renewal deals and age-limit requests are guarded by `jobMarks` (app.job_marks: job + subject + occurrence, written
 * in the job's transaction); request deadlines by the flags of the request; lifecycle transitions by the status
 * they change (a conditional update).
 *
 * The mock does not schedule jobs: the screens keep their sweeps on read (request deadlines, the contract clock) and
 * show the rest in the work queues (docs/DECISIONS.md, stage 1.5).
 *
 * Every job returns a small summary (counts only, no personal data) for the worker's log.
 */
import { openRenewalDeals } from './deals';
import type { BaseCtx } from './kernel';
import { timeClocks } from './lifecycle';
import { ageLimitTasks, salesReminders, slaReminders } from './reminders';
import { sweepDeadlines } from './tasks';
import { JOBS } from './jobs';

export type JobSummary = Record<string, number>;

/** The services of the `api` jobs, by job name. */
export const API_JOBS: Readonly<Record<string, (ctx: BaseCtx) => Promise<JobSummary>>> = {
  /** «Завтра срок» / «Просрочен» notifications of requests (written once each). */
  'task-deadlines': async (ctx) => {
    const before = await ctx.repos.notifications.count();
    await sweepDeadlines(ctx);
    return { notifications: (await ctx.repos.notifications.count()) - before };
  },
  /** Claims, guarantee letters, appointments awaiting the clinic, assistance cases past their SLA: once per breach. */
  'sla-reminders': async (ctx) => slaReminders(ctx),
  /** Idle leads and offers without an answer: the deal's manager, once per state. */
  'sales-reminders': async (ctx) => salesReminders(ctx),
  /** The renewal deal `renewalLeadDays` before the client's policy ends, once per policy. */
  'renewal-deals': async (ctx) => ({ renewalDeals: await openRenewalDeals(ctx) }),
  /** Every state that changes with the date: contracts, policies, guarantee letters, invoices (once each). */
  'contract-lifecycle': async (ctx) => timeClocks(ctx),
  /** A request to the underwriter per child at the age limit (no automatic exclusion), once per child and limit. */
  'child-age-limit': async (ctx) => ({ ageLimitRequests: await ageLimitTasks(ctx) }),
};

/** Runs an `api` job by name (unknown names are an error: the catalog and this map must agree). */
export async function runApiJob(ctx: BaseCtx, name: string): Promise<JobSummary> {
  const job = API_JOBS[name];
  if (!job || !JOBS.some((j) => j.name === name && j.runner === 'api'))
    throw new Error(`Unknown api job ${name}`);
  return job(ctx);
}
