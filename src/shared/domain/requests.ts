/*
 * Requests between people (DECISIONS «Запросы между сотрудниками: полный цикл»): the deadline in working
 * days, overdue and «скоро срок», which request is still open, who may act on it. Pure rules: the queue,
 * «Мои запросы» and the plaque on the object show them, the mock server applies the same ones.
 */
import type { TaskStatus } from '@/shared/types/dto';

const DAY = 86_400_000;
/** Tashkent is UTC+5 all year: the weekday of a moment is taken there. */
const TZ_OFFSET = 5 * 3_600_000;

/** `ms` plus `days` working days (Monday–Friday in Tashkent), the time of day kept. */
export function addWorkdays(ms: number, days: number): number {
  let t = ms;
  let left = Math.max(0, Math.floor(days));
  while (left > 0) {
    t += DAY;
    const wd = new Date(t + TZ_OFFSET).getUTCDay();
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  return t;
}

/** Open or taken: the request still waits for its answer. */
export const isActiveRequest = (status: TaskStatus): boolean => status === 'open' || status === 'in_progress';

/** Past the deadline and not closed. */
export function isOverdue(task: { status: TaskStatus; dueAt: string }, now = Date.now()): boolean {
  return isActiveRequest(task.status) && now > Date.parse(task.dueAt);
}

/** Less than a day to the deadline (and not yet past it). */
export function isDueSoon(task: { status: TaskStatus; dueAt: string }, now = Date.now()): boolean {
  const due = Date.parse(task.dueAt);
  return isActiveRequest(task.status) && now <= due && due - now <= DAY;
}

/** «Напомнить» is offered to the author once the deadline has passed. */
export const canRemind = (task: { status: TaskStatus; dueAt: string }, now = Date.now()): boolean => isOverdue(task, now);
