import { describe, expect, it } from 'vitest';
import { maskBirthDate, maskCard, maskEmail, maskPhone, maskPinfl } from './mask';

describe('mock masking', () => {
  it('masks PINFL leaving last 4', () => {
    expect(maskPinfl('31234567891234')).toBe('••••••••••1234');
  });
  it('masks phone leaving last 2', () => {
    expect(maskPhone('+998901234567')).toBe('+998 •• ••• •• 67');
  });
  it('masks birth date leaving year', () => {
    expect(maskBirthDate('1987-05-12')).toBe('••.••.1987');
  });
  it('masks email and card', () => {
    expect(maskEmail('aziz.k@company.uz')).toBe('a•••@company.uz');
    expect(maskCard('8600123456784417')).toBe('•••• 4417');
  });
  it('never contains the original value', () => {
    const pinfl = '31234567891234';
    expect(maskPinfl(pinfl)).not.toContain(pinfl.slice(0, 10));
  });
});
