/*
 * Sign-in with Supabase Auth and BFF sessions (BACKEND_SPEC §2.4, §7).
 *
 * Sign-in (the same two steps the screens already have):
 * - staff, HR, clinics, assistance companies: `POST /auth/login` checks the password with Supabase Auth
 *   (`grant_type=password`, aal1) and answers a challenge; `POST /auth/otp` verifies the TOTP code of the
 *   person's factor (challenge + verify → aal2). A person without a verified factor enrols one at the first
 *   sign-in (`totpEnrollment` in the answer: the otpauth URI for the authenticator app). In the test MFA mode
 *   (development, ci, staging — never production) the demo code `000000` is turned into the current code of the
 *   demo factor (auth/devMfa.ts) and verified by Supabase Auth like any other code.
 * - the insured: `POST /auth/phone` asks Supabase Auth to send a one-time code (its Send SMS hook calls the API,
 *   auth/sms.ts); `POST /auth/phone/verify` verifies it. The answer never tells whether the number is known.
 * - attempt limits are the DMS parameters with the server counters of the services (lockouts, login_failures).
 *
 * Sessions: the access and refresh tokens stay on the server, sealed with the personal-data key, in
 * `app_sessions` (a row per session, keyed by an HMAC of the cookie value). The browser gets only the opaque
 * `__Host-mig_session` cookie. Every request: idle limit of the role (15/30 min) on the server, the access token
 * refreshed by the server when it is about to expire (10 min tokens), verified, its claims (sub, aal,
 * app_metadata) become the database claims of the request; `X-Background: 1` does not extend activity.
 * `POST /auth/logout` ends the session, `?all=1` every session of the person (and the Supabase sessions).
 *
 * The session is the cookie only: no `Authorization: Bearer` for people (that header belongs to the partner API)
 * and no session id in any answer.
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { Role, SessionUser } from '@mig/contracts';
import { loginSchema, otpSchema, phoneLoginSchema, phoneVerifySchema } from '@mig/contracts/forms';
import { DEMO_CODE, DEMO_PASSWORD } from '@mig/domain/auth/demo';
import { demoAccount, loginAsSchema, type DemoRouteOptions } from '@mig/domain/http/demoRoutes';
import { devFactorId, devTotpSecret, totpCode } from '@mig/domain/auth/devMfa';
import { APP_METADATA_KEYS, appMetadataOf, authPhone, sameAppMetadata } from '@mig/domain/auth/identity';
import { idleLimitsFor } from '@mig/domain/auth/home';
import type { RouteRequest } from '@mig/domain/http/request';
import { audit, notFound, unauthorized, validate, type AuthCtx, type BaseCtx } from '@mig/domain/services/kernel';
import {
  checkLock,
  findAccount,
  invalidCode,
  passwordFailed,
  recordFailure,
  recordSignIn,
  resendSchema,
} from '@mig/domain/services/auth';
import { loadParams } from '@mig/domain/services/params';
import { sessionUserFor } from '@mig/domain/services/session';
import type { PiiCrypto } from '@mig/domain/store/pii';
import type { Sql } from '@mig/domain/store/postgres';
import type pg from 'pg';
import type { Claims, RequestTx } from '../db';
import type { AuthAdapter, AuthAnswer, AuthRoute, RequestMeta } from '../sessions';
import { clearedCookie, readCookie, sessionCookie, type CookiePolicy } from './cookies';
import { AuthApiError, type GoTrue, type TokenSet } from './gotrue';
import type { TestPhoneCodes } from './sms';
import { InvalidToken, type AccessClaims, type JwtVerifier } from './jwt';

const CHALLENGE_TTL = 5 * 60_000;
const RESEND_SEC = 60;
/** The server refreshes the access token when less than this is left. */
const REFRESH_MARGIN = 60_000;
/** The idle limit allows a minute of grace (the warning dialog's countdown), as the mock does. */
const IDLE_GRACE = 60_000;

export interface BffOptions {
  /**
   * Refreshed tokens and the session's activity are stored outside the request transaction (Supabase rotates the
   * refresh token: a request that rolls back must not lose the new one; the activity must not lock the session
   * rows for the whole request).
   */
  pool: Pick<pg.Pool, 'query'>;
  gotrue: GoTrue;
  jwt: JwtVerifier;
  /** Seals the Supabase tokens and the phone of a pending sign-in (AES-256-GCM, the personal-data keys). */
  crypto: PiiCrypto;
  /** HMAC key of session and challenge ids in the database (SESSION_SECRET). */
  sessionSecret: string;
  cookie: CookiePolicy;
  /** Development, ci, staging: `000000` is the demo TOTP code; a person without a factor gets the demo factor. */
  testMfa: boolean;
  /** Brings the Supabase Auth user of an account in line with our tables (jobs/identity.ts). */
  syncIdentity?: (userId: string) => Promise<void>;
  /** Test MFA mode only: gives an account the demo TOTP factor (jobs/identity.ts). */
  ensureDemoFactor?: (userId: string) => Promise<void>;
  /** The services' clock (idle limits, challenge expiry). Token expiry always uses the real time. */
  now: () => number;
  /** Diagnostics without personal data. */
  log?: (msg: string, data?: Record<string, unknown>) => void;
  /** DEMO/CI/STAGING ONLY (with `testMfa`): the codes the Send SMS hook sent; `000000` stands for the last one. */
  testPhoneCodes?: TestPhoneCodes | null;
  /** DEMO/CI/STAGING ONLY (with `testMfa`): the accounts «Войти как…» may sign in as. */
  demoAccounts?: DemoRouteOptions;
}

interface SessionRec {
  session_id: string;
  user_id: string;
  role: Role;
  aal: 'aal1' | 'aal2';
  refresh_enc: Buffer;
  refresh_key_ver: number;
  access_enc: Buffer;
  access_key_ver: number;
  access_exp: number;
  last_activity: number;
  created_at: number;
}

interface ChallengeRec {
  kind: 'password' | 'phone';
  user_id: string | null;
  role: Role | null;
  lock_key: string;
  attempts: number;
  factor_id: string | null;
  enroll: boolean;
  access_enc: Buffer | null;
  access_key_ver: number | null;
  phone_enc: Buffer | null;
  phone_key_ver: number | null;
  expires_at: number;
}

/** A timestamptz column as epoch milliseconds under the given name. */
const ms = (col: string, as: string) => `(extract(epoch from ${col}) * 1000)::float8 as ${as}`;
const ts = (n: number) => new Date(n).toISOString();

/**
 * 401 for a session the server has just ended (idle limit, revoked token, account gone): only this answer clears the
 * cookie. An unknown session (ended earlier, e.g. by a logout) leaves the cookie alone — the answer to a request
 * still in flight from before a new sign-in must not clear the new session's cookie.
 */
export const sessionEnded = () => Object.assign(unauthorized(), { endedSession: true as const });
export const isSessionEnded = (e: unknown): boolean => (e as { endedSession?: boolean } | null)?.endedSession === true;

/** Staff, HR, clinics and assistance companies sign in with a second factor; the insured with a phone code. */
const needsAal2 = (role: Role) => role !== 'insured';

export function bffAuth(o: BffOptions): AuthAdapter {
  const hash = (kind: string, secret: string) =>
    createHmac('sha256', o.sessionSecret).update(`${kind}:${secret}`).digest();
  const newSecret = () => randomBytes(32).toString('base64url');
  const seal = async (v: string) => o.crypto.seal(v);
  const open = async (enc: Buffer | Uint8Array, ver: number) => o.crypto.open(new Uint8Array(enc), ver);
  const log = o.log ?? (() => undefined);

  const secretOf = (req: RouteRequest): string | null => readCookie(req.header('cookie'), o.cookie.name);

  // ------------------------------------------------------------------ sessions

  async function loadSession(sql: Sql, secret: string): Promise<SessionRec | null> {
    const { rows } = await sql.query(
      `select a.session_id, a.user_id::text as user_id, a.role, a.aal, a.refresh_enc, a.refresh_key_ver, a.access_enc, a.access_key_ver,
              ${ms('a.access_expires_at', 'access_exp')}, ${ms('a.last_activity', 'last_activity')}, ${ms('a.created_at', 'created_at')}
         from public.app_sessions a where a.id_hash = $1`,
      [hash('session', secret)],
    );
    return (rows[0] as unknown as SessionRec | undefined) ?? null;
  }

  /** Ends a session: the row of `sessions` and, through the foreign key, its BFF row. */
  async function endSession(sql: Sql, sessionId: string): Promise<void> {
    await sql.query(`delete from public.sessions where id = $1`, [sessionId]);
  }

  async function storeTokens(secret: string, t: TokenSet): Promise<void> {
    const access = await seal(t.access_token);
    const refresh = await seal(t.refresh_token);
    await o.pool.query(
      `update public.app_sessions set access_enc = $2, access_key_ver = $3, refresh_enc = $4, refresh_key_ver = $5, access_expires_at = $6 where id_hash = $1`,
      [hash('session', secret), access.enc, access.keyVer, refresh.enc, refresh.keyVer, ts(expiryOf(t))],
    );
  }

  const expiryOf = (t: TokenSet) => (t.expires_at ? t.expires_at * 1000 : Date.now() + t.expires_in * 1000);

  /** A new session after a completed sign-in: the cookie (the answer carries only the person). */
  async function createSession(
    tx: RequestTx,
    base: BaseCtx,
    t: TokenSet,
    user: SessionUser,
    aal: 'aal1' | 'aal2',
    meta: RequestMeta,
  ): Promise<AuthAnswer> {
    const sql = tx.system();
    const secret = newSecret();
    const sessionId = randomBytes(18).toString('base64url');
    const now = o.now();
    await base.repos.sessions.insert({
      id: sessionId,
      userId: user.id,
      role: user.role,
      createdAt: now,
      lastActivity: now,
    });
    const access = await seal(t.access_token);
    const refresh = await seal(t.refresh_token);
    const claims = await o.jwt.verify(t.access_token);
    await sql.query(
      `insert into public.app_sessions (id_hash, session_id, user_id, role, aal, refresh_enc, refresh_key_ver, access_enc, access_key_ver, access_expires_at, auth_session_id, created_at, last_activity, ip, user_agent)
       values ($1, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11::uuid, $12, $12, $13::inet, $14)`,
      [
        hash('session', secret),
        sessionId,
        user.id,
        user.role,
        aal,
        refresh.enc,
        refresh.keyVer,
        access.enc,
        access.keyVer,
        ts(expiryOf(t)),
        typeof claims.session_id === 'string' ? claims.session_id : null,
        ts(now),
        ipOrNull(meta.ip),
        meta.userAgent?.slice(0, 512) ?? null,
      ],
    );
    await recordSignIn(base, user);
    return {
      body: { user },
      cookies: [sessionCookie(o.cookie, secret)],
    };
  }

  /** Claims of a verified token in line with the server-side record, refreshing (and syncing) once when not. */
  async function freshClaims(
    secret: string,
    s: SessionRec,
    user: SessionUser,
    meta: RequestMeta,
  ): Promise<AccessClaims> {
    let access = await open(s.access_enc, s.access_key_ver);
    let refreshToken = await open(s.refresh_enc, s.refresh_key_ver);
    let refreshed = false;
    const refresh = async () => {
      // Supabase rotates the refresh token: a second refresh in this request uses the new one.
      const t = await o.gotrue.refresh(refreshToken, meta.ip);
      await storeTokens(secret, t);
      access = t.access_token;
      refreshToken = t.refresh_token;
      refreshed = true;
    };
    if (s.access_exp - Date.now() < REFRESH_MARGIN) await refresh();
    let claims: AccessClaims;
    try {
      claims = await o.jwt.verify(access);
    } catch (e) {
      if (!(e instanceof InvalidToken) || refreshed) throw e;
      await refresh();
      claims = await o.jwt.verify(access);
    }
    const expected = appMetadataOf(user);
    if (!sameAppMetadata(claims.app_metadata, expected)) {
      // A role or binding changed after the token was issued: bring Supabase Auth in line, then a new token.
      if (o.syncIdentity) await o.syncIdentity(user.id);
      await refresh();
      claims = await o.jwt.verify(access);
      if (!sameAppMetadata(claims.app_metadata, expected))
        throw new InvalidToken('app_metadata differs from the account');
    }
    return claims;
  }

  async function authenticate(
    tx: RequestTx,
    base: BaseCtx,
    req: RouteRequest,
    meta: RequestMeta,
  ): Promise<{ ctx: AuthCtx; claims: Claims }> {
    const secret = secretOf(req);
    if (!secret) throw unauthorized();
    const sql = tx.system();
    const s = await loadSession(sql, secret);
    if (!s) throw unauthorized();
    const now = o.now();
    if (now - s.last_activity > idleLimitsFor(s.role).timeoutMs + IDLE_GRACE) {
      await endSession(sql, s.session_id);
      throw sessionEnded();
    }
    const user = await sessionUserFor(base, s.user_id, s.role);
    if (!user) {
      await endSession(sql, s.session_id);
      throw sessionEnded();
    }
    let claims: AccessClaims;
    try {
      claims = await freshClaims(secret, s, user, meta);
    } catch (e) {
      // A revoked refresh token, a banned user, a token that does not match the account: the session ends.
      if (e instanceof InvalidToken || (e instanceof AuthApiError && e.status >= 400 && e.status < 500)) {
        log('session ended: token', { reason: e instanceof Error ? e.message : 'token' });
        await endSession(sql, s.session_id);
        throw sessionEnded();
      }
      throw e;
    }
    const aal = claims.aal === 'aal2' ? 'aal2' : 'aal1';
    if (claims.sub !== s.user_id || (needsAal2(user.role) && aal !== 'aal2')) {
      await endSession(sql, s.session_id);
      throw sessionEnded();
    }
    const active = req.header('X-Background') !== '1';
    const lastActivity = active ? now : s.last_activity;
    if (active || s.role !== user.role) {
      /*
       * The activity (and a changed role) is written outside the request's transaction, in one short statement:
       * held for the whole request, the session rows would serialize every parallel request of the person and
       * deadlock with a logout (it deletes `sessions`, then `app_sessions` by cascade). No row: the session has
       * just ended (a logout in parallel) — 401, not 500.
       */
      const { rowCount } = await o.pool.query(
        `with s as (update public.sessions set role = $3, last_activity = $4 where id = $2 returning id)
         update public.app_sessions a set last_activity = case when $6 then $5::timestamptz else a.last_activity end
          from s where a.id_hash = $1 and a.session_id = s.id`,
        [hash('session', secret), s.session_id, user.role, lastActivity, ts(now), active],
      );
      if (!rowCount) throw unauthorized();
    }
    const meta2: Record<string, unknown> = {};
    for (const k of APP_METADATA_KEYS)
      if (claims.app_metadata?.[k] !== undefined) meta2[k] = claims.app_metadata[k];
    return {
      ctx: {
        ...base,
        user,
        session: {
          id: s.session_id,
          userId: s.user_id,
          role: user.role,
          createdAt: s.created_at,
          lastActivity,
        },
      },
      claims: { sub: claims.sub, role: 'authenticated', aal, app_metadata: meta2 as Claims['app_metadata'] },
    };
  }

  /**
   * An account created or changed moments ago may still wait in the identity queue for the worker: its Supabase Auth
   * user is brought in line first, so the first sign-in right after the account was created works.
   */
  async function ensureSynced(tx: RequestTx, userId: string): Promise<void> {
    if (!o.syncIdentity) return;
    const { rows } = await tx.system().query(`select 1 from app.identity_sync where user_id = $1::uuid`, [userId]);
    if (rows.length) await o.syncIdentity(userId);
  }

  // ------------------------------------------------------------------ challenges

  async function newChallenge(
    sql: Sql,
    c: Omit<ChallengeRec, 'attempts' | 'expires_at'> & { refresh?: string; access?: string; phone?: string },
    meta: RequestMeta,
  ): Promise<string> {
    const id = newSecret();
    const access = c.access ? await seal(c.access) : null;
    const refresh = c.refresh ? await seal(c.refresh) : null;
    const phone = c.phone ? await seal(c.phone) : null;
    await sql.query(
      `insert into public.app_auth_challenges (id_hash, kind, user_id, role, lock_key, factor_id, enroll, access_enc, access_key_ver, refresh_enc, refresh_key_ver, phone_enc, phone_key_ver, expires_at, ip, user_agent)
       values ($1, $2, $3::uuid, $4, $5, $6::uuid, $7, $8, $9, $10, $11, $12, $13, $14, $15::inet, $16)`,
      [
        hash('challenge', id),
        c.kind,
        c.user_id,
        c.role,
        c.lock_key,
        c.factor_id,
        c.enroll,
        access?.enc ?? null,
        access?.keyVer ?? null,
        refresh?.enc ?? null,
        refresh?.keyVer ?? null,
        phone?.enc ?? null,
        phone?.keyVer ?? null,
        ts(o.now() + CHALLENGE_TTL),
        ipOrNull(meta.ip),
        meta.userAgent?.slice(0, 512) ?? null,
      ],
    );
    return id;
  }

  async function loadChallenge(
    sql: Sql,
    id: string,
    kind: ChallengeRec['kind'],
  ): Promise<ChallengeRec | null> {
    const { rows } = await sql.query(
      `select kind, user_id::text as user_id, role, lock_key, attempts, factor_id::text as factor_id, enroll, access_enc, access_key_ver, phone_enc, phone_key_ver, ${ms('expires_at', 'expires_at')}
         from public.app_auth_challenges where id_hash = $1 and kind = $2`,
      [hash('challenge', id), kind],
    );
    const c = (rows[0] as unknown as ChallengeRec | undefined) ?? null;
    return c && c.expires_at >= o.now() ? c : null;
  }

  /** A wrong code: counted on the challenge and for the lockout; the challenge dies after the attempt limit. */
  async function wrongCode(sql: Sql, base: BaseCtx, id: string, c: ChallengeRec): Promise<never> {
    const P = await loadParams(base);
    const attempts = c.attempts + 1;
    await recordFailure(base, P, c.lock_key);
    if (attempts >= P.dmsParam('loginMaxAttempts'))
      await sql.query(`delete from public.app_auth_challenges where id_hash = $1`, [hash('challenge', id)]);
    else
      await sql.query(`update public.app_auth_challenges set attempts = $2 where id_hash = $1`, [
        hash('challenge', id),
        attempts,
      ]);
    throw invalidCode();
  }

  // ------------------------------------------------------------------ routes

  const login: AuthRoute = async (tx, base, req, meta) => {
    const { email, password } = validate(loginSchema, await req.json());
    return passwordStep(tx, base, email, password, meta);
  };

  async function acceptedInvitation(userId: string): Promise<boolean> {
    const { rows } = await o.pool.query(`select 1 from app.invitations where user_id = $1::uuid and used_at is not null limit 1`, [userId]);
    return rows.length > 0;
  }

  async function passwordStep(tx: RequestTx, base: BaseCtx, email: string, password: string, meta: RequestMeta): Promise<AuthAnswer> {
    const P = await loadParams(base);
    const key = `email:${email}`;
    await checkLock(base, P, key);
    const account = await findAccount(base, email);
    if (account) await ensureSynced(tx, account.id);
    let tokens: TokenSet | null = null;
    if (account) {
      try {
        tokens = await o.gotrue.passwordGrant(email, password, meta.ip);
      } catch (e) {
        if (!(e instanceof AuthApiError) || e.status >= 500) throw e;
      }
    }
    if (!account || !tokens || tokens.user.id !== account.id) return passwordFailed(base, P, key, email);
    let factorId =
      tokens.user.factors?.find((f) => f.factor_type === 'totp' && f.status === 'verified')?.id ?? null;
    let enrollment: { uri: string; secret: string } | null = null;
    // An account that accepted an invitation enrols a real authenticator even in the test MFA mode (e2e of the first
    // sign-in); the demo factor is for the seeded and demo-password accounts only.
    if (!factorId && o.testMfa && o.ensureDemoFactor && !(await acceptedInvitation(account.id))) {
      await o.ensureDemoFactor(account.id);
      factorId = devFactorId(account.id);
    } else if (!factorId) {
      // The first sign-in: a TOTP factor to enrol (unverified leftovers of earlier attempts are removed first).
      for (const f of tokens.user.factors ?? [])
        if (f.status === 'unverified')
          await o.gotrue.unenroll(tokens.access_token, f.id).catch(() => undefined);
      const e = await o.gotrue.enrollTotp(
        tokens.access_token,
        `MIG ${new Date().toISOString().slice(0, 19)}`,
        meta.ip,
      );
      factorId = e.id;
      enrollment = { uri: e.totp.uri, secret: e.totp.secret };
    }
    const challengeId = await newChallenge(
      tx.system(),
      {
        kind: 'password',
        user_id: account.id,
        role: account.role,
        lock_key: `challenge:${account.id}`,
        factor_id: factorId,
        enroll: !!enrollment,
        access_enc: null,
        access_key_ver: null,
        phone_enc: null,
        phone_key_ver: null,
        access: tokens.access_token,
        refresh: tokens.refresh_token,
      },
      meta,
    );
    return {
      body: { challengeId, resendInSec: RESEND_SEC, ...(enrollment ? { totpEnrollment: enrollment } : {}) },
    };
  }

  const otp: AuthRoute = async (tx, base, req, meta) => {
    const { challengeId, code } = validate(otpSchema, await req.json());
    return codeStep(tx, base, challengeId, code, meta);
  };

  async function codeStep(tx: RequestTx, base: BaseCtx, challengeId: string, code: string, meta: RequestMeta): Promise<AuthAnswer> {
    const sql = tx.system();
    const c = await loadChallenge(sql, challengeId, 'password');
    if (!c || !c.user_id || !c.role || !c.factor_id || !c.access_enc || c.access_key_ver === null)
      throw invalidCode();
    const P = await loadParams(base);
    await checkLock(base, P, c.lock_key);
    const access = await open(c.access_enc, c.access_key_ver);
    // Test MFA mode: the demo code stands for the current code of the demo factor (never in production).
    const effective =
      o.testMfa && code === DEMO_CODE && c.factor_id === devFactorId(c.user_id)
        ? totpCode(devTotpSecret(c.user_id))
        : code;
    let tokens: TokenSet;
    try {
      const ch = await o.gotrue.challenge(access, c.factor_id, meta.ip);
      tokens = await o.gotrue.verifyFactor(access, c.factor_id, ch.id, effective, meta.ip);
    } catch (e) {
      if (e instanceof AuthApiError && e.status < 500) return wrongCode(sql, base, challengeId, c);
      throw e;
    }
    await sql.query(`delete from public.app_auth_challenges where id_hash = $1`, [
      hash('challenge', challengeId),
    ]);
    const user = tokens.user.id === c.user_id ? await sessionUserFor(base, c.user_id, c.role) : null;
    if (!user) throw invalidCode();
    return createSession(tx, base, tokens, user, 'aal2', meta);
  }

  const phone: AuthRoute = async (tx, base, req, meta) => {
    const { phone: number } = validate(phoneLoginSchema, await req.json());
    return phoneStep(tx, base, number, meta);
  };

  async function phoneStep(tx: RequestTx, base: BaseCtx, number: string, meta: RequestMeta): Promise<AuthAnswer> {
    const P = await loadParams(base);
    const key = `phone:${number}`;
    await checkLock(base, P, key);
    const person = await base.repos.insured.first({ where: { phone: number, status: 'active' } });
    if (person?.userId) await ensureSynced(tx, person.userId);
    // Supabase Auth sends the code (or refuses an unknown number): the answer is the same either way.
    await o.gotrue
      .sendPhoneOtp(authPhone(number), meta.ip)
      .catch((e: unknown) =>
        log('phone code not sent', {
          status: e instanceof AuthApiError ? e.status : 0,
          code: e instanceof AuthApiError ? e.code : 'error',
        }),
      );
    const challengeId = await newChallenge(
      tx.system(),
      {
        kind: 'phone',
        user_id: person?.userId ?? null,
        role: 'insured',
        lock_key: key,
        factor_id: null,
        enroll: false,
        access_enc: null,
        access_key_ver: null,
        phone_enc: null,
        phone_key_ver: null,
        phone: number,
      },
      meta,
    );
    return { body: { challengeId, resendInSec: RESEND_SEC } };
  }

  const phoneVerify: AuthRoute = async (tx, base, req, meta) => {
    const { challengeId, code } = validate(phoneVerifySchema, await req.json());
    return phoneCodeStep(tx, base, challengeId, code, meta);
  };

  async function phoneCodeStep(tx: RequestTx, base: BaseCtx, challengeId: string, code: string, meta: RequestMeta): Promise<AuthAnswer> {
    const sql = tx.system();
    const c = await loadChallenge(sql, challengeId, 'phone');
    if (!c || !c.phone_enc || c.phone_key_ver === null) throw invalidCode();
    const P = await loadParams(base);
    await checkLock(base, P, c.lock_key);
    if (!c.user_id) return wrongCode(sql, base, challengeId, c);
    let tokens: TokenSet;
    try {
      const number = authPhone(await open(c.phone_enc, c.phone_key_ver));
      // Test mode: the demo code of a phone that is not a demo phone stands for the code its SMS carried.
      const effective = o.testMfa && code === DEMO_CODE ? ((await o.testPhoneCodes?.take(number)) ?? code) : code;
      tokens = await o.gotrue.verifyPhoneOtp(number, effective, meta.ip);
    } catch (e) {
      if (e instanceof AuthApiError && e.status < 500) return wrongCode(sql, base, challengeId, c);
      throw e;
    }
    await sql.query(`delete from public.app_auth_challenges where id_hash = $1`, [
      hash('challenge', challengeId),
    ]);
    const user = tokens.user.id === c.user_id ? await sessionUserFor(base, c.user_id, 'insured') : null;
    if (!user) throw invalidCode();
    return createSession(tx, base, tokens, user, 'aal1', meta);
  }

  /**
   * DEMO/CI/STAGING ONLY — «Войти как…» (`POST /__demo/login-as`): the two steps of a real sign-in of a demo account
   * in one request (the demo password, the demo code of the test MFA mode, the fixed code of the demo phones), so
   * the session is a real Supabase session behind the BFF cookie. Only demo accounts; never registered in production.
   */
  const loginAs: AuthRoute = async (tx, base, req, meta) => {
    const accounts = o.demoAccounts;
    if (!accounts || !o.testMfa) throw notFound();
    const { login: who } = validate(loginAsSchema, await req.json());
    const acc = demoAccount(accounts, who);
    if (!acc) throw notFound();
    await endCurrent(tx, req);
    const first =
      'email' in acc ? await passwordStep(tx, base, acc.email, DEMO_PASSWORD, meta) : await phoneStep(tx, base, acc.phone, meta);
    const { challengeId } = first.body as { challengeId: string };
    const done =
      'email' in acc ? await codeStep(tx, base, challengeId, DEMO_CODE, meta) : await phoneCodeStep(tx, base, challengeId, DEMO_CODE, meta);
    return done;
  };

  /** The session a «Войти как…» replaces ends first (its cookie is overwritten by the new one). */
  async function endCurrent(tx: RequestTx, req: RouteRequest): Promise<void> {
    const secret = secretOf(req);
    const s = secret ? await loadSession(tx.system(), secret) : null;
    if (s) await endSession(tx.system(), s.session_id);
  }

  const resend: AuthRoute = async (tx, _base, req, meta) => {
    const { challengeId } = validate(resendSchema, await req.json());
    const sql = tx.system();
    const c =
      (await loadChallenge(sql, challengeId, 'phone')) ?? (await loadChallenge(sql, challengeId, 'password'));
    if (!c) throw invalidCode();
    if (c.kind === 'phone' && c.phone_enc && c.phone_key_ver !== null) {
      const number = await open(c.phone_enc, c.phone_key_ver);
      await o.gotrue
        .sendPhoneOtp(authPhone(number), meta.ip)
        .catch((e: unknown) =>
          log('phone code not resent', { status: e instanceof AuthApiError ? e.status : 0 }),
        );
    }
    await sql.query(`update public.app_auth_challenges set expires_at = $2 where id_hash = $1`, [
      hash('challenge', challengeId),
      ts(o.now() + CHALLENGE_TTL),
    ]);
    return { body: { challengeId, resendInSec: RESEND_SEC } };
  };

  const logout: AuthRoute = async (tx, base, req, meta) => {
    const done: AuthAnswer = { body: { ok: true }, cookies: [clearedCookie(o.cookie)] };
    const secret = secretOf(req);
    if (!secret) return done;
    const sql = tx.system();
    const s = await loadSession(sql, secret);
    if (!s) return done;
    const all = req.query.get('all') === '1';
    if (all) await sql.query(`delete from public.sessions where user_id = $1::uuid`, [s.user_id]);
    else await endSession(sql, s.session_id);
    // Supabase sessions end too (best effort: ours are already gone, and its tokens never left the server).
    try {
      let access = await open(s.access_enc, s.access_key_ver);
      if (s.access_exp - Date.now() < REFRESH_MARGIN)
        access = (await o.gotrue.refresh(await open(s.refresh_enc, s.refresh_key_ver), meta.ip)).access_token;
      await o.gotrue.logout(access, all ? 'global' : 'local');
    } catch (e) {
      log('supabase logout failed', { status: e instanceof AuthApiError ? e.status : 0 });
    }
    const user = await sessionUserFor(base, s.user_id, s.role);
    if (user) await audit(base, user, 'logout', { targetType: 'session' });
    return done;
  };

  return {
    authenticate,
    routes: {
      'POST /auth/login': login,
      'POST /auth/resend': resend,
      'POST /auth/otp': otp,
      'POST /auth/phone': phone,
      'POST /auth/phone/verify': phoneVerify,
      'POST /auth/logout': logout,
      ...(o.demoAccounts && o.testMfa ? { 'POST /__demo/login-as': loginAs } : {}),
    },
    expiredCookies: (req, error) =>
      readCookie(req.header('cookie'), o.cookie.name) && isSessionEnded(error) ? [clearedCookie(o.cookie)] : [],
  };
}

/** A valid IP for the `inet` column, or null. */
function ipOrNull(ip: string): string | null {
  return /^[0-9a-f.:]{2,45}$/i.test(ip) ? ip : null;
}
