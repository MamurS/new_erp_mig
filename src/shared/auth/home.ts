import type { Role } from '@/shared/types';
import { isClinicRole, isStaffRole } from '@/shared/domain/labels';

export type Portal = 'staff' | 'hr' | 'app' | 'clinic';

export function homeFor(role: Role): string {
  if (role === 'hr') return '/hr';
  if (role === 'insured') return '/app';
  if (isClinicRole(role)) return '/clinic';
  return '/staff';
}

export function portalOf(role: Role): Portal {
  if (role === 'hr') return 'hr';
  if (role === 'insured') return 'app';
  if (isClinicRole(role)) return 'clinic';
  return 'staff';
}

export function portalRoles(portal: Portal): (r: Role) => boolean {
  if (portal === 'hr') return (r) => r === 'hr';
  if (portal === 'app') return (r) => r === 'insured';
  if (portal === 'clinic') return isClinicRole;
  return isStaffRole;
}

export function loginPathFor(portal: Portal): string {
  return portal === 'app' ? '/app/login' : '/login';
}

/** Inactivity timeout (SPEC §9.2). */
export function idleLimitsFor(role: Role): { timeoutMs: number; warnMs: number | null } {
  // Clinics work with medical data: same 15 minutes as MIG staff (CLINIC_SPEC §2).
  if (isStaffRole(role) || isClinicRole(role)) return { timeoutMs: 15 * 60_000, warnMs: 13 * 60_000 };
  return { timeoutMs: 30 * 60_000, warnMs: 28 * 60_000 };
}
