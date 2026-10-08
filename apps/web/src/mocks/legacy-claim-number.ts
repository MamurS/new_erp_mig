/*
 * Transitional: the synchronous claim number for handlers not yet ported to the services (me.ts).
 * Same rule as `nextClaimNumber` of packages/domain/src/services/claims.ts; remove with the old cores.
 */
import { db } from './db';
import { maxDocSeq, nextDocNumber } from './params';

export function nextClaimNumber(): string {
  const max = maxDocSeq('claim', db().claims.map((c) => c.number), { floor: 9000 });
  return nextDocNumber('claim', { year: new Date().getFullYear(), n: max + 1 });
}
