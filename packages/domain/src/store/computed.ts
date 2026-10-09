/*
 * Computed fields of the list queries: values derived from a row (and from other tables) that lists filter and sort
 * by, so the page, the order and the total come from the database instead of from JavaScript over a whole table.
 * Each field has two definitions that must agree (the conformance test compares the answers, query.test.ts and
 * apps/api/src/listQueries.test.ts the values):
 * - `sql`: an expression over the columns of the table's row (the table's own name qualifies them in subqueries).
 *   It runs as the person under row-level security, like the services' own reads did; values the person's policies
 *   would hide come from the narrow facts (`app.fact_*`), as `views.ts` reads them;
 * - `mem`: the same value in JavaScript over the memory database (`prepare` runs once per query).
 * Rows never carry computed fields: they exist only in `where` and `orderBy`.
 */
import type { LegalFormCode } from '../config/legalForms';
import { LEGAL_FORMS } from '../config/legalForms';
import { FAMILY_RELATIONS } from '../family';
import { currentReserve } from '../services/reserve';
import type { AssistanceCaseRow, ClaimRow, ClientRow, Db, InsuredRow } from './db';
import type { KeyedName, LogName, RowOf } from './repo';

export type ComputedKind = 'int' | 'numeric' | 'text' | 'bool';

export interface ComputedDef<R = never> {
  kind: ComputedKind;
  sql: string;
  mem: (db: Db) => (row: R) => unknown;
}

/** Computed fields by collection (their TypeScript types, for `Where`/`OrderBy`). */
export interface ComputedFields {
  clients: { legalFormOrd: number; insuredCount: number };
  clinics: { legalFormOrd: number };
  assistances: { legalFormOrd: number };
  policies: { clientLegalForm: LegalFormCode; clientLegalFormOrd: number };
  claims: { reserve: number; hasPendingDecision: boolean; appealOpen: boolean; flagged: boolean };
  insured: { activeFamily: number; pendingExclusion: boolean };
  cases: { resolved: boolean };
}

export type ComputedOf<N> = N extends keyof ComputedFields ? ComputedFields[N] : object;

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const textArray = (xs: readonly string[]) => `array[${xs.map(lit).join(', ')}]::text[]`;

/** Position of a legal form in LEGAL_FORMS (`byLegalForm` of the lists), 0-based; no form — no value. */
const legalFormOrdSql = (expr: string) => `(array_position(${textArray(LEGAL_FORMS)}, ${expr}) - 1)`;
const legalFormOrd = (f: LegalFormCode | null | undefined): number | null => (f ? LEGAL_FORMS.indexOf(f) : null);

function countBy<T>(rows: readonly T[], key: (r: T) => unknown, when: (r: T) => boolean = () => true): Map<unknown, number> {
  const m = new Map<unknown, number>();
  for (const r of rows) if (when(r)) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return m;
}

type Defs = { [N in keyof ComputedFields]: { [F in keyof ComputedFields[N]]: ComputedDef<N extends KeyedName | LogName ? RowOf<N> : never> } };

export const COMPUTED: Defs = {
  clients: {
    legalFormOrd: { kind: 'int', sql: legalFormOrdSql('legal_form'), mem: () => (c: ClientRow) => legalFormOrd(c.legalForm) },
    // The client card's counter (views.ts insuredCountFor → app.fact_client_insured_count), for all rows at once.
    insuredCount: {
      kind: 'int',
      sql: "coalesce(((select app.list_client_insured_counts()) ->> clients.id::text)::int, 0)",
      mem: (db) => {
        const m = countBy(db.insured, (i) => i.clientId, (i) => i.status === 'active');
        return (c: ClientRow) => m.get(c.id) ?? 0;
      },
    },
  },
  clinics: {
    legalFormOrd: { kind: 'int', sql: legalFormOrdSql('legal_form'), mem: () => (c) => legalFormOrd(c.legalForm) },
  },
  assistances: {
    legalFormOrd: { kind: 'int', sql: legalFormOrdSql('legal_form'), mem: () => (a) => legalFormOrd(a.legalForm) },
  },
  policies: {
    // views.ts clientLegalFormOf → app.fact_client_legal_form.
    clientLegalForm: {
      kind: 'text',
      sql: 'app.fact_client_legal_form(policies.client_id)',
      mem: (db) => {
        const m = new Map(db.clients.map((c) => [c.id, c.legalForm]));
        return (p) => m.get(p.clientId) ?? null;
      },
    },
    clientLegalFormOrd: {
      kind: 'int',
      sql: legalFormOrdSql('app.fact_client_legal_form(policies.client_id)'),
      mem: (db) => {
        const m = new Map(db.clients.map((c) => [c.id, c.legalForm]));
        return (p) => legalFormOrd(m.get(p.clientId));
      },
    },
  },
  claims: {
    // The current reserve (services/reserve.ts `currentReserve`) — app.claim_reserve over the same columns.
    reserve: {
      kind: 'numeric',
      sql: 'app.claim_reserve(claims.history, claims.reserve_history, claims.amount_claimed, claims.amount_approved)',
      mem: () => (c: ClaimRow) => currentReserve(c),
    },
    hasPendingDecision: { kind: 'bool', sql: '(claims.pending_decision is not null)', mem: () => (c: ClaimRow) => !!c.pendingDecision },
    appealOpen: { kind: 'bool', sql: "coalesce(claims.appeal ->> 'status' = 'open', false)", mem: () => (c: ClaimRow) => c.appeal?.status === 'open' },
    // A fraud flag that is not dismissed.
    flagged: {
      kind: 'bool',
      sql: "exists (select 1 from jsonb_array_elements(case when jsonb_typeof(claims.flags) = 'array' then claims.flags else '[]'::jsonb end) f where not coalesce((f ->> 'dismissed')::boolean, false))",
      mem: () => (c: ClaimRow) => !!c.flags?.some((f) => !f.dismissed),
    },
  },
  insured: {
    // Active family members of an employee (the «Семья» column of HR: familyBrief, active ones).
    activeFamily: {
      kind: 'int',
      sql: `(case when insured.relation = 'employee' then (select count(*)::int from public.insured f where f.principal_id = insured.id and f.relation = any(${textArray(FAMILY_RELATIONS)}) and f.status = 'active') else 0 end)`,
      mem: (db) => {
        const fam = new Set<string>(FAMILY_RELATIONS);
        const m = countBy(db.insured, (f) => f.principalId, (f) => fam.has(f.relation) && f.status === 'active');
        return (i: InsuredRow) => (i.relation === 'employee' ? (m.get(i.id) ?? 0) : 0);
      },
    },
    // A pending exclusion request (HR's «Заявки»: the person is leaving).
    pendingExclusion: {
      kind: 'bool',
      sql: "exists (select 1 from public.policy_changes c where c.insured_id = insured.id and c.kind = 'exclude' and c.status = 'pending')",
      mem: (db) => {
        const s = new Set(db.policyChanges.filter((c) => c.kind === 'exclude' && c.status === 'pending').map((c) => c.insuredId));
        return (i: InsuredRow) => s.has(i.id);
      },
    },
  },
  cases: {
    // The assistance desk lists open cases first.
    resolved: { kind: 'bool', sql: "(cases.status = 'resolved')", mem: () => (c: AssistanceCaseRow) => c.status === 'resolved' },
  },
};

/** The computed fields of a collection (none for most). */
export function computedOf(collection: string): Readonly<Record<string, ComputedDef<unknown>>> {
  return ((COMPUTED as unknown as Record<string, Record<string, ComputedDef<unknown>>>)[collection] ?? {}) as Readonly<Record<string, ComputedDef<unknown>>>;
}
