/*
 * Integration settings of a partner (CLINIC_SPEC §6, ASSISTANCE_SPEC §8): API keys, webhooks,
 * deliveries and the call log. The same handlers serve clinics (/api/clinic/integration) and
 * assistance companies (/api/assist/integration); keys, webhooks and logs belong to the partner.
 */
import { msg } from '@/i18n/core';
import { http } from 'msw';
import type { IntegrationClient, IntegrationMode, PartnerType, Role, WebhookEndpoint } from '@/shared/types';
import type { IntegrationOverview } from '@/shared/types/dto';
import { ASSIST_SCOPES, ASSIST_WEBHOOK_EVENTS, INTEGRATION_SCOPES, keyCreateRequest, WEBHOOK_EVENTS, webhookCreateRequest } from '@/shared/integration/schemas';
import { sha256Hex } from '@/shared/integration/webhook';
import type { Db, IntegrationClientRow, WebhookEndpointRow } from '../db';
import { audit, body, conflict, HttpError, notFound, param, route } from '../http';
import { attemptDelivery, emitWebhook } from '../clinic-core';
import { randomId, randomToken } from '../rng';
import { DAY, parseIso, tzIso } from '../time';
import { revokeKey } from './clinic';

export interface PartnerCtx {
  actor: { id: string; displayName: string; role: Role; assistanceId?: string };
  partnerId: string;
  partnerType: PartnerType;
  mode: IntegrationMode;
  d: Db;
}

const toClientView = ({ secretHash: _h, ...k }: IntegrationClientRow): IntegrationClient => k;
const toWebhookView = ({ signingSecret: _s, ...w }: WebhookEndpointRow): WebhookEndpoint => w;

export function partnerIntegrationHandlers(base: string, resolve: (request: Request) => PartnerCtx) {
  return [
  http.get(
    `${base}/overview`,
    route(({ request }) => {
      const { partnerId, d } = resolve(request);
      const { mode } = resolve(request);
      const since = Date.now() - DAY;
      const logs = d.apiLogs.filter((l) => l.clinicId === partnerId && parseIso(l.at) >= since);
      const last = d.webhookDeliveries.find((w) => w.clinicId === partnerId);
      const activeKeys = d.integrationClients.filter((k) => k.clinicId === partnerId && !k.revokedAt);
      const out: IntegrationOverview = {
        mode,
        connected: activeKeys.some((k) => k.lastUsedAt && parseIso(k.lastUsedAt) >= since),
        activeKeys: activeKeys.length,
        requests24h: logs.length,
        errors24h: logs.filter((l) => l.status >= 400).length,
        lastWebhook: last ? { event: last.event, at: last.lastAttemptAt, status: last.status } : null,
      };
      return out;
    }),
  ),
  http.get(
    `${base}/keys`,
    route(({ request }) => {
      const { partnerId, d } = resolve(request);
      return d.integrationClients.filter((k) => k.clinicId === partnerId).map(toClientView);
    }),
  ),
  http.post(
    `${base}/keys`,
    route(async ({ request }) => {
      const { actor, partnerId, partnerType, d } = resolve(request);
      const input = await body(request, keyCreateRequest);
      const allowed: readonly string[] = partnerType === 'assistance' ? ASSIST_SCOPES : INTEGRATION_SCOPES;
      if (input.scopes.some((x) => !allowed.includes(x))) throw new HttpError(422, 'validation', 'srv.partners.scopeNotAllowed', { fields: { scopes: msg('srv.partners.scopeUnavailable') } });
      const clientId = `mig_${randomToken(12).replace(/[^A-Za-z0-9]/g, '').slice(0, 16).toLowerCase()}`;
      const clientSecret = randomToken(32);
      const row: IntegrationClientRow = {
        id: randomId(),
        clinicId: partnerId,
        partnerType,
        name: input.name,
        clientId,
        secretLast4: clientSecret.slice(-4),
        secretHash: await sha256Hex(clientSecret),
        scopes: input.scopes,
        ipAllowlist: input.ipAllowlist,
        createdAt: tzIso(Date.now()),
      };
      d.integrationClients.push(row);
      audit(actor, 'integration_key_created', { targetType: 'integration', targetId: row.id, targetLabel: row.name });
      // The secret is returned exactly once and never stored in clear.
      return { id: row.id, clientId, clientSecret };
    }),
  ),
  http.post(
    `${base}/keys/:id/revoke`,
    route((ctx) => {
      const { actor, partnerId, d } = resolve(ctx.request);
      const k = d.integrationClients.find((x) => x.id === param(ctx, 'id') && x.clinicId === partnerId);
      if (!k) throw notFound();
      revokeKey(d, k, actor);
      return toClientView(k);
    }),
  ),
  http.get(
    `${base}/webhooks`,
    route(({ request }) => {
      const { partnerId, d } = resolve(request);
      return d.webhooks.filter((w) => w.clinicId === partnerId).map(toWebhookView);
    }),
  ),
  http.post(
    `${base}/webhooks`,
    route(async ({ request }) => {
      const { actor, partnerId, partnerType, d } = resolve(request);
      const input = await body(request, webhookCreateRequest);
      const events: readonly string[] = partnerType === 'assistance' ? ASSIST_WEBHOOK_EVENTS : WEBHOOK_EVENTS;
      if (input.events.some((x) => !events.includes(x))) throw new HttpError(422, 'validation', 'srv.partners.eventNotAllowed', { fields: { events: msg('srv.partners.eventUnavailable') } });
      const signingSecret = `whsec_${randomToken(24)}`;
      const row: WebhookEndpointRow = {
        id: randomId(),
        clinicId: partnerId,
        partnerType,
        url: input.url,
        events: input.events,
        secretLast4: signingSecret.slice(-4),
        signingSecret,
        active: true,
        createdAt: tzIso(Date.now()),
      };
      d.webhooks.push(row);
      audit(actor, 'webhook_created', { targetType: 'integration', targetId: row.id, targetLabel: new URL(row.url).host });
      return { id: row.id, signingSecret };
    }),
  ),
  http.post(
    `${base}/webhooks/:id/test`,
    route(async (ctx) => {
      const { partnerId, partnerType, d } = resolve(ctx.request);
      const w = d.webhooks.find((x) => x.id === param(ctx, 'id') && x.clinicId === partnerId);
      if (!w) throw notFound();
      const [delivery] = await emitWebhook(d, partnerId, w.events[0] ?? (partnerType === 'assistance' ? 'insured.added' : 'appointment.requested'), randomId(), w);
      const { body: _b, signature: _s, clinicId: _c, ...view } = delivery!;
      return view;
    }),
  ),
  http.get(
    `${base}/deliveries`,
    route(({ request }) => {
      const { partnerId, d } = resolve(request);
      return d.webhookDeliveries
        .filter((w) => w.clinicId === partnerId)
        .slice(0, 100)
        .map(({ body: _b, signature: _s, clinicId: _c, ...w }) => w);
    }),
  ),
  http.post(
    `${base}/deliveries/:id/retry`,
    route(async (ctx) => {
      const { partnerId, d } = resolve(ctx.request);
      const delivery = d.webhookDeliveries.find((x) => x.id === param(ctx, 'id') && x.clinicId === partnerId);
      if (!delivery) throw notFound();
      if (delivery.status === 'delivered') throw conflict('srv.partners.alreadyDelivered');
      const ep = d.webhooks.find((w) => w.id === delivery.endpointId);
      if (!ep) throw notFound();
      if (delivery.status === 'failed') delivery.attempts = Math.min(delivery.attempts, 5); // manual retry gets one more attempt
      await attemptDelivery(delivery, ep);
      const { body: _b, signature: _s, clinicId: _c, ...view } = delivery;
      return view;
    }),
  ),
  http.get(
    `${base}/logs`,
    route(({ request }) => {
      const { partnerId, d } = resolve(request);
      return d.apiLogs
        .filter((l) => l.clinicId === partnerId)
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .slice(0, 200)
        .map(({ clinicId: _c, ...l }) => l);
    }),
  ),
  ];
}
