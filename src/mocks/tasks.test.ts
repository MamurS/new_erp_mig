// @vitest-environment node
/*
 * Next steps of empty sections on the mock server (DECISIONS «Пустые состояния со следующим шагом»):
 * «Попросить …» puts a task into the role's queue with a link back, the action itself closes it and
 * notifies the author; «Запросить у HR» needs an HR cabinet; HR uploads appendix 2 of a draft it was asked
 * for; the contract cannot go to approval while the checklist misses a required item.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ClientPipeline, ContractView, DashboardSummary, DealCard, DealView, QueueItem, SessionResponse, UserNotification, WorkTask } from '@/shared/types/dto';
import { unpack } from '@/i18n/core';
import { createMockServer } from './node';
import { db, resetDb } from './db';

const BASE = 'http://localhost/api';
const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => resetDb());

type Res<T> = { status: number; data: T };
async function call<T = Record<string, unknown>>(path: string, init: { method?: string; sid?: string; json?: unknown; text?: string; form?: FormData } = {}): Promise<Res<T>> {
  const headers = new Headers();
  if (init.sid) headers.set('Authorization', `Bearer ${init.sid}`);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  if (init.text !== undefined) headers.set('Content-Type', 'text/csv');
  const res = await fetch(`${BASE}${path}`, { method: init.method ?? 'GET', headers, body: init.form ?? init.text ?? (init.json === undefined ? undefined : JSON.stringify(init.json)) });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  return { status: res.status, data: data as T };
}
async function login(email: string): Promise<string> {
  const a = await call<{ challengeId: string }>('/auth/login', { method: 'POST', json: { email, password: 'Demo-2026!' } });
  const b = await call<SessionResponse>('/auth/otp', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
  expect(b.status, email).toBe(200);
  return b.data.sessionId;
}
const CENSUS = ['gender,birthYear,relation', ...Array.from({ length: 12 }, (_, k) => `${k % 2 ? 'f' : 'm'},${1975 + k * 2},employee`)].join('\n');
const LIST = ['fullName,birthDate,pinfl,phone,position,relation,principal_pinfl,student', 'Novyy Sotrudnik Pervyy,15.03.1990,31503900000101,+998935550101,Engineer,employee,,', 'Novaya Sotrudnitsa Vtoraya,01.07.1988,40107880000102,+998935550102,Accountant,employee,,'].join('\n');

const SALES = 'sales@demo.mig.uz';
const UW = 'underwriter@demo.mig.uz';

async function leadDeal(sid: string): Promise<DealView> {
  const deals = (await call<DealView[]>('/deals', { sid })).data;
  const lead = deals.find((d) => d.stage === 'lead' && !db().hrUsers.some((h) => h.companyId === d.clientId));
  expect(lead, 'a seeded lead without an HR cabinet').toBeTruthy();
  return lead!;
}

/** A deal with a sent KP → accepted by the manager's mark → a draft contract (the client has HR). */
async function draftContract(sales: string): Promise<{ deal: DealView; contract: ContractView }> {
  const deals = (await call<(DealView & { kpId?: string })[]>('/deals', { sid: sales })).data;
  const deal = deals.find((d) => d.stage === 'kp_sent' && d.kpId && d.type === 'new')!;
  expect(deal).toBeTruthy();
  expect((await call(`/kp/${deal.kpId}/accept`, { method: 'POST', sid: sales })).status).toBe(200);
  const c = await call<ContractView>('/contracts', { method: 'POST', sid: sales, json: { dealId: deal.id } });
  expect(c.status).toBe(201);
  return { deal, contract: c.data };
}

describe('«Попросить …»: a task in the queue of the role', () => {
  it('the underwriter asks the manager for the assessment data of a lead; the upload closes it and notifies the underwriter', async () => {
    const uw = await login(UW);
    const sales = await login(SALES);
    const deal = await leadDeal(uw);
    const asked = await call<WorkTask>('/tasks', { method: 'POST', sid: uw, json: { toRole: 'sales_manager', action: 'census_upload', subjectType: 'deal', subjectId: deal.id, comment: 'Нужно к пятнице' } });
    expect(asked.status).toBe(200);
    expect(asked.data).toMatchObject({ toRole: 'sales_manager', status: 'open', link: `/staff/deals/${deal.id}/census?upload=1`, comment: 'Нужно к пятнице' });
    expect(unpack(asked.data.title).key).toBe('next.task.census_upload');

    // The manager's queue has the row with the link back; the underwriter's does not.
    const queue = (await call<QueueItem[]>('/queue?type=request', { sid: sales })).data;
    expect(queue.find((q) => q.entityId === asked.data.id)).toMatchObject({ type: 'request', link: `/staff/deals/${deal.id}/census?upload=1` });
    expect((await call<DashboardSummary>('/dashboard', { sid: sales })).data.queueTypes.some((x) => x.type === 'request')).toBe(true);
    expect((await call<WorkTask[]>('/tasks', { sid: uw })).data.some((x) => x.id === asked.data.id)).toBe(false);

    expect((await call(`/deals/${deal.id}/census`, { method: 'POST', sid: sales, text: CENSUS })).status).toBe(200);
    expect(db().tasks.find((x) => x.id === asked.data.id)!.status).toBe('done');
    const notes = (await call<UserNotification[]>('/notifications', { sid: uw })).data;
    expect(notes[0]).toMatchObject({ read: false, link: `/staff/deals/${deal.id}` });
    expect(unpack(notes[0]!.text).key).toBe('next.notify.done');
    expect((await call('/notifications/read', { method: 'POST', sid: uw })).status).toBe(204);
    expect((await call<UserNotification[]>('/notifications', { sid: uw })).data.every((n) => n.read)).toBe(true);
    expect((await call<QueueItem[]>('/queue?type=request', { sid: sales })).data.some((q) => q.entityId === asked.data.id)).toBe(false);
  });

  it('«Выполнено» by the receiver; partners, the insured and strangers cannot', async () => {
    const uw = await login(UW);
    const sales = await login(SALES);
    const deal = await leadDeal(uw);
    const task = (await call<WorkTask>('/tasks', { method: 'POST', sid: uw, json: { toRole: 'sales_manager', action: 'other', subjectType: 'deal', subjectId: deal.id } })).data;
    expect((await call(`/tasks/${task.id}/done`, { method: 'POST', sid: uw, json: { comment: 'Сделано' } })).status).toBe(404);
    // MIG staff say what was done.
    expect((await call(`/tasks/${task.id}/done`, { method: 'POST', sid: sales, json: {} })).status).toBe(422);
    expect((await call<WorkTask>(`/tasks/${task.id}/done`, { method: 'POST', sid: sales, json: { comment: 'Сделано' } })).data).toMatchObject({ status: 'done', resolution: 'Сделано' });
    expect((await call(`/tasks/${task.id}/done`, { method: 'POST', sid: sales, json: { comment: 'Сделано' } })).status).toBe(409);
    const clinic = await login('admin@demo-clinic.uz');
    expect((await call('/tasks', { method: 'POST', sid: clinic, json: { toRole: 'operator', action: 'other', subjectType: 'deal', subjectId: deal.id } })).status).toBe(403);
    expect((await call('/tasks', { method: 'POST', sid: uw, json: { toRole: 'hr', action: 'other', subjectType: 'deal', subjectId: deal.id } })).status).toBe(422);
    expect((await call('/tasks', { method: 'POST', sid: uw, json: { toRole: 'sales_manager', action: 'other', subjectType: 'deal', subjectId: '00000000-0000-4000-8000-000000000000' } })).status).toBe(404);
  });
});

describe('requests: the full cycle (DECISIONS «Запросы между сотрудниками: полный цикл»)', () => {
  const ask = (sid: string, dealId: string, action = 'census_upload') =>
    call<WorkTask & { key?: string }>('/tasks', { method: 'POST', sid, json: { toRole: 'sales_manager', action, subjectType: 'deal', subjectId: dealId, comment: 'К пятнице' } });

  it('goes to the responsible manager by name, notifies them at once; the same request cannot be sent twice', async () => {
    const uw = await login(UW);
    const sales = await login(SALES);
    const deal = await leadDeal(uw);
    const owner = db().staff.find((s) => s.id === db().deals.find((x) => x.id === deal.id)!.ownerId)!;
    const r = await ask(uw, deal.id);
    expect(r.data).toMatchObject({ status: 'open', assigneeName: owner.fullName, byMe: true, overdue: false, subjectLink: `/staff/deals/${deal.id}` });
    expect(r.data.history.map((h) => h.kind)).toEqual(['created']);
    const note = (await call<UserNotification[]>('/notifications', { sid: sales })).data[0]!;
    expect(unpack(note.text)).toMatchObject({ key: 'next.notify.asked', params: { who: db().staff.find((s) => s.email === UW)!.fullName, subject: expect.stringContaining(deal.number) } });
    expect(note.link).toBe(`/staff/deals/${deal.id}/census?upload=1`);
    const again = await ask(uw, deal.id);
    expect(again.status).toBe(409);
    expect(again.data.key).toBe('srv.task.duplicate');
    // The plaque reads the open request of the object; the deal's events have it.
    expect((await call<WorkTask[]>(`/tasks/about?subjectType=deal&subjectId=${deal.id}`, { sid: uw })).data.map((x) => x.id)).toEqual([r.data.id]);
    expect(db().dealEvents.some((e) => e.dealId === deal.id && unpack(e.text).key === 'next.activity.created')).toBe(true);
    expect((await call<WorkTask[]>('/tasks/mine', { sid: uw })).data[0]).toMatchObject({ id: r.data.id, status: 'open' });
  });

  it('without a responsible person it goes to the whole role; the first «Взять в работу» becomes the executor', async () => {
    const uw = await login(UW);
    const deal = await leadDeal(uw);
    const legal = db().staff.filter((s) => s.role === 'legal' && s.active);
    const r = (await call<WorkTask>('/tasks', { method: 'POST', sid: uw, json: { toRole: 'legal', action: 'other', subjectType: 'deal', subjectId: deal.id } })).data;
    expect(r.assigneeName).toBeUndefined();
    for (const l of legal) expect(db().notifications.some((n) => n.userId === l.id && unpack(n.text).key === 'next.notify.asked')).toBe(true);
    const first = await login(legal[0]!.email);
    const taken = await call<WorkTask>(`/tasks/${r.id}/take`, { method: 'POST', sid: first });
    expect(taken.data).toMatchObject({ status: 'in_progress', assigneeName: legal[0]!.fullName });
    expect((await call(`/tasks/${r.id}/take`, { method: 'POST', sid: first })).status).toBe(409);
    if (legal[1]) {
      const second = await login(legal[1].email);
      expect((await call(`/tasks/${r.id}/take`, { method: 'POST', sid: second })).status).toBe(404);
      expect((await call<QueueItem[]>('/queue?type=request', { sid: second })).data.some((q) => q.entityId === r.id)).toBe(false);
    }
    const notes = (await call<UserNotification[]>('/notifications', { sid: uw })).data;
    expect(unpack(notes[0]!.text).key).toBe('next.notify.taken');
  });

  it('«Отклонить» needs a comment; the author sees it in «Мои запросы» and in the notification', async () => {
    const uw = await login(UW);
    const sales = await login(SALES);
    const deal = await leadDeal(uw);
    const r = (await ask(uw, deal.id)).data;
    expect((await call(`/tasks/${r.id}/reject`, { method: 'POST', sid: sales, json: { comment: '' } })).status).toBe(422);
    expect((await call(`/tasks/${r.id}/reject`, { method: 'POST', sid: uw, json: { comment: 'Не моё' } })).status).toBe(404);
    const rejected = await call<WorkTask>(`/tasks/${r.id}/reject`, { method: 'POST', sid: sales, json: { comment: 'Клиент пришлёт данные в понедельник' } });
    expect(rejected.data).toMatchObject({ status: 'rejected', resolution: 'Клиент пришлёт данные в понедельник' });
    expect((await call<WorkTask[]>('/tasks/mine', { sid: uw })).data[0]).toMatchObject({ status: 'rejected', resolution: 'Клиент пришлёт данные в понедельник' });
    const note = (await call<UserNotification[]>('/notifications', { sid: uw })).data[0]!;
    expect(unpack(note.text).key).toBe('next.notify.rejected');
    expect(note.detail).toBe('Клиент пришлёт данные в понедельник');
    // Closed: the button is back, a new request may be sent.
    expect((await ask(uw, deal.id)).status).toBe(200);
  });

  it('deadline: «Срок ответа на запрос» working days; a day before and when overdue both are notified once; «Напомнить» only after the deadline', async () => {
    const uw = await login(UW);
    const sales = await login(SALES);
    const deal = await leadDeal(uw);
    const r = (await ask(uw, deal.id)).data;
    expect(Date.parse(r.dueAt)).toBeGreaterThan(Date.now() + 36 * 3_600_000);
    expect((await call(`/tasks/${r.id}/remind`, { method: 'POST', sid: uw })).status).toBe(409);
    const row = db().tasks.find((x) => x.id === r.id)!;
    const count = (sid: string, key: string) => call<UserNotification[]>('/notifications', { sid }).then((x) => x.data.filter((n) => unpack(n.text).key === key).length);
    row.dueAt = new Date(Date.now() + 3_600_000).toISOString();
    expect(await count(sales, 'next.notify.dueSoon')).toBe(1);
    expect(await count(uw, 'next.notify.dueSoon')).toBe(1);
    row.dueAt = new Date(Date.now() - 3_600_000).toISOString();
    expect(await count(sales, 'next.notify.overdue')).toBe(1);
    expect(await count(sales, 'next.notify.overdue')).toBe(1);
    expect((await call<WorkTask[]>('/tasks/mine', { sid: uw })).data[0]!.overdue).toBe(true);
    expect((await call<QueueItem[]>('/queue?type=request', { sid: sales })).data.find((q) => q.entityId === r.id)).toMatchObject({ statusTone: 'danger', request: { overdue: true } });
    expect((await call(`/tasks/${r.id}/remind`, { method: 'POST', sid: sales })).status).toBe(404);
    const reminded = await call<WorkTask>(`/tasks/${r.id}/remind`, { method: 'POST', sid: uw });
    expect(reminded.data.remindedAt).toBeTruthy();
    expect(reminded.data.history.at(-1)!.kind).toBe('reminded');
    expect(await count(sales, 'next.notify.reminded')).toBe(1);
  });

  it('a notification is read one by one or all at once; another person cannot read it', async () => {
    const uw = await login(UW);
    const sales = await login(SALES);
    const deal = await leadDeal(uw);
    await ask(uw, deal.id);
    const n = (await call<UserNotification[]>('/notifications', { sid: sales })).data[0]!;
    expect((await call(`/notifications/${n.id}/read`, { method: 'POST', sid: uw })).status).toBe(404);
    expect((await call(`/notifications/${n.id}/read`, { method: 'POST', sid: sales })).status).toBe(204);
    expect((await call<UserNotification[]>('/notifications', { sid: sales })).data[0]!.read).toBe(true);
  });
});

describe('«Запросить у HR» and the contract checklist', () => {
  it('a lead without an HR cabinet: no task (the UI offers the letter)', async () => {
    const sales = await login(SALES);
    const deal = await leadDeal(sales);
    const r = await call<{ key: string }>('/tasks/request-hr', { method: 'POST', sid: sales, json: { action: 'census_upload', subjectType: 'deal', subjectId: deal.id } });
    expect(r.status).toBe(409);
    expect(r.data.key).toBe('srv.task.noHr');
    expect((await call('/tasks/request-hr', { method: 'POST', sid: await login('legal@demo.mig.uz'), json: { action: 'census_upload', subjectType: 'deal', subjectId: deal.id } })).status).toBe(403);
  });

  it('HR uploads appendix 2 of the draft it was asked for; the manager is notified and the contract can go to approval', async () => {
    const sales = await login(SALES);
    const { deal, contract } = await draftContract(sales);
    // The checklist blocks the approval: appendix 2 is missing.
    const card = (await call<DealCard>(`/deals/${deal.id}`, { sid: sales })).data;
    expect(card.stage).toBe('contract_draft');
    expect(card.hasHr).toBe(true);
    expect(card.checklist.find((i) => i.key === 'annex2')).toMatchObject({ done: false, required: true });
    const blocked = await call<{ key: string; params: { items: string } }>(`/contracts/${contract.id}/submit-legal`, { method: 'POST', sid: sales });
    expect(blocked.status).toBe(409);
    expect(blocked.data.key).toBe('srv.next.missing');
    expect(blocked.data.params.items).toContain('Приложение 2');

    const hrRow = db().hrUsers.find((h) => h.companyId === deal.clientId)!;
    const hr = await login(hrRow.email);
    // Not asked yet: HR does not see the draft.
    expect((await call(`/contracts/${contract.id}/insured-list`, { method: 'POST', sid: hr, text: LIST })).status).toBe(404);
    const task = (await call<WorkTask>('/tasks/request-hr', { method: 'POST', sid: sales, json: { action: 'insured_list', subjectType: 'contract', subjectId: contract.id, comment: 'До 15.10' } })).data;
    // The author has it in «Мои запросы»; the client's HR is notified at once.
    expect((await call<WorkTask[]>('/tasks/mine', { sid: sales })).data.find((x) => x.id === task.id)).toMatchObject({ toRole: 'hr', status: 'open', byMe: true });
    expect(db().notifications.some((n) => db().hrUsers.some((h) => h.id === n.userId && h.companyId === contract.clientId) && unpack(n.text).key === 'next.notify.asked')).toBe(true);
    expect(task).toMatchObject({ toRole: 'hr', contractId: contract.id, contractNumber: contract.number, link: '/hr' });
    expect(task.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const hrTasks = (await call<WorkTask[]>('/tasks?status=open', { sid: hr })).data;
    expect(hrTasks.map((x) => x.id)).toEqual([task.id]);
    // Another company's HR sees nothing and may not upload.
    const otherHr = await login('hr@demo-client.uz');
    expect((await call<WorkTask[]>('/tasks', { sid: otherHr })).data.some((x) => x.id === task.id)).toBe(false);
    expect((await call(`/contracts/${contract.id}/insured-list`, { method: 'POST', sid: otherHr, text: LIST })).status).toBe(404);

    const up = await call<ContractView>(`/contracts/${contract.id}/insured-list`, { method: 'POST', sid: hr, text: LIST });
    expect(up.status).toBe(200);
    expect(up.data.insuredCount).toBe(2);
    expect(db().tasks.find((x) => x.id === task.id)!.status).toBe('done');
    const notes = (await call<UserNotification[]>('/notifications', { sid: sales })).data;
    expect(notes[0]).toMatchObject({ link: `/staff/contracts/${contract.id}` });
    expect((await call<WorkTask[]>('/tasks?status=open', { sid: hr })).data).toEqual([]);
    expect((await call<DealCard>(`/deals/${deal.id}`, { sid: sales })).data.checklist.find((i) => i.key === 'annex2')!.done).toBe(true);
    expect((await call(`/contracts/${contract.id}/submit-legal`, { method: 'POST', sid: sales })).status).toBe(200);
  });

  it('the client pipeline explains the empty «Застрахованные» tab', async () => {
    const uw = await login(UW);
    const deal = await leadDeal(uw);
    const p = (await call<ClientPipeline>(`/clients/${deal.clientId}/pipeline`, { sid: uw })).data;
    expect(p).toMatchObject({ hasPolicy: false, hasHr: false, dealId: deal.id, stage: 'lead' });
    const demo = db().clients.find((c) => c.name === 'Toshkent Agrologistika')!;
    expect((await call<ClientPipeline>(`/clients/${demo.id}/pipeline`, { sid: uw })).data.hasPolicy).toBe(true);
    expect((await call(`/clients/${demo.id}/pipeline`, { sid: await login('hr@demo-client.uz') })).status).toBe(403);
  });
});
