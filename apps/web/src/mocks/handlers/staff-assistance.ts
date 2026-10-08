/*
 * MIG side of assistance companies (ASSISTANCE_SPEC §7): companies, contracts, assignments of policies,
 * rebill review and payment, quality control and the report by assistance. The logic is the shared service
 * (packages/domain/src/services/staffAssistance.ts); this is the MSW adapter.
 */
import { http } from 'msw';
import * as svc from '@mig/domain/services/staffAssistance';
import { DEMO_PASSWORD } from '@mig/seed/credentials';
import { API, authCtx, param, readJson, route } from '../http';

export const staffAssistanceHandlers = [
  // ---- companies ----
  http.get(`${API}/assistance`, route(async ({ request, url }) => svc.listAssistances(await authCtx(request), url.searchParams))),
  http.post(`${API}/assistance`, route(async ({ request }) => svc.createAssistance(await authCtx(request), await readJson(request), { initialPassword: DEMO_PASSWORD }))),
  http.get(`${API}/assistance/:id/card`, route(async (c) => svc.card(await authCtx(c.request), param(c, 'id')))),
  // ---- cases of the assistance: the curator reads them and handles complaints (§5.1, §10) ----
  http.get(`${API}/assistance/:id/cases`, route(async (c) => svc.listCases(await authCtx(c.request), param(c, 'id'), c.url.searchParams))),
  http.post(
    `${API}/assistance/:id/cases/:caseId/complaint`,
    route(async (c) => svc.resolveComplaint(await authCtx(c.request), param(c, 'id'), param(c, 'caseId'), await readJson(c.request))),
  ),
  http.patch(`${API}/assistance/:id/contract`, route(async (c) => svc.updateContract(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.post(`${API}/assistance/:id/keys/:keyId/revoke`, route(async (c) => svc.revokeAssistanceKey(await authCtx(c.request), param(c, 'id'), param(c, 'keyId')))),

  // ---- assignment of a policy (underwriter) ----
  http.get(`${API}/policies/:id/assistance`, route(async (c) => svc.policyAssignments(await authCtx(c.request), param(c, 'id')))),
  http.post(`${API}/policies/:id/assistance`, route(async (c) => svc.assignPolicy(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),

  // ---- rebills: review (curator) and payment (accountant) ----
  http.get(`${API}/rebills`, route(async ({ request, url }) => svc.listRebills(await authCtx(request), url.searchParams))),
  http.get(`${API}/rebills/:id`, route(async (c) => svc.getRebill(await authCtx(c.request), param(c, 'id')))),
  http.post(
    `${API}/rebills/:id/lines/:lineId/decision`,
    route(async (c) => svc.decideRebillLine(await authCtx(c.request), param(c, 'id'), param(c, 'lineId'), await readJson(c.request))),
  ),
  http.post(`${API}/rebills/:id/pay`, route(async (c) => svc.payRebill(await authCtx(c.request), param(c, 'id')))),

  // ---- quality control (doctor expert) ----
  http.get(`${API}/qa`, route(async ({ request, url }) => svc.qaQueue(await authCtx(request), url.searchParams))),
  http.post(`${API}/qa/:id/review`, route(async (c) => svc.reviewQa(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),

  // ---- report ----
  http.get(`${API}/reports/by-assistance`, route(async ({ request }) => svc.reportByAssistanceFor(await authCtx(request)))),
];
