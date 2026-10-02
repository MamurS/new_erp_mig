// @vitest-environment node
/*
 * The mock server behaves like the backend: sessions, permissions, masking, audit, business rules.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMockServer } from './node';
import { db, resetDb } from './db';
import type { SessionResponse } from '@/shared/types/dto';

const BASE = 'http://localhost/api';
const server = createMockServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
});

async function call(path: string, init: RequestInit & { sid?: string; json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  if (init.sid) headers.set('Authorization', `Bearer ${init.sid}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers, body });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* csv */
  }
  return { status: res.status, data: data as Record<string, unknown> & unknown[] };
}

async function loginStaff(email: string): Promise<SessionResponse> {
  const a = await call('/auth/login', { method: 'POST', json: { email, password: 'Demo-2026!' } });
  expect(a.status).toBe(200);
  const b = await call('/auth/otp', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
  expect(b.status).toBe(200);
  return b.data as unknown as SessionResponse;
}

async function loginInsured(phone = '+998 90 000 00 01'): Promise<SessionResponse> {
  const a = await call('/auth/phone', { method: 'POST', json: { phone } });
  const b = await call('/auth/phone/verify', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
  expect(b.status).toBe(200);
  return b.data as unknown as SessionResponse;
}

describe('mock auth', () => {
  it('rejects wrong password with a generic message and locks after 5 failures', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await call('/auth/login', { method: 'POST', json: { email: 'operator@demo.mig.uz', password: 'nope' } });
      expect(r.status).toBe(401);
      expect(r.data.message).toBe('Неверный email или пароль');
    }
    const locked = await call('/auth/login', { method: 'POST', json: { email: 'operator@demo.mig.uz', password: 'Demo-2026!' } });
    expect(locked.status).toBe(429);
  });

  it('returns 401 without session and ignores client-sent role headers', async () => {
    expect((await call('/dashboard')).status).toBe(401);
    const { sessionId } = await loginStaff('operator@demo.mig.uz');
    const r = await call('/audit', { sid: sessionId, headers: { 'X-Role': 'admin' } });
    expect(r.status).toBe(403);
    const r2 = await call('/audit?role=admin', { sid: sessionId });
    expect(r2.status).toBe(403);
  });

  it('logout invalidates the session', async () => {
    const { sessionId } = await loginStaff('admin@demo.mig.uz');
    expect((await call('/auth/me', { sid: sessionId })).status).toBe(200);
    await call('/auth/logout', { method: 'POST', sid: sessionId });
    expect((await call('/auth/me', { sid: sessionId })).status).toBe(401);
  });
});

describe('mock masking and reveal', () => {
  it('returns masked PII and reveals only with a reason, writing audit', async () => {
    const { sessionId } = await loginStaff('operator@demo.mig.uz');
    const person = db().insured[5]!;
    const r = await call(`/insured/${person.id}`, { sid: sessionId });
    expect(r.status).toBe(200);
    const raw = JSON.stringify(r.data);
    expect(raw).not.toContain(person.pinfl);
    expect(raw).not.toContain(person.phone.slice(4));
    expect(r.data.pinflMasked).toBe(`••••••••••${person.pinfl.slice(-4)}`);

    const bad = await call(`/insured/${person.id}/reveal`, { method: 'POST', sid: sessionId, json: { field: 'pinfl', reason: 'short' } });
    expect(bad.status).toBe(422);
    const before = db().audit.length;
    const ok = await call(`/insured/${person.id}/reveal`, {
      method: 'POST',
      sid: sessionId,
      json: { field: 'pinfl', reason: 'Звонок застрахованного' },
    });
    expect(ok.status).toBe(200);
    expect(ok.data.value).toBe(person.pinfl);
    expect(db().audit.length).toBe(before + 1);
    expect(db().audit[0]!.action).toBe('reveal_pii');
    expect(JSON.stringify(db().audit[0])).not.toContain(person.pinfl);
  });

  it('accountant sees names only, underwriter cannot reveal', async () => {
    const acc = await loginStaff('accountant@demo.mig.uz');
    const list = await call('/insured?pageSize=5', { sid: acc.sessionId });
    expect(list.status).toBe(200);
    const item = (list.data.items as Record<string, unknown>[])[0]!;
    expect(item.pinflMasked).toBeUndefined();
    expect(item.fullName).toBeTruthy();
    const uw = await loginStaff('underwriter@demo.mig.uz');
    const r = await call(`/insured/${item.id as string}/reveal`, { method: 'POST', sid: uw.sessionId, json: { field: 'pinfl', reason: 'Проверка данных клиента' } });
    expect(r.status).toBe(403);
  });
});

describe('mock business rules', () => {
  it('four eyes: underwriter cannot approve own limit request (409)', async () => {
    const { sessionId, user } = await loginStaff('underwriter@demo.mig.uz');
    const own = db().limitRequests.find((r) => r.requestedById === user.id && r.status === 'pending')!;
    const r = await call(`/limit-requests/${own.id}/approve`, { method: 'POST', sid: sessionId });
    expect(r.status).toBe(409);
    const other = db().limitRequests.find((x) => x.requestedById !== user.id && x.status === 'pending')!;
    expect((await call(`/limit-requests/${other.id}/approve`, { method: 'POST', sid: sessionId })).status).toBe(200);
  });

  it('medical review is mandatory for dental claims', async () => {
    const { sessionId } = await loginStaff('operator@demo.mig.uz');
    const claim = db().claims.find((c) => c.status === 'review' && c.category === 'dental')!;
    const r = await call(`/claims/${claim.id}/transition`, { method: 'POST', sid: sessionId, json: { to: 'approved' } });
    expect(r.status).toBe(409);
    const ok = await call(`/claims/${claim.id}/transition`, { method: 'POST', sid: sessionId, json: { to: 'medical_review' } });
    expect(ok.status).toBe(200);
  });

  it('rejection requires a comment', async () => {
    const { sessionId } = await loginStaff('operator@demo.mig.uz');
    const claim = db().claims.find((c) => c.status === 'review')!;
    const r = await call(`/claims/${claim.id}/transition`, { method: 'POST', sid: sessionId, json: { to: 'rejected' } });
    expect(r.status).toBe(422);
  });

  it('admin has no access to claims (segregation of duties)', async () => {
    const { sessionId } = await loginStaff('admin@demo.mig.uz');
    expect((await call('/claims', { sid: sessionId })).status).toBe(403);
  });
});

describe('mock scoping (IDOR)', () => {
  it('insured gets 404 for someone else’s claim', async () => {
    const { sessionId, user } = await loginInsured();
    const foreign = db().claims.find((c) => c.insuredId !== user.insuredId)!;
    expect((await call(`/me/claims/${foreign.id}`, { sid: sessionId })).status).toBe(404);
    const mine = db().claims.find((c) => c.insuredId === user.insuredId)!;
    expect((await call(`/me/claims/${mine.id}`, { sid: sessionId })).status).toBe(200);
  });

  it('hr gets 404 for another company’s employee', async () => {
    const a = await call('/auth/login', { method: 'POST', json: { email: 'hr@demo-client.uz', password: 'Demo-2026!' } });
    const b = await call('/auth/otp', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
    const { sessionId, user } = b.data as unknown as SessionResponse;
    const foreign = db().insured.find((i) => i.clientId !== user.companyId)!;
    expect((await call(`/hr/employees/${foreign.id}`, { sid: sessionId })).status).toBe(404);
    const own = db().insured.find((i) => i.clientId === user.companyId)!;
    expect((await call(`/hr/employees/${own.id}`, { sid: sessionId })).status).toBe(200);
  });

  it('hr export has no PINFL or birth dates', async () => {
    const a = await call('/auth/login', { method: 'POST', json: { email: 'hr@demo-client.uz', password: 'Demo-2026!' } });
    const b = await call('/auth/otp', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
    const { sessionId, user } = b.data as unknown as SessionResponse;
    const r = await call('/exports', { method: 'POST', sid: sessionId, json: { type: 'hr_employees' } });
    expect(r.status).toBe(200);
    const csv = String(r.data);
    for (const i of db().insured.filter((x) => x.clientId === user.companyId)) {
      expect(csv).not.toContain(i.pinfl);
      expect(csv).not.toContain(i.birthDate);
    }
  });
});

describe('seed', () => {
  it('has the expected volumes', () => {
    const d = db();
    // 40 clients of SPEC plus 2 leads and 4 prospects of LIFECYCLE_SPEC §16.
    expect(d.clients).toHaveLength(46);
    expect(d.clients.filter((c) => c.status === 'lead')).toHaveLength(2);
    expect(d.clinics).toHaveLength(30);
    // 12 staff of SPEC §2 plus 5 demo accounts of LIFECYCLE_SPEC §2.
    expect(d.staff).toHaveLength(17);
    expect(d.claims.length).toBeGreaterThanOrEqual(600);
    expect(d.audit).toHaveLength(500);
    expect(d.limitRequests).toHaveLength(8);
    expect(d.insured.length).toBeGreaterThan(1300);
    expect(d.insured.length).toBeLessThan(1700);
    expect(d.appointments.length).toBeGreaterThanOrEqual(300);
    const now = Date.now();
    const overdue = d.claims.filter((c) => ['new', 'review', 'medical_review'].includes(c.status) && Date.parse(c.slaDueAt) < now);
    expect(overdue.length).toBeGreaterThanOrEqual(12);
    expect(overdue.length).toBeLessThanOrEqual(18);
  });

  it('is deterministic', () => {
    const a = db().clients.map((c) => c.id);
    resetDb();
    expect(db().clients.map((c) => c.id)).toEqual(a);
  });

  it('demo HR company has ~45 employees and 8 not in the app', () => {
    const d = db();
    const hr = d.hrUsers[0]!;
    const emp = d.insured.filter((i) => i.clientId === hr.companyId);
    expect(emp).toHaveLength(45);
    expect(emp.filter((i) => i.appStatus !== 'active')).toHaveLength(8);
  });
});

describe('demo insured', () => {
  it('has dental limit used over 80 %, one approved and one checking claim', async () => {
    const { sessionId } = await loginInsured();
    const limits = (await call('/me/limits', { sid: sessionId })).data as unknown as { category: string; used: number; limit: number }[];
    const dental = limits.find((l) => l.category === 'dental')!;
    expect(dental.used / dental.limit).toBeGreaterThanOrEqual(0.8);
    const claims = (await call('/me/claims', { sid: sessionId })).data as unknown as { status: string }[];
    expect(claims.some((c) => c.status === 'approved')).toBe(true);
    expect(claims.some((c) => c.status === 'checking')).toBe(true);
  });
});
