/*
 * The HR family list (FAMILY_SPEC «HR видит членов семьи списком без медданных»): filters by employee and
 * relation and the free-text search, applied to the rows of GET /api/hr/family.
 */
import type { FamilyRelation } from '@mig/contracts';
import type { FamilyRequest, HrFamilyMember } from '@mig/contracts/dto';
import { FAMILY_RELATIONS } from '@mig/domain/family';
import { matchesSearch } from '@/shared/lib/searchNormalize';

export interface FamilyListFilter {
  employeeId?: string;
  relation?: string;
  q?: string;
}

export const isFamilyRelationFilter = (v: string | undefined): v is FamilyRelation => !!v && (FAMILY_RELATIONS as readonly string[]).includes(v);

/** Rows matching every set filter; the search looks at the person, the employee and the certificate number. */
export function filterFamily(rows: readonly HrFamilyMember[], f: FamilyListFilter): HrFamilyMember[] {
  const relation = isFamilyRelationFilter(f.relation) ? f.relation : undefined;
  return rows.filter(
    (m) =>
      (!f.employeeId || m.employeeId === f.employeeId) &&
      (!relation || m.relation === relation) &&
      matchesSearch(f.q ?? '', m.fullName, m.employeeName, m.certificateNumber),
  );
}

/** Employees that have someone in the list, by name: the options of the employee filter. */
export function employeesOf(rows: readonly HrFamilyMember[]): { id: string; name: string }[] {
  const byId = new Map<string, string>();
  for (const m of rows) if (!byId.has(m.employeeId)) byId.set(m.employeeId, m.employeeName);
  return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export const FAMILY_REQUEST_TABS = ['pending', 'approved', 'rejected'] as const;
export type FamilyRequestTab = (typeof FAMILY_REQUEST_TABS)[number];

/** App requests of one status, newest first. */
export function requestsOf(rows: readonly FamilyRequest[], status: FamilyRequestTab): FamilyRequest[] {
  return rows.filter((r) => r.status === status).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
