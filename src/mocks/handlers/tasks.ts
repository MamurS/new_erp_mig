/*
 * Next steps: tasks between roles, the HR «Задачи от МИГ», notifications and the client pipeline that
 * explains an empty «Застрахованные» tab (docs/DECISIONS.md «Пустые состояния со следующим шагом»).
 * The server checks every right itself; a task never exposes more than its title, comment and link.
 */
import { http } from 'msw';
import type { SessionUser } from '@/shared/types';
import type { ClientPipeline, UserNotification, WorkTask } from '@/shared/types/dto';
import { can } from '@/shared/auth/permissions';
import { isStaffRole } from '@/shared/domain/labels';
import { taskAskSchema, taskRequestHrSchema } from '@/shared/schemas/forms';
import { db, type Db, type TaskRow } from '../db';
import { API, audit, body, conflict, forbidden, notFound, param, requirePermission, requireSession, route } from '../http';
import { dealContract } from '../lifecycle-core';
import { closeTask, createTask, subjectRefs } from '../tasks-core';

const view = (t: TaskRow): WorkTask => {
  const { createdById: _author, ...rest } = t;
  return rest;
};

/** Tasks a person works on: their role's tasks (staff) or the tasks for their company (HR). */
function tasksFor(d: Db, user: SessionUser): TaskRow[] {
  if (user.role === 'hr') return d.tasks.filter((t) => t.toRole === 'hr' && t.clientId === user.companyId);
  if (isStaffRole(user.role)) return d.tasks.filter((t) => t.toRole === user.role);
  return [];
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
  // «Попросить {роль}»: a task in the queue of a MIG role.
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
      const task = createTask(d, user, input, refs);
      audit(user, 'task_created', { targetType: input.subjectType === 'client' ? 'client' : input.subjectType, targetId: input.subjectId, targetLabel: `${refs.dealNumber ?? refs.contractNumber ?? refs.clientName} → ${input.toRole}: ${input.action}` });
      return view(task);
    }),
  ),
  // «Запросить у HR»: a task in the HR cabinet; only when the client already has an HR account.
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
      const task = createTask(d, user, { ...input, toRole: 'hr' }, refs);
      audit(user, 'task_created', { targetType: input.subjectType === 'client' ? 'client' : input.subjectType, targetId: input.subjectId, targetLabel: `${refs.dealNumber ?? refs.contractNumber ?? refs.clientName} → HR: ${input.action}` });
      return view(task);
    }),
  ),
  http.get(
    `${API}/tasks`,
    route(({ request, url }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'tasks.receive', { companyId: user.companyId });
      const status = url.searchParams.get('status');
      return tasksFor(db(), user)
        .filter((t) => !status || t.status === status)
        .slice(0, 100)
        .map(view);
    }),
  ),
  http.post(
    `${API}/tasks/:id/done`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'tasks.receive', { companyId: user.companyId });
      const d = db();
      const task = tasksFor(d, user).find((t) => t.id === param(ctx, 'id'));
      if (!task) throw notFound();
      if (task.status !== 'open') throw conflict('srv.task.closed');
      closeTask(d, task, user.displayName);
      audit(user, 'task_done', { targetType: task.subjectType === 'client' ? 'client' : task.subjectType, targetId: task.subjectId, targetLabel: task.clientName });
      return view(task);
    }),
  ),
  http.get(
    `${API}/notifications`,
    route(({ request }) => {
      const { user } = requireSession(request);
      return db()
        .notifications.filter((n) => n.userId === user.id)
        .slice(0, 50)
        .map(({ userId: _u, ...n }): UserNotification => n);
    }),
  ),
  http.post(
    `${API}/notifications/read`,
    route(({ request }) => {
      const { user } = requireSession(request);
      for (const n of db().notifications) if (n.userId === user.id) n.read = true;
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
