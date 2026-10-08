/*
 * The HR cabinet of a client company: employees, imports, invitations, documents, invoices, family members
 * and requests, statistics with k-anonymity. The logic is the shared service
 * (packages/domain/src/services/hr.ts); this is the MSW adapter.
 */
import { http } from 'msw';
import * as hr from '@mig/domain/services/hr';
import { API, authCtx, param, readJson, route } from '../http';

export { K_ANON } from '@mig/domain/services/hr';

export const hrHandlers = [
  http.get(`${API}/hr/overview`, route(async ({ request }) => hr.overview(await authCtx(request)))),
  http.get(`${API}/hr/employees`, route(async ({ request, url }) => hr.listEmployees(await authCtx(request), url.searchParams))),
  http.get(`${API}/hr/employees/:id`, route(async (c) => hr.getEmployee(await authCtx(c.request), param(c, 'id')))),
  http.post(`${API}/hr/employees`, route(async ({ request }) => hr.addEmployee(await authCtx(request), await readJson(request)))),
  http.delete(`${API}/hr/employees/:id`, route(async (c) => hr.excludeEmployee(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.post(`${API}/hr/employees/import`, route(async ({ request, url }) => hr.importEmployees(await authCtx(request), await request.text(), url.searchParams.get('commit') === '1'))),
  http.post(`${API}/hr/employees/invite`, route(async ({ request }) => hr.inviteEmployees(await authCtx(request), await readJson(request)))),
  http.get(`${API}/hr/documents`, route(async ({ request }) => hr.documents(await authCtx(request)))),
  http.get(`${API}/hr/invoices`, route(async ({ request }) => hr.invoices(await authCtx(request)))),
  // ---- family members (FAMILY_SPEC): HR adds them like employees and sees them without medical data ----
  http.get(`${API}/hr/family`, route(async ({ request, url }) => hr.familyList(await authCtx(request), url.searchParams.get('employeeId') ?? undefined))),
  http.post(`${API}/hr/family`, route(async ({ request }) => hr.addFamilyMember(await authCtx(request), await readJson(request)))),
  http.get(`${API}/hr/family-requests`, route(async ({ request, url }) => hr.familyRequests(await authCtx(request), url.searchParams.get('status')))),
  http.post(`${API}/hr/family-requests/:id/decision`, route(async (c) => hr.decideFamilyRequest(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.get(`${API}/hr/stats`, route(async ({ request }) => hr.stats(await authCtx(request)))),
];
