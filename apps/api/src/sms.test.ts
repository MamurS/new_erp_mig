/*
 * The test mode of phone sign-in: the codes the Send SMS hook carried, shared by the API replicas through Postgres
 * (`app.test_phone_codes`). Needs DATABASE_URL (CI job `api`); skipped otherwise.
 */
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleSendSmsHook, logSms, testPhoneCodes } from './auth/sms';
import { hasDb, testPool } from './test/support';

describe.skipIf(!hasDb)('test phone codes', () => {
  let pool: pg.Pool;
  beforeAll(() => {
    pool = testPool();
  });
  afterAll(async () => {
    await pool?.query(`delete from app.test_phone_codes where phone like '99890777001%'`);
    await pool?.end();
  });

  it('keeps the last code per phone for five minutes and gives it once — to any replica', async () => {
    const replicaA = testPhoneCodes(pool);
    const replicaB = testPhoneCodes(pool);
    await replicaA.record('+998 90 777 00 11', '111111');
    await replicaA.record('998907770011', '222222');
    expect(await replicaB.take('998907770011')).toBe('222222');
    expect(await replicaA.take('998907770011')).toBeNull();
    await replicaA.record('998907770012', '333333');
    await pool.query(`update app.test_phone_codes set at = now() - interval '6 minutes' where phone = '998907770012'`);
    expect(await replicaB.take('998907770012')).toBeNull();
  });

  it('the hook records the code only when the test mode gives a store', async () => {
    const codes = testPhoneCodes(pool);
    const sender = logSms({ revealCodes: false, log: () => undefined });
    await handleSendSmsHook(sender, { user: { phone: '998907770013' }, sms: { otp: '482913' } });
    expect(await codes.take('998907770013')).toBeNull();
    await handleSendSmsHook(sender, { user: { phone: '998907770013' }, sms: { otp: '482913' } }, codes);
    expect(await codes.take('998907770013')).toBe('482913');
  });
});
