/*
 * Background jobs (BACKEND_SPEC §10): the schedules in one place. The pg_cron registrations of the
 * migration `…_jobs.sql` are generated from this list (scripts/gen-schema.mjs).
 *
 * - `db` jobs are SQL functions of schema `app` that pg_cron calls directly;
 * - `api` jobs need the domain services (deadlines, renewals, activation, age limits): pg_cron puts a row
 *   into `app.job_queue` and the API (step 4) takes it and runs `service` with the system context. The mock
 *   calls the same service functions.
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
    service: 'dashboard.queueFor',
    description: 'SLA of claims, guarantee letters, appointments and assistance cases: overdue items in the work queues.',
  },
  {
    name: 'sales-reminders',
    cron: '7 1 * * *',
    runner: 'api',
    service: 'deals (kpNoAnswerDays, leadIdleDays)',
    description: 'Commercial offers without an answer and leads without activity (06:07 Tashkent).',
  },
  {
    name: 'renewal-deals',
    cron: '13 1 * * *',
    runner: 'api',
    service: 'deals.ensureRenewalDeal (renewalLeadDays)',
    description: 'Renewal deals N days before the policy ends (06:13 Tashkent).',
  },
  {
    name: 'contract-lifecycle',
    cron: '5 19 * * *',
    runner: 'api',
    service: 'lifecycle.refreshContract',
    description: 'Contracts entering into force and policies expiring (00:05 Tashkent).',
  },
  {
    name: 'child-age-limit',
    cron: '21 1 * * *',
    runner: 'api',
    service: 'family.ageLimits',
    description: 'Children reaching the age limit (maxChildAge / studentMaxAge) (06:21 Tashkent).',
  },
  {
    name: 'cleanup-expired',
    cron: '*/30 * * * *',
    runner: 'db',
    sql: 'select app.job_cleanup_expired()',
    description: 'Expired sessions, login challenges, attempt counters, lockouts, card tokens, partner tokens and idempotency keys.',
  },
  {
    name: 'audit-chain-check',
    cron: '47 0 * * *',
    runner: 'db',
    sql: 'select app.job_verify_audit_chain()',
    description: 'Verifies the hash chain of the audit log; on a break notifies every MIG admin (05:47 Tashkent).',
  },
];
