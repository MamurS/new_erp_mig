/*
 * The query language of the repositories: comparisons on top-level fields (and on computed fields of a table,
 * store/computed.ts), `$or`/`$and`, a text search, an order with collations, a page and a projection. The memory
 * store evaluates it in JavaScript, the Postgres store turns it into SQL, so both return the same rows in the same
 * order: storage order (`_pos` in Postgres, array order in memory) is the last, unique key of every order.
 */
import { legalNameCollator } from '../config/legalForms';
import { searchKey } from '../lib/searchNormalize';

/** Comparison of one field. A plain value means equality; `undefined` and `null` are «no value». */
export interface Op<V> {
  eq?: V | null;
  ne?: V | null;
  in?: readonly V[];
  notIn?: readonly V[];
  gt?: V;
  gte?: V;
  lt?: V;
  lte?: V;
  /** true: the field has no value; false: it has one. */
  isNull?: boolean;
  /** Case-insensitive substring of a string field. */
  contains?: string;
  /**
   * The search of the lists (lib/searchNormalize.ts `matchesSearch`): the `searchKey` of the term is a substring of
   * the `searchKey` of the field. An empty key matches every row (also rows without a value). Postgres compares the
   * generated column `<column>_sk` (schema `search` fields, trigram index).
   */
  search?: string;
}

/** Conditions on an array field (`text[]`). */
export interface ArrayOp<E> {
  /** The array holds the value. */
  includes: E;
}

type Scalar = string | number | boolean | null | undefined;
type FieldCond<V> = [Exclude<V, undefined>] extends [Scalar]
  ? V | null | Op<Exclude<V, undefined | null>>
  : [Exclude<V, undefined | null>] extends [readonly (infer E)[]]
    ? ArrayOp<E>
    : never;

/** Conditions on scalar top-level fields, all of which must hold; `$or` — any of the alternatives, `$and` — all. */
export type Where<T> = { [K in keyof T]?: FieldCond<T[K]> } & {
  $or?: readonly Where<T>[];
  $and?: readonly Where<T>[];
};

/**
 * How text compares in an order: `C` — code points (default); `ru` — `localeCompare(…, 'ru')` (ICU `ru`, Postgres
 * collation `app.ru`); `legal` — names of legal entities (`legalNameCollator`: case, quotes and punctuation ignored,
 * Postgres `app.legal_name`). Both ICU collations are non-deterministic: strings ICU calls equal are a tie, broken by
 * storage order as in a stable JavaScript sort.
 */
export type Collation = 'C' | 'ru' | 'legal';

export interface OrderTerm<T> {
  field: keyof T & string;
  dir?: 'asc' | 'desc';
  /** Rows without a value: last in either direction (default) or first. */
  nulls?: 'first' | 'last';
  collate?: Collation;
  /** The value that rows without one sort as (`program ?? ''`). */
  ifNull?: string | number;
}
export type OrderItem<T> = readonly [keyof T & string, 'asc' | 'desc'] | OrderTerm<T>;
export type OrderBy<T> = readonly OrderItem<T>[];

/** A query over rows `T` whose conditions and order may also use the computed fields `X` of the table. */
export interface Query<T, X = object> {
  where?: Where<T & X>;
  /** Storage order breaks ties (always the last key). */
  orderBy?: OrderBy<T & X>;
  /**
   * `desc`: ties in reverse storage order (the latest stored first) — what the lists' «newest first» sorts written as
   * `(a.at < b.at ? 1 : -1)` gave for equal times. Default `asc`.
   */
  ties?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  /** Only these fields of each row (lists that need a few columns: no decryption of identity data). */
  fields?: readonly (keyof T & string)[];
}

const OP_KEYS = new Set(['eq', 'ne', 'in', 'notIn', 'gt', 'gte', 'lt', 'lte', 'isNull', 'contains', 'search', 'includes']);

export function isOp(v: unknown): v is Op<unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).every((k) => OP_KEYS.has(k));
}

/** An order item as a term. */
export function orderTerm<T>(o: OrderItem<T>): OrderTerm<T> {
  return Array.isArray(o) ? { field: o[0] as keyof T & string, dir: o[1] as 'asc' | 'desc' } : (o as OrderTerm<T>);
}

/** Fields a query uses in its conditions and its order (to know which computed fields it needs). */
export function fieldsOf<T>(q: Query<T> | undefined): Set<string> {
  const out = new Set<string>();
  const walk = (w: Where<unknown> | undefined) => {
    if (!w) return;
    for (const [k, v] of Object.entries(w)) {
      if (k === '$or' || k === '$and') for (const x of v as Where<unknown>[]) walk(x);
      else out.add(k);
    }
  };
  walk(q?.where as Where<unknown>);
  for (const o of q?.orderBy ?? []) out.add(orderTerm(o).field);
  return out;
}

const none = (v: unknown) => v === undefined || v === null;

function cmp(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

const ruCollator = new Intl.Collator('ru');

function collated(a: unknown, b: unknown, c: Collation | undefined): number {
  if (!c || c === 'C' || (typeof a === 'number' && typeof b === 'number')) return cmp(a, b);
  return (c === 'ru' ? ruCollator : legalNameCollator).compare(String(a), String(b));
}

/** Reads a field of a row (computed fields through the getter of the query). */
export type FieldGetter = (row: unknown, field: string) => unknown;
const plain: FieldGetter = (row, field) => (row as Record<string, unknown>)[field];

function test(value: unknown, cond: unknown): boolean {
  if (!isOp(cond)) return none(cond) ? none(value) : value === cond;
  const op = cond;
  if ('eq' in op && !(none(op.eq) ? none(value) : value === op.eq)) return false;
  if ('ne' in op && (none(op.ne) ? none(value) : value === op.ne)) return false;
  if (op.in && (none(value) || !op.in.includes(value))) return false;
  if (op.notIn && !none(value) && op.notIn.includes(value)) return false;
  if (op.isNull !== undefined && none(value) !== op.isNull) return false;
  if (op.contains !== undefined && (typeof value !== 'string' || !value.toLowerCase().includes(op.contains.toLowerCase()))) return false;
  if ('includes' in op && !(Array.isArray(value) && value.includes((op as unknown as ArrayOp<unknown>).includes))) return false;
  if (op.search !== undefined) {
    const key = searchKey(op.search);
    if (key && (typeof value !== 'string' || !searchKey(value).includes(key))) return false;
  }
  for (const k of ['gt', 'gte', 'lt', 'lte'] as const) {
    if (op[k] === undefined) continue;
    if (none(value)) return false;
    const c = cmp(value, op[k]);
    if ((k === 'gt' && !(c > 0)) || (k === 'gte' && !(c >= 0)) || (k === 'lt' && !(c < 0)) || (k === 'lte' && !(c <= 0))) return false;
  }
  return true;
}

export function matches<T>(row: T, where: Where<T> | undefined, get: FieldGetter = plain): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (k === '$or') {
      if (!(cond as Where<T>[]).some((w) => matches(row, w, get))) return false;
    } else if (k === '$and') {
      if (!(cond as Where<T>[]).every((w) => matches(row, w, get))) return false;
    } else if (!test(get(row, k), cond)) return false;
  }
  return true;
}

export function compareBy<T>(orderBy: OrderBy<T>, get: FieldGetter = plain): (a: T, b: T) => number {
  const terms = orderBy.map(orderTerm);
  return (a, b) => {
    for (const t of terms) {
      let va = get(a, t.field);
      let vb = get(b, t.field);
      if (t.ifNull !== undefined) {
        if (none(va)) va = t.ifNull;
        if (none(vb)) vb = t.ifNull;
      }
      if (none(va) && none(vb)) continue;
      const nullsFirst = t.nulls === 'first';
      if (none(va)) return nullsFirst ? -1 : 1;
      if (none(vb)) return nullsFirst ? 1 : -1;
      const c = collated(va, vb, t.collate);
      if (c !== 0) return t.dir === 'desc' ? -c : c;
    }
    return 0;
  };
}

/** Filters, orders (stable: storage order breaks ties) and pages rows in JavaScript. */
export function applyQuery<T>(rows: readonly T[], q: Query<T> = {}, get: FieldGetter = plain): T[] {
  let out = rows.filter((r) => matches(r, q.where as Where<T>, get));
  if (q.ties === 'desc') {
    const by = q.orderBy?.length ? compareBy(q.orderBy as OrderBy<T>, get) : () => 0;
    out = out
      .map((r, i) => ({ r, i }))
      .sort((a, b) => by(a.r, b.r) || b.i - a.i)
      .map((x) => x.r);
  } else if (q.orderBy?.length) out = out.sort(compareBy(q.orderBy as OrderBy<T>, get));
  const offset = q.offset ?? 0;
  if (offset || q.limit !== undefined) out = out.slice(offset, q.limit === undefined ? undefined : offset + q.limit);
  return out;
}

/** Only the given fields of a row (a projection). */
export function pick<T>(row: T, fields: readonly string[] | undefined): T {
  if (!fields) return row;
  const out: Record<string, unknown> = {};
  for (const f of fields) if (f in (row as object)) out[f] = (row as Record<string, unknown>)[f];
  return out as T;
}
