/*
 * Consequences of an act across roles (docs/PRIVILEGED_AUDIT.md): what MIG's own processes do after a person acts —
 * a fully signed contract is finalised (deal stage, invoices, coming into force, applying an endorsement), a step done
 * closes the requests about it addressed to other roles, the client's answer to a renewal offer opens the renewal
 * deal. The person (often the client's HR) may not touch those rows, and the consequences are one transaction of the
 * request, so they run with the system's repositories. Privileged access: this folder (services/system/) is on the
 * allowlist of the lint rule against it (eslint.config.js).
 */
import type { KpDocument, SessionUser, UUID } from '@mig/contracts';
import type { TaskAction } from '@mig/contracts/dto';
import { fullySignedAt, isFullySigned } from '../../contracts';
import { isoDay, parseIso, tzIso } from '../../lib/time';
import { asSystem, notFound, type BaseCtx } from '../kernel';
import { applyEndorsement, contractOf, createContractInvoices, moveDeal } from '../lifecycle';
import { closeTask } from '../tasks';
import { ensureRenewalDeal } from '../deals';
import { refreshContract } from './clocks';

/** After any signature: a fully signed document is finalised once. */
export async function afterSigning(person: BaseCtx, kind: 'contract' | 'endorsement', id: UUID, actorName: string): Promise<void> {
  // Consequences of a signature (deal stage, invoices, coming into force, applying an endorsement) are the
  // system's, also when the client's HR signs.
  const ctx = asSystem(person, 'consequences of a signature: deal stage, invoices, coming into force, applying an endorsement');
  if (kind === 'contract') {
    const c = await contractOf(ctx, id);
    if (!isFullySigned(c.signing)) {
      if (c.status === 'sent' || c.status === 'approved') {
        c.status = 'signing';
        await ctx.repos.contracts.update(c.id, { status: c.status });
      }
      await moveDeal(ctx, c.dealId, 'signing', actorName);
      return;
    }
    if (c.status === 'signed' || c.status === 'active') return;
    c.status = 'signed';
    await ctx.repos.contracts.update(c.id, { status: c.status });
    await createContractInvoices(ctx, c);
    await moveDeal(ctx, c.dealId, 'awaiting_payment', actorName, `Договор ${c.number} подписан обеими сторонами, выставлены счета`);
    await refreshContract(ctx, c);
    return;
  }
  const e = await ctx.repos.endorsements.get(id);
  if (!e) throw notFound();
  if (!isFullySigned(e.signing)) {
    if (e.status === 'sent' || e.status === 'approved') await ctx.repos.endorsements.update(e.id, { status: 'signing' });
    return;
  }
  if (e.status === 'signed') return;
  e.status = 'signed';
  await ctx.repos.endorsements.update(e.id, { status: e.status });
  await applyEndorsement(ctx, e, isoDay(parseIso(fullySignedAt(e.signing) ?? tzIso(ctx.now()))));
}

/**
 * The action was done: open requests about it (for this deal, contract or client) close and their authors
 * are notified. Returns how many were closed.
 */
export async function completeTasks(person: BaseCtx, actions: TaskAction | readonly TaskAction[], refs: { dealId?: string; contractId?: string; clientId?: string }, byName: string): Promise<number> {
  // A step of the pipeline done closes the requests about it, whoever did it (requests of other roles too).
  const ctx = asSystem(person, 'a step done closes the open requests about it (requests of any role)');
  const list = typeof actions === 'string' ? [actions] : actions;
  let n = 0;
  for (const task of await ctx.repos.tasks.list({ where: { status: { in: ['open', 'in_progress'] }, action: { in: list } } })) {
    const about =
      (refs.contractId && (task.contractId === refs.contractId || (task.subjectType === 'contract' && task.subjectId === refs.contractId))) ||
      (refs.dealId && task.subjectType === 'deal' && task.subjectId === refs.dealId) ||
      (refs.clientId && task.clientId === refs.clientId && task.subjectType === 'client');
    if (!about) continue;
    await closeTask(ctx, task, byName);
    n += 1;
  }
  return n;
}

/** The client's answer to a renewal offer opens its renewal deal (MIG's sales pipeline, whoever answered). */
export async function openRenewalDeal(person: BaseCtx, kp: KpDocument, actor: SessionUser): Promise<void> {
  await ensureRenewalDeal(asSystem(person, 'the client\'s answer to a renewal offer opens its renewal deal'), kp, actor);
}
