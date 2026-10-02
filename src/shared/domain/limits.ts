import type { LimitChangeRequest, SessionUser } from '@/shared/types';
import { can } from '@/shared/auth/permissions';

export const FOUR_EYES_LIMIT_HINT = 'Нужно подтверждение другого сотрудника';

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
