/* The staff dashboard: queues and KPIs per role. The logic is the shared service (packages/domain/src/services/dashboard.ts); this is the MSW adapter. */
import { http } from 'msw';
import * as dashboard from '@mig/domain/services/dashboard';
import { API, authCtx, route } from '../http';

export const dashboardHandlers = [
  http.get(`${API}/dashboard`, route(async ({ request }) => dashboard.dashboard(await authCtx(request)))),
  http.get(`${API}/queue`, route(async ({ request, url }) => dashboard.queue(await authCtx(request), url.searchParams))),
  http.get(`${API}/dashboard/medical-access`, route(async ({ request }) => dashboard.medicalAccess(await authCtx(request)))),
  http.get(`${API}/integrations/status`, route(async ({ request }) => dashboard.integrationsStatus(await authCtx(request)))),
];
