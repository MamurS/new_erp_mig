// @vitest-environment node
/*
 * Clinic cabinet and integration API of the mock server (CLINIC_SPEC §11): visit-only access,
 * one-time QR tokens, limits, idempotency, contract of API responses, isolation between clinics.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import type { CardToken, SessionResponse } from '@mig/contracts/dto';
import * as I from '@mig/contracts/integration';
import { translate, type I18nKey } from '@mig/i18n';
import { createMockServer } from './node';
import { isoDay } from '@mig/domain/lib/time';
import { lastSession, track, withSession } from './test-session';
import { db, resetDb } from './db';

const BASE = 'http://localhost/api';
const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
});

type Res<T = Record<string, unknown>> = { status: number; data: T; headers: Headers };

async function call<T = Record<string, unknown>>(path: string, init: { method?: string; sid?: string; bearer?: string; json?: unknown; headers?: Record<string, string>; form?: FormData } = {}): Promise<Res<T>> {
  const headers = new Headers(init.headers);
  withSession(headers, init.sid);
  if (init.bearer) headers.set('Authorization', `Bearer ${init.bearer}`);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  const res = track(await fetch(`${BASE}${path}`, { method: init.method ?? 'GET', headers, body: init.form ?? (init.json === undefined ? undefined : JSON.stringify(init.json)) }));
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    /* csv */
  }
  return { status: res.status, data: data as T, headers: res.headers };
}

async function login(email: string): Promise<string> {
  const a = await call<{ challengeId: string }>('/auth/login', { method: 'POST', json: { email, password: 'Demo-2026!' } });
  const b = await call<SessionResponse>('/auth/otp', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
  expect(b.status).toBe(200);
  return lastSession();
}

async function loginInsured(): Promise<string> {
  const a = await call<{ challengeId: string }>('/auth/phone', { method: 'POST', json: { phone: '+998900000001' } });
  await call<SessionResponse>('/auth/phone/verify', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
  return lastSession();
}

const demoClinicId = () => db().clinicUsers.find((u) => u.email === 'registrar@demo-clinic.uz')!.clinicId;

async function cardCode(): Promise<CardToken> {
  const sid = await loginInsured();
  return (await call<CardToken>('/me/card-token', { sid })).data;
}

async function newKey(adminSid: string, scopes: string[] = [...I.INTEGRATION_SCOPES], ipAllowlist = ''): Promise<{ id: string; clientId: string; clientSecret: string }> {
  const r = await call<{ id: string; clientId: string; clientSecret: string }>('/clinic/integration/keys', { method: 'POST', sid: adminSid, json: { name: 'Тестовая МИС', scopes, ipAllowlist } });
  expect(r.status).toBe(200);
  return r.data;
}

async function token(clientId: string, clientSecret: string): Promise<Res<{ access_token: string; scope: string }>> {
  return call('/integration/v1/oauth/token', { method: 'POST', json: { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret } });
}

function expectContract(schema: ZodTypeAny, data: unknown) {
  const r = schema.safeParse(data);
  expect(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))).toBe(true);
}

describe('patient check and visits', () => {
  it('QR short code opens a visit with minimal data, no limit amounts, and is one-time', async () => {
    const reg = await login('registrar@demo-clinic.uz');
    const card = await cardCode();
    expect(card.shortCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const r = await call('/clinic/check', { method: 'POST', sid: reg, json: { qrToken: card.shortCode } });
    expect(r.status).toBe(200);
    expectContract(I.coverageCheckResult, r.data);
    const text = JSON.stringify(r.data);
    expect(text).not.toMatch(/limit"|used"|pinfl|\d{14}/i);
    expect((r.data as { person: { fullName: string } }).person.fullName).toBe('Karimov Aziz Bahromovich');
    // the same code again, and the scanned MIG-DMS form of the raw token
    const again = await call<{ key: I18nKey }>('/clinic/check', { method: 'POST', sid: reg, json: { qrToken: card.shortCode } });
    expect(again.status).toBe(410);
    expect(again.data.key).toBe('srv.clinic.codeStale');
    expect(translate('ru', again.data.key)).toBe('Код устарел, попросите пациента обновить карточку');
    const raw = await call('/clinic/check', { method: 'POST', sid: reg, json: { qrToken: `MIG-DMS:${card.token}` } });
    expect(raw.status).toBe(410);
    expect(db().audit.some((e) => e.action === 'clinic_check_failed')).toBe(true);
  });

  it('an expired QR token is refused', async () => {
    const reg = await login('registrar@demo-clinic.uz');
    const card = await cardCode();
    db().cardTokens[0]!.expiresAt = Date.now() - 1;
    const r = await call('/clinic/check', { method: 'POST', sid: reg, json: { qrToken: `MIG-DMS:${card.token}` } });
    expect(r.status).toBe(410);
  });

  it('policy number + PINFL: 10 failures in a row lock checks for 15 minutes', async () => {
    const reg = await login('registrar@demo-clinic.uz');
    const bad = { policyNumber: 'DMS-2026-000101', pinfl: '00000000000000' };
    for (let k = 0; k < 10; k++) expect((await call('/clinic/check', { method: 'POST', sid: reg, json: bad })).status).toBe(404);
    const d = db();
    const demo = d.insured.find((i) => i.fullName === 'Karimov Aziz Bahromovich')!;
    const policy = d.policies.find((p) => p.id === demo.policyId)!;
    const good = await call<{ key: I18nKey }>('/clinic/check', { method: 'POST', sid: reg, json: { policyNumber: policy.number, pinfl: demo.pinfl } });
    expect(good.status).toBe(429);
  });

  it('patient data is reachable only through an open visit of the own clinic', async () => {
    const reg = await login('registrar@demo-clinic.uz');
    const d = db();
    const clinicId = demoClinicId();
    const foreignVisit = { ...d.visits[0]!, id: crypto.randomUUID(), clinicId: d.clinics.find((c) => c.id !== clinicId)!.id, expiresAt: new Date(Date.now() + 3600_000).toISOString() };
    d.visits.push(foreignVisit);
    const expired = d.visits.find((v) => v.clinicId === clinicId && Date.parse(v.expiresAt) < Date.now())!;
    for (const id of [foreignVisit.id, expired.id, crypto.randomUUID()]) {
      expect((await call(`/clinic/visits/${id}/coverage`, { sid: reg })).status).toBe(404);
      const gp = await call('/clinic/guarantees', { method: 'POST', sid: reg, json: { visitId: id, serviceCode: 'DG-310', icd10: 'G43.9', estimatedCost: 1_500_000 } });
      expect(gp.status).toBe(404);
    }
  });
});

describe('isolation and roles', () => {
  it('objects of another clinic answer 404; registrar has no registries or integration', async () => {
    const reg = await login('registrar@demo-clinic.uz');
    const d = db();
    const other = d.clinics.find((c) => c.id !== demoClinicId())!;
    const g = { ...d.guarantees[0]!, id: crypto.randomUUID(), clinicId: other.id };
    d.guarantees.push(g);
    expect((await call(`/clinic/guarantees/${g.id}`, { sid: reg })).status).toBe(404);
    expect((await call('/clinic/integration/keys', { sid: reg })).status).toBe(403);
    expect((await call('/clinic/registries', { sid: reg })).status).toBe(403);
    expect((await call('/clients', { sid: reg })).status).toBe(403);
    expect((await call('/insured', { sid: reg })).status).toBe(403);
  });
});

describe('integration API', () => {
  it('token → coverage check; problem+json, X-Request-Id, logs without values; revoked key → 401', async () => {
    const admin = await login('admin@demo-clinic.uz');
    const key = await newKey(admin);
    const t = await token(key.clientId, key.clientSecret);
    expect(t.status).toBe(200);
    expectContract(I.tokenResponse, t.data);
    const card = await cardCode();
    const check = await call('/integration/v1/coverage/check', { method: 'POST', bearer: t.data.access_token, json: { qrToken: card.shortCode } });
    expect(check.status).toBe(200);
    expect(check.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
    expectContract(I.coverageCheckResult, check.data);
    const visitId = (check.data as { visitId: string }).visitId;
    const v = await call(`/integration/v1/visits/${visitId}`, { bearer: t.data.access_token });
    expectContract(I.visit, v.data);

    const bad = await call('/integration/v1/coverage/check', { method: 'POST', bearer: t.data.access_token, json: { policyNumber: 'x' } });
    expect(bad.status).toBe(422);
    expect(bad.headers.get('Content-Type')).toContain('application/problem+json');
    expectContract(I.problem, bad.data);

    const logs = db().apiLogs.filter((l) => l.clientId === key.clientId);
    expect(logs.map((l) => l.pathTemplate)).toEqual(expect.arrayContaining(['/oauth/token', '/coverage/check', '/visits/{visitId}']));
    expect(JSON.stringify(logs)).not.toContain(visitId);
    expect(JSON.stringify(db().integrationClients)).not.toContain(key.clientSecret);

    expect((await call(`/clinic/integration/keys/${key.id}/revoke`, { method: 'POST', sid: admin })).status).toBe(200);
    expect((await call(`/integration/v1/visits/${visitId}`, { bearer: t.data.access_token })).status).toBe(401);
    expect((await token(key.clientId, key.clientSecret)).status).toBe(401);
  });

  it('POST with the same Idempotency-Key returns the first response instead of a duplicate', async () => {
    const admin = await login('admin@demo-clinic.uz');
    const key = await newKey(admin);
    const t = (await token(key.clientId, key.clientSecret)).data.access_token;
    const card = await cardCode();
    const visitId = ((await call('/integration/v1/coverage/check', { method: 'POST', bearer: t, json: { qrToken: card.shortCode } })).data as { visitId: string }).visitId;
    const req = { visitId, serviceCode: 'DG-310', icd10: 'G43.9', estimatedCost: 1_500_000 };
    const before = db().guarantees.length;
    const a = await call<{ id: string }>('/integration/v1/guarantees', { method: 'POST', bearer: t, json: req, headers: { 'Idempotency-Key': 'abc-123' } });
    const b = await call<{ id: string }>('/integration/v1/guarantees', { method: 'POST', bearer: t, json: req, headers: { 'Idempotency-Key': 'abc-123' } });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers.get('Idempotency-Replayed')).toBe('true');
    expect(b.data.id).toBe(a.data.id);
    expect(db().guarantees.length).toBe(before + 1);
    expectContract(I.guaranteeLetter, a.data);
    const c = await call<{ id: string }>('/integration/v1/guarantees', { method: 'POST', bearer: t, json: req, headers: { 'Idempotency-Key': 'other' } });
    expect(c.data.id).not.toBe(a.data.id);
  });

  it('scopes, IP allow-list and the 60/min rate limit', async () => {
    const admin = await login('admin@demo-clinic.uz');
    const narrow = await newKey(admin, ['appointments:read']);
    const tn = (await token(narrow.clientId, narrow.clientSecret)).data.access_token;
    expect((await call('/integration/v1/coverage/check', { method: 'POST', bearer: tn, json: { qrToken: 'AAAA-BBBB' } })).status).toBe(403);
    const list = await call('/integration/v1/appointments?status=requested', { bearer: tn });
    expect(list.status).toBe(200);
    expectContract(I.appointmentList, list.data);

    const ipKey = await newKey(admin, ['payments:read'], '203.0.113.0/24');
    const ti = (await token(ipKey.clientId, ipKey.clientSecret)).data.access_token;
    expect((await call('/integration/v1/payments', { bearer: ti, headers: { 'X-Test-Client-IP': '198.51.100.7' } })).status).toBe(403);
    const pay = await call('/integration/v1/payments', { bearer: ti, headers: { 'X-Test-Client-IP': '203.0.113.9' } });
    expect(pay.status).toBe(200);
    expectContract(I.paymentList, pay.data);

    let last: Res | undefined;
    for (let k = 0; k < 60; k++) last = await call('/integration/v1/appointments', { bearer: tn });
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('registry from the MIS: checks lines, creates an `api` registry routed to the payer of its lines', async () => {
    const admin = await login('admin@demo-clinic.uz');
    const key = await newKey(admin);
    const t = (await token(key.clientId, key.clientSecret)).data.access_token;
    const card = await cardCode();
    const visitId = ((await call('/integration/v1/coverage/check', { method: 'POST', bearer: t, json: { qrToken: card.shortCode } })).data as { visitId: string }).visitId;
    const today = isoDay(Date.now());
    const period = today.slice(0, 7);
    const tooExpensive = await call<{ errors: Record<string, string> }>('/integration/v1/registries', {
      method: 'POST',
      bearer: t,
      json: { period, lines: [{ visitId, serviceDate: today, serviceCode: 'TH-101', icd10: 'J06.9', quantity: 1, price: 999_999_999 }, { visitId, serviceDate: today, serviceCode: 'DG-310', icd10: 'G43.9', quantity: 1, price: 1000 }] },
    });
    expect(tooExpensive.status).toBe(422);
    expect(tooExpensive.data.errors['lines[0]']).toContain('Цена выше прайса');
    expect(tooExpensive.data.errors['lines[1]']).toContain('нужен номер гарантийного письма');
    const ok = await call<{ id: string; source: string; status: string }>('/integration/v1/registries', {
      method: 'POST',
      bearer: t,
      json: { period, lines: [{ visitId, serviceDate: today, serviceCode: 'TH-101', icd10: 'J06.9', quantity: 1, price: 100_000 }] },
    });
    expect(ok.status).toBe(201);
    expectContract(I.registry, ok.data);
    expect(ok.data).toMatchObject({ source: 'api', status: 'submitted' });
    // The demo patient is served by an assistance: its sub-registry goes there, not to MIG (ASSISTANCE_SPEC §9.2).
    const op = await login('operator@demo.mig.uz');
    const list = await call<{ id: string }[]>('/registries', { sid: op });
    expect(list.data.map((r) => r.id)).not.toContain(ok.data.id);
    const asst = await login('asst-doctor@demo-assist.uz');
    const own = await call<{ id: string }[]>('/assist/registries', { sid: asst });
    expect(own.data.map((r) => r.id)).toContain(ok.data.id);
  });
});

describe('guarantees: four-eyes above the threshold', () => {
  it('one doctor cannot approve a letter above 20 000 000 alone', async () => {
    const d = db();
    const g = d.guarantees.find((x) => x.status === 'requested' && x.approvals.length === 0 && x.assistanceId && !x.escalated)!;
    g.estimatedCost = 30_000_000;
    const doc = await login('doctor@demo.mig.uz');
    // A letter of an assistance's client is decided by the assistance until it escalates (ASSISTANCE_SPEC §9.1).
    const early = await call(`/guarantees/${g.id}/decision`, { method: 'POST', sid: doc, json: { action: 'approve', amount: 30_000_000, validUntil: '2030-01-01' } });
    expect(early.status).toBe(403);
    g.escalated = true;
    const first = await call<{ status: string; approvalsNeeded: number }>(`/guarantees/${g.id}/decision`, { method: 'POST', sid: doc, json: { action: 'approve', amount: 30_000_000, validUntil: '2030-01-01' } });
    expect(first.status).toBe(200);
    expect(first.data).toMatchObject({ status: 'requested', approvalsNeeded: 1 });
    const same = await call(`/guarantees/${g.id}/decision`, { method: 'POST', sid: doc, json: { action: 'approve', amount: 30_000_000, validUntil: '2030-01-01' } });
    expect(same.status).toBe(409);
    const secondDoctor = d.staff.find((s) => s.role === 'doctor_expert' && s.email !== 'doctor@demo.mig.uz' && s.active)!;
    const sid2 = await login(secondDoctor.email);
    const second = await call<{ status: string }>(`/guarantees/${g.id}/decision`, { method: 'POST', sid: sid2, json: { action: 'approve', amount: 30_000_000, validUntil: '2030-01-01' } });
    expect(second.data.status).toBe('approved');
  });
});

describe('webhooks', () => {
  it('a receiver with «fail» in the URL goes to retrying; retry adds an attempt; https + public host only', async () => {
    const admin = await login('admin@demo-clinic.uz');
    const local = await call('/clinic/integration/webhooks', { method: 'POST', sid: admin, json: { url: 'https://10.0.0.5/hook', events: ['registry.paid'] } });
    expect(local.status).toBe(422);
    const created = await call<{ id: string; signingSecret: string }>('/clinic/integration/webhooks', { method: 'POST', sid: admin, json: { url: 'https://mis.example.uz/fail', events: ['registry.paid'] } });
    expect(created.status).toBe(200);
    expect(JSON.stringify((await call('/clinic/integration/webhooks', { sid: admin })).data)).not.toContain(created.data.signingSecret);
    const test = await call<{ id: string; status: string; attempts: number; responseCode: number }>(`/clinic/integration/webhooks/${created.data.id}/test`, { method: 'POST', sid: admin });
    expect(test.data).toMatchObject({ status: 'retrying', attempts: 1, responseCode: 500 });
    const retry = await call<{ attempts: number; status: string }>(`/clinic/integration/deliveries/${test.data.id}/retry`, { method: 'POST', sid: admin });
    expect(retry.data).toMatchObject({ attempts: 2, status: 'retrying' });
    const payload = JSON.parse(db().webhookDeliveries.find((x) => x.id === test.data.id)!.body) as unknown;
    expectContract(I.webhookPayload, payload);
  });
});

describe('seed: registries', () => {
  it('every line of a submitted registry is dated within its period', () => {
    resetDb();
    for (const r of db().registries) {
      for (const l of r.lines) expect(l.serviceDate.startsWith(r.period), `${r.period} ${l.serviceDate}`).toBe(true);
    }
  });
});
