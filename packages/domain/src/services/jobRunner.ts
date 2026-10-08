/*
 * The `api` jobs of jobs.ts (BACKEND_SPEC §10) as service calls with the system context. The API's worker
 * takes the rows pg_cron puts into `app.job_queue` and runs them here (apps/api/src/jobs/worker.ts); the mock
 * calls the same service functions (on read, as before: these are the sweeps the screens trigger).
 *
 * Every job returns a small summary (counts only, no personal data) for the worker's log.
 */
import { reachedAgeLimit } from '../family';
import { ageLimits } from './family';
import { isoDay } from '../lib/time';
import { isOverdue, renewalsWithoutOffer } from './dashboard';
import type { BaseCtx } from './kernel';
import { refreshContract } from './lifecycle';
import { loadParams } from './params';
import { sweepDeadlines } from './tasks';
import { JOBS } from './jobs';

export type JobSummary = Record<string, number>;

const DAY = 86_400_000;

/** The services of the `api` jobs, by job name. */
export const API_JOBS: Readonly<Record<string, (ctx: BaseCtx) => Promise<JobSummary>>> = {
  /** «Завтра срок» / «Просрочен» notifications of requests (written once each). */
  'task-deadlines': async (ctx) => {
    const before = await ctx.repos.notifications.count();
    await sweepDeadlines(ctx);
    return { notifications: (await ctx.repos.notifications.count()) - before };
  },
  /** SLA of claims: the work queues show overdue items on read; the job counts them for monitoring. */
  'sla-reminders': async (ctx) => {
    const now = ctx.now();
    const open = await ctx.repos.claims.list({
      where: { status: { in: ['new', 'review', 'medical_review'] } },
    });
    return { overdueClaims: open.filter((c) => isOverdue(c, now)).length };
  },
  /** Offers without an answer and idle leads: the sales queues show them on read; the job counts them. */
  'sales-reminders': async (ctx) => {
    const P = await loadParams(ctx);
    const now = ctx.now();
    const idle = P.dmsParam('leadIdleDays') * DAY;
    const noAnswer = P.dmsParam('kpNoAnswerDays') * DAY;
    const leads = (await ctx.repos.deals.list({ where: { stage: 'lead' } })).filter(
      (d) => now - Date.parse(d.updatedAt) >= idle,
    ).length;
    const offers = (await ctx.repos.kp.list({ where: { status: 'sent' } })).filter(
      (k) => k.sentAt && now - Date.parse(k.sentAt) >= noAnswer,
    ).length;
    return { idleLeads: leads, offersWithoutAnswer: offers };
  },
  /** Renewals within 30 days without an offer (the dashboard's «renewal» items; the offer opens the renewal deal). */
  'renewal-deals': async (ctx) => ({
    renewalsWithoutOffer: (await renewalsWithoutOffer(ctx, ctx.now())).length,
  }),
  /** Contracts entering into force and policies expiring: the same refresh the screens run on read. */
  'contract-lifecycle': async (ctx) => {
    const list = await ctx.repos.contracts.list();
    for (const c of list) await refreshContract(ctx, c);
    return { contracts: list.length };
  },
  /** Children at the age limit: a task for MIG's manager is shown on read (no automatic exclusion). */
  'child-age-limit': async (ctx) => {
    const limits = ageLimits(await loadParams(ctx));
    const today = isoDay(ctx.now());
    const children = await ctx.repos.insured.list({
      where: { relation: 'child', status: { ne: 'excluded' } },
    });
    return { atAgeLimit: children.filter((p) => reachedAgeLimit(p, today, limits)).length };
  },
};

/** Runs an `api` job by name (unknown names are an error: the catalog and this map must agree). */
export async function runApiJob(ctx: BaseCtx, name: string): Promise<JobSummary> {
  const job = API_JOBS[name];
  if (!job || !JOBS.some((j) => j.name === name && j.runner === 'api'))
    throw new Error(`Unknown api job ${name}`);
  return job(ctx);
}
