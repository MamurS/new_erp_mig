// @vitest-environment node
/*
 * Claim registration by MIG staff (POST /api/claims, multipart): `claims.create` is checked on every request,
 * the body is validated with `staffClaimSchema`, the intake channel and the attachments are stored, the reserve
 * is set to the claimed amount at once (history + audit) and the claim lands in the claims officer's «Новые».
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ClaimDetail, SessionResponse } from '@/shared/types/dto';
import type { Claim, QueueItem } from '@/shared/types';
import { tm } from '@/i18n/core';
import { createMockServer } from './node';
import { db, resetDb } from './db';
import { currentReserve } from './settlement-core';
import { staffClaimSchema } from '@/shared/schemas/forms';

const BASE = 'http://localhost/api';
const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => resetDb());

type Res<T> = { status: number; data: T };
async function call<T = Record<string, unknown>>(path: string, init: { method?: string; sid?: string; json?: unknown; form?: FormData } = {}): Promise<Res<T>> {
  const headers = new Headers();
  if (init.sid) headers.set('Authorization', `Bearer ${init.sid}`);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${BASE}${path}`, { method: init.method ?? 'GET', headers, body: init.form ?? (init.json === undefined ? undefined : JSON.stringify(init.json)) });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T };
}
async function login(email: string): Promise<string> {
  const a = await call<{ challengeId: string }>('/auth/login', { method: 'POST', json: { email, password: 'Demo-2026!' } });
  const b = await call<SessionResponse>('/auth/otp', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
  expect(b.status, email).toBe(200);
  return b.data.sessionId;
}
async function loginPhone(phone: string): Promise<string> {
  const a = await call<{ challengeId: string }>('/auth/phone', { method: 'POST', json: { phone } });
  const b = await call<SessionResponse>('/auth/phone/verify', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
  expect(b.status).toBe(200);
  return b.data.sessionId;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
const PDF = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');
const today = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
/** An insured person of a client without an assistance company (the claim is settled by MIG). */
const insuredId = () => db().insured.find((i) => i.status === 'active')!.id;

function claimForm(over: Record<string, string | null> = {}, files: Blob[] = []): FormData {
  const f = new FormData();
  const fields: Record<string, string | null> = { insuredId: insuredId(), intakeChannel: 'phone', category: 'doctor_visit', amount: '750000', serviceDate: today(), providerName: '  Klinika Shifo  ', ...over };
  for (const [k, v] of Object.entries(fields)) if (v !== null) f.set(k, v);
  files.forEach((b, i) => f.append('files', b, `scan-${i + 1}.${b.type === 'application/pdf' ? 'pdf' : 'png'}`));
  return f;
}

describe('POST /api/claims (staff registration)', () => {
  it('claims officer: intake channel, attachments, reserve = claimed amount, audit, «Новые»', async () => {
    const sid = await login('claims@demo.mig.uz');
    const res = await call<{ id: string }>('/claims', { method: 'POST', sid, form: claimForm({}, [new Blob([PNG], { type: 'image/png' }), new Blob([PDF], { type: 'application/pdf' })]) });
    expect(res.status).toBe(200);
    const row = db().claims.find((c) => c.id === res.data.id)!;
    expect(row).toMatchObject({ intakeChannel: 'phone', source: 'operator', status: 'new', handledBy: 'mig', amountClaimed: 750_000, providerName: 'Klinika Shifo' });
    expect(row.attachments.map((a) => [a.fileName, a.mime])).toEqual([
      ['document-1.png', 'image/png'],
      ['document-2.pdf', 'application/pdf'],
    ]);
    // Staff attachments are never handed to the insured person.
    for (const a of row.attachments) expect(db().files.find((f) => f.id === a.id)?.insuredId).toBeUndefined();

    expect(currentReserve(row)).toBe(750_000);
    const card = await call<ClaimDetail>(`/claims/${row.id}`, { sid });
    expect(card.data.intakeChannel).toBe('phone');
    expect(card.data.reserveHistory).toEqual([expect.objectContaining({ from: 0, to: 750_000 })]);
    const list = await call<{ items: Claim[] }>('/claims?tab=new&pageSize=100', { sid });
    expect(list.data.items.find((c) => c.id === row.id)?.reserve).toBe(750_000);

    const audit = db().audit.filter((e) => e.targetId === row.id);
    expect(audit.map((e) => e.action).sort()).toEqual(['claim_created', 'claim_reserve_changed']);
    expect(audit.find((e) => e.action === 'claim_reserve_changed')?.targetLabel).toBe(`${row.number}: 0 → 750000`);

    const queue = await call<QueueItem[]>('/queue?type=claim&sort=dueAt:desc', { sid });
    const item = queue.data.find((i) => i.entityId === row.id)!;
    expect(item.type).toBe('claim');
    expect(tm(item.status)).toBe('Новый');
  });

  it('operator keeps the right; the PDF is served as a download', async () => {
    const sid = await login('operator@demo.mig.uz');
    const res = await call<{ id: string }>('/claims', { method: 'POST', sid, form: claimForm({ intakeChannel: 'hr_letter' }, [new Blob([PDF], { type: 'application/pdf' })]) });
    expect(res.status).toBe(200);
    const row = db().claims.find((c) => c.id === res.data.id)!;
    expect(row.intakeChannel).toBe('hr_letter');
    const file = await fetch(`${BASE}${row.attachments[0]!.url.replace('/api', '')}`, { headers: { Authorization: `Bearer ${sid}` } });
    expect(file.headers.get('Content-Disposition')).toBe('attachment; filename="document-1.pdf"');
  });

  it('403 for every role without `claims.create`, 401 without a session', async () => {
    for (const email of ['underwriter@demo.mig.uz', 'doctor@demo.mig.uz', 'accountant@demo.mig.uz', 'admin@demo.mig.uz', 'sales@demo.mig.uz', 'legal@demo.mig.uz', 'hr@demo-client.uz']) {
      const sid = await login(email);
      expect((await call('/claims', { method: 'POST', sid, form: claimForm() })).status, email).toBe(403);
    }
    // The insured person files through /me/claims only.
    const me = await loginPhone('+998900000001');
    expect((await call('/claims', { method: 'POST', sid: me, form: claimForm() })).status).toBe(403);
    expect((await call('/claims', { method: 'POST', form: claimForm() })).status).toBe(401);
    expect(db().claims.some((c) => c.intakeChannel)).toBe(false);
  });

  it('the same schema on the server: channel, limits, files, unknown insured person', async () => {
    const sid = await login('claims@demo.mig.uz');
    const post = (f: FormData) => call<{ fields?: Record<string, string> }>('/claims', { method: 'POST', sid, form: f });
    expect((await post(claimForm({ intakeChannel: null }))).status).toBe(422);
    expect((await post(claimForm({ intakeChannel: 'fax' }))).status).toBe(422);
    expect((await post(claimForm({ insuredId: null }))).status).toBe(422);
    expect((await post(claimForm({ providerName: 'x'.repeat(121) }))).status).toBe(422);
    expect((await post(claimForm({ amount: '0' }))).status).toBe(422);
    expect((await post(claimForm({}, [new Blob(['plain text'], { type: 'text/plain' })]))).status).toBe(422);
    expect((await post(claimForm({}, Array.from({ length: 11 }, () => new Blob([PNG], { type: 'image/png' }))))).status).toBe(422);
    expect((await post(claimForm({ insuredId: '99999999-9999-4999-8999-999999999999' }))).status).toBe(404);
    expect(db().claims.some((c) => c.intakeChannel)).toBe(false);
  });
});

describe('staffClaimSchema', () => {
  const base = { insuredId: '11111111-1111-4111-8111-111111111111', intakeChannel: 'email', category: 'dental', amount: 100_000, serviceDate: '05.10.2026', providerName: '  Dental Plus ' };
  it('trims and normalises', () => {
    expect(staffClaimSchema.parse(base)).toEqual({ ...base, serviceDate: '2026-10-05', providerName: 'Dental Plus' });
  });
  it('rejects a missing or unknown channel and a missing insured person', () => {
    expect(staffClaimSchema.safeParse({ ...base, intakeChannel: '' }).success).toBe(false);
    expect(staffClaimSchema.safeParse({ ...base, intakeChannel: 'telegram' }).success).toBe(false);
    expect(staffClaimSchema.safeParse({ ...base, insuredId: '' }).success).toBe(false);
  });
});
