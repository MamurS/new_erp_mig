/*
 * DEV/CI/STAGING ONLY: (re)creates the Supabase Auth users of every demo account of the seed — the same block
 * `supabase/seed.sql` ends with (store/sql/authSeed.ts): ids of our tables, roles and bindings in app_metadata,
 * the demo password and the demo TOTP factors. For a staging database loaded with the seed whose Supabase Auth
 * was reset or created separately:
 *
 *   APP_ENV=staging DATABASE_URL=… node apps/api/dist/provision-demo.js
 *
 * Refuses APP_ENV=production.
 */
import pg from 'pg';
import { createSeed } from '@mig/seed/seed';
import { buildAuthSeedSql } from '@mig/domain/store/sql/authSeed';
import { SEED_NOW } from '@mig/domain/store/sql/seed';

const appEnv = process.env.APP_ENV ?? 'development';
if (appEnv === 'production') throw new Error('Demo accounts are never provisioned in production');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: 'mig-provision-demo' });
await client.connect();
try {
  await client.query(buildAuthSeedSql(createSeed({ now: SEED_NOW })));
  const { rows } = await client.query<{ n: number }>(`select count(*)::int as n from auth.users`);
  process.stdout.write(`${JSON.stringify({ msg: 'demo users provisioned', users: rows[0]?.n ?? 0 })}\n`);
} finally {
  await client.end();
}
