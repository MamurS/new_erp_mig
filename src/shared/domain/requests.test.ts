import { describe, expect, it } from 'vitest';
import { addWorkdays, canRemind, isActiveRequest, isDueSoon, isOverdue } from './requests';

// Thursday 2026-10-08 10:00 in Tashkent (UTC+5).
const THU = Date.parse('2026-10-08T05:00:00Z');
const H = 3_600_000;

describe('requests: deadline in working days', () => {
  it('skips the weekend in Tashkent and keeps the time of day', () => {
    expect(new Date(addWorkdays(THU, 1)).toISOString()).toBe('2026-10-09T05:00:00.000Z');
    expect(new Date(addWorkdays(THU, 2)).toISOString()).toBe('2026-10-12T05:00:00.000Z');
    expect(new Date(addWorkdays(THU, 0)).toISOString()).toBe('2026-10-08T05:00:00.000Z');
  });

  it('open and taken requests are active; overdue past the deadline, «скоро срок» within a day', () => {
    const due = new Date(THU + 10 * H).toISOString();
    expect(isActiveRequest('open') && isActiveRequest('in_progress')).toBe(true);
    expect(isActiveRequest('done') || isActiveRequest('rejected')).toBe(false);
    expect(isDueSoon({ status: 'open', dueAt: due }, THU)).toBe(true);
    expect(isDueSoon({ status: 'open', dueAt: due }, THU - 20 * H)).toBe(false);
    expect(isOverdue({ status: 'in_progress', dueAt: due }, THU + 11 * H)).toBe(true);
    expect(isOverdue({ status: 'done', dueAt: due }, THU + 11 * H)).toBe(false);
    expect(canRemind({ status: 'open', dueAt: due }, THU)).toBe(false);
    expect(canRemind({ status: 'open', dueAt: due }, THU + 11 * H)).toBe(true);
  });
});
