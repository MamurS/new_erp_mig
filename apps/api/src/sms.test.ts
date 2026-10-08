/* The test mode of phone sign-in: the codes the Send SMS hook carried (no database needed). */
import { describe, expect, it } from 'vitest';
import { handleSendSmsHook, logSms, testPhoneCodes } from './auth/sms';

describe('test phone codes', () => {
  it('keeps the last code per phone for five minutes and gives it once', () => {
    let now = 1_000_000;
    const codes = testPhoneCodes(() => now);
    codes.record('+998 90 777 00 11', '111111');
    codes.record('998907770011', '222222');
    expect(codes.take('998907770011')).toBe('222222');
    expect(codes.take('998907770011')).toBeNull();
    codes.record('998907770012', '333333');
    now += 5 * 60_000;
    expect(codes.take('998907770012')).toBeNull();
  });

  it('the hook records the code only when the test mode gives a store', async () => {
    const codes = testPhoneCodes();
    const sender = logSms({ revealCodes: false, log: () => undefined });
    await handleSendSmsHook(sender, { user: { phone: '998907770011' }, sms: { otp: '482913' } });
    expect(codes.take('998907770011')).toBeNull();
    await handleSendSmsHook(sender, { user: { phone: '998907770011' }, sms: { otp: '482913' } }, codes);
    expect(codes.take('998907770011')).toBe('482913');
  });
});
