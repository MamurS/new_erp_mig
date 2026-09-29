import { describe, expect, it } from 'vitest';
import { dayLabel, isUuid, limitForSpecialty, linkify, nextDays, qrPayload } from './lib';
import { translate } from '@/i18n';

const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate('ru', k, v);

describe('insured lib', () => {
  it('linkify turns only safe http(s) URLs into links', () => {
    const parts = linkify('см. https://mig.uz/help, и javascript:alert(1) и data:text/html,x');
    const links = parts.filter((p) => p.kind === 'link');
    expect(links).toEqual([{ kind: 'link', value: 'https://mig.uz/help', href: 'https://mig.uz/help' }]);
    expect(parts.map((p) => p.value).join('')).toBe('см. https://mig.uz/help, и javascript:alert(1) и data:text/html,x');
  });

  it('nextDays returns 4 consecutive days with labels', () => {
    const now = new Date('2026-09-29T10:00:00+05:00');
    const days = nextDays(4, now);
    expect(days).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(dayLabel(days[0]!, t, now)).toBe('Сегодня');
    expect(dayLabel(days[1]!, t, now)).toBe('Завтра');
    expect(dayLabel(days[2]!, t, now)).toBe('Чт, 01.10');
  });

  it('maps specialties to limits and validates ids', () => {
    expect(limitForSpecialty('dentist')).toBe('dental');
    expect(limitForSpecialty('ent')).toBe('outpatient');
    expect(isUuid('3f2b1c9e-8d7a-4c1b-9e2f-1a2b3c4d5e6f')).toBe(true);
    expect(isUuid('javascript:alert(1)')).toBe(false);
  });

  it('QR payload carries only the token', () => {
    expect(qrPayload('abc')).toBe('MIG-DMS:abc');
  });
});
