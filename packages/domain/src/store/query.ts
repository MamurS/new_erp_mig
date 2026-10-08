/*
 * The query language of the repositories: equality and a few comparisons on top-level fields, an order
 * and a page. The memory store evaluates it in JavaScript, the Postgres store turns it into SQL, so
 * both return the same rows in the same order (storage order breaks ties: `_pos` in Postgres).
 */

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
}

type Scalar = string | number | boolean | null | undefined;
type FieldCond<V> = [Exclude<V, undefined>] extends [Scalar] ? V | null | Op<Exclude<V, undefined | null>> : never;

/** Conditions on scalar top-level fields, all of which must hold. */
export type Where<T> = { [K in keyof T]?: FieldCond<T[K]> };

export type OrderBy<T> = readonly (readonly [keyof T & string, 'asc' | 'desc'])[];

export interface Query<T> {
  where?: Where<T>;
  /** Rows without a value come last in either direction; ties keep storage order. */
  orderBy?: OrderBy<T>;
  limit?: number;
  offset?: number;
}

const OP_KEYS = new Set(['eq', 'ne', 'in', 'notIn', 'gt', 'gte', 'lt', 'lte', 'isNull', 'contains']);

export function isOp(v: unknown): v is Op<unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).every((k) => OP_KEYS.has(k));
}

const none = (v: unknown) => v === undefined || v === null;

function cmp(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function test(value: unknown, cond: unknown): boolean {
  if (!isOp(cond)) return none(cond) ? none(value) : value === cond;
  const op = cond;
  if ('eq' in op && !(none(op.eq) ? none(value) : value === op.eq)) return false;
  if ('ne' in op && (none(op.ne) ? none(value) : value === op.ne)) return false;
  if (op.in && (none(value) || !op.in.includes(value))) return false;
  if (op.notIn && !none(value) && op.notIn.includes(value)) return false;
  if (op.isNull !== undefined && none(value) !== op.isNull) return false;
  if (op.contains !== undefined && (typeof value !== 'string' || !value.toLowerCase().includes(op.contains.toLowerCase()))) return false;
  for (const k of ['gt', 'gte', 'lt', 'lte'] as const) {
    if (op[k] === undefined) continue;
    if (none(value)) return false;
    const c = cmp(value, op[k]);
    if ((k === 'gt' && !(c > 0)) || (k === 'gte' && !(c >= 0)) || (k === 'lt' && !(c < 0)) || (k === 'lte' && !(c <= 0))) return false;
  }
  return true;
}

export function matches<T>(row: T, where: Where<T> | undefined): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (!test((row as Record<string, unknown>)[k], cond)) return false;
  }
  return true;
}

export function compareBy<T>(orderBy: OrderBy<T>): (a: T, b: T) => number {
  return (a, b) => {
    for (const [k, dir] of orderBy) {
      const va = (a as Record<string, unknown>)[k];
      const vb = (b as Record<string, unknown>)[k];
      if (none(va) && none(vb)) continue;
      if (none(va)) return 1;
      if (none(vb)) return -1;
      const c = cmp(va, vb);
      if (c !== 0) return dir === 'desc' ? -c : c;
    }
    return 0;
  };
}

/** Filters, orders (stable: storage order breaks ties) and pages rows in JavaScript. */
export function applyQuery<T>(rows: readonly T[], q: Query<T> = {}): T[] {
  let out = rows.filter((r) => matches(r, q.where));
  if (q.orderBy?.length) out = out.sort(compareBy(q.orderBy));
  const offset = q.offset ?? 0;
  if (offset || q.limit !== undefined) out = out.slice(offset, q.limit === undefined ? undefined : offset + q.limit);
  return out;
}
