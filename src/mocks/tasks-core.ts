/*
 * Tasks between roles and in-app notifications (docs/DECISIONS.md «Пустые состояния со следующим шагом»).
 * - «Попросить {роль}» creates a task for a MIG role: it becomes a `request` row of that role's queue with a
 *   link back to the place it is about and the author's comment.
 * - «Запросить у HR» creates a task in the HR cabinet of the client («Задачи от МИГ»).
 * - A task closes by itself when its action is done (census uploaded, appendix 2 uploaded, contract created…:
 *   `completeTasks` is called by those handlers) or by «Выполнено»; the author gets a notification.
 */
import { msg } from '@/i18n/core';
import type { Role, SessionUser } from '@/shared/types';
import type { TaskAction, TaskSubjectType } from '@/shared/types/dto';
import { taskLink, taskTitle } from '@/shared/domain/nextStep';
import type { Db, NotificationRow, TaskRow } from './db';
import { dealContract } from './lifecycle-core';
import { randomId } from './rng';
import { isoDay, tzIso } from './time';

export interface SubjectRefs {
  clientId: string;
  clientName: string;
  dealId?: string;
  dealNumber?: string;
  contractId?: string;
  contractNumber?: string;
}

/** Client, deal and contract behind a subject (null: no such record). */
export function subjectRefs(d: Db, type: TaskSubjectType, id: string): SubjectRefs | null {
  if (type === 'contract') {
    const c = d.contracts.find((x) => x.id === id);
    if (!c) return null;
    const deal = d.deals.find((x) => x.id === c.dealId);
    return { clientId: c.clientId, clientName: c.clientName, contractId: c.id, contractNumber: c.number, dealId: deal?.id, dealNumber: deal?.number };
  }
  if (type === 'deal') {
    const deal = d.deals.find((x) => x.id === id);
    if (!deal) return null;
    const client = d.clients.find((c) => c.id === deal.clientId);
    const c = dealContract(d, deal.id);
    return { clientId: deal.clientId, clientName: client?.name ?? '', dealId: deal.id, dealNumber: deal.number, contractId: c?.id, contractNumber: c?.number };
  }
  const client = d.clients.find((c) => c.id === id);
  if (!client) return null;
  const deal = d.deals.find((x) => x.clientId === id && x.stage !== 'lost' && x.stage !== 'active') ?? d.deals.find((x) => x.clientId === id);
  const c = deal ? dealContract(d, deal.id) : undefined;
  return { clientId: id, clientName: client.name, dealId: deal?.id, dealNumber: deal?.number, contractId: c?.id, contractNumber: c?.number };
}

export function createTask(
  d: Db,
  actor: Pick<SessionUser, 'id' | 'displayName'>,
  input: { action: TaskAction; toRole: Role; subjectType: TaskSubjectType; subjectId: string; comment: string; dueDate?: string },
  refs: SubjectRefs,
): TaskRow {
  const now = Date.now();
  const task: TaskRow = {
    id: randomId(),
    action: input.action,
    toRole: input.toRole,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    clientId: refs.clientId,
    clientName: refs.clientName,
    title: taskTitle(input.action, { deal: refs.dealNumber, contract: refs.contractNumber, client: refs.clientName }),
    comment: input.comment,
    link: taskLink(input.action, input.toRole, refs),
    createdById: actor.id,
    createdByName: actor.displayName,
    createdAt: tzIso(now),
    status: 'open',
    ...(input.dueDate ? { dueDate: input.dueDate } : input.toRole === 'hr' ? { dueDate: isoDay(now + 7 * 86_400_000) } : {}),
    ...(refs.contractId ? { contractId: refs.contractId, contractNumber: refs.contractNumber } : {}),
  };
  d.tasks.unshift(task);
  return task;
}

export function notify(d: Db, userId: string, text: string, link?: string, detail?: string): NotificationRow {
  const n: NotificationRow = { id: randomId(), userId, text, ...(detail ? { detail } : {}), ...(link ? { link } : {}), createdAt: tzIso(Date.now()), read: false };
  d.notifications.unshift(n);
  return n;
}

/** Closes a task and tells its author. */
export function closeTask(d: Db, task: TaskRow, byName: string): void {
  if (task.status === 'done') return;
  task.status = 'done';
  task.doneAt = tzIso(Date.now());
  task.doneByName = byName;
  const back = task.toRole === 'hr' ? undefined : task.link;
  notify(d, task.createdById, msg('next.notify.done', { who: byName, client: task.clientName }), back ?? linkForAuthor(d, task), task.title);
}

/** The author of an HR task is MIG staff: the notification leads to the deal or contract. */
function linkForAuthor(d: Db, task: TaskRow): string {
  if (task.contractId) return `/staff/contracts/${task.contractId}`;
  const deal = task.subjectType === 'deal' ? task.subjectId : d.deals.find((x) => x.clientId === task.clientId)?.id;
  return deal ? `/staff/deals/${deal}` : `/staff/clients/${task.clientId}`;
}

/**
 * The action was done: open tasks about it (for this deal, contract or client) close and their authors are
 * notified. Returns how many were closed.
 */
export function completeTasks(d: Db, actions: TaskAction | readonly TaskAction[], refs: { dealId?: string; contractId?: string; clientId?: string }, byName: string): number {
  const list = typeof actions === 'string' ? [actions] : actions;
  let n = 0;
  for (const task of d.tasks) {
    if (task.status !== 'open' || !list.includes(task.action)) continue;
    const about =
      (refs.contractId && (task.contractId === refs.contractId || (task.subjectType === 'contract' && task.subjectId === refs.contractId))) ||
      (refs.dealId && task.subjectType === 'deal' && task.subjectId === refs.dealId) ||
      (refs.clientId && task.clientId === refs.clientId && task.subjectType === 'client');
    if (!about) continue;
    closeTask(d, task, byName);
    n += 1;
  }
  return n;
}
