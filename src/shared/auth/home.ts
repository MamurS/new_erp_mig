import type { Role } from '@/shared/types';
import { isStaffRole } from '@/shared/domain/labels';

export type Portal = 'staff' | 'hr' | 'app';

export function homeFor(role: Role): string {
  if (role === 'hr') return '/hr';
  if (role === 'insured') return '/app';
  return '/staff';
}

export function portalOf(role: Role): Portal {
  if (role === 'hr') return 'hr';
  if (role === 'insured') return 'app';
  return 'staff';
}

export function portalRoles(portal: Portal): (r: Role) => boolean {
  if (portal === 'hr') return (r) => r === 'hr';
  if (portal === 'app') return (r) => r === 'insured';
  return isStaffRole;
}

export function loginPathFor(portal: Portal): string {
  return portal === 'app' ? '/app/login' : '/login';
}

/** Inactivity timeout (SPEC §9.2). */
export function idleLimitsFor(role: Role): { timeoutMs: number; warnMs: number | null } {
  if (isStaffRole(role)) return { timeoutMs: 15 * 60_000, warnMs: 13 * 60_000 };
  return { timeoutMs: 30 * 60_000, warnMs: 28 * 60_000 };
}
