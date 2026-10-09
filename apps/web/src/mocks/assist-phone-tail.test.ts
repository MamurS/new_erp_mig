// @vitest-environment node
/*
 * The assistance search by the last 4 digits of the phone (stage 1.5): only with a part of the name or the birth date,
 * only among the assistance's own insured persons, every search audited — without the digits, the name or the date.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionResponse, AssistInsuredItem } from '@mig/contracts/dto';
import { createMockServer } from './node';
import { lastSession, track, withSession } from './test-session';
import { db, resetDb } from './db';

const BASE = 'http://localhost/api';
const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => resetDb());

async function call<T>(path: string, init: { method?: string; sid?: string; json?: unknown } = {}): Promise<{ status: number; data: T }> {
  const headers = new Headers();
  withSession(headers, init.sid);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  const res = track(await fetch(`${BASE}${path}`, { method: init.method ?? 'GET', headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) }));
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T };
}
async function login(email: string): Promise<string> {
  const a = await call<{ challengeId: string }>('/auth/login', { method: 'POST', json: { email, password: 'Demo-2026!' } });
  const b = await call<SessionResponse>('/auth/otp', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
  expect(b.status).toBe(200);
  return lastSession();
}
const search = (sid: string, json: unknown) => call<AssistInsuredItem[]>('/assist/insured/phone-tail', { method: 'POST', sid, json });
const tailOf = (phone: string) => phone.replace(/\D/g, '').slice(-4);

describe('assistance: search by the last 4 digits of the phone', () => {
  it('needs a part of the name or the birth date; finds only its own insured; every search is audited without the data', async () => {
    const sid = await login('asst-operator@demo-assist.uz');
    const roster = (await call<AssistInsuredItem[]>('/assist/insured', { sid })).data;
    const own = db().insured.find((i) => i.id === roster.find((r) => db().insured.find((x) => x.id === r.id)?.phone)?.id)!;
    expect(own).toBeDefined();
    const tail = tailOf(own.phone);
    const surname = own.fullName.split(' ')[0]!;
    const audits = () => db().audit.filter((a) => a.action === 'insured_phone_tail_search');

    expect((await search(sid, { tail })).status).toBe(422);
    expect((await search(sid, { tail, name: 'Ив' })).status).toBe(422);
    expect((await search(sid, { tail: '12a4', name: surname })).status).toBe(422);
    expect(audits()).toHaveLength(0);

    const byName = await search(sid, { tail, name: surname.slice(0, 4) });
    expect(byName.status).toBe(200);
    expect(byName.data.map((x) => x.id)).toContain(own.id);
    expect(byName.data.every((x) => db().insured.find((i) => i.id === x.id)!.phone.replace(/\D/g, '').endsWith(tail))).toBe(true);
    const byBirth = await search(sid, { tail, birthDate: own.birthDate });
    expect(byBirth.data.map((x) => x.id)).toContain(own.id);
    const other = String((Number(tail) + 1) % 10_000).padStart(4, '0');
    expect((await search(sid, { tail: other, birthDate: own.birthDate })).data.map((x) => x.id)).not.toContain(own.id);
    // The phone in the answer stays masked.
    expect(byName.data.find((x) => x.id === own.id)!.phoneMasked).not.toContain(own.phone.replace(/\D/g, '').slice(3, 9));

    const records = audits();
    expect(records).toHaveLength(3);
    for (const a of records) {
      expect(a.targetLabel).not.toContain(tail);
      expect(a.targetLabel).not.toContain(surname.slice(0, 4));
      expect(a.targetLabel).not.toContain(own.birthDate);
    }
    expect(records.map((a) => a.targetLabel)).toEqual(expect.arrayContaining([expect.stringMatching(/части ФИО: найдено \d+/), expect.stringMatching(/дате рождения: найдено \d+/)]));
  });

  it('another assistance does not find insured persons of the first one; other roles may not search', async () => {
    const first = await login('asst-operator@demo-assist.uz');
    const roster = (await call<AssistInsuredItem[]>('/assist/insured', { sid: first })).data;
    const own = db().insured.find((i) => roster.some((r) => r.id === i.id) && i.phone)!;
    const second = await login('asst-operator@demo-assist2.uz');
    const r = await search(second, { tail: tailOf(own.phone), birthDate: own.birthDate });
    expect(r.status).toBe(200);
    expect(r.data.map((x) => x.id)).not.toContain(own.id);
    const operator = await login('operator@demo.mig.uz');
    expect((await search(operator, { tail: tailOf(own.phone), birthDate: own.birthDate })).status).toBe(403);
  });
});
