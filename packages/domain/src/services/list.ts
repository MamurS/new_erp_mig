/*
 * Lists: page, sort and filter parameters of the query string. Services take the query string itself
 * (`URLSearchParams`, or anything with `searchParams` such as a URL), not an HTTP request.
 */
import { LEGAL_FORMS, isLegalForm, legalNameCollator, type LegalFormCode } from '../config/legalForms';
import { DAY, isoDay, parseIso, tzIso } from '../lib/time';
import type { Collation, OrderBy, Where } from '../store/query';
import type { LogTable } from '../store/repo';

export type Qs = URLSearchParams | { searchParams: URLSearchParams };
/** The search parameters of a query string or a URL. */
export const sp = (qs: Qs): URLSearchParams => (qs instanceof URLSearchParams ? qs : qs.searchParams);

export function pageParams(qs: Qs): { page: number; pageSize: number } {
  const s = sp(qs);
  const page = Math.max(1, Math.min(10_000, Number(s.get('page')) || 1));
  const pageSize = Math.max(1, Math.min(100, Number(s.get('pageSize')) || 25));
  return { page, pageSize };
}

export function paginate<T>(items: T[], qs: Qs): { items: T[]; total: number; page: number; pageSize: number } {
  const { page, pageSize } = pageParams(qs);
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
}

export type SortGetter<T> = ((x: T) => string | number | null | undefined) & { collator?: Intl.Collator };

/** `?sort=premium:desc` over an allow-list of keys. */
export function sortBy<T>(items: T[], qs: Qs, allowed: Record<string, SortGetter<T>>, fallback?: string): T[] {
  const raw = sp(qs).get('sort') ?? fallback ?? '';
  const [key = '', dir = 'asc'] = raw.split(':');
  const get = allowed[key];
  if (!get) return items;
  const mul = dir === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (va === vb) return 0;
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul;
    if (get.collator) return get.collator.compare(String(va), String(vb)) * mul;
    return String(va).localeCompare(String(vb), 'ru') * mul;
  });
}

/** Sort key of a legal entity's name: case, quotes and apostrophe variants ignored (names carry no form). */
export function byLegalName<T>(get: (x: T) => string | null | undefined): SortGetter<T> {
  return Object.assign((x: T) => get(x), { collator: legalNameCollator });
}

/** Sort key of a legal form: the order of LEGAL_FORMS. */
export function byLegalForm<T>(get: (x: T) => LegalFormCode | null | undefined): SortGetter<T> {
  return (x: T) => {
    const f = get(x);
    return f ? LEGAL_FORMS.indexOf(f) : null;
  };
}

/** `?form=llc,jsc`: the selected legal forms, or null when the filter is off. Unknown codes are ignored. */
export function legalFormsParam(qs: Qs, key = 'form'): Set<LegalFormCode> | null {
  const codes = (sp(qs).get(key) ?? '').split(',').filter(isLegalForm);
  return codes.length ? new Set(codes) : null;
}

/** Keeps the rows whose legal form is selected in `?form=` (all rows when the filter is off). */
export function filterLegalForm<T>(items: T[], qs: Qs, get: (x: T) => LegalFormCode | null | undefined, key = 'form'): T[] {
  const forms = legalFormsParam(qs, key);
  if (!forms) return items;
  return items.filter((x) => {
    const f = get(x);
    return !!f && forms.has(f);
  });
}

// ---------------------------------------------------------------- lists in SQL (store/query.ts)

/** A sort key of a list: the field (or computed field) it orders by and how text compares. */
export interface SortKey<T> {
  field: keyof T & string;
  /** `ru` for the keys `sortBy` compared with localeCompare, `legal` for names of legal entities. */
  collate?: Collation;
  ifNull?: string | number;
}

/**
 * `?sort=premium:desc` over an allow-list of keys, as an order of the repositories (the SQL twin of `sortBy`: rows
 * without a value last, ties in storage order). An unknown key: no order (storage order), as `sortBy` left the rows.
 */
export function sortParam<T>(qs: Qs, allowed: Record<string, SortKey<T>>, fallback?: string): OrderBy<T> {
  const raw = sp(qs).get('sort') ?? fallback ?? '';
  const [key = '', dir = 'asc'] = raw.split(':');
  const k = Object.prototype.hasOwnProperty.call(allowed, key) ? allowed[key] : undefined;
  return k ? [{ ...k, dir: dir === 'desc' ? 'desc' : 'asc' }] : [];
}

/** `matchesSearch(term, …fields)` as a condition: any of the fields matches the search term. */
export function searchWhere<T>(term: string, fields: readonly (keyof T & string)[]): Where<T> {
  return { $or: fields.map((f) => ({ [f]: { search: term } }) as Where<T>) } as unknown as Where<T>;
}

/** `?form=llc,jsc` as a condition on a legal-form field (no condition when the filter is off). */
export function legalFormWhere<T>(qs: Qs, field: keyof T & string, key = 'form'): Where<T> {
  const forms = legalFormsParam(qs, key);
  return forms ? ({ [field]: { in: [...forms] } } as Where<T>) : ({} as Where<T>);
}

/** Conditions that must all hold (empty ones dropped). */
export function allOf<T>(...ws: (Where<T> | null | undefined | false | '')[]): Where<T> {
  const list = ws.filter((w): w is Where<T> => !!w && Object.keys(w).length > 0);
  return list.length === 0 ? ({} as Where<T>) : list.length === 1 ? list[0]! : ({ $and: list } as unknown as Where<T>);
}

/** Matches no row (a filter value that can never match). */
export const NOTHING = { $or: [] } as const;

/**
 * A moment as the bound of a `ts` column compared in SQL and in memory alike: `parseIso(x) >= ms` and
 * `parseIso(x) < ms` (whole seconds stored) hold exactly when `x >= bound` and `x < bound`.
 */
export const tsBound = (ms: number): string => tzIso(Math.ceil(ms / 1000) * 1000);
/** The bound for `parseIso(x) > ms` and `parseIso(x) <= ms` (`x > bound`, `x <= bound`). */
export const tsFloor = (ms: number): string => tzIso(Math.floor(ms / 1000) * 1000);

/** `[from, to)` of the Tashkent day `day` as bounds of a `ts` column; null when `day` is not a real day. */
export function dayRange(day: string): { gte: string; lt: string } | null {
  const from = parseIso(day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(from) || isoDay(from) !== day) return null;
  return { gte: tzIso(from), lt: tzIso(from + DAY) };
}

/** One page of a repository query: `?page=&pageSize=` as LIMIT/OFFSET, the total as COUNT. */
export async function pageOf<T, X>(repo: LogTable<T, X>, qs: Qs, q: { where?: Where<T & X>; orderBy?: OrderBy<T & X> }): Promise<{ items: T[]; total: number; page: number; pageSize: number }> {
  const { page, pageSize } = pageParams(qs);
  const items = await repo.list({ ...q, limit: pageSize, offset: (page - 1) * pageSize });
  const total = items.length < pageSize && (page === 1 || items.length > 0) ? (page - 1) * pageSize + items.length : await repo.count(q.where);
  return { items, total, page, pageSize };
}

/** `?q=` normalised for substring search. */
export function q(qs: Qs): string {
  return (sp(qs).get('q') ?? '').trim().toLowerCase().slice(0, 100);
}

/** A UUID path parameter; anything else is «not found». */
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
}
