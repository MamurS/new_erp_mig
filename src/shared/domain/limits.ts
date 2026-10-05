import { msg } from '@/i18n';
import type { LimitChangeRequest, SessionUser } from '@/shared/types';
import { can } from '@/shared/auth/permissions';

/** Message key (tm() shows it); the server returns it as the 409 reason. */
export const FOUR_EYES_LIMIT_HINT = msg('dom.limits.fourEyes');

/** Four-eyes: the author of a limit change request cannot decide it. */
export function canDecideLimitRequest(
  user: Pick<SessionUser, 'id' | 'role'>,
  req: Pick<LimitChangeRequest, 'requestedById' | 'status'>,
): boolean {
  return req.status === 'pending' && can(user, 'limits.approve_change', { createdById: req.requestedById });
}

/** Running low: no more than `lowShare` (DMS parameter `limitLowShare`) of the limit is left. */
export function isNearLimit(used: number, limit: number, lowShare: number): boolean {
  return limit > 0 && (limit - used) / limit <= lowShare;
}
