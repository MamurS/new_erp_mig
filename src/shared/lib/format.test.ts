import { describe, expect, it } from 'vitest';
import {
  addDaysISO,
  formatCountdown,
  formatDate,
  formatDateTime,
  formatMoney,
  formatRelativeDays,
  initials,
  plural,
  todayISO,
} from './format';

const NBSP = '\u00a0';
const now = new Date('2026-09-29T09:00:00+05:00');

describe('format', () => {
  it('money', () => {
    expect(formatMoney(12500000)).toBe(`12${NBSP}500${NBSP}000${NBSP}UZS`);
    expect(formatMoney(0)).toBe(`0${NBSP}UZS`);
    expect(formatMoney(999, false)).toBe('999');
  });
  it('dates in Asia/Tashkent', () => {
    expect(formatDate('2026-09-29')).toBe('29.09.2026');
    expect(formatDate('2026-09-28T20:30:00Z')).toBe('29.09.2026');
    expect(formatDateTime('2026-09-29T14:21:00+05:00')).toBe('29.09.2026, 14:21');
    expect(todayISO(new Date('2026-09-28T19:30:00Z'))).toBe('2026-09-29');
  });
  it('relative days', () => {
    expect(formatRelativeDays('2026-10-15', now)).toBe('через 16 дн');
    expect(formatRelativeDays('2026-09-29', now)).toBe('сегодня');
    expect(formatRelativeDays('2026-09-28', now)).toBe('−1 дн');
  });
  it('helpers', () => {
    expect(addDaysISO('2026-09-29', 3)).toBe('2026-10-02');
    expect(plural(1, ['клиент', 'клиента', 'клиентов'])).toBe('клиент');
    expect(plural(3, ['клиент', 'клиента', 'клиентов'])).toBe('клиента');
    expect(plural(11, ['клиент', 'клиента', 'клиентов'])).toBe('клиентов');
    expect(initials('ООО Ташкент Агрологистика')).toBe('ТА');
    expect(formatCountdown(65)).toBe('1:05');
  });
});
