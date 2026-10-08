/*
 * Commercial offers (KP_SPEC §8). The server stores parameters and the template version, not a PDF:
 * the document is reproduced exactly from them. The logic is the shared service
 * (packages/domain/src/services/kp.ts); this is the MSW adapter.
 */
import { http } from 'msw';
import * as kp from '@mig/domain/services/kp';
import { API, authCtx, param, readJson, route } from '../http';

export const kpHandlers = [
  http.get(`${API}/clients/:id/kp-defaults`, route(async (c) => kp.kpDefaults(await authCtx(c.request), param(c, 'id'), c.url.searchParams))),
  http.get(`${API}/clients/:id/kp`, route(async (c) => kp.listClientKp(await authCtx(c.request), param(c, 'id')))),
  http.post(`${API}/clients/:id/kp`, route(async (c) => kp.createKp(await authCtx(c.request), param(c, 'id'), c.url.searchParams, await readJson(c.request)))),
  http.get(`${API}/kp/:id`, route(async (c) => kp.getKp(await authCtx(c.request), param(c, 'id')))),
  http.patch(`${API}/kp/:id`, route(async (c) => kp.patchKp(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.post(`${API}/kp/:id/send`, route(async (c) => kp.sendKp(await authCtx(c.request), param(c, 'id')))),
  http.post(`${API}/kp/:id/revoke`, route(async (c) => kp.revokeKp(await authCtx(c.request), param(c, 'id')))),
  http.post(`${API}/kp/:id/downloaded`, route(async (c) => kp.kpDownloaded(await authCtx(c.request), param(c, 'id')))),
];
