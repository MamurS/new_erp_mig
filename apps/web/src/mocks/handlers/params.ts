/*
 * DMS business parameters (/staff/admin/parameters), four-eyes. The logic is the shared service
 * (packages/domain/src/services/params.ts); this is the MSW adapter.
 */
import { http, HttpResponse } from 'msw';
import * as params from '@mig/domain/services/params';
import { API, authCtx, param, readJson, route } from '../http';

export const paramHandlers = [
  // Values the screens need. Staff get all of them; other portals only the ones marked `audience: 'all'`.
  http.get(`${API}/params/values`, route(async ({ request }) => params.paramValuesFor(await authCtx(request)))),
  http.get(`${API}/params`, route(async ({ request }) => params.paramsScreen(await authCtx(request)))),
  http.post(
    `${API}/params/changes`,
    route(async ({ request }) => HttpResponse.json(await params.proposeParamChange(await authCtx(request), await readJson(request)), { status: 201 })),
  ),
  http.post(`${API}/params/changes/:id/approve`, route(async (c) => params.approveParamChange(await authCtx(c.request), param(c, 'id')))),
  http.post(`${API}/params/changes/:id/reject`, route(async (c) => params.rejectParamChange(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
];
