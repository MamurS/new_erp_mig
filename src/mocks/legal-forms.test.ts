// @vitest-environment node
/*
 * Legal forms on the mock server: every row that shows a legal entity carries its form, lists filter by
 * `?form=llc,jsc` and sort by the form (the order of LEGAL_FORMS) and by the name ignoring case.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LEGAL_FORMS, legalNameCollator } from '@/shared/config/legalForms';
import type { Client, Clinic } from '@/shared/types';
import type { AssistanceListItem, ClientListResponse, DealView, InvoiceView, QueueItem, SessionResponse } from '@/shared/types/dto';
import { createMockServer } from './node';
import { db, resetDb } from './db';

const BASE = 'http://localhost/api';
const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => resetDb());

async function call<T>(path: string, init: { method?: string; sid?: string; json?: unknown } = {}): Promise<{ status: number; data: T }> {
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

const formIndex = (f: string | undefined) => (f ? LEGAL_FORMS.indexOf(f as (typeof LEGAL_FORMS)[number]) : Infinity);

describe('legal forms in lists', () => {
  it('clients: filter by ?form=, sort by form order and by name ignoring case', async () => {
    const sid = await login('admin@demo.mig.uz');
    // Two forms present in the data make the filter meaningful.
    db().clients[0]!.legalForm = 'jsc';
    db().clients[1]!.legalForm = 'llc';
    const jsc = (await call<ClientListResponse>('/clients?form=jsc&pageSize=100', { sid })).data;
    expect(jsc.items.length).toBeGreaterThan(0);
    expect(jsc.items.every((c: Client) => c.legalForm === 'jsc')).toBe(true);
    const both = (await call<ClientListResponse>('/clients?form=jsc,llc,bogus&pageSize=100', { sid })).data;
    expect(both.items.every((c) => c.legalForm === 'jsc' || c.legalForm === 'llc')).toBe(true);
    expect(both.total).toBeGreaterThan(jsc.total);

    const byForm = (await call<ClientListResponse>('/clients?sort=legalForm:asc&pageSize=100', { sid })).data.items;
    const idx = byForm.map((c) => formIndex(c.legalForm));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));

    db().clients[2]!.name = 'aaa lower-case first';
    const byName = (await call<ClientListResponse>('/clients?sort=name:asc&pageSize=100', { sid })).data.items.map((c) => c.name);
    expect(byName).toEqual([...byName].sort(legalNameCollator.compare));
    expect(byName[0]).toBe('aaa lower-case first');
  });

  it('clinics and assistance companies carry their form and filter by it', async () => {
    const sid = await login('admin@demo.mig.uz');
    const clinics = (await call<Clinic[]>('/clinics', { sid })).data;
    expect(clinics.every((c) => LEGAL_FORMS.includes(c.legalForm))).toBe(true);
    const form = clinics[0]!.legalForm;
    const only = (await call<Clinic[]>(`/clinics?form=${form}`, { sid })).data;
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((c) => c.legalForm === form)).toBe(true);

    const list = (await call<AssistanceListItem[]>('/assistance', { sid })).data;
    expect(list.every((a) => LEGAL_FORMS.includes(a.legalForm))).toBe(true);
    const aForm = list[0]!.legalForm;
    expect((await call<AssistanceListItem[]>(`/assistance?form=${aForm}`, { sid })).data.every((a) => a.legalForm === aForm)).toBe(true);
  });

  it('deals and invoices carry the client form; names come without the form', async () => {
    const sales = await login('sales@demo.mig.uz');
    const deals = (await call<DealView[]>('/deals', { sid: sales })).data;
    expect(deals.length).toBeGreaterThan(0);
    for (const d of deals) {
      const client = db().clients.find((c) => c.id === d.clientId)!;
      expect(d.clientName).toBe(client.name);
      expect(d.clientLegalForm).toBe(client.legalForm);
    }
    const acc = await login('accountant@demo.mig.uz');
    const invoices = (await call<InvoiceView[]>('/invoices?sort=clientName:asc', { sid: acc })).data;
    expect(invoices.every((i) => i.clientLegalForm)).toBe(true);
    const names = invoices.map((i) => i.clientName);
    expect(names).toEqual([...names].sort(legalNameCollator.compare));
  });

  it('dashboard queue rows about a company carry its form', async () => {
    const sid = await login('underwriter@demo.mig.uz');
    const rows = (await call<QueueItem[]>('/queue?type=loss_ratio', { sid })).data;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.legalForm).toBe(db().clients.find((c) => c.id === r.entityId)!.legalForm);
  });
});
