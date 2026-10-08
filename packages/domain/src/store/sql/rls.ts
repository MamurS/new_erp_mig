/*
 * From the access rules of the schema (schema.ts) to SQL: policy expressions for the migration and the
 * expectations of the generated pgTAP tests. One function decides both, so the tests check that the
 * database does what the matrix (packages/domain/src/auth/permissions.ts) and the scopes say.
 */
import type { Role } from '@mig/contracts';
import { PERMISSIONS, ruleFor, type Action } from '../../auth/permissions';
import { ROLE_GROUPS, type Access, type Grant, type RoleGroup, type Scope, type ScopeLike } from '../schema';

export const STAFF_ROLES = ['operator', 'underwriter', 'doctor_expert', 'accountant', 'admin', 'sales_manager', 'legal', 'claims_officer'] as const satisfies readonly Role[];
export const CLINIC_ROLES = ['clinic_registrar', 'clinic_admin'] as const satisfies readonly Role[];
export const ASSIST_ROLES = ['asst_operator', 'asst_doctor', 'asst_billing', 'asst_admin'] as const satisfies readonly Role[];
export const ALL_ROLES: readonly Role[] = [...STAFF_ROLES, 'hr', 'insured', ...CLINIC_ROLES, ...ASSIST_ROLES];

export function groupOf(role: Role): RoleGroup {
  if ((STAFF_ROLES as readonly Role[]).includes(role)) return 'staff';
  if ((CLINIC_ROLES as readonly Role[]).includes(role)) return 'clinic';
  if ((ASSIST_ROLES as readonly Role[]).includes(role)) return 'assist';
  return role === 'hr' ? 'hr' : 'insured';
}
export const rolesOf = (g: RoleGroup): readonly Role[] => ALL_ROLES.filter((r) => groupOf(r) === g);

export const GROUP_SQL: Record<RoleGroup, string> = {
  staff: 'app.is_staff()',
  hr: "app.role() = 'hr'",
  insured: "app.role() = 'insured'",
  clinic: 'app.is_clinic()',
  assist: 'app.is_assist()',
};

/** `app.company_id()` → `(select app.company_id())`: evaluated once per statement (initPlan), not per row. */
export function cached(sql: string): string {
  // `= any(<subquery>)` would compare with the rows of the subquery: keep an array expression.
  return sql.replace(/any\(app\.(\w+)\(\)\)/g, 'any((select app.$1())::uuid[])').replace(/(?<!select )app\.(\w+)\(\)/g, '(select app.$1())');
}

const scope = (s: ScopeLike): Scope => (typeof s === 'string' ? { pred: s } : s);

export type Op = 'select' | 'insert' | 'update' | 'delete';
export const OPS: readonly Op[] = ['select', 'insert', 'update', 'delete'];

function checkActions(g: Grant): void {
  for (const a of g.actions ?? []) if (!(a in PERMISSIONS)) throw new Error(`Unknown action ${a}`);
}

/** The role passes the action gate of the group's scope. */
function gateOpen(role: Role, g: Grant, s: Scope): boolean {
  if (s.always) return true;
  if (!g.actions?.length) throw new Error(`A gated scope without actions: ${JSON.stringify(g)}`);
  return g.actions.some((a: Action) => ruleFor(role, a) !== false);
}

/** Row predicate that applies to the role under a grant: 'false' when the role may not do it at all. */
export function rolePredicate(role: Role, g: Grant | undefined): string {
  if (!g) return 'false';
  checkActions(g);
  const parts: string[] = [];
  const s = g[groupOf(role)];
  if (s !== undefined && gateOpen(role, g, scope(s))) parts.push(scope(s).pred);
  if (g.anyone !== undefined) parts.push(g.anyone);
  if (!parts.length) return 'false';
  if (parts.includes('true')) return 'true';
  return parts.map((p) => `(${p})`).join(' or ');
}

export function roleAllowed(role: Role, g: Grant | undefined): boolean {
  return rolePredicate(role, g) !== 'false';
}

const arr = (xs: readonly string[]) => `array[${xs.map((x) => `'${x}'`).join(', ')}]::text[]`;

/** USING / WITH CHECK expression of a policy; null when no role may do it. */
export function grantExpression(g: Grant | undefined): string | null {
  if (!g) return null;
  checkActions(g);
  const branches: string[] = [];
  for (const group of ROLE_GROUPS) {
    const sl = g[group];
    if (sl === undefined) continue;
    const s = scope(sl);
    const roles = rolesOf(group).filter((r) => gateOpen(r, g, s));
    if (!roles.length) continue;
    const conds = [GROUP_SQL[group]];
    if (!s.always) conds.push(`(select app.can_any(${arr(g.actions ?? [])}))`);
    if (s.pred !== 'true') conds.push(`(${s.pred})`);
    branches.push(`(${conds.join(' and ')})`);
  }
  if (g.anyone !== undefined) branches.push(g.anyone === 'true' ? 'true' : `(${g.anyone})`);
  if (!branches.length) return null;
  const body = branches.length === 1 ? branches[0]! : `(\n      ${branches.join('\n      or ')}\n    )`;
  return cached(`app.active() and ${body}`);
}

export function accessOps(a: Access): Op[] {
  return OPS.filter((op) => grantExpression(a[op]) !== null);
}
