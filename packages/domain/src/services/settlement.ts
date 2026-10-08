/*
 * Claims settlement (LIFECYCLE_SPEC §13): the reserve timeline, fraud flags, decisions within authority,
 * and who handles reimbursements of the insured.
 */
import type { ClaimDecision, FraudFlag, ReserveChange, SessionUser, UUID } from '@mig/contracts';
import { detectFlags } from '../settlement';
import { randomId } from '../lib/random';
import { parseIso, tzIso } from '../lib/time';
import type { ClaimRow } from '../store/db';
import type { BaseCtx } from './kernel';
import { loadParams, type ParamsView } from './params';
import { currentAssistance } from './assistance';

/**
 * Reserve history of a claim: derived from its status history (registered → claimed amount, decision →
 * approved amount, refusal or payment → 0) and merged with explicit changes by claims officers.
 */
export function reserveTimeline(c: ClaimRow): ReserveChange[] {
  const events: ReserveChange[] = [];
  let value = 0;
  for (const h of c.history) {
    let next: number | null = null;
    if (h.to === 'new' && !h.from) next = c.amountClaimed;
    else if (h.to === 'approved') next = c.amountApproved ?? c.amountClaimed;
    else if (h.to === 'rejected' || h.to === 'paid') next = 0;
    if (next === null || next === value) continue;
    events.push({ at: h.at, byName: h.actorName, from: value, to: next, reason: h.to === 'new' ? 'Регистрация: заявленная сумма' : h.to === 'approved' ? 'Решение: одобренная сумма' : h.to === 'rejected' ? 'Отказ' : 'Оплата' });
    value = next;
  }
  const merged = [...events, ...(c.reserveHistory ?? [])].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  // Recompute `from` along the merged line so the history reads continuously.
  let prev = 0;
  return merged.map((e) => {
    const out = { ...e, from: prev };
    prev = e.to;
    return out;
  });
}

export function currentReserve(c: ClaimRow): number {
  return reserveTimeline(c).at(-1)?.to ?? 0;
}

export function reserveOnDate(c: ClaimRow, date: string): number {
  const end = parseIso(`${date}T23:59:59+05:00`);
  let v = 0;
  for (const e of reserveTimeline(c)) {
    if (parseIso(e.at) > end) break;
    v = e.to;
  }
  return v;
}

/**
 * Recomputes fraud flags; dismissed flags keep their comment. Sets `c.flags` and saves them when the claim
 * is stored already.
 */
export async function refreshFlags(ctx: BaseCtx, c: ClaimRow, P?: ParamsView): Promise<FraudFlag[]> {
  const params = P ?? (await loadParams(ctx));
  const i = await ctx.repos.insured.get(c.insuredId);
  const policy = i ? await ctx.repos.policies.get(i.policyId) : null;
  const found = detectFlags({
    claim: c,
    others: await ctx.repos.claims.list({ where: { id: { ne: c.id } } }),
    coverageFrom: i?.insuredFrom ?? policy?.startDate ?? '0000-01-01',
    coverageTo: policy?.endDate ?? '9999-12-31',
    excludedFrom: i?.excludedFrom,
    params: { maxPerMonth: params.dmsParam('fraudMaxClaimsPerMonth'), priceExcessShare: params.dmsParam('fraudPriceExcessShare'), daysBeforeExclusion: params.dmsParam('fraudDaysBeforeExclusion') },
  });
  const old = c.flags ?? [];
  c.flags = found.map((f) => {
    const prev = old.find((o) => o.code === f.code);
    return prev ? { ...prev, message: f.message } : { id: randomId(), ...f };
  });
  if (await ctx.repos.claims.exists({ id: c.id })) await ctx.repos.claims.update(c.id, { flags: c.flags });
  return c.flags;
}

/** Reimbursements of the insured: MIG's claims officer, or the assistance when its contract says so. */
export async function handlerOf(ctx: BaseCtx, insuredPolicyId: UUID): Promise<'mig' | 'assistance'> {
  const a = await currentAssistance(ctx, insuredPolicyId);
  if (!a) return 'mig';
  const company = await ctx.repos.assistances.get(a);
  return company?.contract.handlesReimbursements === false ? 'mig' : 'assistance';
}

/** Applies a decision to the claim: status, amounts, plain-language reason and history (the caller saves the claim). */
export function applyDecision(c: ClaimRow, decision: ClaimDecision, user: Pick<SessionUser, 'id' | 'displayName'>): void {
  const at = decision.at;
  const to = decision.kind === 'reject' ? 'rejected' : 'approved';
  if (decision.kind !== 'reject') {
    c.amountApproved = decision.amount;
    c.approvedById = decision.byId;
  }
  c.publicRejectionReason = decision.kind === 'approve' ? undefined : decision.reason;
  c.history.push({ at, actorName: user.displayName, from: c.status, to, comment: decision.reason || undefined });
  c.status = to;
  c.decision = decision;
  c.pendingDecision = undefined;
  c.updatedAt = at;
}

export const nowIso = (ctx: Pick<BaseCtx, 'now'>) => tzIso(ctx.now());

/** SHA-256 of a receipt image: the same photo sent twice is a duplicate. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
