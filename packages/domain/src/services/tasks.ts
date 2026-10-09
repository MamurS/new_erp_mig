/*
 * Requests between people and in-app notifications (docs/DECISIONS.md «Запросы между сотрудниками: полный
 * цикл»).
 * - «Попросить {роль}» goes to the responsible person of the object (the manager of the deal or client, the
 *   underwriter of the quote); without one — to everyone with the role, and the first «Взять в работу» makes
 *   that person the executor.
 * - «Запросить у HR» goes to the HR cabinet of the client («Задачи от МИГ»).
 * - Statuses: open (ожидает) → in_progress (в работе) → done / rejected. A request closes by itself when its
 *   action is done (`completeTasks` is called by those services) or by hand with a comment.
 * - The executor is notified at once; the author when the request is taken, done or rejected; both a day
 *   before the deadline and when it is overdue (`sweepDeadlines`, run when anyone reads tasks or
 *   notifications); «Напомнить» of the author notifies the executor again.
 * - Every step goes to the object's activity: the deal's «События» and the client's «Активность».
 */
import { msg } from '@mig/i18n';
import type { Role, SessionUser } from '@mig/contracts';
import type { ClientPipeline, TaskAction, TaskEvent, TaskSubjectType, UserNotification, WorkTask } from '@mig/contracts/dto';
import { taskAskSchema, taskDoneHrSchema, taskDoneSchema, taskRejectSchema, taskRequestHrSchema } from '@mig/contracts/forms';
import { can } from '../auth/permissions';
import { isStaffRole } from '../labels';
import { taskLink, taskTitle } from '../nextStep';
import { addWorkdays, canRemind, isActiveRequest, isDueSoon, isOverdue } from '../requests';
import { randomId } from '../lib/random';
import { isoDay } from '../lib/time';
import type { NotificationRow, TaskRow } from '../store/db';
import { asSystem, audit, conflict, forbidden, notFound, requirePermission, systemRepos, tzIso, validate, type AuthCtx, type BaseCtx } from './kernel';
import { loadParams } from './params';
import { dealContract } from './lifecycle';

export interface SubjectRefs {
  clientId: string;
  clientName: string;
  dealId?: string;
  dealNumber?: string;
  contractId?: string;
  contractNumber?: string;
}

/** Client, deal and contract behind a subject (null: no such record). */
export async function subjectRefs(ctx: BaseCtx, type: TaskSubjectType, id: string): Promise<SubjectRefs | null> {
  const r = ctx.repos;
  if (type === 'contract') {
    const c = await r.contracts.get(id);
    if (!c) return null;
    const deal = await r.deals.get(c.dealId);
    return { clientId: c.clientId, clientName: c.clientName, contractId: c.id, contractNumber: c.number, dealId: deal?.id, dealNumber: deal?.number };
  }
  if (type === 'deal') {
    const deal = await r.deals.get(id);
    if (!deal) return null;
    const client = await r.clients.get(deal.clientId);
    const c = await dealContract(ctx, deal.id);
    return { clientId: deal.clientId, clientName: client?.name ?? '', dealId: deal.id, dealNumber: deal.number, contractId: c?.id, contractNumber: c?.number };
  }
  const client = await r.clients.get(id);
  if (!client) return null;
  const deal = (await r.deals.first({ where: { clientId: id, stage: { notIn: ['lost', 'active'] } } })) ?? (await r.deals.first({ where: { clientId: id } }));
  const c = deal ? await dealContract(ctx, deal.id) : undefined;
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
export async function responsibleFor(ctx: BaseCtx, toRole: Role, refs: SubjectRefs): Promise<{ id: string; fullName: string } | undefined> {
  const r = ctx.repos;
  const deal = refs.dealId ? await r.deals.get(refs.dealId) : null;
  const candidates: (string | undefined)[] = [];
  if (toRole === 'sales_manager') candidates.push(deal?.ownerId, (await r.clients.get(refs.clientId))?.managerId);
  if (toRole === 'underwriter') {
    const quote = deal ? (await r.quotes.list({ where: { dealId: deal.id } })).at(-1) : undefined;
    candidates.push(quote?.createdById, deal?.underwriterId);
  }
  for (const id of candidates) {
    const s = id ? await r.staff.get(id) : null;
    if (s && s.role === toRole && s.active) return { id: s.id, fullName: s.fullName };
  }
  return undefined;
}

/** Who acts on the request: the executor, else everyone with the role (MIG) or the client's HR. */
export async function executorIds(ctx: BaseCtx, task: TaskRow): Promise<string[]> {
  if (task.toRole === 'hr') return (await ctx.repos.hrUsers.list({ where: { companyId: task.clientId } })).map((h) => h.id);
  if (task.assigneeId) return [task.assigneeId];
  return (await ctx.repos.staff.list({ where: { role: task.toRole as never, active: true } })).map((s) => s.id);
}

/** May this person act on the request as its executor (take, reject, mark done)? */
export function isExecutor(task: TaskRow, user: Pick<SessionUser, 'id' | 'role' | 'companyId'>): boolean {
  if (task.toRole === 'hr') return user.role === 'hr' && user.companyId === task.clientId;
  if (user.role !== task.toRole) return false;
  return !task.assigneeId || task.assigneeId === user.id;
}

export async function notify(ctx: BaseCtx, userId: string, text: string, link?: string, detail?: string): Promise<NotificationRow> {
  const n: NotificationRow = { id: randomId(), userId, text, ...(detail ? { detail } : {}), ...(link ? { link } : {}), createdAt: tzIso(ctx.now()), read: false };
  return ctx.repos.notifications.insert(n, { at: 'start' });
}

/** What is asked, as a packed label («Загрузить данные для оценки»). */
const whatOf = (task: TaskRow) => msg(`next.action.${task.action}`);

/** The executor's place of the request (their portal). */
const executorLink = (task: TaskRow) => task.link;

/**
 * A line in the request's history and in the activity of its object (the deal's events, the client's log).
 * Changes `task.history` in place: the caller saves the task.
 */
async function record(ctx: BaseCtx, task: TaskRow, kind: TaskEvent['kind'], byName: string, comment?: string): Promise<void> {
  // The activity of the request's deal and client is written whoever acts on the request (HR included): the deal
  // feed under the RLS of deal_events, the client's log through app.fact_append_client_log.
  const at = tzIso(ctx.now());
  task.history.push({ at, kind, byName, ...(comment ? { comment } : {}) });
  const to = task.assigneeName ?? msg(`labels.role.${task.toRole}`);
  const text = msg(`next.activity.${kind}`, { what: whatOf(task), to, who: byName, ...(comment ? { comment } : { comment: '' }) });
  if (task.dealId) await ctx.repos.dealEvents.insert({ id: randomId(), dealId: task.dealId, at, actorName: byName, text }, { at: 'start' });
  await ctx.repos.facts.appendClientLog(task.clientId, { at, text });
}

const saveTask = (ctx: BaseCtx, t: TaskRow) => ctx.repos.tasks.put(t);

export async function createTask(
  ctx: BaseCtx,
  actor: Pick<SessionUser, 'id' | 'displayName'>,
  input: { action: TaskAction; toRole: Role; subjectType: TaskSubjectType; subjectId: string; comment: string },
  refs: SubjectRefs,
): Promise<TaskRow> {
  const now = ctx.now();
  const P = await loadParams(ctx);
  // MIG staff answer each other in «Срок ответа на внутренний запрос», the client's HR in its own term.
  const dueAt = addWorkdays(now, P.dmsParam(input.toRole === 'hr' ? 'clientResponseWorkdays' : 'requestResponseWorkdays'));
  const subject = subjectOf(input.subjectType, input.subjectId, refs);
  const who = input.toRole === 'hr' ? undefined : await responsibleFor(ctx, input.toRole, refs);
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
  await record(ctx, task, 'created', actor.displayName, input.comment || undefined);
  await ctx.repos.tasks.insert(task, { at: 'start' });
  for (const id of await executorIds(ctx, task)) {
    await notify(ctx, id, msg('next.notify.asked', { who: actor.displayName, what: whatOf(task), subject: task.subjectLabel }), executorLink(task), input.comment || undefined);
  }
  return task;
}

/** The open request of the same kind about the same object (one at a time). */
export async function openDuplicate(ctx: BaseCtx, input: { action: TaskAction; toRole: Role; subjectType: TaskSubjectType; subjectId: string }): Promise<TaskRow | null> {
  return ctx.repos.tasks.first({ where: { status: { in: ['open', 'in_progress'] }, action: input.action, toRole: input.toRole, subjectType: input.subjectType, subjectId: input.subjectId } });
}

/** «Взять в работу»: the person becomes the executor; the author is told. */
export async function takeTask(ctx: BaseCtx, task: TaskRow, user: Pick<SessionUser, 'id' | 'displayName'>): Promise<TaskRow> {
  task.status = 'in_progress';
  task.assigneeId = user.id;
  task.assigneeName = user.displayName;
  await record(ctx, task, 'taken', user.displayName);
  await saveTask(ctx, task);
  await notify(ctx, task.createdById, msg('next.notify.taken', { who: user.displayName, what: whatOf(task), subject: task.subjectLabel }), task.subjectLink);
  return task;
}

/** Closes a request as done (by its action or by hand) and tells its author. */
export async function closeTask(ctx: BaseCtx, task: TaskRow, byName: string, comment?: string): Promise<TaskRow> {
  if (!isActiveRequest(task.status)) return task;
  task.status = 'done';
  task.doneAt = tzIso(ctx.now());
  task.doneByName = byName;
  if (comment) task.resolution = comment;
  await record(ctx, task, 'done', byName, comment);
  await saveTask(ctx, task);
  await notify(ctx, task.createdById, msg('next.notify.done', { who: byName, what: whatOf(task), subject: task.subjectLabel }), task.subjectLink, comment);
  return task;
}

/** «Отклонить» with a comment: the author sees why. */
export async function rejectTask(ctx: BaseCtx, task: TaskRow, byName: string, comment: string): Promise<TaskRow> {
  task.status = 'rejected';
  task.doneAt = tzIso(ctx.now());
  task.doneByName = byName;
  task.resolution = comment;
  await record(ctx, task, 'rejected', byName, comment);
  await saveTask(ctx, task);
  await notify(ctx, task.createdById, msg('next.notify.rejected', { who: byName, what: whatOf(task), subject: task.subjectLabel }), task.subjectLink, comment);
  return task;
}

/** «Напомнить»: the executor (or the role) is notified again; a mark in the history. */
export async function remindTask(ctx: BaseCtx, task: TaskRow, byName: string): Promise<TaskRow> {
  task.remindedAt = tzIso(ctx.now());
  await record(ctx, task, 'reminded', byName);
  await saveTask(ctx, task);
  for (const id of await executorIds(ctx, task)) await notify(ctx, id, msg('next.notify.reminded', { who: byName, what: whatOf(task), subject: task.subjectLabel }), executorLink(task));
  return task;
}

/** A day before the deadline and when it is overdue: the executor and the author, once each. */
export async function sweepDeadlines(ctx: BaseCtx): Promise<void> {
  const now = ctx.now();
  for (const task of await ctx.repos.tasks.list({ where: { status: { in: ['open', 'in_progress'] } } })) {
    const kind = isOverdue(task, now) ? 'overdue' : isDueSoon(task, now) ? 'dueSoon' : null;
    if (!kind) continue;
    if (kind === 'overdue' ? task.overdueSent : task.dueSoonSent || task.overdueSent) continue;
    // Claim the reminder: of requests reading at the same time only one sets the flag (Postgres re-checks the
    // condition after the other's commit), the others skip — the reminder goes once. The reader may update every
    // request it sees (RLS of tasks).
    const claimed = kind === 'overdue' ? await ctx.repos.tasks.updateWhere({ id: task.id, overdueSent: { ne: true } }, { overdueSent: true }) : await ctx.repos.tasks.updateWhere({ id: task.id, dueSoonSent: { ne: true } }, { dueSoonSent: true });
    if (!claimed) continue;
    const text = msg(`next.notify.${kind}`, { what: whatOf(task), subject: task.subjectLabel });
    for (const id of await executorIds(ctx, task)) await notify(ctx, id, text, executorLink(task));
    await notify(ctx, task.createdById, text, task.subjectLink);
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
export async function completeTasks(person: BaseCtx, actions: TaskAction | readonly TaskAction[], refs: { dealId?: string; contractId?: string; clientId?: string }, byName: string): Promise<number> {
  // A step of the pipeline done closes the requests about it, whoever did it (requests of other roles too).
  const ctx = asSystem(person, 'a step done closes the open requests about it (requests of any role)');
  const list = typeof actions === 'string' ? [actions] : actions;
  let n = 0;
  for (const task of await ctx.repos.tasks.list({ where: { status: { in: ['open', 'in_progress'] }, action: { in: list } } })) {
    const about =
      (refs.contractId && (task.contractId === refs.contractId || (task.subjectType === 'contract' && task.subjectId === refs.contractId))) ||
      (refs.dealId && task.subjectType === 'deal' && task.subjectId === refs.dealId) ||
      (refs.clientId && task.clientId === refs.clientId && task.subjectType === 'client');
    if (!about) continue;
    await closeTask(ctx, task, byName);
    n += 1;
  }
  return n;
}

// ---------- endpoints ----------

const target = (type: TaskSubjectType) => (type === 'client' ? 'client' : type);

/** Requests a person works on: their own and their role's unassigned ones (MIG), their company's (HR). */
async function tasksFor(ctx: AuthCtx): Promise<TaskRow[]> {
  const { user } = ctx;
  if (user.role === 'hr') return ctx.repos.tasks.list({ where: { toRole: 'hr', clientId: user.companyId } });
  if (isStaffRole(user.role)) return (await ctx.repos.tasks.list({ where: { toRole: user.role } })).filter((t) => !t.assigneeId || t.assigneeId === user.id);
  return [];
}

/** The request the person may act on as executor (404 for anyone else: it «does not exist» for them). */
async function executorTask(ctx: AuthCtx, id: string): Promise<TaskRow> {
  const task = await ctx.repos.tasks.get(id);
  if (!task || !isExecutor(task, ctx.user)) throw notFound();
  if (!isActiveRequest(task.status)) throw conflict('srv.task.closed');
  return task;
}

/** MIG staff ask about clients they may read; HR only about its own company. */
function mayAskAbout(user: SessionUser): boolean {
  return can(user, 'clients.read') || can(user, 'deals.manage') || can(user, 'contracts.read');
}

/** «Попросить {роль}»: a request to the responsible person, or to the role's pool. */
export async function askTask(ctx: AuthCtx, body: unknown): Promise<WorkTask> {
  const { user } = ctx;
  const input = validate(taskAskSchema, body);
  const refs = await subjectRefs(ctx, input.subjectType, input.subjectId);
  if (!refs) throw notFound();
  requirePermission(user, 'tasks.ask', { companyId: refs.clientId });
  if (isStaffRole(user.role) && !mayAskAbout(user)) throw forbidden();
  // One open request of a kind about an object: the plaque shows it instead of the button.
  if (await openDuplicate(ctx, input)) throw conflict('srv.task.duplicate');
  const task = await createTask(ctx, user, input, refs);
  await audit(ctx, user, 'task_created', { targetType: target(input.subjectType), targetId: input.subjectId, targetLabel: `${refs.dealNumber ?? refs.contractNumber ?? refs.clientName} → ${input.toRole}: ${input.action}` });
  return taskView(task, user.id, ctx.now());
}

/** «Запросить у HR»: a request in the HR cabinet; only when the client already has an HR account. */
export async function requestHr(ctx: AuthCtx, body: unknown): Promise<WorkTask> {
  const { user } = ctx;
  requirePermission(user, 'tasks.request_hr');
  const input = validate(taskRequestHrSchema, body);
  const refs = await subjectRefs(ctx, input.subjectType, input.subjectId);
  if (!refs) throw notFound();
  if (!(await ctx.repos.hrUsers.exists({ companyId: refs.clientId }))) throw conflict('srv.task.noHr');
  if (await openDuplicate(ctx, { ...input, toRole: 'hr' })) throw conflict('srv.task.duplicate');
  const task = await createTask(ctx, user, { ...input, toRole: 'hr' }, refs);
  await audit(ctx, user, 'task_created', { targetType: target(input.subjectType), targetId: input.subjectId, targetLabel: `${refs.dealNumber ?? refs.contractNumber ?? refs.clientName} → HR: ${input.action}` });
  return taskView(task, user.id, ctx.now());
}

/** The executor's requests; `status=open` — the ones still waiting (open or taken). */
export async function listTasks(ctx: AuthCtx, status: string | null): Promise<WorkTask[]> {
  requirePermission(ctx.user, 'tasks.receive', { companyId: ctx.user.companyId });
  await sweepDeadlines(ctx);
  return (await tasksFor(ctx))
    .filter((t) => !status || (status === 'open' ? isActiveRequest(t.status) : t.status === status))
    .slice(0, 100)
    .map((t) => taskView(t, ctx.user.id, ctx.now()));
}

/** «Мои запросы»: what the person asked for, all statuses, the newest first. */
export async function myTasks(ctx: AuthCtx): Promise<WorkTask[]> {
  await sweepDeadlines(ctx);
  return (await ctx.repos.tasks.list({ where: { createdById: ctx.user.id }, limit: 100 })).map((t) => taskView(t, ctx.user.id, ctx.now()));
}

/** The open requests about an object (the plaque instead of «Попросить …»). */
export async function tasksAbout(ctx: AuthCtx, type: string | null, id: string): Promise<WorkTask[]> {
  const { user } = ctx;
  if (type !== 'deal' && type !== 'contract' && type !== 'client') throw notFound();
  const refs = await subjectRefs(ctx, type, id);
  if (!refs) throw notFound();
  if (user.role === 'hr') {
    if (refs.clientId !== user.companyId) throw notFound();
  } else if (!isStaffRole(user.role) || !mayAskAbout(user)) throw forbidden();
  return (await ctx.repos.tasks.list({ where: { status: { in: ['open', 'in_progress'] }, subjectType: type, subjectId: id } })).map((t) => taskView(t, user.id, ctx.now()));
}

/** «Взять в работу»: the first one becomes the executor. */
export async function take(ctx: AuthCtx, id: string): Promise<WorkTask> {
  const { user } = ctx;
  requirePermission(user, 'tasks.receive', { companyId: user.companyId });
  const task = await executorTask(ctx, id);
  if (task.status !== 'open') throw conflict('srv.task.taken');
  await takeTask(ctx, task, user);
  await audit(ctx, user, 'task_taken', { targetType: target(task.subjectType), targetId: task.subjectId, targetLabel: task.clientName });
  return taskView(task, user.id, ctx.now());
}

/** «Отметить выполненным»: by hand, with what was done (HR may leave it empty). */
export async function markDone(ctx: AuthCtx, id: string, body: unknown): Promise<WorkTask> {
  const { user } = ctx;
  requirePermission(user, 'tasks.receive', { companyId: user.companyId });
  const task = await executorTask(ctx, id);
  const { comment } = user.role === 'hr' ? validate(taskDoneHrSchema, body) : validate(taskDoneSchema, body);
  if (!task.assigneeId && user.role !== 'hr') {
    task.assigneeId = user.id;
    task.assigneeName = user.displayName;
  }
  await closeTask(ctx, task, user.displayName, comment || undefined);
  await audit(ctx, user, 'task_done', { targetType: target(task.subjectType), targetId: task.subjectId, targetLabel: task.clientName });
  return taskView(task, user.id, ctx.now());
}

/** «Отклонить»: the comment is required, the author sees it. */
export async function reject(ctx: AuthCtx, id: string, body: unknown): Promise<WorkTask> {
  const { user } = ctx;
  requirePermission(user, 'tasks.receive', { companyId: user.companyId });
  const task = await executorTask(ctx, id);
  const { comment } = validate(taskRejectSchema, body);
  await rejectTask(ctx, task, user.displayName, comment);
  await audit(ctx, user, 'task_rejected', { targetType: target(task.subjectType), targetId: task.subjectId, targetLabel: task.clientName, reason: comment });
  return taskView(task, user.id, ctx.now());
}

/** «Напомнить»: the author, once the deadline has passed. */
export async function remind(ctx: AuthCtx, id: string): Promise<WorkTask> {
  const { user } = ctx;
  const task = await ctx.repos.tasks.get(id);
  if (!task || task.createdById !== user.id) throw notFound();
  if (!isActiveRequest(task.status)) throw conflict('srv.task.closed');
  if (!canRemind(task, ctx.now())) throw conflict('srv.task.notOverdue');
  await remindTask(ctx, task, user.displayName);
  await audit(ctx, user, 'task_reminded', { targetType: target(task.subjectType), targetId: task.subjectId, targetLabel: task.clientName });
  return taskView(task, user.id, ctx.now());
}

export async function listNotifications(ctx: AuthCtx): Promise<UserNotification[]> {
  await sweepDeadlines(ctx);
  return (await ctx.repos.notifications.list({ where: { userId: ctx.user.id }, limit: 50 })).map(({ userId: _u, ...n }) => n);
}

/** «Отметить всё прочитанным». */
export async function readAllNotifications(ctx: AuthCtx): Promise<void> {
  await ctx.repos.notifications.updateWhere({ userId: ctx.user.id }, { read: true });
}

/** A click on a notification: that one is read. */
export async function readNotification(ctx: AuthCtx, id: string): Promise<void> {
  const n = await ctx.repos.notifications.get(id);
  if (!n || n.userId !== ctx.user.id) throw notFound();
  await ctx.repos.notifications.update(id, { read: true });
}

/** The client's way to a policy: the open (or last) deal, its contract and the first unpaid invoice. */
export async function clientPipeline(ctx: BaseCtx, clientId: string): Promise<ClientPipeline> {
  const r = ctx.repos;
  const client = await r.clients.get(clientId);
  const hasPolicy = !!client?.activePolicyId || (await r.insured.exists({ clientId }));
  const hasHr = await r.hrUsers.exists({ companyId: clientId });
  const deals = await r.deals.list({ where: { clientId }, orderBy: [['updatedAt', 'desc']] });
  const deal = deals.find((x) => x.stage !== 'lost' && x.stage !== 'active') ?? deals[0];
  if (!deal) return { hasPolicy, hasHr };
  const c = await dealContract(ctx, deal.id);
  const invoice = c ? await r.invoices.first({ where: { contractId: c.id, status: { ne: 'paid' } }, orderBy: [['dueDate', 'asc']] }) : null;
  return {
    hasPolicy,
    hasHr,
    dealId: deal.id,
    dealNumber: deal.number,
    stage: deal.stage,
    ...(c ? { contractId: c.id, contractNumber: c.number, contractStatus: c.status } : {}),
    ...(invoice ? { invoiceId: invoice.id, invoiceNumber: invoice.number } : {}),
  };
}

export async function pipeline(ctx: AuthCtx, clientId: string): Promise<ClientPipeline> {
  requirePermission(ctx.user, 'clients.read');
  if (!(await ctx.repos.clients.get(clientId))) throw notFound();
  return clientPipeline({ ...ctx, repos: systemRepos(ctx, 'client pipeline: deal stage, contract and invoice numbers of a client the person may read') }, clientId);
}
