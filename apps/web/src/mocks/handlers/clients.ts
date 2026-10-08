/* Clients and policies of the staff portal. The logic is the shared service (packages/domain/src/services/clients.ts); this is the MSW adapter. */
import { http } from 'msw';
import * as clients from '@mig/domain/services/clients';
import { API, authCtx, param, readJson, route } from '../http';

export const clientHandlers = [
  http.get(`${API}/clients`, route(async ({ request, url }) => clients.listClients(await authCtx(request), url.searchParams))),
  http.post(`${API}/clients`, route(async ({ request }) => clients.createClient(await authCtx(request), await readJson(request)))),
  http.get(`${API}/clients/:id/loss-stats`, route(async (c) => clients.lossStats(await authCtx(c.request), param(c, 'id')))),
  http.get(`${API}/clients/:id`, route(async (c) => clients.clientDetail(await authCtx(c.request), param(c, 'id')))),
  http.patch(`${API}/clients/:id`, route(async (c) => clients.patchClient(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.get(`${API}/clients/:id/insured`, route(async (c) => clients.clientInsured(await authCtx(c.request), param(c, 'id'), c.url.searchParams))),
  http.get(`${API}/clients/:id/documents`, route(async (c) => clients.clientDocuments(await authCtx(c.request), param(c, 'id')))),
  http.get(`${API}/clients/:id/history`, route(async (c) => clients.clientHistory(await authCtx(c.request), param(c, 'id')))),
  http.post(
    `${API}/clients/:id/hr-letter`,
    route(async (c) => {
      const ctx = await authCtx(c.request);
      const id = param(c, 'id');
      // The letter's text is read and dropped (imitation).
      await c.request.text();
      return clients.hrLetter(ctx, id);
    }),
  ),
  // ---- policies ----
  http.get(`${API}/policies`, route(async ({ request, url }) => clients.listPolicies(await authCtx(request), url.searchParams))),
  http.get(`${API}/policies/:id`, route(async (c) => clients.policyDetail(await authCtx(c.request), param(c, 'id')))),
];
