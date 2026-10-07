/*
 * Audience of help content. Markers in docs/help/USER_GUIDE.*.md: `<!-- audience: staff hr -->` — a
 * space-separated list of tokens; the fragment is visible to a role matched by ANY token. Nested levels
 * (article → subsection → block → list item / table row) narrow: a fragment is visible only if every
 * enclosing level is visible too.
 *
 * Vocabulary (roles from src/shared/types Role):
 * - `all`          — every role;
 * - `staff`        — every MIG employee (StaffRole);
 * - `staff:admin`  — the MIG administrator only (`staff:<StaffRole>` in general);
 * - `hr`           — HR of a client company;
 * - `insured`      — the insured person (the app);
 * - `clinic`       — clinic registrar and clinic administrator (`clinic:admin`, `clinic:registrar` — one of them);
 * - `assist`       — every assistance role (`assist:operator`, `assist:doctor`, `assist:billing`, `assist:admin`);
 * - `demo`         — only in a demo build (VITE_DEMO_MODE); alone it means every role, with other tokens it
 *                    narrows them. A build without the flag does not contain such articles at all.
 */
import type { Role, StaffRole } from '@/shared/types';
import { ASSISTANCE_ROLES, CLINIC_ROLES, STAFF_ROLES } from '@/shared/domain/labels';

export const ALL_ROLES: readonly Role[] = [...STAFF_ROLES, 'hr', 'insured', ...CLINIC_ROLES, ...ASSISTANCE_ROLES];

export interface Audience {
  /** Roles the fragment is for. */
  roles: ReadonlySet<Role>;
  /** Visible only in a demo build. */
  demoOnly: boolean;
}

export const AUDIENCE_ALL: Audience = { roles: new Set(ALL_ROLES), demoOnly: false };

const ASSIST_SHORT: Record<string, Role> = { operator: 'asst_operator', doctor: 'asst_doctor', billing: 'asst_billing', admin: 'asst_admin' };
const CLINIC_SHORT: Record<string, Role> = { admin: 'clinic_admin', registrar: 'clinic_registrar' };

/** Roles of one token, or null for an unknown token. */
export function rolesOfToken(token: string): readonly Role[] | null {
  if (token === 'all' || token === 'demo') return ALL_ROLES;
  if (token === 'staff') return STAFF_ROLES;
  if (token === 'hr' || token === 'insured') return [token];
  if (token === 'clinic') return CLINIC_ROLES;
  if (token === 'assist') return ASSISTANCE_ROLES;
  const [head, tail = ''] = token.split(':');
  if (head === 'staff' && (STAFF_ROLES as readonly string[]).includes(tail)) return [tail as StaffRole];
  if (head === 'clinic' && CLINIC_SHORT[tail]) return [CLINIC_SHORT[tail]];
  if (head === 'assist' && ASSIST_SHORT[tail]) return [ASSIST_SHORT[tail]];
  return null;
}

export class AudienceError extends Error {}

/** Parses the token list of a marker; throws on an unknown or empty list (the guide must be fixed). */
export function parseAudience(spec: string): Audience {
  const tokens = spec.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) throw new AudienceError('empty audience');
  const demoOnly = tokens.includes('demo');
  const rest = tokens.filter((t) => t !== 'demo');
  const roles = new Set<Role>();
  for (const t of rest.length ? rest : ['all']) {
    const r = rolesOfToken(t);
    if (!r) throw new AudienceError(`unknown audience token: ${t}`);
    for (const x of r) roles.add(x);
  }
  return { roles, demoOnly };
}

export function audienceVisible(a: Audience, role: Role, demo: boolean): boolean {
  return a.roles.has(role) && (!a.demoOnly || demo);
}

/** Narrowing of a nested level. */
export function intersectAudience(outer: Audience, inner: Audience): Audience {
  return { roles: new Set([...inner.roles].filter((r) => outer.roles.has(r))), demoOnly: outer.demoOnly || inner.demoOnly };
}

/** A marker that is a whole line: `<!-- audience: … -->`. */
export const MARKER_LINE = /^\s*<!--\s*audience:\s*([^>]*?)\s*-->\s*$/;
/** Closes a block marker. */
export const MARKER_CLOSE = /^\s*<!--\s*\/audience\s*-->\s*$/;
/** A marker at the end of a list item or a table row. */
export const MARKER_TRAILING = /\s*<!--\s*audience:\s*([^>]*?)\s*-->\s*$/;
/** Any other HTML comment line (notes for editors): ignored. */
export const COMMENT_LINE = /^\s*<!--.*-->\s*$/;
