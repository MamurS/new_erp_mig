import { describe, expect, it } from 'vitest';
import { safeUrl, isSafeHttpUrl, BLANK } from './safeUrl';

describe('safeUrl', () => {
  it.each([
    ['https://example.com/a?b=1', 'https://example.com/a?b=1'],
    ['http://example.com', 'http://example.com/'],
    ['mailto:help@mig.uz', 'mailto:help@mig.uz'],
    ['tel:+998900000001', 'tel:+998900000001'],
    ['/staff/clients', '/staff/clients'],
    ['./x', './x'],
    ['../x', '../x'],
    ['#top', '#top'],
  ])('allows %s', (input, out) => {
    expect(safeUrl(input)).toBe(out);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '  javascript:alert(1)',
    '\u0001\u0002javascript:alert(1)',
    'java\nscript:alert(1)',
    'java\tscript:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'DATA:image/png;base64,AAAA',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '//evil.example.com',
    '/\\evil.example.com',
    'ftp://example.com',
    '',
    '   ',
    'plain text',
  ])('blocks %j', (input) => {
    expect(safeUrl(input)).toBe(BLANK);
  });

  it('handles non-strings', () => {
    expect(safeUrl(undefined)).toBe(BLANK);
    expect(safeUrl(null)).toBe(BLANK);
  });

  it('isSafeHttpUrl only accepts http(s)', () => {
    expect(isSafeHttpUrl('https://example.com')).toBe(true);
    expect(isSafeHttpUrl('mailto:a@b.c')).toBe(false);
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
  });
});
