// @vitest-environment node
/*
 * Phone sign-in of the app must not reveal whether a number belongs to an insured person:
 * known and unknown numbers get the same challenge, the same rejection and the same lockout.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { translate, type I18nKey } from '@mig/i18n';
import { createMockServer } from './node';
import { resetDb } from './db';
import { loadParams } from '@mig/domain/services/params';
import { baseCtx } from './http';

const BASE = 'http://localhost/api';
const server = createMockServer();
const KNOWN = '+998 90 000 00 01';
const UNKNOWN = '+998 93 765 43 21';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
});

async function post(path: string, json: unknown) {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'mig-web' }, body: JSON.stringify(json) });
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

const shape = (data: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(data).map(([k, v]) => [k, k === 'challengeId' ? (v as string).length : v]));

describe('phone sign-in does not reveal who is insured', () => {
  it('answers /auth/phone the same way for a known and an unknown number', async () => {
    const known = await post('/auth/phone', { phone: KNOWN });
    const unknown = await post('/auth/phone', { phone: UNKNOWN });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(known.status);
    expect(Object.keys(unknown.data).sort()).toEqual(Object.keys(known.data).sort());
    expect(shape(unknown.data)).toEqual(shape(known.data));
    expect(unknown.data.challengeId).not.toBe(known.data.challengeId);
  });

  it('rejects a wrong code for a known number and any code for an unknown one identically', async () => {
    const known = await post('/auth/phone', { phone: KNOWN });
    const unknown = await post('/auth/phone', { phone: UNKNOWN });
    const wrong = await post('/auth/phone/verify', { challengeId: known.data.challengeId, code: '111111' });
    const anyCode = await post('/auth/phone/verify', { challengeId: unknown.data.challengeId, code: '000000' });
    expect(wrong.status).toBe(401);
    expect(anyCode.status).toBe(wrong.status);
    expect(anyCode.data).toEqual(wrong.data);
    expect(translate('ru', wrong.data.key as I18nKey)).not.toMatch(/не найден/);
  });

  it('locks a known and an unknown number after the same number of attempts, each on its own', async () => {
    const max = (await loadParams(baseCtx())).dmsParam('loginMaxAttempts');
    const statuses = async (phone: string) => {
      const out: number[] = [];
      for (let i = 0; i <= max; i++) {
        const c = await post('/auth/phone', { phone });
        if (c.status !== 200) {
          out.push(c.status);
          continue;
        }
        out.push((await post('/auth/phone/verify', { challengeId: c.data.challengeId, code: '111111' })).status);
      }
      return out;
    };
    const known = await statuses(KNOWN);
    const unknown = await statuses(UNKNOWN);
    expect(known.slice(0, max)).toEqual(Array<number>(max).fill(401));
    expect(known[max]).toBe(429);
    expect(unknown).toEqual(known);
    // Another unknown number is not locked by the first one's failures.
    expect((await post('/auth/phone', { phone: '+998 93 765 43 22' })).status).toBe(200);
    // And the lockout holds for the real number even with the right code.
    expect((await post('/auth/phone', { phone: KNOWN })).status).toBe(429);
  });
});
