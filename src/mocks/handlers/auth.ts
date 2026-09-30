import { http } from 'msw';
import { z } from 'zod';
import { loginSchema, otpSchema, phoneLoginSchema, phoneVerifySchema } from '@/shared/schemas/forms';
import type { SessionResponse } from '@/shared/types/dto';
import { db, type ChallengeRow } from '../db';
import { API, audit, body, HttpError, requireSession, route, sessionUserFor } from '../http';
import { randomToken } from '../rng';
import { DEMO_CODE } from '../credentials';
import { tzIso } from '../time';

const WINDOW = 10 * 60_000;
const LOCK = 5 * 60_000;
const MAX_FAILS = 5;
const CHALLENGE_TTL = 5 * 60_000;
const NIL = '00000000-0000-4000-8000-000000000000';

const invalidCreds = () => new HttpError(401, 'unauthorized', 'Неверный email или пароль');
const invalidCode = () => new HttpError(401, 'unauthorized', 'Неверный или устаревший код');

function checkLock(key: string): void {
  const d = db();
  const now = Date.now();
  d.lockouts = d.lockouts.filter((l) => l.until > now);
  if (d.lockouts.some((l) => l.key === key)) {
    throw new HttpError(429, 'rate_limited', 'Слишком много попыток. Вход заблокирован на 5 минут');
  }
}

function recordFailure(key: string): void {
  const d = db();
  const now = Date.now();
  d.loginFailures = d.loginFailures.filter((f) => now - f.at < WINDOW);
  d.loginFailures.push({ key, at: now });
  if (d.loginFailures.filter((f) => f.key === key).length >= MAX_FAILS) {
    d.lockouts.push({ key, until: now + LOCK });
    d.loginFailures = d.loginFailures.filter((f) => f.key !== key);
  }
}

function newChallenge(userId: string, kind: ChallengeRow['kind']): { challengeId: string; resendInSec: number } {
  const d = db();
  const c: ChallengeRow = { id: randomToken(24), userId, kind, expiresAt: Date.now() + CHALLENGE_TTL, attempts: 0 };
  d.challenges = d.challenges.filter((x) => x.expiresAt > Date.now());
  d.challenges.push(c);
  return { challengeId: c.id, resendInSec: 60 };
}

function verify(challengeId: string, code: string): SessionResponse {
  const d = db();
  const c = d.challenges.find((x) => x.id === challengeId);
  if (!c || c.expiresAt < Date.now()) throw invalidCode();
  const lockKey = `challenge:${c.userId}`;
  checkLock(lockKey);
  if (code !== DEMO_CODE || c.userId === NIL) {
    c.attempts += 1;
    recordFailure(lockKey);
    if (c.attempts >= MAX_FAILS) d.challenges = d.challenges.filter((x) => x !== c);
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
          : d.staff.find((s) => s.id === c.userId)?.role;
  if (!role) throw invalidCode();
  const user = sessionUserFor(d, c.userId, role);
  if (!user) throw invalidCode();
  const sessionId = randomToken(32);
  const now = Date.now();
  d.sessions.push({ id: sessionId, userId: user.id, role: user.role, createdAt: now, lastActivity: now });
  const staffRow = d.staff.find((s) => s.id === user.id) ?? d.clinicUsers.find((u) => u.id === user.id);
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
      const account = staff ?? hr ?? clinicUser;
      if (!account || account.password !== password) {
        recordFailure(key);
        audit({ id: NIL, displayName: 'Неизвестный', role: staff?.role ?? 'operator' }, 'login_failed', {
          targetType: 'session',
        });
        throw invalidCreds();
      }
      return newChallenge(account.id, staff ? 'staff' : clinicUser ? 'clinic' : 'hr');
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
      return newChallenge(person?.userId ?? NIL, 'insured');
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
    route(({ request }) => {
      let auth;
      try {
        auth = requireSession(request);
      } catch {
        return { ok: true as const };
      }
      const d = db();
      d.sessions = d.sessions.filter((s) => s.id !== auth.session.id);
      audit(auth.user, 'logout', { targetType: 'session' });
      return { ok: true as const };
    }),
  ),
  http.get(
    `${API}/auth/me`,
    route(({ request }) => requireSession(request).user),
  ),
];

