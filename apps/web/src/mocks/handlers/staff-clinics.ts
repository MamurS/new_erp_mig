/*
 * MIG staff side of clinics (CLINIC_SPEC §5): clinic card, clinic management by the admin,
 * guarantee-letter queue for doctor experts, registry review (operator) and payment (accountant).
 * The logic is the shared service (packages/domain/src/services/staffClinics.ts); this is the MSW adapter.
 */
import { http } from 'msw';
import * as svc from '@mig/domain/services/staffClinics';
import { DEMO_PASSWORD } from '@mig/seed/credentials';
import { API, authCtx, param, readJson, route } from '../http';

export const staffClinicHandlers = [
  // ---- clinics ----
  http.get(`${API}/clinics/:id/card`, route(async (c) => svc.card(await authCtx(c.request), param(c, 'id')))),
  http.post(`${API}/clinics`, route(async ({ request }) => svc.createClinic(await authCtx(request), await readJson(request)))),
  http.patch(`${API}/clinics/:id`, route(async (c) => svc.setMode(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.post(`${API}/clinics/:id/admins`, route(async (c) => svc.inviteAdmin(await authCtx(c.request), param(c, 'id'), await readJson(c.request), DEMO_PASSWORD))),
  http.post(`${API}/clinics/:id/keys/:keyId/revoke`, route(async (c) => svc.revokeClinicKey(await authCtx(c.request), param(c, 'id'), param(c, 'keyId')))),
  // ---- guarantee letters ----
  http.get(`${API}/guarantees`, route(async ({ request, url }) => svc.listGuarantees(await authCtx(request), url.searchParams))),
  http.get(`${API}/guarantees/:id`, route(async (c) => svc.getGuarantee(await authCtx(c.request), param(c, 'id')))),
  http.post(`${API}/guarantees/:id/decision`, route(async (c) => svc.decideGuarantee(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  // ---- registries ----
  http.get(`${API}/registries`, route(async ({ request, url }) => svc.listRegistries(await authCtx(request), url.searchParams))),
  http.get(`${API}/registries/:id`, route(async (c) => svc.getRegistry(await authCtx(c.request), param(c, 'id')))),
  http.post(`${API}/registries/:id/lines/:lineId/decision`, route(async (c) => svc.decideLine(await authCtx(c.request), param(c, 'id'), param(c, 'lineId'), await readJson(c.request)))),
  http.post(`${API}/registries/:id/pay`, route(async (c) => svc.payRegistry(await authCtx(c.request), param(c, 'id')))),
];
