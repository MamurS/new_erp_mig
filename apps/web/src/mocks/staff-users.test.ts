// @vitest-environment node
/* «+ Создать → Пользователь» on the mock server: only admin invites MIG employees; the body is validated. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionResponse } from '@mig/contracts/dto';
import type { StaffUser } from '@mig/contracts';
import { createMockServer } from './node';
import { lastSession, track, withSession } from './test-session';
import { resetDb } from './db';

const BASE = 'http://localhost/api';
const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => resetDb());

async function call<T>(path: string, init: { method?: string; sid?: string; json?: unknown } = {}): Promise<{ status: number; data: T }> {
  const headers = new Headers();
  withSession(headers, init.sid);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  const res = track(await fetch(`${BASE}${path}`, { method: init.method ?? 'GET', headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) }));
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T };
}
async function login(email: string): Promise<string> {
  const a = await call<{ challengeId: string }>('/auth/login', { method: 'POST', json: { email, password: 'Demo-2026!' } });
  const b = await call<SessionResponse>('/auth/otp', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
  expect(b.status).toBe(200);
  return lastSession();
}

const INVITE = { fullName: 'Karimov Aziz Bahodirovich', email: 'new.employee@demo.mig.uz', role: 'operator' };

describe('POST /admin/users', () => {
  it('admin invites an employee; the list shows them, the password never leaves the server', async () => {
    const sid = await login('admin@demo.mig.uz');
    const r = await call<StaffUser & { password?: string }>('/admin/users', { method: 'POST', sid, json: { ...INVITE, email: '  New.Employee@demo.mig.uz ' } });
    expect(r.status).toBe(201);
    expect(r.data).toMatchObject({ fullName: INVITE.fullName, email: INVITE.email, role: 'operator', active: true });
    expect(r.data.password).toBeUndefined();
    const list = await call<StaffUser[]>('/admin/users', { sid });
    expect(list.data.some((u) => u.email === INVITE.email)).toBe(true);
  });

  it('a taken email is a conflict, a bad body a validation error', async () => {
    const sid = await login('admin@demo.mig.uz');
    expect((await call('/admin/users', { method: 'POST', sid, json: { ...INVITE, email: 'operator@demo.mig.uz' } })).status).toBe(409);
    expect((await call('/admin/users', { method: 'POST', sid, json: { ...INVITE, role: 'hr' } })).status).toBe(422);
  });

  it.each(['operator@demo.mig.uz', 'underwriter@demo.mig.uz', 'sales@demo.mig.uz', 'hr@demo-client.uz', 'admin@demo-clinic.uz'])('%s may not', async (email) => {
    const sid = await login(email);
    expect((await call('/admin/users', { method: 'POST', sid, json: INVITE })).status).toBe(403);
  });
});
