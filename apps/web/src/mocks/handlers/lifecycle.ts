/*
 * Sales part of the lifecycle (LIFECYCLE_SPEC §2–6): staff authority changes (four-eyes), leads, deals,
 * the anonymous census, quotes with authority routing, the offer from an approved quote, the client's answer.
 * The logic is the shared service (packages/domain/src/services/deals.ts); this is the MSW adapter.
 */
import { http, HttpResponse } from 'msw';
import * as deals from '@mig/domain/services/deals';
import { API, authCtx, param, readJson, route } from '../http';

export const lifecycleHandlers = [
  // ---------------- staff directory and authority (LIFECYCLE_SPEC §2) ----------------
  http.get(`${API}/staff/directory`, route(async ({ request }) => deals.staffDirectory(await authCtx(request)))),
  http.get(`${API}/admin/authority-changes`, route(async ({ request }) => deals.listAuthorityChanges(await authCtx(request)))),
  http.post(
    `${API}/admin/users/:id/authority`,
    route(async (c) => HttpResponse.json(await deals.proposeAuthority(await authCtx(c.request), param(c, 'id'), await readJson(c.request)), { status: 201 })),
  ),
  http.post(`${API}/admin/authority-changes/:id/approve`, route(async (c) => deals.decideAuthority(await authCtx(c.request), param(c, 'id'), 'approve'))),
  http.post(`${API}/admin/authority-changes/:id/reject`, route(async (c) => deals.decideAuthority(await authCtx(c.request), param(c, 'id'), 'reject', await readJson(c.request)))),

  // ---------------- leads (§3) ----------------
  http.get(`${API}/leads`, route(async ({ request }) => deals.listLeads(await authCtx(request)))),
  http.post(`${API}/leads`, route(async ({ request }) => HttpResponse.json(await deals.createLead(await authCtx(request), await readJson(request)), { status: 201 }))),

  // ---------------- deals (§3) ----------------
  http.get(`${API}/deals`, route(async ({ request, url }) => deals.listDeals(await authCtx(request), url.searchParams))),
  http.get(`${API}/deals/:id`, route(async (c) => deals.getDeal(await authCtx(c.request), param(c, 'id')))),
  http.patch(`${API}/deals/:id`, route(async (c) => deals.patchDeal(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.post(`${API}/deals/:id/stage`, route(async (c) => deals.loseDeal(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),

  // ---------------- census (§4) ----------------
  http.post(`${API}/deals/:id/census`, route(async (c) => deals.uploadCensus(await authCtx(c.request), param(c, 'id'), await c.request.text()))),

  // ---------------- quotes (§5) ----------------
  http.post(`${API}/quotes`, route(async ({ request }) => HttpResponse.json(await deals.createQuote(await authCtx(request), await readJson(request)), { status: 201 }))),
  http.get(`${API}/quotes/:id`, route(async (c) => deals.getQuote(await authCtx(c.request), param(c, 'id')))),
  http.patch(`${API}/quotes/:id`, route(async (c) => deals.patchQuote(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.post(`${API}/quotes/:id/submit`, route(async (c) => deals.submitQuote(await authCtx(c.request), param(c, 'id')))),
  http.post(`${API}/quotes/:id/approve`, route(async (c) => deals.approveQuote(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.post(`${API}/quotes/:id/reject`, route(async (c) => deals.rejectQuote(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),

  // ---------------- the offer from an approved quote (§6) ----------------
  http.post(`${API}/deals/:id/kp`, route(async (c) => HttpResponse.json(await deals.sendDealKp(await authCtx(c.request), param(c, 'id')), { status: 201 }))),
  http.post(`${API}/kp/:id/accept`, route(async (c) => deals.respondKp(await authCtx(c.request), param(c, 'id'), 'accept'))),
  http.post(`${API}/kp/:id/decline`, route(async (c) => deals.respondKp(await authCtx(c.request), param(c, 'id'), 'decline', await readJson(c.request)))),
];
