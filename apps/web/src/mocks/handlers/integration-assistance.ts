/*
 * Integration API for assistance companies (/api/integration/v1/assistance/...), ASSISTANCE_SPEC §8. The
 * framework (OAuth, scopes, idempotency, problem+json, log) and the endpoints are shared services
 * (packages/domain/src/services/integrationKit.ts, integrationAssistance.ts); the MSW plumbing is the
 * clinic API's (../integration-http.ts).
 */
import { http } from 'msw';
import {
  appointmentList,
  assistanceCase,
  guaranteeLetter,
  guaranteeList,
  insuredLimits,
  integrationAppointment,
  rebill as rebillSchema,
  registry as registrySchema,
  registryList,
  rosterPage,
} from '@mig/contracts/integration';
import type { IntegrationScope } from '@mig/contracts';
import type { ZodTypeAny } from 'zod';
import * as svc from '@mig/domain/services/integrationAssistance';
import { apiRoute as partnerRoute, BASE, type Handler } from '../integration-http';

const AB = `${BASE}/assistance`;

/** One endpoint of the assistance keys. */
const apiRoute = (method: 'GET' | 'POST' | 'PATCH', template: string, scope: IntegrationScope, response: ZodTypeAny | null, fn: Handler) => partnerRoute(method, template, scope, response, fn, 'assistance');

export const integrationAssistanceHandlers = [
  // ---- roster ----
  http.get(`${AB}/roster`, apiRoute('GET', '/assistance/roster', 'roster:read', rosterPage, svc.roster)),
  http.get(`${AB}/insured/:id/limits`, apiRoute('GET', '/assistance/insured/{id}/limits', 'roster:read', insuredLimits, svc.insuredLimits)),

  // ---- cases ----
  http.post(`${AB}/cases`, apiRoute('POST', '/assistance/cases', 'cases:write', assistanceCase, svc.createCase)),
  http.patch(`${AB}/cases/:id`, apiRoute('PATCH', '/assistance/cases/{id}', 'cases:write', assistanceCase, svc.updateCase)),

  // ---- appointments ----
  http.get(`${AB}/appointments`, apiRoute('GET', '/assistance/appointments', 'appointments:write', appointmentList, svc.listAppointments)),
  ...(['confirm', 'reschedule', 'decline'] as const).map((kind) =>
    http.post(`${AB}/appointments/:id/${kind}`, apiRoute('POST', `/assistance/appointments/{id}/${kind}`, 'appointments:write', integrationAppointment, (c) => svc.answerAppointment(c, kind))),
  ),

  // ---- guarantee letters ----
  http.get(`${AB}/guarantees`, apiRoute('GET', '/assistance/guarantees', 'guarantees:decide', guaranteeList, svc.listGuarantees)),
  http.post(`${AB}/guarantees/:id/decide`, apiRoute('POST', '/assistance/guarantees/{id}/decide', 'guarantees:decide', guaranteeLetter, svc.decideGuarantee)),

  // ---- registries: own lines ----
  http.get(`${AB}/registries`, apiRoute('GET', '/assistance/registries', 'registries:review', registryList, svc.listRegistries)),
  http.post(`${AB}/registries/:id/lines/:lineId/decide`, apiRoute('POST', '/assistance/registries/{id}/lines/{lineId}/decide', 'registries:review', registrySchema, svc.decideRegistryLine)),
  http.post(`${AB}/registries/:id/payments`, apiRoute('POST', '/assistance/registries/{id}/payments', 'payments:write', registrySchema, svc.payRegistry)),

  // ---- rebills ----
  http.post(`${AB}/rebills`, apiRoute('POST', '/assistance/rebills', 'rebills:write', rebillSchema, svc.createRebill)),
  http.get(`${AB}/rebills/:id`, apiRoute('GET', '/assistance/rebills/{id}', 'rebills:write', rebillSchema, svc.getRebill)),
  http.post(`${AB}/rebills/:id/lines/:lineId/dispute`, apiRoute('POST', '/assistance/rebills/{id}/lines/{lineId}/dispute', 'rebills:write', rebillSchema, svc.disputeLine)),
];
