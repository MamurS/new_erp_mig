// @vitest-environment node
/*
 * Premium of a person included during the term on the mock server: by the contract's `pricingBasis`.
 * flat_by_type — premium_family / premium_employee; age_banded — the band table of the contract; an
 * age_banded contract without a table cannot be saved, signed or used for a change.
 */
import { tm } from '@/i18n';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionResponse } from '@mig/contracts/dto';
import type { Contract, PolicyChange } from '@mig/contracts';
import { daysInclusive } from '@mig/domain/policies';
import { createMockServer } from './node';
import { lastSession, track, withSession } from './test-session';
import { db, resetDb } from './db';
import { DEMO_INSURED_PHONE } from '@mig/seed/credentials';
import { endorsementLines } from '@mig/domain/services/lifecycle';
import { baseCtx } from './http';
import { isoDay } from '@mig/seed/time';

const BASE = 'http://localhost/api';
const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
});

async function call<T = unknown>(path: string, init: { method?: string; sid?: string; json?: unknown } = {}) {
  const headers = new Headers();
  withSession(headers, init.sid);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  const res = track(await fetch(`${BASE}${path}`, { method: init.method ?? 'GET', headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) }));
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T };
}
async function loginStaff(email: string): Promise<string> {
  const a = await call<{ challengeId: string }>('/auth/login', { method: 'POST', json: { email, password: 'Demo-2026!' } });
  const b = await call<SessionResponse>('/auth/otp', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
  expect(b.status).toBe(200);
  return lastSession();
}

const demo = () => db().insured.find((i) => i.phone === DEMO_INSURED_PHONE)!;
const demoContract = () => db().contracts.find((c) => c.clientId === demo().clientId && c.status === 'active')!;
const banded = () => db().contracts.find((c) => c.params.pricingBasis === 'age_banded')!;

/** HR adds a child of the demo employee, the underwriter approves; the change request of the contract. */
async function addChild(birthDate: string, startDate: string) {
  const hr = await loginStaff('hr@demo-client.uz');
  const r = await call<PolicyChange>('/hr/family', { method: 'POST', sid: hr, json: { employeeId: demo().id, fullName: 'Karimova Zarina Azizovna', birthDate, pinfl: '41501240000777', relation: 'child', startDate } });
  expect(r.status).toBe(200);
  const uw = await loginStaff('underwriter@demo.mig.uz');
  const decided = await call('/policy-changes/decision', { method: 'POST', sid: uw, json: { ids: [r.data.id], decision: 'approve' } });
  return { change: r.data, decided, cr: () => db().changeRequests.find((x) => x.policyChangeId === r.data.id)! };
}

describe('seed: both pricing bases are visible', () => {
  it('the demo HR company contract is flat_by_type; one contract is age_banded with its table from the quote', async () => {
    expect(demoContract().params.pricingBasis).toBe('flat_by_type');
    expect(db().contracts.filter((c) => c.params.pricingBasis === 'age_banded')).toHaveLength(1);
    const c = banded();
    const q = db().quotes.find((x) => x.id === c.quoteId)!;
    expect(q.pricingBasis).toBe('age_banded');
    expect(c.params.ageBandRates).toEqual(q.ageBandRates);
    const uw = await loginStaff('underwriter@demo.mig.uz');
    const view = await call<Contract>(`/contracts/${c.id}`, { sid: uw });
    expect(view.data.params).toMatchObject({ pricingBasis: 'age_banded', ageBandRates: q.ageBandRates });
  });
});

describe('inclusion during the term', () => {
  it('flat_by_type: premium_family × remaining days / term days, «по типу» in the line', async () => {
    const start = isoDay(Date.now() + 86_400_000);
    const { change, decided, cr } = await addChild('2024-01-15', start);
    expect(decided.status).toBe(200);
    const c = demoContract();
    const days = daysInclusive(start, c.params.endDate);
    const term = daysInclusive(c.params.startDate, c.params.endDate);
    const expected = Math.round((c.params.premiumFamily * days) / term);
    // The policy change shows the delta rounded to 1000; the endorsement line is exact.
    expect(Math.abs(change.premiumDelta - expected)).toBeLessThanOrEqual(500);
    expect(cr().payload).toMatchObject({ annual: c.params.premiumFamily, rule: { basis: 'flat_by_type', key: 'premium_family' } });
    const [line] = await endorsementLines(baseCtx(), c, [cr()]);
    expect(line!.amount).toBe(expected);
    expect(tm(line!.formula)).toMatch(/^по типу: premium_family [\d ]+ × \d+ \/ \d+ = [\d ]+$/);
  });

  it('age_banded: the band of the age on the inclusion date', async () => {
    const c = demoContract();
    const bands = [
      { minAge: 0, maxAge: 17, annual: 900_000 },
      { minAge: 18, maxAge: null, annual: 2_000_000 },
    ];
    c.params.pricingBasis = 'age_banded';
    c.params.ageBandRates = bands;
    const start = isoDay(Date.now() + 86_400_000);
    // Turns 18 the day after the inclusion: still the band 0–17 on the inclusion date.
    const birth = `${Number(start.slice(0, 4)) - 18}${isoDay(Date.now() + 2 * 86_400_000).slice(4)}`;
    const { change, cr } = await addChild(birth, start);
    const days = daysInclusive(start, c.params.endDate);
    const term = daysInclusive(c.params.startDate, c.params.endDate);
    expect(Math.abs(change.premiumDelta - Math.round((900_000 * days) / term))).toBeLessThanOrEqual(500);
    expect((await endorsementLines(baseCtx(), c, [cr()]))[0]!.amount).toBe(Math.round((900_000 * days) / term));
    expect(cr().payload).toMatchObject({ annual: 900_000, rule: { basis: 'age_banded', minAge: 0, maxAge: 17 } });
    expect(tm((await endorsementLines(baseCtx(), c, [cr()]))[0]!.formula)).toMatch(/^по возрастной группе 0–17: 900 000 × \d+ \/ \d+ = /);
  });

  it('age_banded without a table: HR cannot add and the underwriter cannot approve', async () => {
    const hr = await loginStaff('hr@demo-client.uz');
    const start = isoDay(Date.now() + 86_400_000);
    const r = await call<PolicyChange>('/hr/family', { method: 'POST', sid: hr, json: { employeeId: demo().id, fullName: 'Karimova Zarina Azizovna', birthDate: '2024-01-15', pinfl: '41501240000777', relation: 'child', startDate: start } });
    expect(r.status).toBe(200);
    const c = demoContract();
    c.params.pricingBasis = 'age_banded';
    delete c.params.ageBandRates;
    const uw = await loginStaff('underwriter@demo.mig.uz');
    const decided = await call<{ key: string }>('/policy-changes/decision', { method: 'POST', sid: uw, json: { ids: [r.data.id], decision: 'approve' } });
    expect(decided.status).toBe(422);
    expect(decided.data.key).toBe('dom.pricing.noBandTable');
    // Nothing changed: the request is still pending, nobody was created.
    expect(db().policyChanges.find((x) => x.id === r.data.id)!.status).toBe('pending');
    expect(db().insured.some((i) => i.fullName === 'Karimova Zarina Azizovna')).toBe(false);
    const again = await call<{ key: string }>('/hr/family', { method: 'POST', sid: hr, json: { employeeId: demo().id, fullName: 'Karimov Said Azizovich', birthDate: '2022-01-15', pinfl: '31501220000778', relation: 'child', startDate: start } });
    expect(again.status).toBe(422);
  });
});

describe('contract terms are validated', () => {
  it('an age_banded contract without a table cannot be saved or signed', async () => {
    const sales = await loginStaff('sales@demo.mig.uz');
    const c = banded();
    c.status = 'draft';
    const ok = await call<Contract>(`/contracts/${c.id}`, { method: 'PATCH', sid: sales, json: { params: { pricingBasis: 'flat_by_type' } } });
    expect(ok.status).toBe(200);
    expect(ok.data.params.pricingBasis).toBe('flat_by_type');
    // Back to age_banded: the table of the quote is still the appendix.
    expect((await call(`/contracts/${c.id}`, { method: 'PATCH', sid: sales, json: { params: { pricingBasis: 'age_banded' } } })).status).toBe(200);
    delete c.params.ageBandRates;
    const bad = await call<{ key: string; fields: Record<string, string> }>(`/contracts/${c.id}`, { method: 'PATCH', sid: sales, json: { params: { pricingBasis: 'age_banded' } } });
    expect(bad.status).toBe(422);
    expect(bad.data.fields['params.pricingBasis']).toBe('dom.pricing.noBandTable');
    expect((await call(`/contracts/${c.id}/submit-legal`, { method: 'POST', sid: sales })).status).toBe(422);
    c.status = 'approved';
    const head = await loginStaff('underwriter-head@demo.mig.uz');
    const sign = await call(`/contracts/${c.id}/sign`, { method: 'POST', sid: head, json: { side: 'mig', method: 'paper' } });
    expect(sign.status).toBe(422);
  });

  it('the quote carries the basis chosen by the underwriter and the derived band table', async () => {
    const uw = await loginStaff('underwriter@demo.mig.uz');
    const q = db().quotes.find((x) => x.status === 'draft')!;
    const r = await call<{ pricingBasis: string; ageBandRates: unknown[] }>(`/quotes/${q.id}`, { method: 'PATCH', sid: uw, json: { program: q.program, adjustments: q.adjustments, pricingBasis: 'age_banded' } });
    expect(r.status).toBe(200);
    expect(r.data.pricingBasis).toBe('age_banded');
    expect(r.data.ageBandRates).toHaveLength(6);
    const kept = await call<{ pricingBasis: string }>(`/quotes/${q.id}`, { method: 'PATCH', sid: uw, json: { program: q.program, adjustments: q.adjustments } });
    expect(kept.data.pricingBasis).toBe('age_banded');
  });
});
