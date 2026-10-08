/*
 * Claims settlement (LIFECYCLE_SPEC §13): medical opinion, decisions within the officer's authority and
 * approval above it, reserves, fraud flags, appeals, the decision letter, reserve report and claims register.
 * The logic is the shared service (packages/domain/src/services/settlementApi.ts); this is the MSW adapter.
 */
import { http, HttpResponse } from 'msw';
import * as settlement from '@mig/domain/services/settlementApi';
import { API, authCtx, param, readJson, route } from '../http';

export const settlementHandlers = [
  http.post(`${API}/claims/:id/request-opinion`, route(async (c) => settlement.requestOpinion(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.post(`${API}/claims/:id/opinion`, route(async (c) => settlement.giveOpinion(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.post(`${API}/claims/:id/decide`, route(async (c) => settlement.decide(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.post(`${API}/claims/:id/decision/approve`, route(async (c) => settlement.approveDecision(await authCtx(c.request), param(c, 'id')))),
  http.post(`${API}/claims/:id/decision/reject`, route(async (c) => settlement.rejectDecision(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.patch(`${API}/claims/:id/reserve`, route(async (c) => settlement.changeReserve(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.post(
    `${API}/claims/:id/flags/:flagId/dismiss`,
    route(async (c) => settlement.dismissFlag(await authCtx(c.request), param(c, 'id'), param(c, 'flagId'), await readJson(c.request))),
  ),
  http.post(`${API}/claims/:id/appeal/resolve`, route(async (c) => settlement.resolveAppeal(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.get(`${API}/claims/:id/letter`, route(async (c) => settlement.claimLetter(await authCtx(c.request), param(c, 'id')))),
  // ---- the insured person: appeal and the letter of their own claims (/api/me only) ----
  http.post(`${API}/me/claims/:id/appeal`, route(async (c) => settlement.appeal(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.get(`${API}/me/claims/:id/letter`, route(async (c) => settlement.myClaimLetter(await authCtx(c.request), param(c, 'id')))),
  // ---- reports ----
  http.get(`${API}/reports/reserves`, route(async ({ request, url }) => settlement.reserveReport(await authCtx(request), url.searchParams))),
  http.get(
    `${API}/reports/claims-register`,
    route(async ({ request, url }) => {
      const { csv, fileName } = await settlement.claimsRegister(await authCtx(request), url.searchParams);
      return new HttpResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'no-store' } });
    }),
  ),
];
