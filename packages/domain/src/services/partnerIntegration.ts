/*
 * Integration settings of a partner (CLINIC_SPEC §6, ASSISTANCE_SPEC §8): API keys, webhooks,
 * deliveries and the call log. The same service serves clinics (/api/clinic/integration) and
 * assistance companies (/api/assist/integration); keys, webhooks and logs belong to the partner.
 */
import { msg } from '@mig/i18n';
import type { IntegrationClient, IntegrationMode, PartnerType, UUID, WebhookDelivery, WebhookEndpoint, ApiCallLog } from '@mig/contracts';
import type { IntegrationOverview } from '@mig/contracts/dto';
import { ASSIST_SCOPES, ASSIST_WEBHOOK_EVENTS, INTEGRATION_SCOPES, keyCreateRequest, WEBHOOK_EVENTS, webhookCreateRequest } from '@mig/contracts/integration';
import { randomId, randomToken } from '../lib/random';
import { DAY, parseIso, tzIso } from '../lib/time';
import { sha256Hex } from '../lib/webhook';
import type { IntegrationClientRow, WebhookDeliveryRow, WebhookEndpointRow } from '../store/db';
import { attemptDelivery, emitWebhook, pushEvent } from './clinic';
import { audit, conflict, DomainError, notFound, systemRepos, validate, type AuditActor, type BaseCtx } from './kernel';

/** Whose integration settings: resolved by the adapter from the session (clinic or assistance admin). */
export interface PartnerScope {
  actor: AuditActor;
  partnerId: UUID;
  partnerType: PartnerType;
  mode: IntegrationMode;
}

export const toClientView = ({ secretHash: _h, ...k }: IntegrationClientRow): IntegrationClient => k;
const toWebhookView = ({ signingSecret: _s, ...w }: WebhookEndpointRow): WebhookEndpoint => w;
const toDeliveryView = ({ body: _b, signature: _s, clinicId: _c, ...w }: WebhookDeliveryRow): WebhookDelivery => w;

/** Revokes a key (partner admin or MIG); already issued tokens stop working immediately. */
export async function revokeKey(ctx: BaseCtx, k: IntegrationClientRow, actor: AuditActor): Promise<IntegrationClientRow> {
  if (k.revokedAt) throw conflict('srv.apiKeys.alreadyRevoked');
  const revoked = await ctx.repos.integrationClients.update(k.id, { revokedAt: tzIso(ctx.now()) });
  await ctx.repos.accessTokens.removeWhere({ clientRowId: k.id });
  await audit(ctx, actor, 'integration_key_revoked', { targetType: 'integration', targetId: k.id, targetLabel: k.name });
  await pushEvent(ctx, k.clinicId, `Ключ API «${k.name}» отозван`);
  return revoked;
}

export async function overview(ctx: BaseCtx, p: PartnerScope): Promise<IntegrationOverview> {
  const r = ctx.repos;
  const since = ctx.now() - DAY;
  const logs = (await r.apiLogs.list({ where: { clinicId: p.partnerId } })).filter((l) => parseIso(l.at) >= since);
  const last = await r.webhookDeliveries.first({ where: { clinicId: p.partnerId } });
  const activeKeys = await r.integrationClients.list({ where: { clinicId: p.partnerId, revokedAt: { isNull: true } } });
  return {
    mode: p.mode,
    connected: activeKeys.some((k) => k.lastUsedAt && parseIso(k.lastUsedAt) >= since),
    activeKeys: activeKeys.length,
    requests24h: logs.length,
    errors24h: logs.filter((l) => l.status >= 400).length,
    lastWebhook: last ? { event: last.event, at: last.lastAttemptAt, status: last.status } : null,
  };
}

export async function listKeys(ctx: BaseCtx, p: PartnerScope): Promise<IntegrationClient[]> {
  return (await ctx.repos.integrationClients.list({ where: { clinicId: p.partnerId } })).map(toClientView);
}

export async function createKey(ctx: BaseCtx, p: PartnerScope, body: unknown): Promise<{ id: UUID; clientId: string; clientSecret: string }> {
  const input = validate(keyCreateRequest, body);
  const allowed: readonly string[] = p.partnerType === 'assistance' ? ASSIST_SCOPES : INTEGRATION_SCOPES;
  if (input.scopes.some((x) => !allowed.includes(x))) throw new DomainError(422, 'validation', 'srv.partners.scopeNotAllowed', { fields: { scopes: msg('srv.partners.scopeUnavailable') } });
  const clientId = `mig_${randomToken(12).replace(/[^A-Za-z0-9]/g, '').slice(0, 16).toLowerCase()}`;
  const clientSecret = randomToken(32);
  const row: IntegrationClientRow = {
    id: randomId(),
    clinicId: p.partnerId,
    partnerType: p.partnerType,
    name: input.name,
    clientId,
    secretLast4: clientSecret.slice(-4),
    secretHash: await sha256Hex(clientSecret),
    scopes: input.scopes,
    ipAllowlist: input.ipAllowlist,
    createdAt: tzIso(ctx.now()),
  };
  await ctx.repos.integrationClients.insert(row);
  await audit(ctx, p.actor, 'integration_key_created', { targetType: 'integration', targetId: row.id, targetLabel: row.name });
  // The secret is returned exactly once and never stored in clear.
  return { id: row.id, clientId, clientSecret };
}

export async function revokePartnerKey(ctx: BaseCtx, p: PartnerScope, id: UUID): Promise<IntegrationClient> {
  const k = await ctx.repos.integrationClients.first({ where: { id, clinicId: p.partnerId } });
  if (!k) throw notFound();
  return toClientView(await revokeKey(ctx, k, p.actor));
}

export async function listWebhooks(ctx: BaseCtx, p: PartnerScope): Promise<WebhookEndpoint[]> {
  return (await ctx.repos.webhooks.list({ where: { clinicId: p.partnerId } })).map(toWebhookView);
}

export async function createWebhook(ctx: BaseCtx, p: PartnerScope, body: unknown): Promise<{ id: UUID; signingSecret: string }> {
  const input = validate(webhookCreateRequest, body);
  const events: readonly string[] = p.partnerType === 'assistance' ? ASSIST_WEBHOOK_EVENTS : WEBHOOK_EVENTS;
  if (input.events.some((x) => !events.includes(x))) throw new DomainError(422, 'validation', 'srv.partners.eventNotAllowed', { fields: { events: msg('srv.partners.eventUnavailable') } });
  const signingSecret = `whsec_${randomToken(24)}`;
  const row: WebhookEndpointRow = {
    id: randomId(),
    clinicId: p.partnerId,
    partnerType: p.partnerType,
    url: input.url,
    events: input.events,
    secretLast4: signingSecret.slice(-4),
    signingSecret,
    active: true,
    createdAt: tzIso(ctx.now()),
  };
  await ctx.repos.webhooks.insert(row);
  await audit(ctx, p.actor, 'webhook_created', { targetType: 'integration', targetId: row.id, targetLabel: new URL(row.url).host });
  return { id: row.id, signingSecret };
}

export async function testWebhook(ctx: BaseCtx, p: PartnerScope, id: UUID): Promise<WebhookDelivery> {
  const w = await ctx.repos.webhooks.first({ where: { id, clinicId: p.partnerId } });
  if (!w) throw notFound();
  const [delivery] = await emitWebhook(ctx, p.partnerId, w.events[0] ?? (p.partnerType === 'assistance' ? 'insured.added' : 'appointment.requested'), randomId(), w);
  return toDeliveryView(delivery!);
}

export async function listDeliveries(ctx: BaseCtx, p: PartnerScope): Promise<WebhookDelivery[]> {
  return (await ctx.repos.webhookDeliveries.list({ where: { clinicId: p.partnerId }, limit: 100 })).map(toDeliveryView);
}

export async function retryDelivery(ctx: BaseCtx, p: PartnerScope, id: UUID): Promise<WebhookDelivery> {
  const delivery = await ctx.repos.webhookDeliveries.first({ where: { id, clinicId: p.partnerId } });
  if (!delivery) throw notFound();
  if (delivery.status === 'delivered') throw conflict('srv.partners.alreadyDelivered');
  const ep = await ctx.repos.webhooks.get(delivery.endpointId);
  if (!ep) throw notFound();
  if (delivery.status === 'failed') delivery.attempts = Math.min(delivery.attempts, 5); // manual retry gets one more attempt
  await attemptDelivery(delivery, ep, ctx.now());
  await systemRepos(ctx, 'webhook outbox: a manual retry records the attempt in the delivery log').webhookDeliveries.put(delivery);
  return toDeliveryView(delivery);
}

export async function listLogs(ctx: BaseCtx, p: PartnerScope): Promise<ApiCallLog[]> {
  return (await ctx.repos.apiLogs.list({ where: { clinicId: p.partnerId } }))
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 200)
    .map(({ clinicId: _c, ...l }) => l);
}
