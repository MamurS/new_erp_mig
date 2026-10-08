// @vitest-environment node
/*
 * Corporate clients only and the minimal group size on the mock server (DECISIONS «Только корпоративные
 * клиенты и минимальная численность»): the form of a lead, the exception in a quote, signing a contract,
 * an HR exclusion during the term. The UI only warns; these answers are the rule.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ContractView, HrOverview, QuoteView, SessionResponse } from '@mig/contracts/dto';
import type { DmsParamKey } from '@mig/contracts';
import { createMockServer } from './node';
import { db, resetDb } from './db';
import { ALL_FORMS_MASK } from '@mig/domain/config/dmsParameters';

const BASE = 'http://localhost/api';
const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => resetDb());

type Res<T> = { status: number; data: T };
async function call<T = Record<string, unknown>>(path: string, init: { method?: string; sid?: string; json?: unknown } = {}): Promise<Res<T>> {
  const headers = new Headers();
  if (init.sid) headers.set('Authorization', `Bearer ${init.sid}`);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${BASE}${path}`, { method: init.method ?? 'GET', headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T };
}
async function login(email: string): Promise<string> {
  const a = await call<{ challengeId: string }>('/auth/login', { method: 'POST', json: { email, password: 'Demo-2026!' } });
  const b = await call<SessionResponse>('/auth/otp', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
  expect(b.status, email).toBe(200);
  return b.data.sessionId;
}
const setParam = (key: DmsParamKey, value: number) => {
  db().dmsParams.values[key] = { value, changedAt: new Date().toISOString(), changedByName: 'test' };
};
const lead = (legalForm: string) => ({
  legalForm,
  name: 'Kichik Biznes',
  inn: '512340099',
  requisites: { bank: 'Demo Bank', account: '20208000100000000001', mfo: '00001', director: 'Direktorov Direktor Direktorovich', directorBasis: 'Устав' },
  contactName: 'Kontaktova Kontakta',
  contactPhone: '+998901230000',
  contactEmail: 'hr@kichik.uz',
  estimatedHeadcount: 4,
  expectedStart: new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10),
});

describe('legal form of the policyholder', () => {
  it('a sole proprietor lead is refused by the server with a field error; an LLC is saved; MIG can allow the form', async () => {
    const sales = await login('sales@demo.mig.uz');
    const ip = await call<{ fields?: Record<string, string> }>('/leads', { method: 'POST', sid: sales, json: lead('sole_proprietor') });
    expect(ip.status).toBe(422);
    expect(ip.data.fields?.legalForm).toBeTruthy();
    expect((await call('/leads', { method: 'POST', sid: sales, json: lead('llc') })).status).toBe(201);
    setParam('allowedLegalForms', ALL_FORMS_MASK);
    expect((await call('/leads', { method: 'POST', sid: sales, json: { ...lead('sole_proprietor'), inn: '512340098' } })).status).toBe(201);
  });

  it('the seed: clients are companies, except the one ИП lead that shows the ban', () => {
    const ip = db().clients.filter((c) => c.legalForm === 'sole_proprietor');
    expect(ip).toHaveLength(1);
    expect(ip[0]!.status).toBe('lead');
  });
});

describe('quote below the minimum', () => {
  const smallQuote = () => {
    const client = db().clients.find((c) => c.name === 'Navoiy Mebel')!;
    const deal = db().deals.find((d) => d.clientId === client.id)!;
    return db().quotes.find((q) => q.dealId === deal.id)!;
  };

  it('the 6-employee quote is never approved within authority; the underwriter cannot approve, the head only with a comment', async () => {
    const uw = await login('underwriter@demo.mig.uz');
    const q = smallQuote();
    const view = await call<QuoteView>(`/quotes/${q.id}`, { sid: uw });
    expect(view.data.group).toMatchObject({ size: 6, min: 10, below: true });
    const sent = await call<QuoteView>(`/quotes/${q.id}/submit`, { method: 'POST', sid: uw });
    expect(sent.data.status).toBe('pending_approval');
    expect((await call(`/quotes/${q.id}/approve`, { method: 'POST', sid: uw, json: { comment: 'Прошу согласовать' } })).status).toBe(403);
    const head = await login('underwriter-head@demo.mig.uz');
    expect((await call(`/quotes/${q.id}/approve`, { method: 'POST', sid: head, json: {} })).status).toBe(422);
    const ok = await call<QuoteView>(`/quotes/${q.id}/approve`, { method: 'POST', sid: head, json: { comment: 'Растущая компания, через квартал 12 сотрудников' } });
    expect(ok.status).toBe(200);
    expect(ok.data.status).toBe('approved');
    expect(ok.data.belowMinException).toMatchObject({ comment: 'Растущая компания, через квартал 12 сотрудников' });
  });

  it('the seed has one quote with an approved exception', () => {
    expect(db().quotes.filter((q) => q.belowMinException && q.status === 'approved')).toHaveLength(1);
  });
});

describe('signing a contract below the minimum', () => {
  it('appendix 2 below the minimum without an exception: not signed; with the exception in the quote: signed', async () => {
    const c = db().contracts.find((x) => x.status === 'signing' && !x.migration)!;
    const hrEmail = db().clients.find((x) => x.id === c.clientId)!.hrContact.email;
    db().contractInsured.push({
      contractId: c.id,
      rows: [
        { fullName: 'Birinchi Xodim Aliyevich', birthDate: '1990-03-15', pinfl: '31503900000101', phone: '+998935550101', position: 'Engineer', relation: 'employee' },
        { fullName: 'Ikkinchi Xodima Aliyevna', birthDate: '1988-07-01', pinfl: '40107880000102', phone: '+998935550102', position: 'Accountant', relation: 'employee' },
      ],
    });
    const sales = await login('sales@demo.mig.uz');
    const view = await call<ContractView>(`/contracts/${c.id}`, { sid: sales });
    expect(view.data.group).toEqual({ size: 2, min: 10, below: true, exception: false });
    const hr = await login(hrEmail);
    const eimzo = { side: 'client', method: 'eimzo', certificateSerial: 'ABCDEF0123', password: 'any' };
    const refused = await call<{ message?: string }>(`/contracts/${c.id}/sign`, { method: 'POST', sid: hr, json: eimzo });
    expect(refused.status).toBe(409);
    db().quotes.find((q) => q.id === c.quoteId)!.belowMinException = { byName: 'Head', at: new Date().toISOString(), comment: 'Исключение' };
    expect((await call(`/contracts/${c.id}/sign`, { method: 'POST', sid: hr, json: eimzo })).status).toBe(200);
  });
});

describe('HR exclusion during the term', () => {
  const activeEmployee = (companyId: string) =>
    db().insured.find((i) => i.clientId === companyId && i.relation === 'employee' && i.status === 'active' && !db().policyChanges.some((c) => c.status === 'pending' && c.insuredId === i.id))!;

  it('an exclusion below the minimum is allowed and puts a task to the underwriter and the manager (once)', async () => {
    const hr = await login('hr@demo-client.uz');
    const o = await call<HrOverview>('/hr/overview', { sid: hr });
    setParam('minGroupSize', o.data.group.employees);
    const companyId = db().hrUsers.find((h) => h.email === 'hr@demo-client.uz')!.companyId;
    const res = await call(`/hr/employees/${activeEmployee(companyId).id}`, { method: 'DELETE', sid: hr, json: { excludeFrom: new Date().toLocaleDateString('ru-RU') } });
    expect(res.status).toBe(200);
    const tasks = db().tasks.filter((t) => t.action === 'below_min_group' && t.clientId === companyId);
    expect(tasks.map((t) => t.toRole).sort()).toEqual(['sales_manager', 'underwriter']);
    expect(tasks[0]!.link).toBe(`/staff/clients/${companyId}`);
    expect((await call<HrOverview>('/hr/overview', { sid: hr })).data.group.employees).toBe(o.data.group.employees - 1);
  });

  it('with «запретить» the server refuses the exclusion', async () => {
    const hr = await login('hr@demo-client.uz');
    const o = await call<HrOverview>('/hr/overview', { sid: hr });
    setParam('minGroupSize', o.data.group.employees);
    setParam('belowMinDuringTerm', 1);
    const companyId = db().hrUsers.find((h) => h.email === 'hr@demo-client.uz')!.companyId;
    const res = await call(`/hr/employees/${activeEmployee(companyId).id}`, { method: 'DELETE', sid: hr, json: { excludeFrom: new Date().toLocaleDateString('ru-RU') } });
    expect(res.status).toBe(409);
    expect(db().tasks.some((t) => t.action === 'below_min_group')).toBe(false);
  });
});
