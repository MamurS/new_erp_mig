/*
 * The reserve of a claim (LIFECYCLE_SPEC §13), pure: the services (settlement.ts) and the list queries
 * (store/computed.ts: `claims.reserve`, mirrored by the SQL function `app.claim_reserve`) share it.
 */
import type { ReserveChange } from '@mig/contracts';
import type { ClaimRow } from '../store/db';

/**
 * Reserve history of a claim: derived from its status history (registered → claimed amount, decision →
 * approved amount, refusal or payment → 0) and merged with explicit changes by claims officers.
 */
export function reserveTimeline(c: Pick<ClaimRow, 'history' | 'reserveHistory' | 'amountClaimed' | 'amountApproved'>): ReserveChange[] {
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

export function currentReserve(c: Pick<ClaimRow, 'history' | 'reserveHistory' | 'amountClaimed' | 'amountApproved'>): number {
  return reserveTimeline(c).at(-1)?.to ?? 0;
}

