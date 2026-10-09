/*
 * The webhook outbox (docs/PRIVILEGED_AUDIT.md): an event of any party is delivered to the partner it concerns — the
 * partner's endpoints and signing secrets (never readable by a person) and its delivery log are the system's. Thin
 * events only. Privileged access: this folder (services/system/) is on the allowlist of the lint rule against it
 * (eslint.config.js).
 */
import type { UUID, WebhookEvent } from '@mig/contracts';
import { randomId } from '../../lib/random';
import { tzIso } from '../../lib/time';
import type { WebhookDeliveryRow, WebhookEndpointRow } from '../../store/db';
import { asSystem, type BaseCtx } from '../kernel';
import { attemptDelivery, trimNewest } from '../clinic';

/** Thin events only: id, type, time and the object id — no personal or medical data. */
export async function emitWebhook(person: BaseCtx, clinicId: UUID, event: WebhookEvent, objectId: UUID, only?: WebhookEndpointRow): Promise<WebhookDeliveryRow[]> {
  // The outbox: the partner's endpoints and the delivery log are the system's, whoever caused the event.
  const ctx = asSystem(person, 'webhook outbox: endpoints of the partner an event concerns, the delivery log');
  const endpoints = only ? [only] : (await ctx.repos.webhooks.list({ where: { clinicId, active: true } })).filter((w) => w.events.includes(event));
  const out: WebhookDeliveryRow[] = [];
  for (const ep of endpoints) {
    const body = JSON.stringify({ id: randomId(), type: event, createdAt: tzIso(ctx.now()), objectId });
    const delivery: WebhookDeliveryRow = {
      id: randomId(),
      endpointId: ep.id,
      clinicId,
      event,
      status: 'retrying',
      attempts: 0,
      lastAttemptAt: tzIso(ctx.now()),
      objectId,
      body,
      signature: '',
    };
    await ctx.repos.webhookDeliveries.insert(delivery, { at: 'start' });
    await attemptDelivery(delivery, ep, ctx.now());
    await ctx.repos.webhookDeliveries.put(delivery);
    out.push(delivery);
  }
  await trimNewest(ctx.repos.webhookDeliveries, 1000);
  return out;
}
