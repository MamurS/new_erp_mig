/*
 * Lazy server clocks — jobs run on read (BACKEND_SPEC §10, docs/PRIVILEGED_AUDIT.md): state that changes with time
 * alone — an approved guarantee letter past its validity expires, an unpaid invoice becomes overdue, a contract signed
 * in EDO comes into force or expires, the monthly quality-control sample is drawn, a rebill is recomputed — is saved by
 * whoever reads it first, as a background job would. The reader may not update those rows (a clinic's letter read by
 * MIG, an invoice read by HR), so the save is the system's. Privileged access: this folder (services/system/) is on
 * the allowlist of the lint rule against it (eslint.config.js).
 */
import type { Contract, Policy, Rebill, UUID } from '@mig/contracts';
import { qaSample } from '../../assistance';
import { activationDate, addSignature } from '../../contracts';
import { randomId } from '../../lib/random';
import { isoDay, tzIso } from '../../lib/time';
import { actorOf, asSystem, audit, systemRepos, todayIso, type AuditActor, type BaseCtx } from '../kernel';
import { loadParams } from '../params';
import { activateContract, dealEvent, edoArrived, edoClientSignature, refreshInvoice, reload } from '../lifecycle';
import { afterSigning } from './consequences';


/**
 * A rebill whose automatic checks, fee and totals changed since it was saved (MIG's data moved on) is saved
 * recomputed by whoever reads it first (the assistance doctor, a MIG operator: readers that may not update it).
 */
export async function saveRecomputedRebill(ctx: BaseCtx, b: Rebill): Promise<void> {
  await systemRepos(ctx, 'rebill: the recomputed checks, fee and totals (a job run on read)').rebills.put(b);
}

/**
 * Lazy server clock: EDO events, coming into force by the activation rule, expiry. Called on every read
 * of the contract and after payments, so the state is current without background jobs. `c` is saved and
 * holds the current state afterwards.
 */
export async function refreshContract(person: BaseCtx, c: Contract, now = person.now()): Promise<void> {
  // A job run on read: its effects (signatures from EDO, the policy and insured persons on coming into force,
  // expiry) are the system's, whoever reads the contract.
  const ctx: BaseCtx = { ...person, repos: systemRepos(person, 'the lazy server clock of contracts: EDO events, coming into force, expiry') };
  const r = ctx.repos;
  if (edoArrived(c.signing, now)) {
    c.signing = addSignature(c.signing, 'client', edoClientSignature(c.signing, c.params.clientSignatory.name, todayIso(ctx)));
    await r.contracts.update(c.id, { signing: c.signing });
    await dealEvent(ctx, c.dealId, 'ЭДО', `Договор ${c.number} подписан клиентом в ЭДО (${c.signing.client?.edoProvider})`);
    await afterSigning(ctx, 'contract', c.id, 'ЭДО');
    await reload(ctx, c);
    return;
  }
  const arrived = (await r.endorsements.list({ where: { contractId: c.id } })).filter((x) => edoArrived(x.signing, now));
  for (const e of arrived) {
    e.signing = addSignature(e.signing, 'client', edoClientSignature(e.signing, c.params.clientSignatory.name, todayIso(ctx)));
    await r.endorsements.update(e.id, { signing: e.signing });
    await afterSigning(ctx, 'endorsement', e.id, 'ЭДО');
  }
  if (arrived.length) await reload(ctx, c);
  const today = isoDay(now);
  // Each transition is claimed by a conditional update first: of two readers (or a reader and the job) at the same
  // time only one moves the contract (Postgres re-checks the status after the other's commit), so the policy is
  // issued and the transition audited once. The actor of the audit entry is whoever ran the clock: the reader, or
  // the system for the background job.
  if (c.status === 'signed') {
    const payments = await r.payments.list({ where: { contractId: c.id } });
    const on = activationDate(c.params.activationRule, c.params.startDate, c.params.paymentSchedule, payments);
    if (on && on <= today && (await r.contracts.updateWhere({ id: c.id, status: 'signed' }, { status: 'active' }))) {
      const policy = await activateContract(ctx, c, on);
      await audit(ctx, actorOf(person), 'contract_activated', { targetType: 'contract', targetId: c.id, targetLabel: `${c.number}: с ${ru(on)}, полис ${policy.number}` });
    }
  }
  if (c.status === 'active' && c.params.endDate < today && (await r.contracts.updateWhere({ id: c.id, status: 'active' }, { status: 'expired' }))) {
    c.status = 'expired';
    await audit(ctx, actorOf(person), 'contract_expired', { targetType: 'contract', targetId: c.id, targetLabel: `${c.number}: действовал до ${ru(c.params.endDate)}` });
    const p = c.policyId ? await r.policies.get(c.policyId) : null;
    if (p) await expirePolicy(ctx, p, actorOf(person));
  }
}

const ru = (iso: string) => iso.split('-').reverse().join('.');

/**
 * A policy past its end date expires (once: a conditional update claims it) and the transition is audited; a client
 * whose current policy it was and that has no other active one becomes «Истёк». True when it expired now.
 */
async function expirePolicy(ctx: BaseCtx, p: Policy, actor: AuditActor): Promise<boolean> {
  const r = ctx.repos;
  if (!(await r.policies.updateWhere({ id: p.id, status: 'active' }, { status: 'expired' }))) return false;
  await audit(ctx, actor, 'policy_expired', { targetType: 'policy', targetId: p.id, targetLabel: `${p.number}: действовал до ${ru(p.endDate)}` });
  const client = await r.clients.get(p.clientId);
  if (client?.activePolicyId === p.id && client.status === 'active' && !(await r.policies.exists({ clientId: client.id, status: 'active' }))) await r.clients.update(client.id, { status: 'expired' });
  return true;
}

/**
 * The background job `contract-lifecycle` (BACKEND_SPEC §10): every contract's clock (EDO events, coming into force,
 * expiry — the same refresh the screens run on read), then policies without a contract of their own past their end
 * date. Returns the counts of the transitions it made.
 */
export async function contractLifecycle(person: BaseCtx): Promise<{ activated: number; contractsExpired: number; policiesExpired: number }> {
  const ctx = asSystem(person, 'the background job of the contract lifecycle: coming into force and expiry');
  const r = ctx.repos;
  const out = { activated: 0, contractsExpired: 0, policiesExpired: 0 };
  for (const c of await r.contracts.list({ where: { status: { in: ['sent', 'signing', 'signed', 'active'] } } })) {
    const was = c.status;
    await refreshContract(ctx, c);
    if (was !== 'active' && c.status === 'active') out.activated += 1;
    if (c.status === 'expired') out.contractsExpired += 1;
  }
  const today = todayIso(ctx);
  for (const p of await r.policies.list({ where: { status: 'active', endDate: { lt: today } } })) {
    // A policy of a contract follows its contract (above); an active contract of a policy past its end date is not
    // left behind either: its own clock expires both.
    const c = p.contractId ? await r.contracts.get(p.contractId) : null;
    if (c && c.status === 'active') continue;
    if (await expirePolicy(ctx, p, actorOf(person))) out.policiesExpired += 1;
  }
  return out;
}

/**
 * Signatures that arrived from the EDO operator (the demo operator answers 3 seconds after the send; a real operator
 * is polled the same way): the API worker runs this on every pass (about every 10 seconds), the mock before a
 * request. Only contracts with a document waiting for the client's EDO signature are touched. Returns how many
 * contracts got a signature.
 */
export async function edoEvents(person: BaseCtx): Promise<number> {
  const ctx = asSystem(person, 'signatures arriving from the EDO operator (a job of the worker)');
  const now = ctx.now();
  const r = ctx.repos;
  const waiting = await r.contracts.list({ where: { status: { in: ['sent', 'signing', 'signed', 'active'] } } });
  const endorsements = await r.endorsements.list({ where: { status: { in: ['sent', 'signing'] } } });
  let n = 0;
  for (const c of waiting) {
    if (!edoArrived(c.signing, now) && !endorsements.some((e) => e.contractId === c.id && edoArrived(e.signing, now))) continue;
    await refreshContract(ctx, c, now);
    n += 1;
  }
  return n;
}

/**
 * The background job `contract-lifecycle` (every 15 minutes): every state that changes with the date alone is saved
 * here and only here — reads (lists and cards) show what is stored. Contracts (EDO events, coming into force, expiry)
 * and policies (contractLifecycle), approved guarantee letters past their validity, invoice statuses by their due
 * date. Each step changes only the rows whose state is due, so a second run changes nothing.
 */
export async function timeClocks(person: BaseCtx): Promise<{ activated: number; contractsExpired: number; policiesExpired: number; guaranteesExpired: number; invoicesUpdated: number }> {
  const lifecycle = await contractLifecycle(person);
  const ctx = asSystem(person, 'the background job of the date clocks: guarantee letters and invoices');
  const today = todayIso(ctx);
  const due = await ctx.repos.guarantees.list({ where: { status: 'approved', validUntil: { lt: today } } });
  for (const g of due) await ctx.repos.guarantees.update(g.id, { status: 'expired' });
  let invoicesUpdated = 0;
  for (const inv of await ctx.repos.invoices.list({ where: { status: { ne: 'paid' } } })) {
    const before = inv.status;
    refreshInvoice(inv, today);
    if (inv.status !== before) {
      await ctx.repos.invoices.update(inv.id, { status: inv.status });
      invoicesUpdated += 1;
    }
  }
  return { ...lifecycle, guaranteesExpired: due.length, invoicesUpdated };
}

/** Adds this month's 5% sample of the assistance's decisions to the MIG queue (deterministic, idempotent). */
export async function ensureQaSample(person: BaseCtx, now = person.now()): Promise<void> {
  // The monthly quality-control sample: a job run on read.
  const ctx = asSystem(person, 'monthly quality-control sample of assistance decisions');
  const r = ctx.repos;
  const P = await loadParams(ctx);
  const month = isoDay(now).slice(0, 7);
  const known = new Set((await r.qaSamples.list()).map((s) => s.subject.id));
  const registries = await r.registries.list();
  for (const a of await r.assistances.list()) {
    const decisions: { id: UUID; type: 'guarantee' | 'registry_line'; label: string; at: string }[] = [
      ...(await r.guarantees.list({ where: { assistanceId: a.id, decidedBy: 'assistance' } }))
        .filter((g) => (g.decidedAt ?? g.createdAt).startsWith(month))
        .map((g) => ({ id: g.id, type: 'guarantee' as const, label: g.number, at: g.decidedAt ?? g.createdAt })),
      ...registries
        .filter((x) => (x.submittedAt ?? '').startsWith(month))
        .flatMap((x) => x.lines.filter((l) => l.payer === a.id && l.status === 'accepted').map((l) => ({ id: l.id, type: 'registry_line' as const, label: `${x.period}: ${l.serviceName}`, at: x.submittedAt! }))),
    ];
    for (const x of qaSample(decisions, month, P.dmsParam('qaSampleShare'))) {
      if (known.has(x.id)) continue;
      await r.qaSamples.insert({ id: randomId(), assistanceId: a.id, subject: { type: x.type, id: x.id, label: x.label }, createdAt: tzIso(now) }, { at: 'start' });
    }
  }
}
