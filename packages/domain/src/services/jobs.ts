/*
 * Background jobs (BACKEND_SPEC §10): the schedules in one place. The pg_cron registrations of the
 * migration `…_jobs.sql` are generated from this list (scripts/gen-schema.mjs).
 *
 * - `db` jobs are SQL functions of schema `app` that pg_cron calls directly;
 * - `api` jobs need the domain services (deadlines, renewals, activation, age limits): pg_cron puts a row
 *   into `app.job_queue` and the API takes it and runs `service` with the system context (services/jobRunner.ts).
 *   Every action of a job happens once: `jobMarks` (app.job_marks) or the state it changes guards it.
 *
 * The step 3 migration registered the catalog from a frozen copy (store/sql/jobsStep3.ts); a changed `service` or
 * `description` reaches `app.job_catalog` through the newer migration (store/sql/migrationsJobs.ts).
 *
 * Cron expressions are in UTC (pg_cron's default); Tashkent is UTC+5.
 */
export type JobRunner = 'db' | 'api';

export interface JobSpec {
  name: string;
  cron: string;
  runner: JobRunner;
  /** `db`: the SQL statement pg_cron runs. */
  sql?: string;
  /** `api`: the service the API runs for the queued job. */
  service?: string;
  description: string;
}

export const JOBS: readonly JobSpec[] = [
  {
    name: 'task-deadlines',
    cron: '*/15 * * * *',
    runner: 'api',
    service: 'tasks.sweepDeadlines',
    description: 'Reminders on request deadlines: «Завтра срок» and «Просрочен» (once each).',
  },
  {
    name: 'sla-reminders',
    cron: '*/10 * * * *',
    runner: 'api',
    service: 'reminders.slaReminders',
    description: 'SLA of claims, guarantee letters, appointments awaiting the clinic and assistance cases: the responsible people are notified once per breach.',
  },
  {
    name: 'sales-reminders',
    cron: '7 1 * * *',
    runner: 'api',
    service: 'reminders.salesReminders (leadIdleDays, kpNoAnswerDays)',
    description: 'Leads without activity and commercial offers without an answer: the deal manager is notified once per state (06:07 Tashkent).',
  },
  {
    name: 'renewal-deals',
    cron: '13 1 * * *',
    runner: 'api',
    service: 'deals.openRenewalDeals (renewalLeadDays)',
    description: 'The renewal deal N days before the policy ends, once per policy (06:13 Tashkent).',
  },
  {
    name: 'contract-lifecycle',
    cron: '*/15 * * * *',
    runner: 'api',
    service: 'lifecycle.timeClocks',
    description: 'Every state that changes with the date: contracts (EDO events, entering into force, expiry) and policies expiring, audited; approved guarantee letters past their validity; invoice statuses by due date (every 15 minutes; reads show the stored state).',
  },
  {
    name: 'child-age-limit',
    cron: '21 1 * * *',
    runner: 'api',
    service: 'reminders.ageLimitTasks',
    description: 'Children reaching the age limit (maxChildAge / studentMaxAge): a request to the underwriter once per child and limit (06:21 Tashkent).',
  },
  {
    name: 'cleanup-expired',
    cron: '*/30 * * * *',
    runner: 'db',
    sql: 'select app.job_cleanup_expired()',
    description: 'Expired sessions, login challenges, attempt counters, lockouts, card tokens, partner tokens, idempotency keys, test SMS codes and old job marks.',
  },
  {
    name: 'audit-chain-check',
    cron: '47 0 * * *',
    runner: 'db',
    sql: 'select app.job_verify_audit_chain()',
    description: 'Verifies the hash chain of the audit log; on a break notifies every MIG admin (05:47 Tashkent).',
  },
];
