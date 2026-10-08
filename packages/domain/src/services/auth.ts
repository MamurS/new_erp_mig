/*
 * Sign-in (SPEC §5): e-mail + password (staff, HR, clinics, assistance) or phone (the insured), then a
 * one-time code. Attempt limits are DMS parameters (loginMaxAttempts, loginWindowMinutes, loginLockMinutes);
 * a lockout is kept per account key, and per phone number for both known and unknown numbers.
 *
 * The endpoints below are the mock's sign-in (demo password, demo code). The API signs in with Supabase Auth
 * (apps/api/src/auth/bff.ts) and shares the rest from here: the account lookup, the attempt counters and
 * lockouts, and what a successful sign-in records.
 */
import { z } from 'zod';
import type { SessionUser } from '@mig/contracts';
import { loginSchema, otpSchema, phoneLoginSchema, phoneVerifySchema } from '@mig/contracts/forms';
import { DEMO_CODE } from '../auth/demo';
import { randomToken } from '../lib/random';
import { tzIso } from '../lib/time';
import type { ChallengeRow } from '../store/db';
import { audit, DomainError, validate, type AuthCtx, type BaseCtx } from './kernel';
import { loadParams, type ParamsView } from './params';
import { sessionUserFor } from './session';

/**
 * A completed sign-in inside the server: the new session's id goes into the session cookie (the adapters set
 * it), the answer's body is `{ user }` (SessionResponse) — the browser's code never sees the id.
 */
export interface SignedIn {
  sessionId: string;
  user: SessionUser;
}

const CHALLENGE_TTL = 5 * 60_000;
const NIL = '00000000-0000-4000-8000-000000000000';

export const invalidCreds = () => new DomainError(401, 'unauthorized', 'srv.auth.invalidCreds');
export const invalidCode = () => new DomainError(401, 'unauthorized', 'srv.auth.invalidCode');

/** 429 while the key is locked out (expired lockouts are dropped first). */
export async function checkLock(ctx: BaseCtx, P: ParamsView, key: string): Promise<void> {
  await ctx.repos.lockouts.removeWhere({ until: { lte: ctx.now() } });
  if (await ctx.repos.lockouts.exists({ key })) {
    throw new DomainError(429, 'rate_limited', 'srv.auth.locked', { params: { minutes: P.dmsParam('loginLockMinutes') } });
  }
}

/** A failed attempt for the key; enough of them within the window lock the key out. */
export async function recordFailure(ctx: BaseCtx, P: ParamsView, key: string): Promise<void> {
  const r = ctx.repos;
  const now = ctx.now();
  await r.loginFailures.removeWhere({ at: { lte: now - P.dmsParam('loginWindowMinutes') * 60_000 } });
  await r.loginFailures.insert({ key, at: now });
  if ((await r.loginFailures.count({ key })) >= P.dmsParam('loginMaxAttempts')) {
    await r.lockouts.put({ key, until: now + P.dmsParam('loginLockMinutes') * 60_000 });
    await r.loginFailures.removeWhere({ key });
  }
}

async function newChallenge(ctx: BaseCtx, userId: string, kind: ChallengeRow['kind'], lockKey?: string): Promise<{ challengeId: string; resendInSec: number }> {
  const c: ChallengeRow = { id: randomToken(24), userId, kind, expiresAt: ctx.now() + CHALLENGE_TTL, attempts: 0, lockKey };
  await ctx.repos.challenges.removeWhere({ expiresAt: { lte: ctx.now() } });
  await ctx.repos.challenges.insert(c);
  return { challengeId: c.id, resendInSec: 60 };
}

async function roleOf(ctx: BaseCtx, c: ChallengeRow): Promise<SessionUser['role'] | undefined> {
  const r = ctx.repos;
  if (c.kind === 'hr') return 'hr';
  if (c.kind === 'insured') return 'insured';
  if (c.kind === 'clinic') return (await r.clinicUsers.get(c.userId))?.role;
  if (c.kind === 'assist') return (await r.assistUsers.get(c.userId))?.role;
  return (await r.staff.get(c.userId))?.role;
}

/** An active account with this e-mail (staff, HR, clinic, assistance), in that order. */
export async function findAccount(ctx: BaseCtx, email: string): Promise<{ id: string; password: string; kind: ChallengeRow['kind']; role: SessionUser['role'] } | null> {
  const r = ctx.repos;
  const staff = await r.staff.first({ where: { email, active: true } });
  if (staff) return { id: staff.id, password: staff.password, kind: 'staff', role: staff.role };
  const hr = await r.hrUsers.first({ where: { email } });
  if (hr) return { id: hr.id, password: hr.password, kind: 'hr', role: 'hr' };
  const clinicUser = await r.clinicUsers.first({ where: { email, active: true } });
  if (clinicUser) return { id: clinicUser.id, password: clinicUser.password, kind: 'clinic', role: clinicUser.role };
  const assistUser = await r.assistUsers.first({ where: { email, active: true } });
  if (assistUser) return { id: assistUser.id, password: assistUser.password, kind: 'assist', role: assistUser.role };
  return null;
}

/** A failed password: counted for the lockout and audited (no account named). */
export async function passwordFailed(ctx: BaseCtx, P: ParamsView, key: string, email: string): Promise<never> {
  const staff = await ctx.repos.staff.first({ where: { email, active: true } });
  await recordFailure(ctx, P, key);
  await audit(ctx, { id: NIL, displayName: 'Неизвестный', role: staff?.role ?? 'operator' }, 'login_failed', { targetType: 'session' });
  throw invalidCreds();
}

/** What a successful sign-in records: the last login of the account and the `login` audit entry. */
export async function recordSignIn(ctx: BaseCtx, user: SessionUser): Promise<void> {
  const r = ctx.repos;
  const lastLoginAt = tzIso(ctx.now());
  if (await r.staff.exists({ id: user.id })) await r.staff.update(user.id, { lastLoginAt });
  else if (await r.clinicUsers.exists({ id: user.id })) await r.clinicUsers.update(user.id, { lastLoginAt });
  else if (await r.assistUsers.exists({ id: user.id })) await r.assistUsers.update(user.id, { lastLoginAt });
  await audit(ctx, user, 'login', { targetType: 'session' });
}

async function verify(ctx: BaseCtx, challengeId: string, code: string): Promise<SignedIn> {
  const r = ctx.repos;
  const P = await loadParams(ctx);
  const c = await r.challenges.get(challengeId);
  if (!c || c.expiresAt < ctx.now()) throw invalidCode();
  const lockKey = c.lockKey ?? `challenge:${c.userId}`;
  await checkLock(ctx, P, lockKey);
  if (code !== DEMO_CODE || c.userId === NIL) {
    c.attempts += 1;
    await r.challenges.update(c.id, { attempts: c.attempts });
    await recordFailure(ctx, P, lockKey);
    if (c.attempts >= P.dmsParam('loginMaxAttempts')) await r.challenges.remove(c.id);
    throw invalidCode();
  }
  await r.challenges.remove(c.id);
  const role = await roleOf(ctx, c);
  if (!role) throw invalidCode();
  const user = await sessionUserFor(ctx, c.userId, role);
  if (!user) throw invalidCode();
  const sessionId = randomToken(32);
  const now = ctx.now();
  await r.sessions.insert({ id: sessionId, userId: user.id, role: user.role, createdAt: now, lastActivity: now });
  await recordSignIn(ctx, user);
  return { sessionId, user };
}

// ---------------------------------------------------------------- endpoints

/** POST /auth/login: e-mail and password; a code challenge on success. */
export async function login(ctx: BaseCtx, body: unknown): Promise<{ challengeId: string; resendInSec: number }> {
  const { email, password } = validate(loginSchema, body);
  const P = await loadParams(ctx);
  const key = `email:${email}`;
  await checkLock(ctx, P, key);
  const account = await findAccount(ctx, email);
  if (!account || account.password !== password) return passwordFailed(ctx, P, key, email);
  return newChallenge(ctx, account.id, account.kind);
}

/** The body of POST /auth/resend. */
export const resendSchema = z.object({ challengeId: z.string().trim().min(1).max(128) });

/** POST /auth/resend: the same challenge lives another five minutes. */
export async function resend(ctx: BaseCtx, body: unknown): Promise<{ challengeId: string; resendInSec: number }> {
  const { challengeId } = validate(resendSchema, body);
  const c = await ctx.repos.challenges.get(challengeId);
  if (!c || c.expiresAt < ctx.now()) throw invalidCode();
  await ctx.repos.challenges.update(c.id, { expiresAt: ctx.now() + CHALLENGE_TTL });
  return { challengeId: c.id, resendInSec: 60 };
}

/** POST /auth/otp. */
export async function otp(ctx: BaseCtx, body: unknown): Promise<SignedIn> {
  const { challengeId, code } = validate(otpSchema, body);
  return verify(ctx, challengeId, code);
}

/** POST /auth/phone: the insured person's sign-in by phone. */
export async function phoneLogin(ctx: BaseCtx, body: unknown): Promise<{ challengeId: string; resendInSec: number }> {
  const { phone } = validate(phoneLoginSchema, body);
  const P = await loadParams(ctx);
  const key = `phone:${phone}`;
  await checkLock(ctx, P, key);
  const person = await ctx.repos.insured.first({ where: { phone, status: 'active' } });
  // Unknown numbers get a dead challenge: the response does not reveal whether the number exists.
  // Failures and lockouts are counted per number for both cases (a shared key for all unknown
  // numbers would lock them together and so tell them apart from real ones).
  return newChallenge(ctx, person?.userId ?? NIL, 'insured', key);
}

/** POST /auth/phone/verify. */
export async function phoneVerify(ctx: BaseCtx, body: unknown): Promise<SignedIn> {
  const { challengeId, code } = validate(phoneVerifySchema, body);
  return verify(ctx, challengeId, code);
}

/**
 * POST /auth/logout; `ctx` is null without a valid session (the answer is the same). `all` — «Выйти на всех
 * устройствах»: every session of the person ends, not only this one.
 */
export async function logout(ctx: AuthCtx | null, all: boolean): Promise<{ ok: true }> {
  if (!ctx) return { ok: true as const };
  if (all) await ctx.repos.sessions.removeWhere({ userId: ctx.session.userId });
  else await ctx.repos.sessions.remove(ctx.session.id);
  await audit(ctx, ctx.user, 'logout', { targetType: 'session' });
  return { ok: true as const };
}

/** GET /auth/me. */
export async function me(ctx: AuthCtx): Promise<SessionUser> {
  return ctx.user;
}
