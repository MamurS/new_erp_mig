/*
 * Claims settlement (LIFECYCLE_SPEC §13): the reserve timeline, fraud flags, decisions within authority,
 * and who handles reimbursements of the insured.
 */
import type { ClaimDecision, FraudFlag, SessionUser, UUID } from '@mig/contracts';
import { detectFlags } from '../settlement';
import { randomId } from '../lib/random';
import { parseIso, tzIso } from '../lib/time';
import type { ClaimRow } from '../store/db';
import { type BaseCtx } from './kernel';
import { loadParams, type ParamsView } from './params';
import { currentAssistance } from './assistance';
import { reserveTimeline } from './reserve';

export { currentReserve, reserveTimeline } from './reserve';

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
  // Fraud checks compare the claim with all claims of the insurer: other people's claims that may be the same receipt
  // come as a narrow fact without the person (app.fact_receipt_twins); the person's own claims (the monthly
  // frequency) under the submitter's RLS. A stored claim only (both callers save it first).
  const params = P ?? (await loadParams(ctx));
  const i = await ctx.repos.insured.get(c.insuredId);
  const policy = i ? await ctx.repos.policies.get(i.policyId) : null;
  const twins = await ctx.repos.facts.receiptTwins(c.id);
  const twinIds = new Set(twins.map((t) => t.id));
  const own = (await ctx.repos.claims.list({ where: { insuredId: c.insuredId, id: { ne: c.id } } })).filter((o) => !twinIds.has(o.id));
  const found = detectFlags({
    claim: c,
    others: [...twins, ...own],
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
