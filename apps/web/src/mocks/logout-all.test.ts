// @vitest-environment node
/* «Выйти на всех устройствах» (STUBS_AUDIT): `?all=1` ends every session of the person, a plain logout only this one. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionResponse } from '@mig/contracts/dto';
import { createMockServer } from './node';
import { resetDb } from './db';

const BASE = 'http://localhost/api';
const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => resetDb());

async function call(path: string, init: { method?: string; sid?: string; json?: unknown } = {}): Promise<{ status: number; data: unknown }> {
  const headers = new Headers();
  if (init.sid) headers.set('Authorization', `Bearer ${init.sid}`);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${BASE}${path}`, { method: init.method ?? 'GET', headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
  const text = await res.text();
  return { status: res.status, data: text ? (JSON.parse(text) as unknown) : undefined };
}
async function loginPhone(): Promise<string> {
  const a = (await call('/auth/phone', { method: 'POST', json: { phone: '+998 90 000 00 01' } })).data as { challengeId: string };
  const b = (await call('/auth/phone/verify', { method: 'POST', json: { challengeId: a.challengeId, code: '000000' } })).data as SessionResponse;
  return b.sessionId;
}

describe('logout', () => {
  it('a plain logout ends this device only; «на всех устройствах» ends every session of the person', async () => {
    const phone1 = await loginPhone();
    const phone2 = await loginPhone();
    const tablet = await loginPhone();
    expect((await call('/auth/logout', { method: 'POST', sid: phone1 })).status).toBe(200);
    expect((await call('/auth/me', { sid: phone1 })).status).toBe(401);
    expect((await call('/auth/me', { sid: phone2 })).status).toBe(200);
    expect((await call('/auth/logout?all=1', { method: 'POST', sid: phone2 })).status).toBe(200);
    expect((await call('/auth/me', { sid: phone2 })).status).toBe(401);
    expect((await call('/auth/me', { sid: tablet })).status).toBe(401);
  });
});
