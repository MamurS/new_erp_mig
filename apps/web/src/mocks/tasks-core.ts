/*
 * Requests between people and in-app notifications (docs/DECISIONS.md «Запросы между сотрудниками: полный
 * цикл»).
 * - «Попросить {роль}» goes to the responsible person of the object (the manager of the deal or client, the
 *   underwriter of the quote); without one — to everyone with the role, and the first «Взять в работу» makes
 *   that person the executor.
 * - «Запросить у HR» goes to the HR cabinet of the client («Задачи от МИГ»).
 * - Statuses: open (ожидает) → in_progress (в работе) → done / rejected. A request closes by itself when its
 *   action is done (`completeTasks` is called by those handlers) or by hand with a comment.
 * - The executor is notified at once; the author when the request is taken, done or rejected; both a day
 *   before the deadline and when it is overdue (`sweepDeadlines`, run when anyone reads tasks or
 *   notifications); «Напомнить» of the author notifies the executor again.
 * - Every step goes to the object's activity: the deal's «События» and the client's «Активность».
 */
import { msg } from '@mig/i18n';
import type { Role, SessionUser } from '@mig/contracts';
import type { TaskAction, TaskEvent, TaskSubjectType, WorkTask } from '@mig/contracts/dto';
import { taskLink, taskTitle } from '@mig/domain/nextStep';
import { addWorkdays, isActiveRequest, isDueSoon, isOverdue } from '@mig/domain/requests';
import type { Db, NotificationRow, TaskRow } from './db';
import { dealContract } from './lifecycle-core';
import { dmsParam } from './params';
import { randomId } from '@mig/seed/rng';
import { isoDay, tzIso } from '@mig/seed/time';

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

/** The object as the author sees it: the deal, the contract or the client. */
function subjectOf(type: TaskSubjectType, id: string, refs: SubjectRefs): { label: string; link: string } {
  if (type === 'contract') return { label: `${refs.contractNumber ?? ''} · ${refs.clientName}`, link: `/staff/contracts/${id}` };
  if (type === 'deal') return { label: `${refs.dealNumber ?? ''} · ${refs.clientName}`, link: `/staff/deals/${id}` };
  return { label: refs.clientName, link: `/staff/clients/${id}` };
}

/**
 * The responsible person for a request to a role: the manager of the deal (or of the client), the underwriter
 * of the quote (or of the deal). Only an active employee with that role; otherwise nobody (the role's pool).
 */
export function responsibleFor(d: Db, toRole: Role, refs: SubjectRefs): { id: string; fullName: string } | undefined {
  const deal = refs.dealId ? d.deals.find((x) => x.id === refs.dealId) : undefined;
  const candidates: (string | undefined)[] = [];
  if (toRole === 'sales_manager') candidates.push(deal?.ownerId, d.clients.find((c) => c.id === refs.clientId)?.managerId);
  if (toRole === 'underwriter') {
    const quote = deal ? d.quotes.filter((q) => q.dealId === deal.id).at(-1) : undefined;
    candidates.push(quote?.createdById, deal?.underwriterId);
  }
  for (const id of candidates) {
    const s = id ? d.staff.find((x) => x.id === id && x.role === toRole && x.active) : undefined;
    if (s) return { id: s.id, fullName: s.fullName };
  }
  return undefined;
}

/** Who acts on the request: the executor, else everyone with the role (MIG) or the client's HR. */
export function executorIds(d: Db, task: TaskRow): string[] {
  if (task.toRole === 'hr') return d.hrUsers.filter((h) => h.companyId === task.clientId).map((h) => h.id);
  if (task.assigneeId) return [task.assigneeId];
  return d.staff.filter((s) => s.role === task.toRole && s.active).map((s) => s.id);
}

/** May this person act on the request as its executor (take, reject, mark done)? */
export function isExecutor(task: TaskRow, user: Pick<SessionUser, 'id' | 'role' | 'companyId'>): boolean {
  if (task.toRole === 'hr') return user.role === 'hr' && user.companyId === task.clientId;
  if (user.role !== task.toRole) return false;
  return !task.assigneeId || task.assigneeId === user.id;
}

export function notify(d: Db, userId: string, text: string, link?: string, detail?: string): NotificationRow {
  const n: NotificationRow = { id: randomId(), userId, text, ...(detail ? { detail } : {}), ...(link ? { link } : {}), createdAt: tzIso(Date.now()), read: false };
  d.notifications.unshift(n);
  return n;
}

/** What is asked, as a packed label («Загрузить данные для оценки»). */
const whatOf = (task: TaskRow) => msg(`next.action.${task.action}`);

/** The executor's place of the request (their portal). */
const executorLink = (task: TaskRow) => task.link;

/** A line in the request's history and in the activity of its object (the deal's events, the client's log). */
function record(d: Db, task: TaskRow, kind: TaskEvent['kind'], byName: string, comment?: string): void {
  const at = tzIso(Date.now());
  task.history.push({ at, kind, byName, ...(comment ? { comment } : {}) });
  const to = task.assigneeName ?? msg(`labels.role.${task.toRole}`);
  const text = msg(`next.activity.${kind}`, { what: whatOf(task), to, who: byName, ...(comment ? { comment } : { comment: '' }) });
  if (task.dealId) d.dealEvents.unshift({ id: randomId(), dealId: task.dealId, at, actorName: byName, text });
  const client = d.clients.find((c) => c.id === task.clientId);
  if (client) (client.log ??= []).unshift({ at, text });
}

export function createTask(
  d: Db,
  actor: Pick<SessionUser, 'id' | 'displayName'>,
  input: { action: TaskAction; toRole: Role; subjectType: TaskSubjectType; subjectId: string; comment: string },
  refs: SubjectRefs,
): TaskRow {
  const now = Date.now();
  // MIG staff answer each other in «Срок ответа на внутренний запрос», the client's HR in its own term.
  const dueAt = addWorkdays(now, dmsParam(input.toRole === 'hr' ? 'clientResponseWorkdays' : 'requestResponseWorkdays'));
  const subject = subjectOf(input.subjectType, input.subjectId, refs);
  const who = input.toRole === 'hr' ? undefined : responsibleFor(d, input.toRole, refs);
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
    dueAt: tzIso(dueAt),
    dueDate: isoDay(dueAt),
    status: 'open',
    ...(who ? { assigneeId: who.id, assigneeName: who.fullName } : {}),
    subjectLabel: subject.label,
    subjectLink: subject.link,
    history: [],
    ...(refs.dealId ? { dealId: refs.dealId } : {}),
    ...(refs.contractId ? { contractId: refs.contractId, contractNumber: refs.contractNumber } : {}),
  };
  d.tasks.unshift(task);
  record(d, task, 'created', actor.displayName, input.comment || undefined);
  for (const id of executorIds(d, task)) {
    notify(d, id, msg('next.notify.asked', { who: actor.displayName, what: whatOf(task), subject: task.subjectLabel }), executorLink(task), input.comment || undefined);
  }
  return task;
}

/** The open request of the same kind about the same object (one at a time). */
export function openDuplicate(d: Db, input: { action: TaskAction; toRole: Role; subjectType: TaskSubjectType; subjectId: string }): TaskRow | undefined {
  return d.tasks.find((t) => isActiveRequest(t.status) && t.action === input.action && t.toRole === input.toRole && t.subjectType === input.subjectType && t.subjectId === input.subjectId);
}

/** «Взять в работу»: the person becomes the executor; the author is told. */
export function takeTask(d: Db, task: TaskRow, user: Pick<SessionUser, 'id' | 'displayName'>): void {
  task.status = 'in_progress';
  task.assigneeId = user.id;
  task.assigneeName = user.displayName;
  record(d, task, 'taken', user.displayName);
  notify(d, task.createdById, msg('next.notify.taken', { who: user.displayName, what: whatOf(task), subject: task.subjectLabel }), task.subjectLink);
}

/** Closes a request as done (by its action or by hand) and tells its author. */
export function closeTask(d: Db, task: TaskRow, byName: string, comment?: string): void {
  if (!isActiveRequest(task.status)) return;
  task.status = 'done';
  task.doneAt = tzIso(Date.now());
  task.doneByName = byName;
  if (comment) task.resolution = comment;
  record(d, task, 'done', byName, comment);
  notify(d, task.createdById, msg('next.notify.done', { who: byName, what: whatOf(task), subject: task.subjectLabel }), task.subjectLink, comment);
}

/** «Отклонить» with a comment: the author sees why. */
export function rejectTask(d: Db, task: TaskRow, byName: string, comment: string): void {
  task.status = 'rejected';
  task.doneAt = tzIso(Date.now());
  task.doneByName = byName;
  task.resolution = comment;
  record(d, task, 'rejected', byName, comment);
  notify(d, task.createdById, msg('next.notify.rejected', { who: byName, what: whatOf(task), subject: task.subjectLabel }), task.subjectLink, comment);
}

/** «Напомнить»: the executor (or the role) is notified again; a mark in the history. */
export function remindTask(d: Db, task: TaskRow, byName: string): void {
  task.remindedAt = tzIso(Date.now());
  record(d, task, 'reminded', byName);
  for (const id of executorIds(d, task)) notify(d, id, msg('next.notify.reminded', { who: byName, what: whatOf(task), subject: task.subjectLabel }), executorLink(task));
}

/** A day before the deadline and when it is overdue: the executor and the author, once each. */
export function sweepDeadlines(d: Db, now = Date.now()): void {
  for (const task of d.tasks) {
    if (!isActiveRequest(task.status)) continue;
    const kind = isOverdue(task, now) ? 'overdue' : isDueSoon(task, now) ? 'dueSoon' : null;
    if (!kind) continue;
    if (kind === 'overdue' ? task.overdueSent : task.dueSoonSent || task.overdueSent) continue;
    if (kind === 'overdue') task.overdueSent = true;
    else task.dueSoonSent = true;
    const text = msg(`next.notify.${kind}`, { what: whatOf(task), subject: task.subjectLabel });
    for (const id of executorIds(d, task)) notify(d, id, text, executorLink(task));
    notify(d, task.createdById, text, task.subjectLink);
  }
}

/** The request as the API returns it (no internal ids). */
export function taskView(t: TaskRow, viewerId: string, now = Date.now()): WorkTask {
  const { createdById: _a, assigneeId: _b, dealId: _c, dueSoonSent: _d, overdueSent: _e, ...rest } = t;
  return { ...rest, overdue: isOverdue(t, now), byMe: t.createdById === viewerId };
}

/**
 * The action was done: open requests about it (for this deal, contract or client) close and their authors
 * are notified. Returns how many were closed.
 */
export function completeTasks(d: Db, actions: TaskAction | readonly TaskAction[], refs: { dealId?: string; contractId?: string; clientId?: string }, byName: string): number {
  const list = typeof actions === 'string' ? [actions] : actions;
  let n = 0;
  for (const task of d.tasks) {
    if (!isActiveRequest(task.status) || !list.includes(task.action)) continue;
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
