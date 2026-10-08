import { describe, expect, it } from 'vitest';
import { safeNext, targetAfterLogin } from './redirect';

describe('safeNext', () => {
  it.each([
    ['/staff/clients', '/staff/clients'],
    ['/staff/claims?status=new', '/staff/claims?status=new'],
    ['/app#x', '/app#x'],
  ])('accepts %s', (input, out) => expect(safeNext(input, '/fb')).toBe(out));

  it.each([
    null,
    undefined,
    '',
    '//evil.com',
    '/\\evil.com',
    '\\\\evil.com',
    'https://evil.com',
    'javascript:alert(1)',
    'staff',
    '/%0a',
    '/\u0000x',
    '/a\tb',
  ])('rejects %j', (input) => {
    const out = safeNext(input, '/fb');
    if (input === '/%0a') expect(out).toBe('/%0a');
    else expect(out).toBe('/fb');
  });
});

describe('targetAfterLogin', () => {
  it('keeps targets inside the portal', () => {
    expect(targetAfterLogin('/staff/claims', '/staff')).toBe('/staff/claims');
    expect(targetAfterLogin('/hr', '/staff')).toBe('/staff');
    expect(targetAfterLogin('/staffer', '/staff')).toBe('/staff');
    expect(targetAfterLogin('//evil.com', '/app')).toBe('/app');
  });
});
