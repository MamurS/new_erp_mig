// @vitest-environment node
/*
 * Assistance companies in the mock server (ASSISTANCE_SPEC §14): scope on the date of the event,
 * read-only access of a former assistance, guarantee authority and escalation, limit reserve and
 * write-off, sub-registries of payers, rebill four-eyes, partner type of API keys, roster webhooks.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionResponse } from '@mig/contracts/dto';
import * as I from '@mig/contracts/integration';
import { assistanceOn } from '@mig/domain/assistance';
import { tm, translate } from '@mig/i18n';
import { createMockServer } from './node';
import { db, resetDb } from './db';
import { requireAssistanceScope } from '@mig/domain/services/assistance';
import { baseCtx } from './http';

const BASE = 'http://localhost/api';
const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
});

type Res<T = Record<string, unknown>> = { status: number; data: T };

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
  expect(b.status).toBe(200);
  return b.data.sessionId;
}

const today = () => new Date().toISOString().slice(0, 10);
const A1 = () => db().assistances[0]!;
const A2 = () => db().assistances[1]!;
const demoInsured = () => db().insured.find((i) => i.phone === '+998900000001')!;
const demoClinicId = () => db().clinicUsers.find((u) => u.email === 'registrar@demo-clinic.uz')!.clinicId;
/** The client that moved from the second assistance to the first one in the middle of the year. */
const moved = () => {
  const d = db();
  const old = d.assignments.find((a) => a.to && a.assistanceId === A2().id)!;
  return { policyId: old.policyId, to: old.to!, from: old.from };
};

describe('scope on the date of the event (§3, §13.1–13.2)', () => {
  it('requireAssistanceScope: full for the current assistance, read for the former one, 404 for others', async () => {
    const ctx = baseCtx();
    const m = moved();
    const before = m.to;
    const after = today();
    await expect(requireAssistanceScope(ctx, A1().id, m.policyId, after, 'write')).resolves.toBe('full');
    await expect(requireAssistanceScope(ctx, A2().id, m.policyId, before)).resolves.toBe('read');
    await expect(requireAssistanceScope(ctx, A2().id, m.policyId, before, 'write')).rejects.toMatchObject({ key: 'srv.assist.readOnly' });
    expect(translate('ru', 'srv.assist.readOnly')).toMatch(/только на чтение/);
    await expect(requireAssistanceScope(ctx, A2().id, m.policyId, after)).rejects.toThrow();
    await expect(requireAssistanceScope(ctx, A1().id, m.policyId, before)).rejects.toThrow();
    await expect(requireAssistanceScope(ctx, db().assistances[2]!.id, m.policyId, after)).rejects.toThrow();
  });

  it('an operator of another assistance finds nobody and gets 404 by id', async () => {
    const sid = await login('asst-operator@demo-assist2.uz');
    const me = demoInsured();
    const search = await call<unknown[]>(`/assist/insured?q=${encodeURIComponent(me.fullName.split(' ')[0]!)}`, { sid });
    expect(search.status).toBe(200);
    expect(JSON.stringify(search.data)).not.toContain(me.id);
    expect((await call(`/assist/insured/${me.id}`, { sid })).status).toBe(404);
    expect((await call('/assist/cases', { method: 'POST', sid, json: { insuredId: me.id, type: 'consultation', description: 'Вопрос по лимиту' } })).status).toBe(404);
    const own = await login('asst-operator@demo-assist.uz');
    const found = await call<{ id: string; pinflMasked: string }[]>(`/assist/insured?q=${encodeURIComponent(me.fullName.split(' ')[0]!)}`, { sid: own });
    const row = found.data.find((x) => x.id === me.id)!;
    expect(row.pinflMasked).not.toBe(me.pinfl);
    expect(JSON.stringify(found.data)).not.toContain(me.pinfl);
  });

  it('after a change new cases go to the new assistance; the former one reads old cases only', async () => {
    const m = moved();
    const person = db().insured.find((i) => i.policyId === m.policyId && i.status === 'active')!;
    const a1 = await login('asst-operator@demo-assist.uz');
    const created = await call<{ assistanceId: string; access: string }>('/assist/cases', { method: 'POST', sid: a1, json: { insuredId: person.id, type: 'appointment', description: 'Просит записать к терапевту' } });
    expect(created.status).toBe(200);
    expect(created.data).toMatchObject({ assistanceId: A1().id, access: 'full' });
    const a2 = await login('asst-operator@demo-assist2.uz');
    const list = await call<{ id: string; access: string; assistanceId: string }[]>('/assist/cases', { sid: a2 });
    const old = list.data.filter((c) => db().cases.find((x) => x.id === c.id)?.policyId === m.policyId);
    expect(old.length).toBeGreaterThan(0);
    expect(old.every((c) => c.access === 'read')).toBe(true);
    expect(JSON.stringify(list.data)).not.toContain(created.data.assistanceId === A1().id ? (created.data as unknown as { id: string }).id : 'x');
    expect((await call(`/assist/cases/${old[0]!.id}`, { method: 'PATCH', sid: a2, json: { status: 'resolved', resolution: 'Закрыто' } })).status).toBe(403);
    const card = await call<{ access: string }>(`/assist/insured/${person.id}`, { sid: a2 });
    expect(card.data.access).toBe('read');
    expect((await call(`/assist/insured/${person.id}/reveal`, { method: 'POST', sid: a2, json: { field: 'pinfl', reason: 'Сверка старого дела' } })).status).toBe(403);
  });
});

describe('guarantee letters, reserve and write-off (§5.2, §5.3)', () => {
  it('within authority the assistance decides; above it escalates and MIG decides with four-eyes', async () => {
    const d = db();
    const within = d.guarantees.find((g) => g.assistanceId === A1().id && g.status === 'requested' && !g.escalated && g.estimatedCost <= 10_000_000)!;
    const doc = await login('asst-doctor@demo-assist.uz');
    const tooMuch = await call(`/assist/guarantees/${within.id}/decision`, { method: 'POST', sid: doc, json: { action: 'approve', amount: 12_000_000, validUntil: '2030-01-01' } });
    expect(tooMuch.status).toBe(409);
    const mig = await login('doctor@demo.mig.uz');
    expect((await call(`/guarantees/${within.id}/decision`, { method: 'POST', sid: mig, json: { action: 'reject', reason: 'Нет показаний к услуге' } })).status).toBe(403);
    const ok = await call<{ status: string; decidedBy: string }>(`/assist/guarantees/${within.id}/decision`, { method: 'POST', sid: doc, json: { action: 'approve', amount: within.estimatedCost, validUntil: '2030-01-01' } });
    expect(ok.data).toMatchObject({ status: 'approved', decidedBy: 'assistance' });

    const big = d.guarantees.find((g) => g.assistanceId === A1().id && g.status === 'requested' && !g.escalated && g.id !== within.id)!;
    big.estimatedCost = 25_000_000;
    const esc = await call<{ escalated: boolean; status: string }>(`/assist/guarantees/${big.id}/decision`, { method: 'POST', sid: doc, json: { action: 'escalate', reason: 'Операция показана, сумма выше полномочий' } });
    expect(esc.data).toMatchObject({ escalated: true, status: 'requested' });
    expect((await call(`/assist/guarantees/${big.id}/decision`, { method: 'POST', sid: doc, json: { action: 'reject', reason: 'Передумали' } })).status).toBe(409);
    const first = await call<{ status: string }>(`/guarantees/${big.id}/decision`, { method: 'POST', sid: mig, json: { action: 'approve', amount: 25_000_000, validUntil: '2030-01-01' } });
    expect(first.data.status).toBe('requested');
    const second = d.staff.find((s) => s.role === 'doctor_expert' && s.email !== 'doctor@demo.mig.uz' && s.active)!;
    const done = await call<{ status: string; decidedBy: string }>(`/guarantees/${big.id}/decision`, { method: 'POST', sid: await login(second.email), json: { action: 'approve', amount: 25_000_000, validUntil: '2030-01-01' } });
    expect(done.data).toMatchObject({ status: 'approved', decidedBy: 'mig' });
    const clinic = await login('registrar@demo-clinic.uz');
    const seen = await call<{ id: string; status: string; assistanceName: string }[]>('/clinic/guarantees', { sid: clinic });
    expect(seen.data.find((g) => g.id === big.id)).toMatchObject({ status: 'approved', assistanceName: A1().name });
  });

  it('an approved letter reserves the limit; the accepted line uses it and releases the reserve atomically', async () => {
    const d = db();
    const me = demoInsured();
    const reg = await login('registrar@demo-clinic.uz');
    const card = await call<{ shortCode: string }>('/me/card-token', { sid: await (async () => {
      const a = await call<{ challengeId: string }>('/auth/phone', { method: 'POST', json: { phone: '+998900000001' } });
      return (await call<SessionResponse>('/auth/phone/verify', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } })).data.sessionId;
    })() });
    const visit = await call<{ visitId: string }>('/clinic/check', { method: 'POST', sid: reg, json: { qrToken: card.data.shortCode } });
    const svc = d.priceLists.find((p) => p.clinicId === demoClinicId())!.items.find((p) => p.requiresGuarantee && p.category === 'diagnostics_advanced')!;
    const price = d.clinicContracts.find((c) => c.payer === A1().id)!.priceList.find((p) => p.code === svc.code)!.price;
    const g = await call<{ id: string; number: string; assistanceId: string }>('/clinic/guarantees', { method: 'POST', sid: reg, json: { visitId: visit.data.visitId, serviceCode: svc.code, icd10: 'G43.9', estimatedCost: price } });
    expect(g.data.assistanceId).toBe(A1().id);
    const before = (await call<{ category: string; used: number; reserved: number }[]>(`/insured/${me.id}/limits`, { sid: await login('operator@demo.mig.uz') })).data.find((l) => l.category === 'outpatient')!;
    const doc = await login('asst-doctor@demo-assist.uz');
    await call(`/assist/guarantees/${g.data.id}/decision`, { method: 'POST', sid: doc, json: { action: 'approve', amount: price, validUntil: '2030-01-01' } });
    const op = await login('operator@demo.mig.uz');
    const reserved = (await call<{ category: string; used: number; reserved: number }[]>(`/insured/${me.id}/limits`, { sid: op })).data.find((l) => l.category === 'outpatient')!;
    expect(reserved.reserved).toBe((before.reserved ?? 0) + price);
    expect(reserved.used).toBe(before.used);

    const admin = await login('admin@demo-clinic.uz');
    const period = today().slice(0, 7);
    const draft = await call<{ id: string }>('/clinic/registries', { method: 'POST', sid: admin, json: { period } });
    const regId = draft.data.id ?? d.registries.find((r) => r.clinicId === demoClinicId() && r.period === period && r.status === 'draft')!.id;
    const added = await call(`/clinic/registries/${regId}/lines`, { method: 'POST', sid: admin, json: { visitId: visit.data.visitId, serviceDate: today(), serviceCode: svc.code, icd10: 'G43.9', quantity: 1, price, guaranteeNumber: g.data.number } });
    expect(added.status).toBe(200);
    const r = d.registries.find((x) => x.id === regId)!;
    for (const l of r.lines) if (l.id !== r.lines[r.lines.length - 1]!.id) r.lines = r.lines.filter((x) => x.id !== l.id);
    expect((await call(`/clinic/registries/${regId}/submit`, { method: 'POST', sid: admin })).status).toBe(200);
    const line = r.lines[0]!;
    expect(line.payer).toBe(A1().id);
    await call(`/assist/registries/${regId}/lines/${line.id}/decision`, { method: 'POST', sid: doc, json: { decision: 'accept' } });
    const after = (await call<{ category: string; used: number; reserved: number }[]>(`/insured/${me.id}/limits`, { sid: op })).data.find((l) => l.category === 'outpatient')!;
    expect(after.reserved).toBe(before.reserved ?? 0);
    expect(after.used).toBe(before.used + price);
  });
});

describe('sub-registries of payers (§5.3, §9.2)', () => {
  it('lines are split automatically: the assistance sees its lines, MIG only lines of clients without one', async () => {
    const d = db();
    const r = d.registries.find((x) => x.status !== 'draft' && x.lines.some((l) => l.payer === 'mig') && x.lines.some((l) => l.payer === A1().id))!;
    const asst = await login('asst-doctor@demo-assist.uz');
    const own = await call<{ lines: { id: string; payer: string }[] }>(`/assist/registries/${r.id}`, { sid: asst });
    expect(own.data.lines.length).toBe(r.lines.filter((l) => l.payer === A1().id).length);
    expect(own.data.lines.every((l) => l.payer === A1().id)).toBe(true);
    const op = await login('operator@demo.mig.uz');
    const mig = await call<{ lines: { id: string; payer: string }[] }>(`/registries/${r.id}`, { sid: op });
    expect(mig.data.lines.length).toBe(r.lines.filter((l) => l.payer === 'mig').length);
    expect(mig.data.lines.every((l) => l.payer === 'mig')).toBe(true);
    const foreign = r.lines.find((l) => l.payer === A1().id && (l.status === 'pending' || l.status === 'disputed'));
    if (foreign) expect((await call(`/registries/${r.id}/lines/${foreign.id}/decision`, { method: 'POST', sid: op, json: { decision: 'accept' } })).status).toBe(404);
    const a2 = await login('asst-operator@demo-assist2.uz');
    expect((await call(`/assist/registries/${r.id}`, { sid: a2 })).status).toBe(403);
  });
});

describe('rebills (§5.5, §13.4–13.5)', () => {
  it('pay → rebill → reject → dispute → accept → pay; the curator cannot pay, the acceptor cannot pay', async () => {
    const d = db();
    const billing = await login('asst-billing@demo-assist.uz');
    const period = today().slice(0, 7);
    const r = d.registries.find((x) => x.status !== 'draft' && x.lines.some((l) => l.payer === A1().id && l.status === 'pending'))!;
    const doc = await login('asst-doctor@demo-assist.uz');
    const pending = r.lines.filter((l) => l.payer === A1().id && l.status === 'pending').slice(0, 2);
    for (const l of pending) expect((await call(`/assist/registries/${r.id}/lines/${l.id}/decision`, { method: 'POST', sid: doc, json: { decision: 'accept' } })).status).toBe(200);
    const unpaid = r.lines.filter((l) => l.payer === A1().id && l.status === 'accepted' && !l.payment);
    const total = unpaid.reduce((s, l) => s + l.amount, 0);
    expect((await call(`/assist/registries/${r.id}/payments`, { method: 'POST', sid: billing, json: { lineIds: unpaid.map((l) => l.id), paidAt: today(), amount: total + 1, orderNumber: 'PP-1' } })).status).toBe(422);
    expect((await call(`/assist/registries/${r.id}/payments`, { method: 'POST', sid: billing, json: { lineIds: unpaid.map((l) => l.id), paidAt: today(), amount: total, orderNumber: 'PP-1' } })).status).toBe(200);

    const draft = await call<{ id: string; lines: { id: string; registryLineId: string; checks: unknown[] }[]; fee: { formula: string } }>('/assist/rebills', { method: 'POST', sid: billing, json: { period } });
    expect(draft.status).toBe(200);
    expect(tm(draft.data.fee.formula)).toMatch(/застрахованных × 15 000 UZS/);
    for (const l of unpaid) expect(draft.data.lines.map((x) => x.registryLineId)).toContain(l.id);
    expect((await call(`/assist/rebills/${draft.data.id}/submit`, { method: 'POST', sid: billing })).status).toBe(200);

    // Lines of assistance rebills are reviewed by the claims officer (LIFECYCLE_SPEC §2: moved from the curator).
    expect((await call(`/rebills/${draft.data.id}/lines/${draft.data.lines[0]!.id}/decision`, { method: 'POST', sid: await login('operator@demo.mig.uz'), json: { decision: 'accept' } })).status).toBe(403);
    const curator = await login('claims@demo.mig.uz');
    const lines = draft.data.lines;
    const rejected = await call(`/rebills/${draft.data.id}/lines/${lines[0]!.id}/decision`, { method: 'POST', sid: curator, json: { decision: 'reject', reason: 'Нет подтверждения оплаты' } });
    expect(rejected.status).toBe(200);
    for (const l of lines.slice(1)) await call(`/rebills/${draft.data.id}/lines/${l.id}/decision`, { method: 'POST', sid: curator, json: { decision: 'accept' } });
    const disputed = await call<{ status: string }>(`/assist/rebills/${draft.data.id}/lines/${lines[0]!.id}/dispute`, { method: 'POST', sid: billing, json: { comment: 'Платёжное поручение приложено' } });
    expect(disputed.data.status).toBe('in_review');
    const accepted = await call<{ status: string; acceptedById: string }>(`/rebills/${draft.data.id}/lines/${lines[0]!.id}/decision`, { method: 'POST', sid: curator, json: { decision: 'accept' } });
    expect(accepted.data.status).toBe('accepted');
    // Accepted lines are MIG claims with the `assistance` source.
    const claims = d.claims.filter((c) => c.source === 'assistance' && lines.some((l) => l.registryLineId === c.registryLineId));
    expect(claims.length).toBe(lines.length);

    expect((await call(`/rebills/${draft.data.id}/pay`, { method: 'POST', sid: curator })).status).toBe(403);
    const b = d.rebills.find((x) => x.id === draft.data.id)!;
    const accountant = d.staff.find((s) => s.role === 'accountant' && s.email === 'accountant@demo.mig.uz')!;
    const realAcceptor = b.acceptedById;
    b.acceptedById = accountant.id;
    const acc = await login('accountant@demo.mig.uz');
    expect((await call(`/rebills/${draft.data.id}/pay`, { method: 'POST', sid: acc })).status).toBe(409);
    b.acceptedById = realAcceptor;
    const paid = await call<{ status: string }>(`/rebills/${draft.data.id}/pay`, { method: 'POST', sid: acc });
    expect(paid.data.status).toBe('paid');
    expect(d.claims.filter((c) => claims.some((x) => x.id === c.id)).every((c) => c.status === 'paid')).toBe(true);
  });

  it('seed: a partially accepted rebill carries duplicate and over_limit flags; other assistances cannot see it', async () => {
    const d = db();
    const b = d.rebills.find((x) => x.status === 'partially_accepted')!;
    const codes = b.lines.flatMap((l) => l.checks.map((c) => c.code));
    expect(codes).toContain('duplicate');
    expect(codes).toContain('over_limit');
    const other = await login('asst-operator@demo-assist2.uz');
    expect((await call(`/assist/rebills/${b.id}`, { sid: other })).status).toBe(403);
    const a2 = d.assistUsers.find((u) => u.email === 'admin@demo-assist2.uz')!;
    a2.role = 'asst_billing';
    const a2billing = await login(a2.email);
    expect((await call(`/assist/rebills/${b.id}`, { sid: a2billing })).status).toBe(404);
    expect(JSON.stringify((await call('/assist/rebills', { sid: a2billing })).data)).not.toContain(b.id);
  });
});

describe('integration API of an assistance (§8)', () => {
  it('assistance keys work only with assistance methods; roster lists own insured with limits', async () => {
    const admin = await login('asst-admin@demo-assist.uz');
    const bad = await call('/assist/integration/keys', { method: 'POST', sid: admin, json: { name: 'CRM', scopes: ['coverage:check'], ipAllowlist: '' } });
    expect(bad.status).toBe(422);
    const key = await call<{ clientId: string; clientSecret: string }>('/assist/integration/keys', { method: 'POST', sid: admin, json: { name: 'CRM', scopes: [...I.ASSIST_SCOPES], ipAllowlist: '' } });
    expect(key.status).toBe(200);
    const t = await call<{ access_token: string }>('/integration/v1/oauth/token', { method: 'POST', json: { grant_type: 'client_credentials', client_id: key.data.clientId, client_secret: key.data.clientSecret } });
    const bearer = t.data.access_token;
    const get = (path: string) => fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${bearer}` } });
    expect((await get('/integration/v1/appointments')).status).toBe(403);
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = (await (await get(`/integration/v1/assistance/roster?limit=100${cursor ? `&cursor=${cursor}` : ''}`)).json()) as { items: { insuredId: string }[]; nextCursor: string | null };
      expect(I.rosterPage.safeParse(page).success).toBe(true);
      ids.push(...page.items.map((x) => x.insuredId));
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toContain(demoInsured().id);
    const d = db();
    const foreign = d.insured.find((i) => i.status === 'active' && assistanceOn(d.assignments, i.policyId, today()) === A2().id)!;
    expect(ids).not.toContain(foreign.id);
    expect((await get(`/integration/v1/assistance/insured/${demoInsured().id}/limits`)).status).toBe(200);
    expect((await get(`/integration/v1/assistance/insured/${foreign.id}/limits`)).status).toBe(404);
    const rebill = await fetch(`${BASE}/integration/v1/assistance/rebills`, { method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ period: '2026-01' }) });
    expect(rebill.status).toBe(422);
  });

  it('HR changes reach the assistance as thin insured.added / insured.excluded webhooks', async () => {
    const d = db();
    const hook = d.webhooks.find((w) => w.clinicId === A1().id)!;
    const change = d.policyChanges.find((c) => c.status === 'pending' && assistanceOn(d.assignments, c.policyId, today()) === A1().id);
    if (!change) return;
    const uw = await login('underwriter@demo.mig.uz');
    const res = await call('/policy-changes/decision', { method: 'POST', sid: uw, json: { ids: [change.id], decision: 'approve' } });
    expect(res.status).toBe(200);
    const delivery = d.webhookDeliveries.find((w) => w.endpointId === hook.id && (w.event === 'insured.added' || w.event === 'insured.excluded'))!;
    expect(delivery).toBeTruthy();
    const body = JSON.parse(delivery.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['createdAt', 'id', 'objectId', 'type']);
  });
});

describe('call centre, curator and MIG admin (§2, §5.1–5.2, §5.7, §10)', () => {
  it('the operator requests a letter on a call: it goes to the assistance doctor, the clinic sees it, the case links it', async () => {
    const d = db();
    const me = demoInsured();
    const op = await login('asst-operator@demo-assist.uz');
    const c = await call<{ id: string }>('/assist/cases', { method: 'POST', sid: op, json: { insuredId: me.id, type: 'guarantee', description: 'Направление на МРТ, нужно ГП' } });
    const svc = d.priceLists.find((p) => p.clinicId === demoClinicId())!.items.find((p) => p.requiresGuarantee)!;
    const noGp = d.priceLists.find((p) => p.clinicId === demoClinicId())!.items.find((p) => !p.requiresGuarantee)!;
    const bad = await call('/assist/guarantees', { method: 'POST', sid: op, json: { insuredId: me.id, clinicId: demoClinicId(), serviceCode: noGp.code, icd10: 'G43.9', estimatedCost: noGp.price, caseId: c.data.id } });
    expect(bad.status).toBe(422);
    const g = await call<{ id: string; number: string; assistanceId: string; status: string }>('/assist/guarantees', {
      method: 'POST',
      sid: op,
      json: { insuredId: me.id, clinicId: demoClinicId(), serviceCode: svc.code, icd10: 'G43.9', estimatedCost: svc.price, caseId: c.data.id },
    });
    expect(g.status).toBe(200);
    expect(g.data).toMatchObject({ assistanceId: A1().id, status: 'requested' });
    expect(d.cases.find((x) => x.id === c.data.id)!.links.guaranteeId).toBe(g.data.id);
    const doc = await login('asst-doctor@demo-assist.uz');
    expect(JSON.stringify((await call('/assist/guarantees?status=requested', { sid: doc })).data)).toContain(g.data.id);
    const clinic = await login('registrar@demo-clinic.uz');
    expect(JSON.stringify((await call('/clinic/guarantees', { sid: clinic })).data)).toContain(g.data.number);
    // Another assistance cannot request letters for this person.
    const other = await login('asst-operator@demo-assist2.uz');
    expect((await call('/assist/guarantees', { method: 'POST', sid: other, json: { insuredId: me.id, clinicId: demoClinicId(), serviceCode: svc.code, icd10: 'G43.9', estimatedCost: svc.price } })).status).toBe(404);
  });

  it('roster `updatedSince` returns people excluded after that moment', async () => {
    const d = db();
    const change = d.policyChanges.find((c) => c.status === 'pending' && c.kind === 'exclude' && assistanceOn(d.assignments, c.policyId, today()) === A1().id);
    if (!change) return;
    const since = new Date(Date.now() - 1000).toISOString();
    const uw = await login('underwriter@demo.mig.uz');
    expect((await call('/policy-changes/decision', { method: 'POST', sid: uw, json: { ids: [change.id], decision: 'approve' } })).status).toBe(200);
    const admin = await login('asst-admin@demo-assist.uz');
    const key = await call<{ clientId: string; clientSecret: string }>('/assist/integration/keys', { method: 'POST', sid: admin, json: { name: 'CRM', scopes: ['roster:read'], ipAllowlist: '' } });
    const t = await call<{ access_token: string }>('/integration/v1/oauth/token', { method: 'POST', json: { grant_type: 'client_credentials', client_id: key.data.clientId, client_secret: key.data.clientSecret } });
    const res = await fetch(`${BASE}/integration/v1/assistance/roster?updatedSince=${encodeURIComponent(since)}`, { headers: { Authorization: `Bearer ${t.data.access_token}` } });
    const page = (await res.json()) as { items: { insuredId: string; status: string }[] };
    expect(page.items).toContainEqual(expect.objectContaining({ insuredId: change.insuredId, status: 'excluded' }));
  });

  it('the MIG curator reads all cases of an assistance and closes complaints only', async () => {
    const d = db();
    const cur = await login('operator@demo.mig.uz');
    const list = await call<{ id: string; type: string; status: string }[]>(`/assistance/${A1().id}/cases`, { sid: cur });
    expect(list.status).toBe(200);
    expect(list.data.length).toBe(d.cases.filter((c) => c.assistanceId === A1().id).length);
    const complaint = list.data.find((c) => c.type === 'complaint' && c.status !== 'resolved')!;
    const other = list.data.find((c) => c.type !== 'complaint' && c.status !== 'resolved')!;
    expect((await call(`/assistance/${A1().id}/cases/${other.id}/complaint`, { method: 'POST', sid: cur, json: { resolution: 'Разобрались с ассистансом' } })).status).toBe(409);
    const closed = await call<{ status: string; resolution: string }>(`/assistance/${A1().id}/cases/${complaint.id}/complaint`, { method: 'POST', sid: cur, json: { resolution: 'Разобрались с ассистансом' } });
    expect(closed.data).toMatchObject({ status: 'resolved', resolution: 'Куратор МИГ: Разобрались с ассистансом' });
    expect(d.audit.some((e) => e.action === 'complaint_resolved' && e.assistanceId === A1().id)).toBe(true);
    const doctor = await login('doctor@demo.mig.uz');
    expect((await call(`/assistance/${A1().id}/cases`, { sid: doctor })).status).toBe(403);
    const asst = await login('asst-operator@demo-assist.uz');
    expect((await call(`/assistance/${A1().id}/cases`, { sid: asst })).status).toBe(403);
  });

  it('the MIG admin adds an assistance with its first admin, who can log in; others cannot add', async () => {
    const admin = await login('admin@demo.mig.uz');
    const body = {
      name: 'Самарканд Ассистанс Плюс',
      phone24x7: '+998 66 200 00 00',
      integrationMode: 'portal',
      contractNumber: 'DA-2026-004',
      contract: { feeModel: 'per_case', feeValue: 40000, guaranteeAuthorityLimit: 8000000, rebillPaymentDays: 15 },
      admin: { fullName: 'Дилноза Каримова', email: 'admin@samarkand-assist.uz' },
    };
    const uw = await login('underwriter@demo.mig.uz');
    expect((await call('/assistance', { method: 'POST', sid: uw, json: body })).status).toBe(403);
    const created = await call<{ id: string; name: string }>('/assistance', { method: 'POST', sid: admin, json: body });
    expect(created.status).toBe(200);
    expect((await call('/assistance', { method: 'POST', sid: admin, json: body })).status).toBe(409);
    const first = await login('admin@samarkand-assist.uz');
    const ov = await call<{ assistance: { name: string } }>('/assist/overview', { sid: first });
    expect(ov.data.assistance.name).toBe('Самарканд Ассистанс Плюс');
  });

  it('appointments and sub-registries carry their SLA deadlines', async () => {
    const op = await login('asst-operator@demo-assist.uz');
    const appts = await call<{ slaDueAt: string }[]>('/assist/appointments?view=all', { sid: op });
    expect(appts.data.every((a) => /^\d{4}-\d{2}-\d{2}T/.test(a.slaDueAt))).toBe(true);
    const doc = await login('asst-doctor@demo-assist.uz');
    const regs = await call<{ submittedAt?: string; reviewDueAt?: string }[]>('/assist/registries', { sid: doc });
    expect(regs.data.filter((r) => r.submittedAt).every((r) => !!r.reviewDueAt)).toBe(true);
  });
});
