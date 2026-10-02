// @vitest-environment node
/* Commercial offer endpoints (KP_SPEC §7–8): rights, statuses, HR visibility and audit. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { KpDocument, KpParams } from '@/shared/types';
import type { KpDefaults, SessionResponse } from '@/shared/types/dto';
import { createMockServer } from './node';
import { db, resetDb } from './db';

const BASE = 'http://localhost/api';
const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
});

async function call<T = Record<string, unknown>>(path: string, init: { method?: string; sid?: string; json?: unknown } = {}) {
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
  expect(b.status).toBe(200);
  return b.data.sessionId;
}

function demoClientId(): string {
  const hr = db().hrUsers.find((h) => h.email === 'hr@demo-client.uz')!;
  return hr.companyId;
}

async function createDraft(sid: string, clientId = demoClientId()): Promise<KpDocument> {
  const defaults = await call<KpDefaults>(`/clients/${clientId}/kp-defaults`, { sid });
  expect(defaults.status).toBe(200);
  const res = await call<KpDocument>(`/clients/${clientId}/kp`, { method: 'POST', sid, json: defaults.data.params });
  expect(res.status).toBe(200);
  return res.data;
}

describe('KP API', () => {
  it('prefills defaults from the client and the policy', async () => {
    const sid = await login('underwriter@demo.mig.uz');
    const clientId = demoClientId();
    const { data } = await call<KpDefaults>(`/clients/${clientId}/kp-defaults`, { sid });
    const d = db();
    const active = d.insured.filter((i) => i.clientId === clientId && i.status === 'active');
    const policy = d.policies.find((p) => p.clientId === clientId && p.status === 'active')!;
    expect(data.params.employees).toBe(active.length);
    expect(data.params.familyMembers).toBe(active.reduce((s, i) => s + i.familyMembersCount, 0));
    expect(data.params).toMatchObject({ templateId: 'gold', lang: 'ru', variant: 'grey' });
    expect(data.params.coverageStart > policy.endDate).toBe(true);
    expect(data.letter).toMatchObject({ clientName: 'Ташкент Агрологистика', createdByEmail: 'underwriter@demo.mig.uz', policyId: policy.id });
  });

  it('underwriter creates a draft with number, template version, total and audit', async () => {
    const sid = await login('underwriter@demo.mig.uz');
    const kp = await createDraft(sid);
    expect(kp.number).toMatch(/^КП-\d{4}-\d{6}$/);
    expect(kp.status).toBe('draft');
    expect(kp.templateVersion).toBe('GOLD 09/26');
    const p = kp.params;
    expect(kp.totalPremium).toBe(p.employees * p.premiumEmployee + p.familyMembers * p.premiumFamily);
    expect(db().audit[0]).toMatchObject({ action: 'kp_created', targetType: 'kp', targetId: kp.id, targetLabel: kp.number });
  });

  it('validates the body with the form schema (422)', async () => {
    const sid = await login('underwriter@demo.mig.uz');
    const { data } = await call<KpDefaults>(`/clients/${demoClientId()}/kp-defaults`, { sid });
    const bad: KpParams = { ...data.params, employees: 0, coverageEnd: data.params.coverageStart };
    const res = await call<{ fields: Record<string, string> }>(`/clients/${demoClientId()}/kp`, { method: 'POST', sid, json: bad });
    expect(res.status).toBe(422);
    expect(Object.keys(res.data.fields)).toEqual(expect.arrayContaining(['employees', 'coverageEnd']));
  });

  it('other roles cannot create, send or revoke (403); readers can list', async () => {
    const uw = await login('underwriter@demo.mig.uz');
    const kp = await createDraft(uw);
    for (const email of ['operator@demo.mig.uz', 'accountant@demo.mig.uz', 'admin@demo.mig.uz']) {
      const sid = await login(email);
      expect((await call(`/clients/${demoClientId()}/kp`, { method: 'POST', sid, json: kp.params })).status).toBe(403);
      expect((await call(`/kp/${kp.id}/send`, { method: 'POST', sid })).status).toBe(403);
      expect((await call(`/kp/${kp.id}`, { method: 'PATCH', sid, json: kp.params })).status).toBe(403);
      const list = await call<KpDocument[]>(`/clients/${demoClientId()}/kp`, { sid });
      expect(list.status).toBe(200);
      expect(list.data.map((k) => k.id)).toContain(kp.id);
    }
    const doctor = await login('doctor@demo.mig.uz');
    expect((await call(`/kp/${kp.id}`, { sid: doctor })).status).toBe(403);
  });

  it('draft → sent → revoked; only drafts can be changed (409)', async () => {
    const sid = await login('underwriter@demo.mig.uz');
    const kp = await createDraft(sid);
    const patched = await call<KpDocument>(`/kp/${kp.id}`, { method: 'PATCH', sid, json: { ...kp.params, employees: 10 } });
    expect(patched.status).toBe(200);
    expect(patched.data.params.employees).toBe(10);
    const sent = await call<KpDocument>(`/kp/${kp.id}/send`, { method: 'POST', sid });
    expect(sent.data).toMatchObject({ status: 'sent' });
    expect(sent.data.sentAt).toBeTruthy();
    expect((await call(`/kp/${kp.id}`, { method: 'PATCH', sid, json: kp.params })).status).toBe(409);
    expect((await call(`/kp/${kp.id}/send`, { method: 'POST', sid })).status).toBe(409);
    const revoked = await call<KpDocument>(`/kp/${kp.id}/revoke`, { method: 'POST', sid });
    expect(revoked.data.status).toBe('revoked');
    expect((await call(`/kp/${kp.id}/revoke`, { method: 'POST', sid })).status).toBe(409);
    expect(db().audit.slice(0, 2).map((e) => e.action)).toEqual(['kp_revoked', 'kp_sent']);
  });

  it('HR sees only sent offers of its own company; drafts, revoked and foreign ones are 404', async () => {
    const uw = await login('underwriter@demo.mig.uz');
    const draft = await createDraft(uw);
    const sent = await createDraft(uw);
    await call(`/kp/${sent.id}/send`, { method: 'POST', sid: uw });
    const hr = await login('hr@demo-client.uz');
    const docs = await call<{ kind: string; kpId?: string }[]>('/hr/documents', { sid: hr });
    const kpDocs = docs.data.filter((d) => d.kind === 'kp');
    // The seed also has the company's renewal offer (LIFECYCLE_SPEC §16); drafts are never listed.
    expect(kpDocs.map((d) => d.kpId)).toContain(sent.id);
    expect(kpDocs.map((d) => d.kpId)).not.toContain(draft.id);
    expect(kpDocs.every((d) => db().kp.find((k) => k.id === d.kpId)?.status === 'sent')).toBe(true);
    expect((await call(`/kp/${sent.id}`, { sid: hr })).status).toBe(200);
    expect((await call(`/kp/${draft.id}`, { sid: hr })).status).toBe(404);
    expect((await call(`/clients/${demoClientId()}/kp`, { sid: hr })).status).toBe(403);
    // another company's HR
    const other = await login('hr@client-b.example.uz');
    expect((await call(`/kp/${sent.id}`, { sid: other })).status).toBe(404);
    expect((await call<{ kind: string }[]>('/hr/documents', { sid: other })).data.some((d) => d.kind === 'kp')).toBe(false);
    // revoked disappears for HR
    await call(`/kp/${sent.id}/revoke`, { method: 'POST', sid: uw });
    expect((await call(`/kp/${sent.id}`, { sid: hr })).status).toBe(404);
  });

  it('download is audited for staff readers and for HR', async () => {
    const uw = await login('underwriter@demo.mig.uz');
    const kp = await createDraft(uw);
    expect((await call(`/kp/${kp.id}/downloaded`, { method: 'POST', sid: uw })).status).toBe(204);
    expect(db().audit[0]).toMatchObject({ action: 'kp_downloaded', targetLabel: kp.number });
    await call(`/kp/${kp.id}/send`, { method: 'POST', sid: uw });
    const hr = await login('hr@demo-client.uz');
    expect((await call(`/kp/${kp.id}/downloaded`, { method: 'POST', sid: hr })).status).toBe(204);
    expect(db().audit[0]).toMatchObject({ action: 'kp_downloaded', actorRole: 'hr', targetLabel: kp.number });
  });

  it('a live offer takes the client out of «renewals without offer»', async () => {
    const uw = await login('underwriter@demo.mig.uz');
    const q = await call<{ type: string; entityId: string; action: string }[]>('/queue?type=renewal', { sid: uw });
    const row = q.data.find((r) => r.action === 'prepare_offer')!;
    expect(row).toBeTruthy();
    await createDraft(uw, row.entityId);
    const after = await call<{ entityId: string; action: string; status: string }[]>('/queue?type=renewal', { sid: uw });
    expect(after.data.find((r) => r.entityId === row.entityId)).toMatchObject({ action: 'open', status: 'КП готово' });
  });
});
