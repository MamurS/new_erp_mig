/*
 * Next steps: tasks between roles, the HR «Задачи от МИГ», notifications and the client pipeline that
 * explains an empty «Застрахованные» tab. The logic is the shared service (packages/domain/src/services/tasks.ts);
 * this is the MSW adapter.
 */
import { http } from 'msw';
import * as tasks from '@mig/domain/services/tasks';
import { API, authCtx, param, readJson, route } from '../http';

export const taskHandlers = [
  http.post(`${API}/tasks`, route(async ({ request }) => tasks.askTask(await authCtx(request), await readJson(request)))),
  http.post(`${API}/tasks/request-hr`, route(async ({ request }) => tasks.requestHr(await authCtx(request), await readJson(request)))),
  http.get(`${API}/tasks`, route(async ({ request, url }) => tasks.listTasks(await authCtx(request), url.searchParams.get('status')))),
  http.get(`${API}/tasks/mine`, route(async ({ request }) => tasks.myTasks(await authCtx(request)))),
  http.get(`${API}/tasks/about`, route(async ({ request, url }) => tasks.tasksAbout(await authCtx(request), url.searchParams.get('subjectType'), url.searchParams.get('subjectId') ?? ''))),
  http.post(`${API}/tasks/:id/take`, route(async (c) => tasks.take(await authCtx(c.request), param(c, 'id')))),
  http.post(`${API}/tasks/:id/done`, route(async (c) => tasks.markDone(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.post(`${API}/tasks/:id/reject`, route(async (c) => tasks.reject(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.post(`${API}/tasks/:id/remind`, route(async (c) => tasks.remind(await authCtx(c.request), param(c, 'id')))),
  http.get(`${API}/notifications`, route(async ({ request }) => tasks.listNotifications(await authCtx(request)))),
  http.post(`${API}/notifications/read`, route(async ({ request }) => tasks.readAllNotifications(await authCtx(request)))),
  http.post(`${API}/notifications/:id/read`, route(async (c) => tasks.readNotification(await authCtx(c.request), param(c, 'id')))),
  http.get(`${API}/clients/:id/pipeline`, route(async (c) => tasks.pipeline(await authCtx(c.request), param(c, 'id')))),
];
