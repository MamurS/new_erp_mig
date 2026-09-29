import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger, redact, redactString } from './logger';

describe('logger redaction', () => {
  afterEach(() => vi.restoreAllMocks());

  it('redacts sensitive keys', () => {
    const out = redact({
      pinfl: '12345678901234',
      phoneMasked: 'x',
      email: 'a@b.c',
      birthDate: '1990-01-01',
      sessionId: 'abc',
      nested: { cardNumber: '4417', diagnosisCode: 'J06', ok: 'fine' },
      password: 'p',
      passportNo: 'AA',
      token: 't',
    }) as Record<string, unknown>;
    expect(out.pinfl).toBe('[redacted]');
    expect(out.phoneMasked).toBe('[redacted]');
    expect(out.email).toBe('[redacted]');
    expect(out.birthDate).toBe('[redacted]');
    expect(out.sessionId).toBe('[redacted]');
    expect(out.password).toBe('[redacted]');
    expect(out.passportNo).toBe('[redacted]');
    expect(out.token).toBe('[redacted]');
    expect(out.nested).toEqual({ cardNumber: '[redacted]', diagnosisCode: '[redacted]', ok: 'fine' });
  });

  it('redacts PINFL-like and phone-like strings', () => {
    expect(redactString('pinfl 12345678901234 end')).toBe('pinfl [redacted] end');
    expect(redactString('call +998 90 123 45 67 now')).toBe('call [redacted] now');
    expect(redactString('call 901234567')).toBe('call [redacted]');
    expect(redactString('mail a.b@mig.uz')).toBe('mail [redacted]');
    expect(redactString('claim У-2026-004512')).toBe('claim У-2026-004512');
  });

  it('never prints raw PII', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logger.warn('user 12345678901234 failed', { phone: '+998901234567' });
    const printed = JSON.stringify(spy.mock.calls);
    expect(printed).not.toContain('12345678901234');
    expect(printed).not.toContain('901234567');
  });
});
