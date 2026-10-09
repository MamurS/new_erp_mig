/*
 * DEV/CI/STAGING ONLY — loading the demo seed into a running database (database maintenance, the owner role):
 * the API tests load it for their own «now», and the demo reset of ci/staging (`POST /api/__demo/reset`, demo.ts)
 * reloads it between e2e tests. Never reachable in production (the demo routes are not registered there).
 *
 * The data tables are emptied and refilled in one transaction from the same SQL as `supabase/seed.sql`
 * (store/sql/seed.ts) for the chosen «now». The Supabase Auth users of the demo accounts change rarely (a test
 * that bans, re-binds or adds an account), and rewriting them costs a bcrypt and every Supabase session, so they
 * are rewritten only when their fingerprint differs from the one written last (or when asked).
 */
import type pg from 'pg';
import type { Db } from '@mig/domain/store/db';
import { TABLES } from '@mig/domain/store/schema';
import { buildAuthSeedSql } from '@mig/domain/store/sql/authSeed';
import { buildSeedSql } from '@mig/domain/store/sql/seed';
import { identitiesOfDb } from '@mig/domain/auth/identity';

export interface LoadSeedOptions {
  /** Keep the sessions of `sessions`/`app_sessions` (the demo reset keeps people signed in, as the mock does). */
  keepSessions?: boolean;
  /** Supabase Auth users: `always` rewrites them, `when-changed` only after something changed them. */
  authUsers?: 'always' | 'when-changed';
  /** `buildSeedSql(db)`, when already built (the demo reset prepares the next seed ahead). */
  sql?: string;
}

/** Fingerprint of everything the seed writes to Supabase Auth (users, logins, bans, roles, passwords, factors). */
const AUTH_FINGERPRINT = `
  select md5(coalesce(string_agg(concat_ws('|', u.id, u.email, u.phone, u.banned_until, u.raw_app_meta_data::text, u.encrypted_password,
           (select string_agg(concat_ws(':', f.id, f.status, f.secret), ',' order by f.id) from auth.mfa_factors f where f.user_id = u.id)), ',' order by u.id), '')) as fp
    from auth.users u`;

let lastAuthFingerprint: string | null = null;

/**
 * Empties the tables. Fast path: `delete` with `session_replication_role = replica` (no triggers, no foreign key
 * checks — every table goes anyway; ~0.1 s against ~1 s of `truncate` over a hundred tables). Where the role may
 * not set it, `truncate … cascade` as the owner, with the audit log's truncate guard switched off for the moment.
 */
async function emptyTables(c: pg.PoolClient, tables: string[]): Promise<void> {
  await c.query('begin');
  try {
    await c.query('savepoint fast');
    await c.query('set local session_replication_role = replica');
    for (const t of tables) await c.query(`delete from ${t}`);
  } catch {
    await c.query('rollback to savepoint fast');
    await c.query('alter table public.audit_log disable trigger audit_log_no_truncate');
    await c.query(`truncate ${tables.join(', ')} cascade`);
    await c.query('alter table public.audit_log enable trigger audit_log_no_truncate');
  }
  await c.query('commit');
}

async function authFingerprint(c: pg.PoolClient): Promise<string | null> {
  try {
    const { rows } = await c.query<{ fp: string }>(AUTH_FINGERPRINT);
    return rows[0]?.fp ?? null;
  } catch {
    return null; // no Supabase Auth schema (a plain Postgres)
  }
}

/**
 * Replaces the whole database content with the seed `db` (as the table owner: the append-only audit log is
 * emptied too).
 */
export async function loadSeed(pool: pg.Pool, db: Db, o: LoadSeedOptions = {}): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query(`select pg_advisory_lock(hashtext('mig-api-test-seed'))`);
    // The API's own tables go too (`delete` under the replica role does not cascade): BFF sessions, sign-in steps, queues.
    const sessions = o.keepSessions ? [] : ['public.app_sessions'];
    const tables = [...sessions, ...TABLES.filter((t) => !(o.keepSessions && t.table === 'sessions')).map((t) => `public.${t.table}`), 'public.app_auth_challenges', 'app.identity_sync', 'app.job_queue', 'app.job_marks', 'app.invitations'];
    await emptyTables(c, tables);
    const sql = o.sql ?? buildSeedSql(db);
    const fp = o.authUsers === 'when-changed' ? await authFingerprint(c) : null;
    if (fp !== null && fp === lastAuthFingerprint) {
      // The demo users are as the last load left them: the data only (the auth block is the file's tail).
      await c.query(sql.slice(0, sql.lastIndexOf(buildAuthSeedSql(db))));
    } else {
      await c.query(sql);
      // Supabase Auth users the tests created (invited accounts) go too: the seed provisions its own.
      const ids = identitiesOfDb(db).map((i) => i.userId);
      await c.query(`delete from auth.users where not (id = any($1::uuid[]))`, [ids]).catch(() => undefined);
      lastAuthFingerprint = await authFingerprint(c);
    }
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    await c.query(`select pg_advisory_unlock(hashtext('mig-api-test-seed'))`).catch(() => undefined);
    c.release();
  }
}
