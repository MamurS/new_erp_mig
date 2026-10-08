/*
 * Clinic cabinet API (/api/clinic/...). Every handler resolves the clinic from the session, never
 * from the request; objects of other clinics answer 404 (CLINIC_SPEC §9.9). The logic is the shared
 * service (packages/domain/src/services/clinicPortal.ts); this is the MSW adapter.
 */
import { http } from 'msw';
import * as svc from '@mig/domain/services/clinicPortal';
import { DEMO_PASSWORD } from '@mig/seed/credentials';
import { API, authCtx, param, readJson, route, type Ctx } from '../http';
import { readForm } from '../uploads';
import { partnerIntegrationHandlers } from './partner-integration';

// Synchronous versions for the handlers not yet ported to the services (assist.ts, staff-assistance.ts).
export { createGuarantee, revokeKey } from '../clinic-legacy';

const C = `${API}/clinic`;

/** The files of a multipart form as plain values for the services. */
export async function uploadedFiles(form: FormData, field = 'files'): Promise<svc.UploadedFile[]> {
  const files = form.getAll(field).filter((f): f is File => f instanceof File);
  return Promise.all(files.map(async (f) => ({ size: f.size, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

async function documentsForm(request: Request): Promise<{ comment: string | null; files: svc.UploadedFile[] }> {
  const form = await readForm(request);
  const comment = form.get('comment');
  return { comment: typeof comment === 'string' ? comment : null, files: await uploadedFiles(form) };
}

async function registryCsv({ request }: Ctx): Promise<svc.RegistryCsvInput> {
  const form = await readForm(request);
  const period = form.get('period');
  const file = form.get('file');
  return { period: typeof period === 'string' ? period : null, file: file instanceof File ? { size: file.size, text: await file.text() } : null };
}

export const clinicHandlers = [
  // ---- overview ----
  http.get(`${C}/overview`, route(async ({ request }) => svc.overview(await authCtx(request)))),
  // ---- patient check & visits ----
  http.post(`${C}/check`, route(async ({ request }) => svc.check(await authCtx(request), await readJson(request)))),
  http.get(`${C}/visits`, route(async ({ request, url }) => svc.visits(await authCtx(request), url.searchParams))),
  http.get(`${C}/visits/:id/coverage`, route(async (c) => svc.visitCoverage(await authCtx(c.request), param(c, 'id')))),
  // ---- appointments ----
  http.get(`${C}/appointments`, route(async ({ request, url }) => svc.appointments(await authCtx(request), url.searchParams))),
  http.get(`${C}/slots`, route(async ({ request, url }) => svc.slots(await authCtx(request), url.searchParams))),
  ...(['confirm', 'reschedule', 'decline'] as const).map((kind) =>
    http.post(
      `${C}/appointments/:id/${kind}`,
      route(async (c) => svc.answerAppointment(await authCtx(c.request), kind, param(c, 'id'), kind === 'confirm' ? undefined : await readJson(c.request))),
    ),
  ),
  // ---- guarantees ----
  http.get(`${C}/guarantees`, route(async ({ request, url }) => svc.listGuarantees(await authCtx(request), url.searchParams.get('status')))),
  http.get(`${C}/guarantees/:id`, route(async (c) => svc.getGuarantee(await authCtx(c.request), param(c, 'id')))),
  http.post(`${C}/guarantees`, route(async ({ request }) => svc.requestGuarantee(await authCtx(request), await readJson(request)))),
  http.post(`${C}/guarantees/:id/documents`, route(async (c) => svc.guaranteeDocuments(await authCtx(c.request), param(c, 'id'), await documentsForm(c.request)))),
  http.get(`${C}/price-list`, route(async ({ request, url }) => svc.priceList(await authCtx(request), url.searchParams.get('visitId')))),
  // ---- registries (clinic_admin) ----
  http.get(`${C}/registries`, route(async ({ request }) => svc.listRegistries(await authCtx(request)))),
  http.get(`${C}/registries/:id`, route(async (c) => svc.getRegistry(await authCtx(c.request), param(c, 'id')))),
  http.post(`${C}/registries/build`, route(async ({ request }) => svc.buildRegistry(await authCtx(request), await readJson(request)))),
  http.post(`${C}/registries/import`, route(async (c) => svc.importRegistry(await authCtx(c.request), await registryCsv(c), c.url.searchParams.get('commit') === '1'))),
  http.post(`${C}/registries/:id/lines`, route(async (c) => svc.addRegistryLine(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.delete(`${C}/registries/:id/lines/:lineId`, route(async (c) => svc.removeRegistryLine(await authCtx(c.request), param(c, 'id'), param(c, 'lineId')))),
  http.post(`${C}/registries/:id/submit`, route(async (c) => svc.sendRegistry(await authCtx(c.request), param(c, 'id')))),
  http.post(
    `${C}/registries/:id/lines/:lineId/dispute`,
    route(async (c) => svc.disputeRegistryLine(await authCtx(c.request), param(c, 'id'), param(c, 'lineId'), await readJson(c.request))),
  ),
  // ---- documents ----
  http.get(`${C}/documents`, route(async ({ request }) => svc.documents(await authCtx(request)))),
  // ---- users (clinic_admin) ----
  http.get(`${C}/users`, route(async ({ request }) => svc.listUsers(await authCtx(request)))),
  http.post(`${C}/users`, route(async ({ request }) => svc.inviteUser(await authCtx(request), await readJson(request), DEMO_PASSWORD))),
  http.patch(`${C}/users/:id`, route(async (c) => svc.patchUser(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  // ---- integration (clinic_admin): the partner framework shared with assistance companies ----
  ...partnerIntegrationHandlers(`${C}/integration`, async (request) => {
    const ctx = await authCtx(request);
    return { ...(await svc.integrationScope(ctx)), ctx };
  }),
];
