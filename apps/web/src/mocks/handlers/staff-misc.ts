/*
 * Clinics, limit change requests, reports, exports, the audit log and staff users. The logic is the shared
 * service (packages/domain/src/services/staffMisc.ts); this is the MSW adapter.
 */
import { http, HttpResponse } from 'msw';
import * as misc from '@mig/domain/services/staffMisc';
import { exportFileName } from '@mig/domain/lib/csv';
import { API, authCtx, param, readJson, route } from '../http';


function csvResponse({ csv, kind }: { csv: string; kind: string }): Response {
  return new HttpResponse(`\ufeff${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exportFileName(kind)}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export const staffMiscHandlers = [
  // ---- clinics ----
  http.get(`${API}/clinics`, route(async ({ request, url }) => misc.clinics(await authCtx(request), url))),
  http.get(`${API}/clinics/nearby`, route(async ({ request, url }) => misc.nearby(await authCtx(request), url))),
  http.get(`${API}/clinics/:id/slots`, route(async (c) => misc.slots(await authCtx(c.request), param(c, 'id'), c.url.searchParams.get('date')))),
  // ---- limit change requests ----
  http.get(`${API}/limit-requests`, route(async ({ request, url }) => misc.limitRequests(await authCtx(request), url.searchParams.get('status')))),
  http.post(`${API}/limit-requests`, route(async ({ request }) => misc.requestLimitChange(await authCtx(request), await readJson(request)))),
  ...(['approve', 'reject'] as const).map((kind) =>
    http.post(
      `${API}/limit-requests/:id/${kind}`,
      route(async (c) => misc.decideLimitChange(await authCtx(c.request), param(c, 'id'), kind, kind === 'reject' ? await readJson(c.request) : undefined)),
    ),
  ),
  // ---- reports ----
  http.get(`${API}/reports/loss-ratio-by-client`, route(async ({ request }) => misc.lossRatio(await authCtx(request)))),
  http.get(
    `${API}/reports/claims-by-category`,
    route(async ({ request, url }) => misc.claimsByCategory(await authCtx(request), url.searchParams.get('from'), url.searchParams.get('to'))),
  ),
  http.get(`${API}/reports/premium-by-month`, route(async ({ request }) => misc.premiumByMonth(await authCtx(request)))),
  // ---- exports ----
  http.post(`${API}/exports`, route(async ({ request }) => csvResponse(await misc.exportCsv(await authCtx(request), await readJson(request))))),
  // ---- audit ----
  http.get(`${API}/audit`, route(async ({ request, url }) => misc.auditLog(await authCtx(request), url))),
  // ---- admin ----
  http.get(`${API}/admin/users`, route(async ({ request }) => misc.staffUsers(await authCtx(request)))),
  http.post(
    `${API}/admin/users`,
    route(async ({ request }) => HttpResponse.json(await misc.inviteStaffUser(await authCtx(request), await readJson(request)), { status: 201 })),
  ),
  http.patch(`${API}/admin/users/:id`, route(async (c) => misc.updateStaffUser(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
];
