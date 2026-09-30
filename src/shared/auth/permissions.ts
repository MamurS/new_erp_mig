/*
 * Single source of truth for access rights (SPEC §4). Used by UI guards and by the mock server.
 */
import type { ClaimStatus, Role, SessionUser, UUID } from '@/shared/types';

/** Scoped rule: allowed only for records that belong to the session's company / insured person. */
type Own = 'own';
/** Allowed, data arrives masked. */
type Masked = 'masked';
/** Allowed, name-level fields only. */
type NameOnly = 'name_only';
/** Allowed except on records the user created (four-eyes). */
type ExceptOwn = 'except_own';
type Transitions = { transitions: readonly (readonly [ClaimStatus, ClaimStatus])[] };
export type Rule = boolean | Own | Masked | NameOnly | ExceptOwn | Transitions;

type Row = Record<Role, Rule>;

const no = false;
const yes = true;

export const PERMISSIONS = {
  'clients.read': { operator: yes, underwriter: yes, doctor_expert: no, accountant: yes, admin: yes, hr: no, insured: no },
  'clients.write': { operator: no, underwriter: yes, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no },
  'policies.read': { operator: yes, underwriter: yes, doctor_expert: no, accountant: yes, admin: no, hr: 'own', insured: 'own' },
  'policies.write': { operator: no, underwriter: yes, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no },
  'insured.read': {
    operator: 'masked',
    underwriter: 'masked',
    doctor_expert: 'masked',
    accountant: 'name_only',
    admin: no,
    hr: 'own',
    insured: 'own',
  },
  'insured.reveal_pii': { operator: yes, underwriter: no, doctor_expert: yes, accountant: no, admin: no, hr: no, insured: no },
  'medical.read': { operator: no, underwriter: no, doctor_expert: yes, accountant: no, admin: no, hr: no, insured: no },
  'claims.read': { operator: yes, underwriter: no, doctor_expert: yes, accountant: yes, admin: no, hr: no, insured: 'own' },
  'claims.transition': {
    operator: {
      transitions: [
        ['new', 'review'],
        ['review', 'medical_review'],
        ['review', 'approved'],
        ['review', 'rejected'],
      ],
    },
    underwriter: no,
    doctor_expert: {
      transitions: [
        ['medical_review', 'approved'],
        ['medical_review', 'rejected'],
      ],
    },
    accountant: {
      transitions: [
        ['approved', 'to_pay'],
        ['to_pay', 'paid'],
      ],
    },
    admin: no,
    hr: no,
    insured: no,
  },
  'claims.create': { operator: yes, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: no, insured: 'own' },
  'appointments.read': { operator: yes, underwriter: no, doctor_expert: yes, accountant: no, admin: no, hr: no, insured: 'own' },
  'appointments.manage': { operator: yes, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: no, insured: 'own' },
  'clinics.read': { operator: yes, underwriter: yes, doctor_expert: yes, accountant: no, admin: yes, hr: no, insured: yes },
  'limits.request_change': { operator: yes, underwriter: yes, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no },
  'limits.approve_change': {
    operator: no,
    underwriter: 'except_own',
    doctor_expert: no,
    accountant: no,
    admin: no,
    hr: no,
    insured: no,
  },
  'reports.read': { operator: no, underwriter: yes, doctor_expert: no, accountant: yes, admin: no, hr: 'own', insured: no },
  'exports.create': { operator: no, underwriter: yes, doctor_expert: no, accountant: yes, admin: no, hr: 'own', insured: no },
  'audit.read': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: yes, hr: no, insured: no },
  'users.manage': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: yes, hr: no, insured: no },
  'kp.create': { operator: no, underwriter: yes, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no },
  'kp.send': { operator: no, underwriter: yes, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no },
  'kp.read': { operator: yes, underwriter: yes, doctor_expert: no, accountant: yes, admin: yes, hr: 'own', insured: no },
  'hr.employees.manage': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: 'own', insured: no },
} as const satisfies Record<string, Row>;

export type Action = keyof typeof PERMISSIONS;
export const ACTIONS = Object.keys(PERMISSIONS) as Action[];

export interface PermissionContext {
  /** Company that owns the record (hr scope). */
  companyId?: UUID;
  /** Insured person that owns the record (insured scope). */
  insuredId?: UUID;
  /** Creator of the record (four-eyes). */
  createdById?: UUID;
  /** Claim transition being attempted. */
  from?: ClaimStatus;
  to?: ClaimStatus;
}

type MinimalUser = Pick<SessionUser, 'id' | 'role' | 'companyId' | 'insuredId'>;

export function ruleFor(role: Role, action: Action): Rule {
  return (PERMISSIONS[action] as Row)[role];
}

function ownMatches(user: MinimalUser, ctx: PermissionContext | undefined): boolean {
  if (!ctx) return true; // scope is applied by the data layer
  if (user.role === 'hr') {
    if (ctx.companyId === undefined) return ctx.insuredId === undefined;
    return !!user.companyId && ctx.companyId === user.companyId;
  }
  if (user.role === 'insured') {
    if (ctx.insuredId === undefined) return ctx.companyId === undefined;
    return !!user.insuredId && ctx.insuredId === user.insuredId;
  }
  return false;
}

export function can(user: MinimalUser | null | undefined, action: Action, ctx?: PermissionContext): boolean {
  if (!user) return false;
  const rule = ruleFor(user.role, action);
  if (rule === false) return false;
  if (rule === true || rule === 'masked' || rule === 'name_only') return true;
  if (rule === 'own') return ownMatches(user, ctx);
  if (rule === 'except_own') return !(ctx?.createdById && ctx.createdById === user.id);
  // transitions
  if (ctx?.from === undefined || ctx.to === undefined) return rule.transitions.length > 0;
  return rule.transitions.some(([f, t]) => f === ctx.from && t === ctx.to);
}

/** How personal data of insured persons is exposed to the role. */
export function insuredVisibility(role: Role): 'masked' | 'name_only' | 'none' {
  const r = ruleFor(role, 'insured.read');
  if (r === 'name_only') return 'name_only';
  if (r === false) return 'none';
  return 'masked';
}

/** Claim transitions the role may perform from a status (before business rules). */
export function roleTransitionsFrom(role: Role, from: ClaimStatus): ClaimStatus[] {
  const rule = ruleFor(role, 'claims.transition');
  if (typeof rule !== 'object') return [];
  return rule.transitions.filter(([f]) => f === from).map(([, t]) => t);
}
