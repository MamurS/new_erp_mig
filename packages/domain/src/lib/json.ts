/*
 * JSON comparison that does not depend on the order of object keys. Postgres `jsonb` stores keys in its own order
 * (by length, then bytes), so a value read back from the database and the same value built in code serialize
 * differently with JSON.stringify; the services compare values with these instead.
 */

/** JSON text with the keys of every object sorted (arrays keep their order; `undefined` members are dropped). */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return x;
    const o = x as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  });
}

/** Whether two values are the same JSON, whatever the order of their keys. */
export const sameJson = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
