/*
 * Integration API for clinic MIS (/api/integration/v1), CLINIC_SPEC §6. The logic is the shared service
 * (packages/domain/src/services/integration.ts, framework: integrationKit.ts); this is the MSW adapter.
 * The partner API authenticates with its own bearer tokens (not sessions); errors are RFC 9457 problem+json.
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
import { apiRoute, BASE, tokenRoute } from '../integration-http';
import { formFiles, formText } from '../uploads';

/** The form of «documents for a letter», or null when the body is not multipart. */
async function documentsForm(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return null;
  }
  return { comment: formText(form, 'comment'), files: await formFiles(form, 'files') };
}

export const integrationHandlers = [
  http.post(`${BASE}/oauth/token`, tokenRoute),

  http.post(`${BASE}/coverage/check`, apiRoute('POST', '/coverage/check', 'coverage:check', coverageCheckResult, svc.coverageCheck)),
  http.get(`${BASE}/visits/:visitId`, apiRoute('GET', '/visits/{visitId}', 'coverage:check', visitSchema, svc.getVisit)),

  http.get(`${BASE}/appointments`, apiRoute('GET', '/appointments', 'appointments:read', appointmentList, svc.listAppointments)),
  ...(['confirm', 'reschedule', 'decline'] as const).map((kind) =>
    http.post(`${BASE}/appointments/:id/${kind}`, apiRoute('POST', `/appointments/{id}/${kind}`, 'appointments:write', integrationAppointment, (c) => svc.answerAppointment(c, kind))),
  ),
  http.put(`${BASE}/slots`, apiRoute('PUT', '/slots', 'slots:write', slotsPutResult, svc.putSlots)),

  http.post(`${BASE}/guarantees`, apiRoute('POST', '/guarantees', 'guarantees:write', guaranteeLetter, svc.requestGuarantee)),
  http.get(`${BASE}/guarantees/:id`, apiRoute('GET', '/guarantees/{id}', 'guarantees:read', guaranteeLetter, svc.getGuarantee)),
  http.post(
    `${BASE}/guarantees/:id/documents`,
    apiRoute('POST', '/guarantees/{id}/documents', 'guarantees:write', guaranteeLetter, async (c, request) => {
      c.pathParam('id');
      return svc.guaranteeDocuments(c, await documentsForm(request));
    }),
  ),

  http.post(`${BASE}/registries`, apiRoute('POST', '/registries', 'registries:write', registrySchema, svc.createRegistry)),
  http.get(`${BASE}/registries/:id`, apiRoute('GET', '/registries/{id}', 'registries:read', registrySchema, svc.getRegistry)),
  http.post(`${BASE}/registries/:id/lines/:lineId/dispute`, apiRoute('POST', '/registries/{id}/lines/{lineId}/dispute', 'registries:write', registrySchema, svc.disputeRegistryLine)),
  http.get(`${BASE}/payments`, apiRoute('GET', '/payments', 'payments:read', paymentList, svc.payments)),
];
