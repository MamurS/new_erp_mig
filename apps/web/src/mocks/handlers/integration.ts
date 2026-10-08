/*
 * Integration API for clinic MIS (/api/integration/v1), CLINIC_SPEC §6. The logic is the shared service
 * (packages/domain/src/services/integration.ts); this is the MSW adapter. The partner API authenticates
 * with its own bearer tokens (not sessions); errors are RFC 9457 problem+json.
 */
import { http } from 'msw';
import {
  appointmentList,
  coverageCheckResult,
  guaranteeLetter,
  integrationAppointment,
  paymentList,
  registry as registrySchema,
  slotsPutResult,
  visit as visitSchema,
} from '@mig/contracts/integration';
import * as svc from '@mig/domain/services/integration';
import { baseCtx } from '../http';
import { apiRoute, BASE, pathParam, persist, readJson, toResponse } from '../integration-http';
import { uploadedFiles } from './clinic';

// The framework is shared with the assistance API (integration-assistance.ts).
export { ApiProblem, page, toIntegrationAppointment } from '@mig/domain/services/integration';
export { apiRoute, BASE, pathParam, readJson, TEST_IP_HEADER, type ApiCtx, type Handler } from '../integration-http';

/** The form of «documents for a letter», or null when the body is not multipart. */
async function documentsForm(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return null;
  }
  const comment = form.get('comment');
  return { comment: typeof comment === 'string' ? comment : null, files: await uploadedFiles(form) };
}

export const integrationHandlers = [
  http.post(`${BASE}/oauth/token`, async ({ request }) => {
    const startedAt = Date.now();
    try {
      const type = request.headers.get('content-type') ?? '';
      const readBody = async () => (type.includes('application/x-www-form-urlencoded') ? Object.fromEntries(new URLSearchParams(await request.text())) : await readJson(request));
      return toResponse(await svc.issueToken(baseCtx(), readBody, startedAt));
    } finally {
      persist();
    }
  }),

  http.post(`${BASE}/coverage/check`, apiRoute('POST', '/coverage/check', 'coverage:check', coverageCheckResult, async (c) => svc.coverageCheck(c, await readJson(c.request)))),
  http.get(`${BASE}/visits/:visitId`, apiRoute('GET', '/visits/{visitId}', 'coverage:check', visitSchema, (c) => svc.getVisit(c, pathParam(c, 'visitId')))),

  http.get(`${BASE}/appointments`, apiRoute('GET', '/appointments', 'appointments:read', appointmentList, (c) => svc.listAppointments(c, c.url.searchParams))),
  http.post(
    `${BASE}/appointments/:id/confirm`,
    apiRoute('POST', '/appointments/{id}/confirm', 'appointments:write', integrationAppointment, (c) => svc.answerAppointment(c, 'confirm', pathParam(c, 'id'), undefined)),
  ),
  http.post(
    `${BASE}/appointments/:id/reschedule`,
    apiRoute('POST', '/appointments/{id}/reschedule', 'appointments:write', integrationAppointment, async (c) => svc.answerAppointment(c, 'reschedule', pathParam(c, 'id'), await readJson(c.request))),
  ),
  http.post(
    `${BASE}/appointments/:id/decline`,
    apiRoute('POST', '/appointments/{id}/decline', 'appointments:write', integrationAppointment, async (c) => svc.answerAppointment(c, 'decline', pathParam(c, 'id'), await readJson(c.request))),
  ),
  http.put(`${BASE}/slots`, apiRoute('PUT', '/slots', 'slots:write', slotsPutResult, async (c) => svc.putSlots(c, await readJson(c.request)))),

  http.post(`${BASE}/guarantees`, apiRoute('POST', '/guarantees', 'guarantees:write', guaranteeLetter, async (c) => svc.requestGuarantee(c, await readJson(c.request)))),
  http.get(`${BASE}/guarantees/:id`, apiRoute('GET', '/guarantees/{id}', 'guarantees:read', guaranteeLetter, (c) => svc.getGuarantee(c, pathParam(c, 'id')))),
  http.post(
    `${BASE}/guarantees/:id/documents`,
    apiRoute('POST', '/guarantees/{id}/documents', 'guarantees:write', guaranteeLetter, async (c) => svc.guaranteeDocuments(c, pathParam(c, 'id'), await documentsForm(c.request))),
  ),

  http.post(`${BASE}/registries`, apiRoute('POST', '/registries', 'registries:write', registrySchema, async (c) => svc.createRegistry(c, await readJson(c.request)))),
  http.get(`${BASE}/registries/:id`, apiRoute('GET', '/registries/{id}', 'registries:read', registrySchema, (c) => svc.getRegistry(c, pathParam(c, 'id')))),
  http.post(
    `${BASE}/registries/:id/lines/:lineId/dispute`,
    apiRoute('POST', '/registries/{id}/lines/{lineId}/dispute', 'registries:write', registrySchema, async (c) =>
      svc.disputeRegistryLine(c, pathParam(c, 'id'), pathParam(c, 'lineId'), await readJson(c.request)),
    ),
  ),
  http.get(`${BASE}/payments`, apiRoute('GET', '/payments', 'payments:read', paymentList, (c) => svc.payments(c, c.url.searchParams))),
];
