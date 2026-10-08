// @vitest-environment node
/* Policy issuance and insured-list changes in the mock server (POLICY_SPEC §10). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { HrEmployee, SessionResponse } from '@mig/contracts/dto';
import type { Policy, PolicyChange } from '@mig/contracts';
import { createMockServer } from './node';
import { lastSession, track, withSession } from './test-session';
import { db, resetDb } from './db';

const BASE = 'http://localhost/api';
const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => resetDb());

type Res<T> = { status: number; data: T };
async function call<T = Record<string, unknown>>(path: string, init: { method?: string; sid?: string; json?: unknown; text?: string } = {}): Promise<Res<T>> {
  const headers = new Headers();
  withSession(headers, init.sid);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  if (init.text !== undefined) headers.set('Content-Type', 'text/csv');
  const res = track(await fetch(`${BASE}${path}`, { method: init.method ?? 'GET', headers, body: init.text ?? (init.json === undefined ? undefined : JSON.stringify(init.json)) }));
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T };
}
async function login(email: string): Promise<string> {
  const a = await call<{ challengeId: string }>('/auth/login', { method: 'POST', json: { email, password: 'Demo-2026!' } });
  const b = await call<SessionResponse>('/auth/otp', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
  expect(b.status).toBe(200);
  return lastSession();
}

/** A row per person: two employees, the first one's spouse and child (FAMILY_SPEC), two rows with errors. */
const CSV = [
  'fullName,birthDate,pinfl,phone,position,relation,principal_pinfl',
  'Алиев Тимур Рашидович,15.03.1990,31503900000011,+998901112233,Инженер,,',
  'Алиева Лола Тимуровна,02.04.1992,40204920000033,+998901112277,,spouse,31503900000011',
  'Алиев Сардор Тимурович,10.10.2015,31010150000044,,,child,31503900000011',
  'Каримова Нигора Алишеровна,1988-07-01,30107880000022,901112244,Бухгалтер,employee,',
  'Ошибкин Ош,01.01.1990,123,901112255,Водитель,,',
  'Дублев Дубль Дублевич,01.01.1991,31503900000011,901112266,Водитель,,',
].join('\n');

const iso = (d: Date) => d.toISOString().slice(0, 10);
const tomorrow = iso(new Date(Date.now() + 86_400_000));
const inAYear = iso(new Date(Date.now() + 365 * 86_400_000));
const issuable = () => db().clients.find((c) => c.status === 'negotiation' && !c.activePolicyId)!;
const terms = { program: 'standard', startDate: tomorrow, endDate: inAYear, tariff: { employee: 3_800_000, family: 3_040_000 } };

describe('policy issuance', () => {
  it('checks the list: valid rows, family members and row errors', async () => {
    const uw = await login('underwriter@demo.mig.uz');
    const r = await call<{ total: number; valid: number; familyMembers: number; errors: { row: number; field: string }[] }>(`/clients/${issuable().id}/policies/check`, { method: 'POST', sid: uw, text: CSV });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ total: 6, valid: 4, employees: 2, familyMembers: 2 });
    expect(r.data.errors.map((e) => [e.row, e.field])).toEqual([
      [6, 'pinfl'],
      [7, 'pinfl'],
    ]);
  });

  it('issues a policy with the insured persons, premium, documents and HR; a second issue is 409', async () => {
    const uw = await login('underwriter@demo.mig.uz');
    const client = issuable();
    const r = await call<Policy>(`/clients/${client.id}/policies`, { method: 'POST', sid: uw, json: { ...terms, csv: CSV, hr: { fullName: 'Новая Эйчар Тестовна', email: 'hr@new-client.uz' } } });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ status: 'active', insuredCount: 4, familyCount: 2, premium: 2 * 3_800_000 + 2 * 3_040_000 });
    expect(r.data.number).toMatch(/^DMS-\d{4}-\d{6}$/);
    const d = db();
    const people = d.insured.filter((i) => i.policyId === r.data.id);
    expect(people).toHaveLength(4);
    // Family members are insured persons under the employee; a child has no phone and is not invited.
    const timur = people.find((i) => i.pinfl === '31503900000011')!;
    expect(people.filter((i) => i.principalId === timur.id).map((i) => [i.relation, i.appStatus])).toEqual([
      ['spouse', 'not_invited'],
      ['child', 'not_invited'],
    ]);
    expect(d.clients.find((c) => c.id === client.id)).toMatchObject({ status: 'active', activePolicyId: r.data.id, premium: r.data.premium });
    expect(d.documents.filter((x) => x.clientId === client.id && x.title.includes(r.data.number)).map((x) => x.kind).sort()).toEqual(['insured_list', 'policy']);
    expect(d.audit.some((a) => a.action === 'policy_issued' && a.targetId === r.data.id)).toBe(true);
    // the invited HR can log in and sees the employees
    const hr = await login('hr@new-client.uz');
    const list = await call<{ items: HrEmployee[] }>('/hr/employees', { sid: hr });
    expect(list.data.items.map((e) => e.status)).toEqual(['active', 'active']);
    expect((await call(`/clients/${client.id}/policies`, { method: 'POST', sid: uw, json: { ...terms, csv: CSV } })).status).toBe(409);
  });

  it('only underwriters issue policies; the period is checked', async () => {
    const op = await login('operator@demo.mig.uz');
    expect((await call(`/clients/${issuable().id}/policies`, { method: 'POST', sid: op, json: { ...terms, csv: CSV } })).status).toBe(403);
    const uw = await login('underwriter@demo.mig.uz');
    const r = await call(`/clients/${issuable().id}/policies`, { method: 'POST', sid: uw, json: { ...terms, endDate: iso(new Date(Date.now() + 500 * 86_400_000)), csv: CSV } });
    expect(r.status).toBe(422);
  });
});

describe('changes of the insured list', () => {
  const newbie = { fullName: 'Новиков Новик Новикович', birthDate: '01.02.1995', pinfl: '30102950000077', phone: '901234599', position: 'Стажёр' };

  it('HR adding a person creates a request, not an insured person; approval applies it with pro-rata premium and a request for the endorsement', async () => {
    const hr = await login('hr@demo-client.uz');
    const before = db().insured.length;
    const policy = db().policies.find((p) => p.id === db().clients.find((c) => c.id === db().hrUsers[0]!.companyId)!.activePolicyId)!;
    const premium = policy.premium;
    const add = await call<HrEmployee>('/hr/employees', { method: 'POST', sid: hr, json: { ...newbie, startDate: tomorrow } });
    expect(add.status).toBe(200);
    expect(add.data.status).toBe('pending');
    expect(db().insured.length).toBe(before);
    expect((await call('/hr/employees', { method: 'POST', sid: hr, json: { ...newbie, startDate: tomorrow } })).status).toBe(409); // already requested

    const uw = await login('underwriter@demo.mig.uz');
    const queue = await call<PolicyChange[]>('/policy-changes?status=pending', { sid: uw });
    const req = queue.data.find((c) => c.id === add.data.id)!;
    expect(req).toMatchObject({ kind: 'add', fullName: newbie.fullName });
    expect(JSON.stringify(queue.data)).not.toContain(newbie.pinfl); // no PII in the queue
    expect(req.premiumDelta).toBeGreaterThan(0);

    const op = await login('operator@demo.mig.uz');
    expect((await call('/policy-changes/decision', { method: 'POST', sid: op, json: { ids: [req.id], decision: 'approve' } })).status).toBe(403);
    const ok = await call<{ approved: number; endorsements: number }>('/policy-changes/decision', { method: 'POST', sid: uw, json: { ids: [req.id], decision: 'approve' } });
    // The demo company's policy is issued under a contract (LIFECYCLE_SPEC §16): the accepted change waits
    // for the monthly endorsement instead of an immediate document.
    expect(ok.data).toEqual({ approved: 1, rejected: 0, endorsements: 0 });
    expect(db().insured.length).toBe(before + 1);
    expect(policy.premium).toBe(premium + req.premiumDelta);
    const cr = db().changeRequests.find((c) => c.policyChangeId === req.id)!;
    expect(cr).toMatchObject({ type: 'add_insured', status: 'pending', contractId: policy.contractId, effectiveDate: tomorrow });
    expect(db().insured.find((i) => i.id === cr.insuredId)?.certificateNumber).toMatch(/^SERT-/);
    expect((await call('/policy-changes/decision', { method: 'POST', sid: uw, json: { ids: [req.id], decision: 'approve' } })).status).toBe(409);
    const mine = await call<{ items: HrEmployee[] }>(`/hr/employees?q=${encodeURIComponent('новик новикович')}`, { sid: hr });
    expect(mine.data.items.map((e) => e.status)).toEqual(['active']);
  });

  it('an exclusion request can be rejected with a reason; the person stays active', async () => {
    const hr = await login('hr@demo-client.uz');
    const companyId = db().hrUsers[0]!.companyId;
    const person = db().insured.find((i) => i.clientId === companyId && i.status === 'active' && !db().policyChanges.some((c) => c.insuredId === i.id))!;
    const ex = await call<HrEmployee>(`/hr/employees/${person.id}`, { method: 'DELETE', sid: hr, json: { excludeFrom: tomorrow } });
    expect(ex.data.pendingExclusionFrom).toBe(tomorrow);
    expect(person.status).toBe('active');
    const uw = await login('underwriter@demo.mig.uz');
    const req = db().policyChanges.find((c) => c.insuredId === person.id && c.status === 'pending')!;
    expect(req.premiumDelta).toBeLessThan(0);
    expect((await call('/policy-changes/decision', { method: 'POST', sid: uw, json: { ids: [req.id], decision: 'reject' } })).status).toBe(422); // reason required
    expect((await call('/policy-changes/decision', { method: 'POST', sid: uw, json: { ids: [req.id], decision: 'reject', reason: 'Нет приказа об увольнении' } })).status).toBe(200);
    expect(person.status).toBe('active');
    const view = await call<HrEmployee>(`/hr/employees/${person.id}`, { sid: hr });
    expect(view.data.pendingExclusionFrom).toBeUndefined();
    expect(view.data.rejectionReason).toBe('Нет приказа об увольнении');
  });

  it('HR import sends requests; HR of another company gets 404; the queue is not for HR', async () => {
    const hr = await login('hr@demo-client.uz');
    const csv = `fullName,birthDate,pinfl,phone,position,startDate\nИмпортов Импорт Импортович,01.01.1990,30101900000088,901110088,Кладовщик,${tomorrow}\n`;
    const r = await call<{ requested: number; added: number }>('/hr/employees/import?commit=1', { method: 'POST', sid: hr, text: csv });
    expect(r.data).toMatchObject({ requested: 1, added: 0 });
    const other = db().insured.find((i) => i.clientId !== db().hrUsers[0]!.companyId)!;
    expect((await call(`/hr/employees/${other.id}`, { method: 'DELETE', sid: hr, json: { excludeFrom: tomorrow } })).status).toBe(404);
    expect((await call('/policy-changes', { sid: hr })).status).toBe(404);
    const doctor = await login('doctor@demo.mig.uz');
    expect((await call('/policy-changes', { sid: doctor })).status).toBe(403);
  });

  it('seed: pending, rejected and approved requests of the demo company', () => {
    const rows = db().policyChanges;
    expect(rows.filter((c) => c.status === 'pending').map((c) => c.kind).sort()).toEqual(['add', 'add', 'add', 'exclude']);
    expect(rows.filter((c) => c.status === 'rejected')).toHaveLength(1);
    expect(rows.filter((c) => c.status === 'approved' && c.endorsementId)).toHaveLength(2);
  });
});
