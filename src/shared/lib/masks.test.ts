import { describe, expect, it } from 'vitest';
import { maskCardNumber, maskDate, maskMoney, maskPhone, maskPinfl, normalizePhone, parseRuDate } from './masks';

describe('masks', () => {
  it('phone', () => {
    expect(maskPhone('900000001')).toBe('+998 90 000 00 01');
    expect(maskPhone('+998 90 000 00 01')).toBe('+998 90 000 00 01');
    expect(normalizePhone('+998 90 000 00 01')).toBe('+998900000001');
  });
  it('pinfl, date, money', () => {
    expect(maskPinfl('123-456 789012345')).toBe('12345678901234');
    expect(maskDate('01021990')).toBe('01.02.1990');
    expect(parseRuDate('31.02.1990')).toBeNull();
    expect(parseRuDate('01.02.1990')).toBe('1990-02-01');
    expect(maskMoney('1250000')).toBe('1 250 000');
  });
  it('card number: groups of four, at most 16 digits', () => {
    expect(maskCardNumber('8600-1234 5678901299')).toBe('8600 1234 5678 9012');
    expect(maskCardNumber('86001')).toBe('8600 1');
    expect(maskCardNumber('')).toBe('');
  });
});
