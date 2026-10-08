/*
 * Integration settings of a partner (CLINIC_SPEC §6, ASSISTANCE_SPEC §8): API keys, webhooks,
 * deliveries and the call log. The same handlers serve clinics (/api/clinic/integration) and
 * assistance companies (/api/assist/integration). The logic is the shared service
 * (packages/domain/src/services/partnerIntegration.ts); this is the MSW adapter.
 */
import { http } from 'msw';
import type { BaseCtx } from '@mig/domain/services/kernel';
import * as svc from '@mig/domain/services/partnerIntegration';
import { baseCtx, param, readJson, route } from '../http';

/** The partner of the request, resolved from the session (401/403 otherwise); `ctx`: its service context. */
export type PartnerCtx = svc.PartnerScope & { ctx?: BaseCtx };

export function partnerIntegrationHandlers(base: string, resolve: (request: Request) => PartnerCtx | Promise<PartnerCtx>) {
  const scope = async (request: Request): Promise<[BaseCtx, svc.PartnerScope]> => {
    const p = await resolve(request);
    return [p.ctx ?? baseCtx(), p];
  };
  return [
    http.get(`${base}/overview`, route(async ({ request }) => svc.overview(...(await scope(request))))),
    http.get(`${base}/keys`, route(async ({ request }) => svc.listKeys(...(await scope(request))))),
    http.post(`${base}/keys`, route(async ({ request }) => svc.createKey(...(await scope(request)), await readJson(request)))),
    http.post(`${base}/keys/:id/revoke`, route(async (c) => svc.revokePartnerKey(...(await scope(c.request)), param(c, 'id')))),
    http.get(`${base}/webhooks`, route(async ({ request }) => svc.listWebhooks(...(await scope(request))))),
    http.post(`${base}/webhooks`, route(async ({ request }) => svc.createWebhook(...(await scope(request)), await readJson(request)))),
    http.post(`${base}/webhooks/:id/test`, route(async (c) => svc.testWebhook(...(await scope(c.request)), param(c, 'id')))),
    http.get(`${base}/deliveries`, route(async ({ request }) => svc.listDeliveries(...(await scope(request))))),
    http.post(`${base}/deliveries/:id/retry`, route(async (c) => svc.retryDelivery(...(await scope(c.request)), param(c, 'id')))),
    http.get(`${base}/logs`, route(async ({ request }) => svc.listLogs(...(await scope(request))))),
  ];
}
