/*
 * Supabase Auth follows our account tables (BACKEND_SPEC §7): roles and bindings live only in `app_metadata`,
 * set here with the service role. Triggers queue every new account and every change of e-mail, phone, role,
 * binding or activity in `app.identity_sync` (migration …_auth_sessions.sql); the worker takes the queue and the
 * session store calls `syncOne` directly when a token's claims no longer match the account.
 *
 * - a new e-mail account (an admin created a MIG user, the sales manager opened an HR cabinet, a clinic or an
 *   assistance company got its users): created unconfirmed and invited — `inviteUserByEmail`, the e-mail goes
 *   through the SMTP of Supabase Auth (GOTRUE_SMTP_* of the deployment). Development and ci with DEMO_PASSWORD:
 *   created confirmed with the demo password instead (no SMTP there), with the demo TOTP factor (test MFA mode);
 * - a new phone account (an employee invited to the app): a confirmed phone, signed in with a one-time code;
 * - a deactivated account is banned (its BFF sessions already ended with its `sessions` rows).
 */
import type pg from 'pg';
import { devFactorId, devTotpSecret } from '@mig/domain/auth/devMfa';
import { APP_METADATA_KEYS, identityOf } from '@mig/domain/auth/identity';
import type { PiiCrypto } from '@mig/domain/store/pii';
import { AuthApiError, type AdminUserParams, type GoTrue } from '../auth/gotrue';
import { withSystemDb } from '../systemDb';

const BANNED = '876000h';

export interface IdentitySyncOptions {
  pool: pg.Pool;
  crypto: PiiCrypto;
  gotrue: GoTrue;
  /** DEV/CI/STAGING ONLY: new e-mail accounts get this password instead of an invitation e-mail. */
  demoPassword?: string;
  /** Test MFA mode: new e-mail accounts get the demo TOTP factor. */
  testMfa: boolean;
  /** Where the invitation link leads (the sign-in page of the deployment). */
  inviteRedirectTo?: string;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

export interface IdentitySync {
  syncOne(userId: string): Promise<void>;
  /** Takes up to `limit` queued accounts; failures are retried with a growing delay. */
  runPending(limit?: number): Promise<{ synced: number; failed: number }>;
  /** Test MFA mode only: the demo TOTP factor of an account (the same the seed provisions). */
  ensureDemoFactor(userId: string): Promise<void>;
}

export function identitySync(o: IdentitySyncOptions): IdentitySync {
  const log = o.log ?? (() => undefined);

  async function ensureDemoFactor(userId: string): Promise<void> {
    if (!o.testMfa) throw new Error('demo TOTP factors exist only in the test MFA mode');
    // Supabase Auth has no API to enrol a factor with a known secret; the test mode writes it like the seed does.
    await o.pool.query(
      `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
       values ($1::uuid, $2::uuid, 'MIG demo', 'totp', 'verified', now(), now(), $3) on conflict (id) do nothing`,
      [devFactorId(userId), userId, devTotpSecret(userId)],
    );
  }

  async function syncOne(userId: string): Promise<void> {
    const spec = await withSystemDb(o.pool, { crypto: o.crypto }, (ctx) => identityOf(ctx.repos, userId));
    const existing = await o.gotrue.adminGetUser(userId);
    if (!spec) {
      if (existing) await o.gotrue.adminUpdateUser(userId, { ban_duration: BANNED });
      return;
    }
    // Keys the account no longer has are removed (null deletes a key of app_metadata).
    const appMetadata: Record<string, unknown> = Object.fromEntries(
      APP_METADATA_KEYS.map((k) => [k, spec.appMetadata[k] ?? null]),
    );
    const ban = spec.active ? 'none' : BANNED;
    if (existing) {
      const p: AdminUserParams = { app_metadata: appMetadata, ban_duration: ban };
      if (spec.email && spec.email !== existing.email)
        Object.assign(p, { email: spec.email, email_confirm: true });
      if (spec.phone && spec.phone !== existing.phone)
        Object.assign(p, { phone: spec.phone, phone_confirm: true });
      await o.gotrue.adminUpdateUser(userId, p);
      return;
    }
    if (spec.email) {
      if (o.demoPassword) {
        await o.gotrue.adminCreateUser({
          id: userId,
          email: spec.email,
          password: o.demoPassword,
          email_confirm: true,
          app_metadata: appMetadata,
        });
        if (o.testMfa) await ensureDemoFactor(userId);
      } else {
        await o.gotrue.adminCreateUser({
          id: userId,
          email: spec.email,
          email_confirm: false,
          app_metadata: appMetadata,
        });
        await o.gotrue.inviteUserByEmail(spec.email, o.inviteRedirectTo);
      }
    } else if (spec.phone) {
      await o.gotrue.adminCreateUser({
        id: userId,
        phone: spec.phone,
        phone_confirm: true,
        app_metadata: appMetadata,
      });
    } else {
      return;
    }
    if (!spec.active) await o.gotrue.adminUpdateUser(userId, { ban_duration: BANNED });
  }

  async function runPending(limit = 20): Promise<{ synced: number; failed: number }> {
    // A lease of five minutes: two workers never take the same account at once.
    const { rows } = await o.pool.query<{ user_id: string; requested_at: Date; attempts: number }>(
      `update app.identity_sync s set next_attempt_at = now() + interval '5 minutes'
         where s.user_id in (select user_id from app.identity_sync where next_attempt_at <= now() order by requested_at limit $1 for update skip locked)
       returning s.user_id::text as user_id, s.requested_at, s.attempts`,
      [limit],
    );
    let synced = 0;
    let failed = 0;
    for (const r of rows) {
      try {
        await syncOne(r.user_id);
        await o.pool.query(`delete from app.identity_sync where user_id = $1::uuid and requested_at <= $2`, [
          r.user_id,
          r.requested_at,
        ]);
        synced++;
      } catch (e) {
        failed++;
        const why =
          e instanceof AuthApiError ? `${e.status} ${e.code}` : e instanceof Error ? e.name : 'error';
        log('identity sync failed', { reason: why, attempts: r.attempts + 1 });
        await o.pool.query(
          `update app.identity_sync set attempts = attempts + 1, last_error = $2, next_attempt_at = now() + least(interval '1 hour', interval '30 seconds' * power(2, attempts)) where user_id = $1::uuid`,
          [r.user_id, why.slice(0, 200)],
        );
      }
    }
    return { synced, failed };
  }

  return { syncOne, runPending, ensureDemoFactor };
}
