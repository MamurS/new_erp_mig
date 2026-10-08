/*
 * Next steps: tasks between roles, the HR «Задачи от МИГ», notifications and the client pipeline that
 * explains an empty «Застрахованные» tab (docs/DECISIONS.md «Пустые состояния со следующим шагом»).
 * The server checks every right itself; a task never exposes more than its title, comment and link.
 */
import { http } from 'msw';
import type { SessionUser } from '@mig/contracts';
import type { ClientPipeline, TaskSubjectType, UserNotification } from '@mig/contracts/dto';
import { can } from '@mig/domain/auth/permissions';
import { isStaffRole } from '@mig/domain/labels';
import { canRemind, isActiveRequest } from '@mig/domain/requests';
import { taskAskSchema, taskDoneHrSchema, taskDoneSchema, taskRejectSchema, taskRequestHrSchema } from '@mig/contracts/forms';
import { db, type Db, type TaskRow } from '../db';
import { API, audit, body, conflict, forbidden, notFound, param, requirePermission, requireSession, route } from '../http';
import { dealContract } from '../lifecycle-core';
import { closeTask, createTask, isExecutor, openDuplicate, rejectTask, remindTask, subjectRefs, sweepDeadlines, takeTask, taskView } from '../tasks-core';

const target = (type: TaskSubjectType) => (type === 'client' ? 'client' : type);

/** Requests a person works on: their own and their role's unassigned ones (MIG), their company's (HR). */
function tasksFor(d: Db, user: SessionUser): TaskRow[] {
  if (user.role === 'hr') return d.tasks.filter((t) => t.toRole === 'hr' && t.clientId === user.companyId);
  if (isStaffRole(user.role)) return d.tasks.filter((t) => t.toRole === user.role && (!t.assigneeId || t.assigneeId === user.id));
  return [];
}

/** The request the person may act on as executor (404 for anyone else: it «does not exist» for them). */
function executorTask(d: Db, user: SessionUser, id: string): TaskRow {
  const task = d.tasks.find((t) => t.id === id);
  if (!task || !isExecutor(task, user)) throw notFound();
  if (!isActiveRequest(task.status)) throw conflict('srv.task.closed');
  return task;
}

/** The client's way to a policy: the open (or last) deal, its contract and the first unpaid invoice. */
export function clientPipeline(d: Db, clientId: string): ClientPipeline {
  const client = d.clients.find((c) => c.id === clientId);
  const hasPolicy = !!client?.activePolicyId || d.insured.some((i) => i.clientId === clientId);
  const hasHr = d.hrUsers.some((h) => h.companyId === clientId);
  const deals = d.deals.filter((x) => x.clientId === clientId).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const deal = deals.find((x) => x.stage !== 'lost' && x.stage !== 'active') ?? deals[0];
  if (!deal) return { hasPolicy, hasHr };
  const c = dealContract(d, deal.id);
  const invoice = c ? d.invoices.filter((i) => i.contractId === c.id && i.status !== 'paid').sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0] : undefined;
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

export const taskHandlers = [
  // «Попросить {роль}»: a request to the responsible person, or to the role's pool.
  http.post(
    `${API}/tasks`,
    route(async ({ request }) => {
      const { user } = requireSession(request);
      const input = await body(request, taskAskSchema);
      const d = db();
      const refs = subjectRefs(d, input.subjectType, input.subjectId);
      if (!refs) throw notFound();
      requirePermission(user, 'tasks.ask', { companyId: refs.clientId });
      // MIG staff ask about clients they may read; HR only about its own company.
      if (isStaffRole(user.role) && !can(user, 'clients.read') && !can(user, 'deals.manage') && !can(user, 'contracts.read')) throw forbidden();
      // One open request of a kind about an object: the plaque shows it instead of the button.
      if (openDuplicate(d, input)) throw conflict('srv.task.duplicate');
      const task = createTask(d, user, input, refs);
      audit(user, 'task_created', { targetType: target(input.subjectType), targetId: input.subjectId, targetLabel: `${refs.dealNumber ?? refs.contractNumber ?? refs.clientName} → ${input.toRole}: ${input.action}` });
      return taskView(task, user.id);
    }),
  ),
  // «Запросить у HR»: a request in the HR cabinet; only when the client already has an HR account.
  http.post(
    `${API}/tasks/request-hr`,
    route(async ({ request }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'tasks.request_hr');
      const input = await body(request, taskRequestHrSchema);
      const d = db();
      const refs = subjectRefs(d, input.subjectType, input.subjectId);
      if (!refs) throw notFound();
      if (!d.hrUsers.some((h) => h.companyId === refs.clientId)) throw conflict('srv.task.noHr');
      if (openDuplicate(d, { ...input, toRole: 'hr' })) throw conflict('srv.task.duplicate');
      const task = createTask(d, user, { ...input, toRole: 'hr' }, refs);
      audit(user, 'task_created', { targetType: target(input.subjectType), targetId: input.subjectId, targetLabel: `${refs.dealNumber ?? refs.contractNumber ?? refs.clientName} → HR: ${input.action}` });
      return taskView(task, user.id);
    }),
  ),
  // The executor's requests; `status=open` — the ones still waiting (open or taken).
  http.get(
    `${API}/tasks`,
    route(({ request, url }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'tasks.receive', { companyId: user.companyId });
      const d = db();
      sweepDeadlines(d);
      const status = url.searchParams.get('status');
      return tasksFor(d, user)
        .filter((t) => !status || (status === 'open' ? isActiveRequest(t.status) : t.status === status))
        .slice(0, 100)
        .map((t) => taskView(t, user.id));
    }),
  ),
  // «Мои запросы»: what the person asked for, all statuses, the newest first.
  http.get(
    `${API}/tasks/mine`,
    route(({ request }) => {
      const { user } = requireSession(request);
      const d = db();
      sweepDeadlines(d);
      return d.tasks
        .filter((t) => t.createdById === user.id)
        .slice(0, 100)
        .map((t) => taskView(t, user.id));
    }),
  ),
  // The open requests about an object (the plaque instead of «Попросить …»).
  http.get(
    `${API}/tasks/about`,
    route(({ request, url }) => {
      const { user } = requireSession(request);
      const type = url.searchParams.get('subjectType');
      const id = url.searchParams.get('subjectId') ?? '';
      if (type !== 'deal' && type !== 'contract' && type !== 'client') throw notFound();
      const d = db();
      const refs = subjectRefs(d, type, id);
      if (!refs) throw notFound();
      if (user.role === 'hr') {
        if (refs.clientId !== user.companyId) throw notFound();
      } else if (!isStaffRole(user.role) || (!can(user, 'clients.read') && !can(user, 'deals.manage') && !can(user, 'contracts.read'))) throw forbidden();
      return d.tasks.filter((t) => isActiveRequest(t.status) && t.subjectType === type && t.subjectId === id).map((t) => taskView(t, user.id));
    }),
  ),
  // «Взять в работу»: the first one becomes the executor.
  http.post(
    `${API}/tasks/:id/take`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'tasks.receive', { companyId: user.companyId });
      const d = db();
      const task = executorTask(d, user, param(ctx, 'id'));
      if (task.status !== 'open') throw conflict('srv.task.taken');
      takeTask(d, task, user);
      audit(user, 'task_taken', { targetType: target(task.subjectType), targetId: task.subjectId, targetLabel: task.clientName });
      return taskView(task, user.id);
    }),
  ),
  // «Отметить выполненным»: by hand, with what was done (HR may leave it empty).
  http.post(
    `${API}/tasks/:id/done`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'tasks.receive', { companyId: user.companyId });
      const d = db();
      const task = executorTask(d, user, param(ctx, 'id'));
      const { comment } = user.role === 'hr' ? await body(ctx.request, taskDoneHrSchema) : await body(ctx.request, taskDoneSchema);
      if (!task.assigneeId && user.role !== 'hr') {
        task.assigneeId = user.id;
        task.assigneeName = user.displayName;
      }
      closeTask(d, task, user.displayName, comment || undefined);
      audit(user, 'task_done', { targetType: target(task.subjectType), targetId: task.subjectId, targetLabel: task.clientName });
      return taskView(task, user.id);
    }),
  ),
  // «Отклонить»: the comment is required, the author sees it.
  http.post(
    `${API}/tasks/:id/reject`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'tasks.receive', { companyId: user.companyId });
      const d = db();
      const task = executorTask(d, user, param(ctx, 'id'));
      const { comment } = await body(ctx.request, taskRejectSchema);
      rejectTask(d, task, user.displayName, comment);
      audit(user, 'task_rejected', { targetType: target(task.subjectType), targetId: task.subjectId, targetLabel: task.clientName, reason: comment });
      return taskView(task, user.id);
    }),
  ),
  // «Напомнить»: the author, once the deadline has passed.
  http.post(
    `${API}/tasks/:id/remind`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      const d = db();
      const task = d.tasks.find((t) => t.id === param(ctx, 'id') && t.createdById === user.id);
      if (!task) throw notFound();
      if (!isActiveRequest(task.status)) throw conflict('srv.task.closed');
      if (!canRemind(task)) throw conflict('srv.task.notOverdue');
      remindTask(d, task, user.displayName);
      audit(user, 'task_reminded', { targetType: target(task.subjectType), targetId: task.subjectId, targetLabel: task.clientName });
      return taskView(task, user.id);
    }),
  ),
  http.get(
    `${API}/notifications`,
    route(({ request }) => {
      const { user } = requireSession(request);
      const d = db();
      sweepDeadlines(d);
      return d.notifications
        .filter((n) => n.userId === user.id)
        .slice(0, 50)
        .map(({ userId: _u, ...n }): UserNotification => n);
    }),
  ),
  // «Отметить всё прочитанным».
  http.post(
    `${API}/notifications/read`,
    route(({ request }) => {
      const { user } = requireSession(request);
      for (const n of db().notifications) if (n.userId === user.id) n.read = true;
      return undefined;
    }),
  ),
  // A click on a notification: that one is read.
  http.post(
    `${API}/notifications/:id/read`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      const n = db().notifications.find((x) => x.id === param(ctx, 'id') && x.userId === user.id);
      if (!n) throw notFound();
      n.read = true;
      return undefined;
    }),
  ),
  http.get(
    `${API}/clients/:id/pipeline`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'clients.read');
      const d = db();
      const id = param(ctx, 'id');
      if (!d.clients.some((c) => c.id === id)) throw notFound();
      return clientPipeline(d, id);
    }),
  ),
];
