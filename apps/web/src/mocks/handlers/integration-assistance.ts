/*
 * Integration API for assistance companies (/api/integration/v1/assistance/...), ASSISTANCE_SPEC §8. The
 * framework (OAuth, scopes, idempotency, problem+json, log) and the endpoints are shared services
 * (packages/domain/src/services/integrationKit.ts, integrationAssistance.ts); this is the MSW adapter.
 */
import { http, HttpResponse } from 'msw';
import type { IntegrationScope } from '@mig/contracts';
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
import type { ZodTypeAny } from 'zod';
import { runApiCall, TEST_IP_HEADER, type ApiHandler, type ApiSpec } from '@mig/domain/services/integrationKit';
import * as svc from '@mig/domain/services/integrationAssistance';
import { API, baseCtx, route } from '../http';

const AB = `${API}/integration/v1/assistance`;

/** One partner API endpoint: the request parts go to the service, its answer becomes the response. */
function apiRoute(method: ApiSpec['method'], template: string, scope: IntegrationScope, response: ZodTypeAny | null, fn: ApiHandler) {
  return route(
    async ({ request, params, url }) => {
      const answer = await runApiCall(
        baseCtx(),
        { method, template, scope, response, partner: 'assistance' },
        {
          path: url.pathname,
          params,
          query: url.searchParams,
          authorization: request.headers.get('authorization'),
          ip: request.headers.get(TEST_IP_HEADER),
          idempotencyKey: request.headers.get('Idempotency-Key'),
          bodyText: await request.text(),
        },
        fn,
      );
      return new HttpResponse(answer.body, { status: answer.status, headers: answer.headers });
    },
    { noFailures: true },
  );
}

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
