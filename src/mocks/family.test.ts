// @vitest-environment node
/*
 * Family members as full insured persons on the mock server (FAMILY_SPEC): the app's profiles and per-person
 * data, the consent of an adult member, IDOR, the payout card, adding a member by HR and from the app with the
 * change request and the premium by age group, shared family limits and the age-limit task.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionResponse } from '@/shared/types/dto';
import type { FamilyProfile, FamilyRequest, HrFamilyMember, MeProfile, QueueItem } from '@/shared/types/dto';
import type { LimitUsage, MyClaim, PolicyChange } from '@/shared/types';
import { createMockServer } from './node';
import { db, resetDb, type InsuredRow } from './db';
import { DEMO_INSURED_PHONE, DEMO_SPOUSE_PHONE } from './credentials';
import { isoDay } from './time';

const BASE = 'http://localhost/api';
const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
});

async function call<T = unknown>(path: string, init: { method?: string; sid?: string; json?: unknown } = {}) {
  const headers = new Headers();
  if (init.sid) headers.set('Authorization', `Bearer ${init.sid}`);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${BASE}${path}`, { method: init.method ?? 'GET', headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T };
}
async function loginPhone(phone: string): Promise<string> {
  const a = await call<{ challengeId: string }>('/auth/phone', { method: 'POST', json: { phone } });
  const b = await call<SessionResponse>('/auth/phone/verify', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
  expect(b.status).toBe(200);
  return b.data.sessionId;
}
async function loginStaff(email: string): Promise<string> {
  const a = await call<{ challengeId: string }>('/auth/login', { method: 'POST', json: { email, password: 'Demo-2026!' } });
  const b = await call<SessionResponse>('/auth/otp', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
  expect(b.status).toBe(200);
  return b.data.sessionId;
}

const demo = () => db().insured.find((i) => i.phone === DEMO_INSURED_PHONE)!;
const familyOfDemo = () => db().insured.filter((i) => i.principalId === demo().id);
const spouse = () => familyOfDemo().find((i) => i.relation === 'spouse')!;
const children = () => familyOfDemo().filter((i) => i.relation === 'child');
const childWithClaim = () => children().find((c) => db().claims.some((x) => x.insuredId === c.id))!;
const q = (personId: string) => `?personId=${personId}`;

describe('the app: profiles of the family', () => {
  it('the employee switches between self, the children (full) and the spouse (insurance only)', async () => {
    const sid = await loginPhone(DEMO_INSURED_PHONE);
    const r = await call<FamilyProfile[]>('/me/family', { sid });
    expect(r.status).toBe(200);
    expect(r.data.map((p) => [p.relation, p.access])).toEqual([
      ['employee', 'self'],
      ['spouse', 'basic'],
      ['child', 'full'],
      ['child', 'full'],
    ]);
    expect(r.data.find((p) => p.relation === 'spouse')).toMatchObject({ ownLogin: true, dependentChild: false });
    expect(r.data.filter((p) => p.relation === 'child').every((p) => p.dependentChild && !p.ownLogin && !!p.certificateNumber)).toBe(true);
    // No personal data in the profiles.
    expect(JSON.stringify(r.data)).not.toMatch(/\d{14}|\+998/);
  });

  it("a child's limits, policy, certificate, QR, claims and appointments are per person", async () => {
    const sid = await loginPhone(DEMO_INSURED_PHONE);
    const child = childWithClaim();
    const policy = await call<{ certificateNumber: string }>(`/me/policy${q(child.id)}`, { sid });
    expect(policy.data.certificateNumber).toBe(child.certificateNumber);
    expect((await call<{ insuredId: string }>(`/me/certificate${q(child.id)}`, { sid })).data.insuredId).toBe(child.id);
    const token = await call<{ token: string }>(`/me/card-token${q(child.id)}`, { sid });
    expect(token.status).toBe(200);
    expect(db().cardTokens.find((t) => t.token === token.data.token)?.insuredId).toBe(child.id);
    const claims = await call<MyClaim[]>(`/me/claims${q(child.id)}`, { sid });
    expect(claims.data).toHaveLength(1);
    // Reimbursement of a family member goes to the employee's card by default.
    expect(claims.data[0]!.payoutCardMasked).toBe('•••• 4417');
    expect((await call<MyClaim>(`/me/claims/${claims.data[0]!.id}`, { sid })).status).toBe(200);
    const appts = await call<{ insuredId: string }[]>(`/me/appointments${q(child.id)}`, { sid });
    expect(appts.data.length).toBeGreaterThan(0);
    expect(appts.data.every((a) => a.insuredId === child.id)).toBe(true);
    // The employee's own lists do not mix in the family.
    const own = await call<{ insuredId: string }[]>('/me/appointments', { sid });
    expect(own.data.every((a) => a.insuredId === demo().id)).toBe(true);
    const limits = await call<LimitUsage[]>(`/me/limits${q(child.id)}`, { sid });
    expect(limits.data.find((l) => l.category === 'dental')!.used).toBe(0);
  });

  it('a booking for a child is made for the child', async () => {
    const sid = await loginPhone(DEMO_INSURED_PHONE);
    const child = children()[1]!;
    const clinic = db().clinics.find((c) => c.specialties.includes('pediatrician'))!;
    const startsAt = new Date(Date.now() + 5 * 86_400_000);
    startsAt.setUTCHours(6, 0, 0, 0);
    const r = await call<{ insuredId: string }>(`/me/appointments${q(child.id)}`, { method: 'POST', sid, json: { clinicId: clinic.id, specialty: 'pediatrician', startsAt: startsAt.toISOString() } });
    expect(r.status).toBe(200);
    expect(r.data.insuredId).toBe(child.id);
  });
});

describe('the spouse: an own login, consent, payout card', () => {
  it('the employee does not see her claim until she allows it; revoking hides it again; all audited', async () => {
    const emp = await loginPhone(DEMO_INSURED_PHONE);
    const s = spouse();
    const herClaim = db().claims.find((c) => c.insuredId === s.id)!;
    // Insurance only: certificate and QR, no claims, limits or appointments.
    expect((await call(`/me/policy${q(s.id)}`, { sid: emp })).status).toBe(200);
    expect((await call(`/me/card-token${q(s.id)}`, { sid: emp })).status).toBe(200);
    for (const path of [`/me/claims${q(s.id)}`, `/me/limits${q(s.id)}`, `/me/appointments${q(s.id)}`, `/me/claims/${herClaim.id}`, `/me/claims/${herClaim.id}/letter`]) {
      expect((await call(path, { sid: emp })).status, path).toBe(404);
    }

    const her = await loginPhone(DEMO_SPOUSE_PHONE);
    const me = await call<MeProfile>('/me', { sid: her });
    expect(me.data).toMatchObject({ relation: 'spouse', familyConsentGranted: false, payoutCardOwn: false, payoutCardMasked: '•••• 4417' });
    // She sees only herself, and her own claim.
    expect((await call<FamilyProfile[]>('/me/family', { sid: her })).data.map((p) => p.access)).toEqual(['self']);
    expect((await call<MyClaim[]>('/me/claims', { sid: her })).data.map((c) => c.id)).toEqual([herClaim.id]);
    expect((await call(`/me/claims${q(demo().id)}`, { sid: her })).status).toBe(404);
    expect((await call(`/me/claims${q(children()[0]!.id)}`, { sid: her })).status).toBe(404);

    expect((await call('/me/family/consent', { method: 'POST', sid: her, json: { granted: true } })).status).toBe(200);
    expect((await call<MeProfile>('/me', { sid: her })).data.familyConsentGranted).toBe(true);
    expect((await call<FamilyProfile[]>('/me/family', { sid: emp })).data.find((p) => p.id === s.id)!.access).toBe('full');
    expect((await call<MyClaim[]>(`/me/claims${q(s.id)}`, { sid: emp })).data.map((c) => c.id)).toEqual([herClaim.id]);
    expect((await call(`/me/claims/${herClaim.id}`, { sid: emp })).status).toBe(200);

    expect((await call('/me/family/consent', { method: 'POST', sid: her, json: { granted: false } })).status).toBe(200);
    expect((await call(`/me/claims${q(s.id)}`, { sid: emp })).status).toBe(404);
    const actions = db().audit.filter((a) => a.targetId === s.id).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['family_consent_granted', 'family_consent_revoked']));
    expect(db().familyConsents.filter((c) => c.ownerId === s.id).map((c) => !!c.revokedAt)).toEqual([true]);
  });

  it('only an adult member gives the consent; the employee cannot', async () => {
    const emp = await loginPhone(DEMO_INSURED_PHONE);
    expect((await call('/me/family/consent', { method: 'POST', sid: emp, json: { granted: true } })).status).toBe(409);
  });

  it('an adult member may set an own card and go back to the employee\'s', async () => {
    const her = await loginPhone(DEMO_SPOUSE_PHONE);
    const set = await call<{ payoutCardMasked: string; payoutCardOwn: boolean }>('/me/payout-card', { method: 'POST', sid: her, json: { card: '8600 1111 2222 3333' } });
    expect(set.data).toEqual({ payoutCardMasked: '•••• 3333', payoutCardOwn: true });
    const claims = await call<MyClaim[]>('/me/claims', { sid: her });
    expect(claims.data[0]!.payoutCardMasked).toBe('•••• 3333');
    expect((await call<{ payoutCardOwn: boolean }>('/me/payout-card', { method: 'POST', sid: her, json: { card: null } })).data.payoutCardOwn).toBe(false);
    expect((await call('/me/payout-card', { method: 'POST', sid: her, json: { card: '123' } })).status).toBe(422);
    const emp = await loginPhone(DEMO_INSURED_PHONE);
    expect((await call('/me/payout-card', { method: 'POST', sid: emp, json: { card: null } })).status).toBe(422);
    expect(db().audit.some((a) => a.action === 'payout_card_changed' && a.targetId === spouse().id)).toBe(true);
    // No card number in the audit.
    expect(JSON.stringify(db().audit.filter((a) => a.action === 'payout_card_changed'))).not.toMatch(/3333/);
  });
});

describe('IDOR', () => {
  it("another family's member, an unknown id or a bad id is 404 on every /me endpoint", async () => {
    const sid = await loginPhone(DEMO_INSURED_PHONE);
    const d = db();
    const stranger = d.insured.find((i) => i.relation === 'employee' && i.id !== demo().id && i.status === 'active')!;
    const strangersChild: InsuredRow = { ...children()[0]!, id: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f', principalId: stranger.id };
    d.insured.push(strangersChild);
    for (const id of [stranger.id, strangersChild.id, '11111111-1111-4111-8111-111111111111', 'not-a-uuid']) {
      for (const path of ['/me/policy', '/me/limits', '/me/card-token', '/me/claims', '/me/appointments', '/me/certificate']) {
        expect((await call(`${path}${q(id)}`, { sid })).status, `${path} ${id}`).toBe(404);
      }
      expect((await call(`/me/appointments${q(id)}`, { method: 'POST', sid, json: { clinicId: d.clinics[0]!.id, specialty: 'therapist', startsAt: new Date().toISOString() } })).status).toBe(404);
    }
    const foreignClaim = d.claims.find((c) => c.insuredId === stranger.id) ?? d.claims.find((c) => c.insuredId !== demo().id && !familyOfDemo().some((f) => f.id === c.insuredId))!;
    expect((await call(`/me/claims/${foreignClaim.id}`, { sid })).status).toBe(404);
  });
});

describe('limit mode', () => {
  it('family_shared: one pool per family and category, consumption by any member counts', async () => {
    const sid = await loginPhone(DEMO_INSURED_PHONE);
    const child = childWithClaim();
    const individual = await call<LimitUsage[]>(`/me/limits${q(child.id)}`, { sid });
    const own = await call<LimitUsage[]>('/me/limits', { sid });
    db().dmsParams.values.limitMode = { value: 1, changedAt: new Date().toISOString(), changedByName: 'test' };
    const shared = await call<LimitUsage[]>(`/me/limits${q(child.id)}`, { sid });
    const sharedOwn = await call<LimitUsage[]>('/me/limits', { sid });
    expect(shared.data).toEqual(sharedOwn.data);
    const used = (r: { data: LimitUsage[] }, cat: string) => r.data.find((l) => l.category === cat)!.used;
    // The employee's dental consumption is the family's now.
    expect(used(individual, 'dental')).toBe(0);
    expect(used(shared, 'dental')).toBe(used(own, 'dental'));
    expect(used(shared, 'medicines')).toBeGreaterThanOrEqual(used(own, 'medicines'));
  });
});

describe('HR adds family members', () => {
  it('HR adds a child: a change request with the premium by age; after MIG approves, the child is in the parent\'s app', async () => {
    const hr = await loginStaff('hr@demo-client.uz');
    const tomorrow = isoDay(Date.now() + 86_400_000);
    const r = await call<PolicyChange>('/hr/family', { method: 'POST', sid: hr, json: { employeeId: demo().id, fullName: 'Karimova Zarina Azizovna', birthDate: '2024-01-15', pinfl: '41501240000777', relation: 'child', startDate: tomorrow } });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ kind: 'add', relation: 'child', principalId: demo().id, principalName: demo().fullName, status: 'pending' });
    // Premium for the rest of the term by the age group: less than an employee's.
    const employeeChange = db().policyChanges.find((c) => c.relation === 'employee' && c.kind === 'add' && c.status === 'pending')!;
    expect(r.data.premiumDelta).toBeGreaterThan(0);
    expect(r.data.premiumDelta).toBeLessThan(employeeChange.premiumDelta * 2);
    const list = await call<HrFamilyMember[]>(`/hr/family?employeeId=${demo().id}`, { sid: hr });
    expect(list.data.find((m) => m.fullName === 'Karimova Zarina Azizovna')).toMatchObject({ status: 'pending', relation: 'child' });
    // No medical data or personal identifiers in HR's list.
    expect(Object.keys(list.data[0]!).sort()).not.toContain('claims');
    expect(JSON.stringify(list.data)).not.toMatch(/\d{14}|\+998|diagnos/i);
    // Latin name only; another company's employee does not exist for this HR.
    expect((await call('/hr/family', { method: 'POST', sid: hr, json: { employeeId: demo().id, fullName: 'Каримова Зарина', birthDate: '2024-01-15', pinfl: '41501240000778', relation: 'child', startDate: tomorrow } })).status).toBe(422);
    const foreign = db().insured.find((i) => i.clientId !== demo().clientId && i.relation === 'employee')!;
    expect((await call('/hr/family', { method: 'POST', sid: hr, json: { employeeId: foreign.id, fullName: 'Aliyeva Lola Akmalovna', birthDate: '2020-01-15', pinfl: '41501200000779', relation: 'child', startDate: tomorrow } })).status).toBe(404);

    const uw = await loginStaff('underwriter@demo.mig.uz');
    expect((await call('/policy-changes/decision', { method: 'POST', sid: uw, json: { ids: [r.data.id], decision: 'approve' } })).status).toBe(200);
    const child = db().insured.find((i) => i.fullName === 'Karimova Zarina Azizovna')!;
    expect(child).toMatchObject({ relation: 'child', principalId: demo().id, phone: '', payoutCard: '', appStatus: 'not_invited' });
    expect(child.certificateNumber).toMatch(/^SERT-/);
    // The change request of the endorsement carries the person's premium by the age group.
    const cr = db().changeRequests.find((x) => x.insuredId === child.id)!;
    expect(cr.payload).toMatchObject({ relation: 'child' });
    expect(typeof cr.payload.annual).toBe('number');
    const app = await loginPhone(DEMO_INSURED_PHONE);
    const profiles = await call<FamilyProfile[]>('/me/family', { sid: app });
    expect(profiles.data.find((p) => p.id === child.id)).toMatchObject({ access: 'full', dependentChild: true });
  });

  it('the employee asks from the app with the consent; HR approves into a change request or rejects', async () => {
    const app = await loginPhone(DEMO_INSURED_PHONE);
    const body = { fullName: 'Karimov Bahrom Ilhomovich', birthDate: '1958-03-02', pinfl: '30203580000888', relation: 'parent', consent: true };
    expect((await call('/me/family/requests', { method: 'POST', sid: app, json: { ...body, consent: false } })).status).toBe(422);
    const created = await call<FamilyRequest>('/me/family/requests', { method: 'POST', sid: app, json: body });
    expect(created.status).toBe(200);
    expect(created.data).toMatchObject({ status: 'pending', relation: 'parent', employeeId: demo().id, pinflMasked: '••••••••••0888' });
    expect((await call('/me/family/requests', { method: 'POST', sid: app, json: body })).status).toBe(409);
    // An adult member cannot ask; HR of another company does not see the request.
    const her = await loginPhone(DEMO_SPOUSE_PHONE);
    expect((await call('/me/family/requests', { method: 'POST', sid: her, json: { ...body, pinfl: '30203580000889' } })).status).toBe(409);
    const otherHr = await loginStaff('hr@client-b.example.uz');
    expect((await call<FamilyRequest[]>('/hr/family-requests', { sid: otherHr })).data).toHaveLength(0);
    expect((await call(`/hr/family-requests/${created.data.id}/decision`, { method: 'POST', sid: otherHr, json: { decision: 'approve' } })).status).toBe(404);

    const hr = await loginStaff('hr@demo-client.uz');
    const pending = await call<FamilyRequest[]>('/hr/family-requests?status=pending', { sid: hr });
    expect(pending.data.map((x) => x.id)).toEqual([created.data.id]);
    const approved = await call<FamilyRequest>(`/hr/family-requests/${created.data.id}/decision`, { method: 'POST', sid: hr, json: { decision: 'approve' } });
    expect(approved.data).toMatchObject({ status: 'approved', decidedByName: 'Tursunova Malika Zafarovna' });
    const change = db().policyChanges.find((c) => c.id === approved.data.policyChangeId)!;
    expect(change).toMatchObject({ kind: 'add', relation: 'parent', principalId: demo().id, status: 'pending' });
    // A parent of 68: the premium is the family tariff times the coefficient of 60+.
    expect(change.premiumDelta).toBeGreaterThan(0);
    expect((await call(`/hr/family-requests/${created.data.id}/decision`, { method: 'POST', sid: hr, json: { decision: 'reject', reason: 'Повторно' } })).status).toBe(409);
    expect((await call<FamilyRequest[]>('/me/family/requests', { sid: app })).data[0]!.status).toBe('approved');

    const second = await call<FamilyRequest>('/me/family/requests', { method: 'POST', sid: app, json: { ...body, fullName: 'Karimova Oydin Ilhomovna', pinfl: '40203580000999' } });
    expect((await call(`/hr/family-requests/${second.data.id}/decision`, { method: 'POST', sid: hr, json: { decision: 'reject' } })).status).toBe(422);
    const rejected = await call<FamilyRequest>(`/hr/family-requests/${second.data.id}/decision`, { method: 'POST', sid: hr, json: { decision: 'reject', reason: 'Не является членом семьи' } });
    expect(rejected.data).toMatchObject({ status: 'rejected', rejectionReason: 'Не является членом семьи' });
    expect(db().audit.filter((a) => a.action === 'family_request_created' || a.action === 'family_request_decided')).toHaveLength(4);
  });

  it('HR excludes an employee: the family leaves with them', async () => {
    const hr = await loginStaff('hr@demo-client.uz');
    const tomorrow = isoDay(Date.now() + 86_400_000);
    expect((await call(`/hr/employees/${demo().id}`, { method: 'DELETE', sid: hr, json: { excludeFrom: tomorrow } })).status).toBe(200);
    const pending = db().policyChanges.filter((c) => c.kind === 'exclude' && c.status === 'pending').map((c) => c.insuredId);
    for (const m of familyOfDemo()) expect(pending).toContain(m.id);
  });
});

describe('the age limit', () => {
  it('a child who reached maxChildAge is a task of the underwriter; no automatic exclusion', async () => {
    const uw = await loginStaff('underwriter@demo.mig.uz');
    const items = (await call<QueueItem[]>('/queue?type=age_limit', { sid: uw })).data;
    const grown = db().insured.find((i) => i.relation === 'child' && i.principalId !== demo().id)!;
    expect(items.map((i) => i.entityId)).toEqual([grown.id]);
    expect(grown.status).toBe('active');
    // A child one day before the 18th birthday: no task yet; on the birthday: a task.
    const child = children()[0]!;
    const d = new Date();
    const birthday = (daysBack: number) => {
      const x = new Date(d.getTime() - daysBack * 86_400_000);
      return `${x.getFullYear() - 18}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    };
    child.birthDate = birthday(-1);
    expect((await call<QueueItem[]>('/queue?type=age_limit', { sid: uw })).data.map((i) => i.entityId)).not.toContain(child.id);
    child.birthDate = birthday(0);
    expect((await call<QueueItem[]>('/queue?type=age_limit', { sid: uw })).data.map((i) => i.entityId)).toContain(child.id);
    // A student is covered until studentMaxAge.
    child.isStudent = true;
    expect((await call<QueueItem[]>('/queue?type=age_limit', { sid: uw })).data.map((i) => i.entityId)).not.toContain(child.id);
    // HR sees the over-age child marked in the family list.
    const hr = await loginStaff('hr@demo-client.uz');
    expect((await call<HrFamilyMember[]>('/hr/family', { sid: hr })).data.find((m) => m.id === grown.id)?.overAgeLimit).toBe(true);
  });
});
