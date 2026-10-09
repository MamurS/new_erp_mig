// @vitest-environment node
/*
 * Invitations of e-mail accounts on the mock server (stage 1.5): a new account gets an e-mail with a single-use link;
 * the link sets the password once, expires, and a resend revokes it. Who may resend and see the list.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '@mig/contracts/dto';
import type { ClinicUserView } from '@mig/contracts/dto';
import type { InvitationBrief, InvitationCheck, InvitationView, StaffUser } from '@mig/contracts';
import { createMockServer } from './node';
import { lastSession, track, withSession } from './test-session';
import { db, resetDb } from './db';
import { outbox } from './outbox';

const BASE = 'http://localhost/api';
const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  outbox.length = 0;
});
afterEach(() => vi.useRealTimers());

async function call<T>(path: string, init: { method?: string; sid?: string; json?: unknown } = {}): Promise<{ status: number; data: T }> {
  const headers = new Headers();
  withSession(headers, init.sid);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  const res = track(await fetch(`${BASE}${path}`, { method: init.method ?? 'GET', headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) }));
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T };
}
async function login(email: string, password = 'Demo-2026!'): Promise<string> {
  const a = await call<{ challengeId: string }>('/auth/login', { method: 'POST', json: { email, password } });
  expect(a.status).toBe(200);
  const b = await call<SessionResponse>('/auth/otp', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
  expect(b.status).toBe(200);
  return lastSession();
}
/** The token of the newest e-mail to `to` (the mail job runs before the next request). */
async function mailedToken(to: string): Promise<string> {
  await call('/auth/me');
  const m = [...outbox].reverse().find((x) => x.to === to);
  expect(m).toBeDefined();
  const token = /\/invite#([A-Za-z0-9_-]+)/.exec(m!.text)?.[1];
  expect(token).toBeTruthy();
  return token!;
}

const NEW = { fullName: 'Karimov Aziz Bahodirovich', email: 'new.employee@demo.mig.uz', role: 'operator' };
const PASSWORD = 'Novyi-parol-2026';

describe('invitations', () => {
  it('a new employee gets one e-mail; the link sets the password once, then the password signs in', async () => {
    const admin = await login('admin@demo.mig.uz');
    const created = await call<StaffUser>('/admin/users', { method: 'POST', sid: admin, json: NEW });
    expect(created.status).toBe(201);
    expect(created.data.invitation).toMatchObject({ status: 'pending' });
    const token = await mailedToken(NEW.email);
    const mail = outbox.find((x) => x.to === NEW.email)!;
    expect(mail.subject).toContain('Mosaic Insurance Group');
    expect(mail.text).toContain(NEW.fullName);
    // Sent once: more requests do not send it again; the list shows when it left.
    await call('/auth/me');
    expect(outbox.filter((x) => x.to === NEW.email)).toHaveLength(1);
    const listed = (await call<StaffUser[]>('/admin/users', { sid: admin })).data.find((u) => u.email === NEW.email)!;
    expect(listed.invitation?.sentAt).toBeTruthy();
    // Only the hash is stored after the e-mail left.
    expect(JSON.stringify(db().invitations)).not.toContain(token);

    const check = await call<InvitationCheck>('/auth/invitation', { method: 'POST', json: { token } });
    expect(check.status).toBe(200);
    expect(check.data.email).not.toBe(NEW.email);
    expect(check.data.email).toMatch(/•/);
    expect((await call('/auth/invitation/accept', { method: 'POST', json: { token, password: 'short1', confirm: 'short1' } })).status).toBe(422);
    expect((await call('/auth/invitation/accept', { method: 'POST', json: { token, password: PASSWORD, confirm: `${PASSWORD}x` } })).status).toBe(422);
    expect((await call('/auth/invitation/accept', { method: 'POST', json: { token, password: PASSWORD, confirm: PASSWORD } })).status).toBe(200);
    // Once: the link is used.
    expect((await call('/auth/invitation/accept', { method: 'POST', json: { token, password: PASSWORD, confirm: PASSWORD } })).status).toBe(409);
    expect((await call('/auth/invitation', { method: 'POST', json: { token } })).status).toBe(409);
    // The demo password no longer works, the new one does; the list no longer shows an invitation.
    expect((await call('/auth/login', { method: 'POST', json: { email: NEW.email, password: 'Demo-2026!' } })).status).toBe(401);
    await login(NEW.email, PASSWORD);
    expect((await call<StaffUser[]>('/admin/users', { sid: admin })).data.find((u) => u.email === NEW.email)!.invitation).toBeUndefined();
    const actions = db().audit.filter((a) => a.targetLabel === NEW.fullName).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['invitation_sent', 'invitation_accepted']));
    // A resend after the password is set: nothing to resend.
    expect((await call(`/invitations/${created.data.id}/resend`, { method: 'POST', sid: admin })).status).toBe(409);
  });

  it('an unknown or malformed token is refused; the link expires after «Срок действия приглашения»', async () => {
    expect((await call('/auth/invitation', { method: 'POST', json: { token: 'x'.repeat(43) } })).status).toBe(404);
    expect((await call('/auth/invitation', { method: 'POST', json: { token: 'bad token' } })).status).toBe(422);
    const admin = await login('admin@demo.mig.uz');
    await call('/admin/users', { method: 'POST', sid: admin, json: NEW });
    const token = await mailedToken(NEW.email);
    vi.useFakeTimers({ now: Date.now() + 3 * 24 * 3600_000 + 60_000, toFake: ['Date'] });
    const expired = await call<{ key: string }>('/auth/invitation', { method: 'POST', json: { token } });
    expect(expired.status).toBe(409);
    expect(expired.data.key).toBe('srv.invite.expired');
    expect((await call('/auth/invitation/accept', { method: 'POST', json: { token, password: PASSWORD, confirm: PASSWORD } })).status).toBe(409);
    const admin2 = await login('admin@demo.mig.uz');
    expect((await call<StaffUser[]>('/admin/users', { sid: admin2 })).data.find((u) => u.email === NEW.email)!.invitation?.status).toBe('expired');
  });

  it('«Отправить повторно»: a new e-mail, the old link stops working', async () => {
    const admin = await login('admin@demo.mig.uz');
    const created = (await call<StaffUser>('/admin/users', { method: 'POST', sid: admin, json: NEW })).data;
    const first = await mailedToken(NEW.email);
    const again = await call<InvitationBrief>(`/invitations/${created.id}/resend`, { method: 'POST', sid: admin });
    expect(again.status).toBe(200);
    expect(again.data.status).toBe('pending');
    const second = await mailedToken(NEW.email);
    expect(second).not.toBe(first);
    expect((await call('/auth/invitation', { method: 'POST', json: { token: first } })).status).toBe(404);
    expect((await call('/auth/invitation', { method: 'POST', json: { token: second } })).status).toBe(200);
  });

  it('a clinic administrator resends to their own clinic only; the MIG list of invitations is the administrator’s', async () => {
    const clinicAdmin = await login('admin@demo-clinic.uz');
    const u = await call<ClinicUserView>('/clinic/users', { method: 'POST', sid: clinicAdmin, json: { fullName: 'Rasulova Dilnoza Akmalovna', email: 'reg2@demo-clinic.uz', role: 'clinic_registrar' } });
    expect(u.status).toBe(200);
    expect(u.data.invitation?.status).toBe('pending');
    expect((await call(`/invitations/${u.data.id}/resend`, { method: 'POST', sid: clinicAdmin })).status).toBe(200);
    // Not someone else's account.
    const staffId = db().staff.find((s) => s.email === 'operator@demo.mig.uz')!.id;
    expect((await call(`/invitations/${staffId}/resend`, { method: 'POST', sid: clinicAdmin })).status).toBe(404);
    expect((await call('/invitations', { sid: clinicAdmin })).status).toBe(404);
    const operator = await login('operator@demo.mig.uz');
    expect((await call(`/invitations/${u.data.id}/resend`, { method: 'POST', sid: operator })).status).toBe(404);
    const admin = await login('admin@demo.mig.uz');
    const list = await call<InvitationView[]>('/invitations', { sid: admin });
    expect(list.data.find((x) => x.userId === u.data.id)).toMatchObject({ portal: 'clinic', fullName: 'Rasulova Dilnoza Akmalovna', status: 'pending' });
  });
});
