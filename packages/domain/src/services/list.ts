/*
 * Lists: page, sort and filter parameters of the query string. Services take the query string itself
 * (`URLSearchParams`, or anything with `searchParams` such as a URL), not an HTTP request.
 */
import { LEGAL_FORMS, isLegalForm, legalNameCollator, type LegalFormCode } from '../config/legalForms';

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

/** `?q=` normalised for substring search. */
export function q(qs: Qs): string {
  return (sp(qs).get('q') ?? '').trim().toLowerCase().slice(0, 100);
}

/** A UUID path parameter; anything else is «not found». */
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
}
