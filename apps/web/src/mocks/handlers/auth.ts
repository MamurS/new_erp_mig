import { http } from 'msw';
import { z } from 'zod';
import { loginSchema, otpSchema, phoneLoginSchema, phoneVerifySchema } from '@mig/contracts/forms';
import type { SessionResponse } from '@mig/contracts/dto';
import { db, type ChallengeRow } from '../db';
import { API, audit, body, HttpError, requireSession, route, sessionUserFor } from '../http';
import { randomToken } from '@mig/seed/rng';
import { DEMO_CODE } from '@mig/seed/credentials';
import { tzIso } from '@mig/seed/time';
import { dmsParam } from '../params';

// Attempt limits are DMS parameters: loginMaxAttempts, loginWindowMinutes, loginLockMinutes.
const CHALLENGE_TTL = 5 * 60_000;
const NIL = '00000000-0000-4000-8000-000000000000';

const invalidCreds = () => new HttpError(401, 'unauthorized', 'srv.auth.invalidCreds');
const invalidCode = () => new HttpError(401, 'unauthorized', 'srv.auth.invalidCode');

function checkLock(key: string): void {
  const d = db();
  const now = Date.now();
  d.lockouts = d.lockouts.filter((l) => l.until > now);
  if (d.lockouts.some((l) => l.key === key)) {
    throw new HttpError(429, 'rate_limited', 'srv.auth.locked', { params: { minutes: dmsParam('loginLockMinutes') } });
  }
}

function recordFailure(key: string): void {
  const d = db();
  const now = Date.now();
  d.loginFailures = d.loginFailures.filter((f) => now - f.at < dmsParam('loginWindowMinutes') * 60_000);
  d.loginFailures.push({ key, at: now });
  if (d.loginFailures.filter((f) => f.key === key).length >= dmsParam('loginMaxAttempts')) {
    d.lockouts.push({ key, until: now + dmsParam('loginLockMinutes') * 60_000 });
    d.loginFailures = d.loginFailures.filter((f) => f.key !== key);
  }
}

function newChallenge(userId: string, kind: ChallengeRow['kind'], lockKey?: string): { challengeId: string; resendInSec: number } {
  const d = db();
  const c: ChallengeRow = { id: randomToken(24), userId, kind, expiresAt: Date.now() + CHALLENGE_TTL, attempts: 0, lockKey };
  d.challenges = d.challenges.filter((x) => x.expiresAt > Date.now());
  d.challenges.push(c);
  return { challengeId: c.id, resendInSec: 60 };
}

function verify(challengeId: string, code: string): SessionResponse {
  const d = db();
  const c = d.challenges.find((x) => x.id === challengeId);
  if (!c || c.expiresAt < Date.now()) throw invalidCode();
  const lockKey = c.lockKey ?? `challenge:${c.userId}`;
  checkLock(lockKey);
  if (code !== DEMO_CODE || c.userId === NIL) {
    c.attempts += 1;
    recordFailure(lockKey);
    if (c.attempts >= dmsParam('loginMaxAttempts')) d.challenges = d.challenges.filter((x) => x !== c);
    throw invalidCode();
  }
  d.challenges = d.challenges.filter((x) => x !== c);
  const role =
    c.kind === 'hr'
      ? 'hr'
      : c.kind === 'insured'
        ? 'insured'
        : c.kind === 'clinic'
          ? d.clinicUsers.find((u) => u.id === c.userId)?.role
          : c.kind === 'assist'
            ? d.assistUsers.find((u) => u.id === c.userId)?.role
            : d.staff.find((s) => s.id === c.userId)?.role;
  if (!role) throw invalidCode();
  const user = sessionUserFor(d, c.userId, role);
  if (!user) throw invalidCode();
  const sessionId = randomToken(32);
  const now = Date.now();
  d.sessions.push({ id: sessionId, userId: user.id, role: user.role, createdAt: now, lastActivity: now });
  const staffRow = d.staff.find((s) => s.id === user.id) ?? d.clinicUsers.find((u) => u.id === user.id) ?? d.assistUsers.find((u) => u.id === user.id);
  if (staffRow) staffRow.lastLoginAt = tzIso(now);
  audit(user, 'login', { targetType: 'session' });
  return { sessionId, user };
}

export const authHandlers = [
  http.post(
    `${API}/auth/login`,
    route(async ({ request }) => {
      const { email, password } = await body(request, loginSchema);
      const key = `email:${email}`;
      checkLock(key);
      const d = db();
      const staff = d.staff.find((s) => s.email === email && s.active);
      const hr = d.hrUsers.find((h) => h.email === email);
      const clinicUser = d.clinicUsers.find((u) => u.email === email && u.active);
      const assistUser = d.assistUsers.find((u) => u.email === email && u.active);
      const account = staff ?? hr ?? clinicUser ?? assistUser;
      if (!account || account.password !== password) {
        recordFailure(key);
        audit({ id: NIL, displayName: 'Неизвестный', role: staff?.role ?? 'operator' }, 'login_failed', {
          targetType: 'session',
        });
        throw invalidCreds();
      }
      return newChallenge(account.id, staff ? 'staff' : clinicUser ? 'clinic' : assistUser ? 'assist' : 'hr');
    }),
  ),
  http.post(
    `${API}/auth/resend`,
    route(async ({ request }) => {
      const { challengeId } = await body(request, z.object({ challengeId: z.string().trim().min(1).max(128) }));
      const c = db().challenges.find((x) => x.id === challengeId);
      if (!c || c.expiresAt < Date.now()) throw invalidCode();
      c.expiresAt = Date.now() + CHALLENGE_TTL;
      return { challengeId: c.id, resendInSec: 60 };
    }),
  ),
  http.post(
    `${API}/auth/otp`,
    route(async ({ request }) => {
      const { challengeId, code } = await body(request, otpSchema);
      return verify(challengeId, code);
    }),
  ),
  http.post(
    `${API}/auth/phone`,
    route(async ({ request }) => {
      const { phone } = await body(request, phoneLoginSchema);
      const key = `phone:${phone}`;
      checkLock(key);
      const person = db().insured.find((i) => i.phone === phone && i.status === 'active');
      // Unknown numbers get a dead challenge: the response does not reveal whether the number exists.
      // Failures and lockouts are counted per number for both cases (a shared key for all unknown
      // numbers would lock them together and so tell them apart from real ones).
      return newChallenge(person?.userId ?? NIL, 'insured', key);
    }),
  ),
  http.post(
    `${API}/auth/phone/verify`,
    route(async ({ request }) => {
      const { challengeId, code } = await body(request, phoneVerifySchema);
      return verify(challengeId, code);
    }),
  ),
  http.post(
    `${API}/auth/logout`,
    route(({ request, url }) => {
      let auth;
      try {
        auth = requireSession(request);
      } catch {
        return { ok: true as const };
      }
      const d = db();
      // `?all=1` — «Выйти на всех устройствах»: every session of the person ends, not only this one.
      const all = url.searchParams.get('all') === '1';
      d.sessions = d.sessions.filter((s) => (all ? s.userId !== auth.session.userId : s.id !== auth.session.id));
      audit(auth.user, 'logout', { targetType: 'session' });
      return { ok: true as const };
    }),
  ),
  http.get(
    `${API}/auth/me`,
    route(({ request }) => requireSession(request).user),
  ),
];

