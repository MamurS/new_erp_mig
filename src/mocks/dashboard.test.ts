// @vitest-environment node
/*
 * The staff dashboard by role: every queue item is allowed by the role's rights (the server drops the
 * rest), every role has its own queue of at least three kinds of work, and its own KPIs.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { StaffRole } from '@/shared/types';
import type { DashboardSummary, QueueItem, QueueType, SessionResponse } from '@/shared/types/dto';
import { canSeeQueueType } from '@/shared/domain/queue';
import { createMockServer } from './node';
import { db, resetDb } from './db';

const BASE = 'http://localhost/api';
const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => resetDb());

async function call<T>(path: string, sid?: string): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}${path}`, { headers: sid ? { Authorization: `Bearer ${sid}` } : {} });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T };
}
async function login(email: string): Promise<{ sid: string; user: SessionResponse['user'] }> {
  const post = (path: string, json: unknown) => fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) }).then((r) => r.json());
  const a = (await post('/auth/login', { email, password: 'Demo-2026!' })) as { challengeId: string };
  const b = (await post('/auth/otp', { challengeId: a.challengeId, code: '000000' })) as SessionResponse;
  return { sid: b.sessionId, user: b.user };
}

const ACCOUNTS: Record<StaffRole, string> = {
  operator: 'operator@demo.mig.uz',
  underwriter: 'underwriter@demo.mig.uz',
  doctor_expert: 'doctor@demo.mig.uz',
  accountant: 'accountant@demo.mig.uz',
  admin: 'admin@demo.mig.uz',
  sales_manager: 'sales@demo.mig.uz',
  legal: 'legal@demo.mig.uz',
  claims_officer: 'claims@demo.mig.uz',
};

/** What the role's queue is about (the task's list per role). */
const EXPECTED: Record<StaffRole, QueueType[]> = {
  operator: ['assistance_sla', 'complaint', 'appointment', 'clinic_no_response'],
  underwriter: ['quote', 'renewal', 'endorsement', 'limit_request', 'loss_ratio'],
  sales_manager: ['lead', 'kp', 'contract'],
  claims_officer: ['claim', 'appeal', 'fraud_flag'],
  doctor_expert: ['escalation', 'opinion', 'qa_sample'],
  accountant: ['bank_payment', 'payout', 'rebill'],
  legal: ['contract', 'endorsement', 'scan'],
  admin: ['param_change', 'authority_change', 'integration_error'],
};

describe('dashboard by role', () => {
  for (const [role, email] of Object.entries(ACCOUNTS) as [StaffRole, string][]) {
    it(`${role}: every queue item is allowed by the role's rights; at least three kinds of work; own KPIs`, async () => {
      const { sid, user } = await login(email);
      const dash = await call<DashboardSummary>('/dashboard', sid);
      expect(dash.status).toBe(200);
      const types = dash.data.queueTypes.map((t) => t.type);
      expect(types.length, JSON.stringify(types)).toBeGreaterThanOrEqual(3);
      for (const t of EXPECTED[role]) expect(types, `${role} has ${t}`).toContain(t);
      for (const t of types) expect(canSeeQueueType(user, t), `${role} may see ${t}`).toBe(true);
      expect(dash.data.queueTypes.reduce((s, t) => s + t.count, 0)).toBe(dash.data.queueCount);
      expect(dash.data.kpis.length).toBeGreaterThanOrEqual(3);

      const all = await call<QueueItem[]>('/queue?type=all', sid);
      for (const i of all.data) expect(canSeeQueueType(user, i.type), `${role}: ${i.type}`).toBe(true);
      // A tab returns only its own type.
      for (const t of types) {
        const tab = await call<QueueItem[]>(`/queue?type=${t}`, sid);
        expect(tab.data.length).toBeGreaterThan(0);
        expect(new Set(tab.data.map((i) => i.type))).toEqual(new Set([t]));
      }
    });
  }

  it('the underwriter has no claims in the queue, even when asked for them, and sees no claim details', async () => {
    const { sid } = await login(ACCOUNTS.underwriter);
    const all = await call<QueueItem[]>('/queue?type=all', sid);
    expect(all.data.filter((i) => i.type === 'claim')).toHaveLength(0);
    expect((await call<QueueItem[]>('/queue?type=claim', sid)).data).toHaveLength(0);
    expect((await call<QueueItem[]>('/queue?type=appeal', sid)).data).toHaveLength(0);
    expect(new Set(all.data.map((i) => i.type)).size).toBeGreaterThan(1);
    // Loss ratio is an aggregate per client: no claim numbers in its rows.
    const loss = (await call<QueueItem[]>('/queue?type=loss_ratio', sid)).data;
    expect(loss.length).toBeGreaterThan(0);
    for (const i of loss) expect(i.details).not.toMatch(/У-\d{4}-\d+/);
    const dash = await call<DashboardSummary>('/dashboard', sid);
    expect(dash.data.kpis.map((k) => k.key)).toEqual(['quotes', 'renewals', 'finance', 'loss']);
  });

  it('the «Убыточность» row leads to aggregates only: sums, categories, months — no claims, names or diagnoses', async () => {
    const { sid } = await login(ACCOUNTS.underwriter);
    const row = (await call<QueueItem[]>('/queue?type=loss_ratio', sid)).data[0]!;
    const res = await call<Record<string, unknown>>(`/clients/${row.entityId}/loss-stats`, sid);
    expect(res.status).toBe(200);
    expect(Object.keys(res.data).sort()).toEqual(['byCategory', 'byMonth', 'claimsAmount', 'claimsCount', 'clientId', 'clientLegalForm', 'clientName', 'lossRatio', 'lossRatioWarn', 'premium']);
    const text = JSON.stringify(res.data);
    const claims = db().claims.filter((c) => c.clientId === row.entityId);
    expect(claims.length).toBeGreaterThan(0);
    for (const c of claims) {
      expect(text).not.toContain(c.number);
      expect(text).not.toContain(c.insuredName);
    }
    expect(text).not.toMatch(/[A-Z]\d{2}\.\d/); // no ICD-10 codes
    expect((res.data.byMonth as unknown[]).length).toBe(12);
    // The client card itself no longer names a single claim to a role without claims.read.
    const card = await call<{ activity: { text: string }[] }>(`/clients/${row.entityId}`, sid);
    expect(card.data.activity.some((a) => /Новый убыток/.test(a.text))).toBe(false);
    const op = await login(ACCOUNTS.operator);
    const opCard = await call<{ activity: { text: string }[] }>(`/clients/${row.entityId}`, op.sid);
    expect(opCard.data.activity.some((a) => /Новый убыток У-/.test(a.text))).toBe(true);
    // Roles without clients.read get 403.
    expect((await call(`/clients/${row.entityId}/loss-stats`, (await login(ACCOUNTS.claims_officer)).sid)).status).toBe(403);
  });

  it('a pending change is never in the queue of the person who proposed it (four eyes)', async () => {
    const { sid } = await login('admin2@demo.mig.uz');
    const q = await call<QueueItem[]>('/queue?type=all', sid);
    const mine = new Set(db().dmsParams.changes.filter((c) => c.proposedByName === 'Nazarov Sardor Ravshanovich').map((c) => c.id));
    expect(q.data.some((i) => mine.has(i.entityId))).toBe(false);
  });

  it('roles without a staff portal get 403', async () => {
    const { sid } = await login('hr@demo-client.uz');
    expect((await call('/queue', sid)).status).toBe(403);
    expect((await call('/dashboard', sid)).status).toBe(403);
  });
});
