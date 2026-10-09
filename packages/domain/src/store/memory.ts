/*
 * The memory implementation of the repositories over the in-memory database (`Db`): the mock server's
 * storage. Rows go in and out as copies, so a service that changes a row without `update` loses the
 * change here exactly as it would in Postgres. Array order is storage order (`_pos` in Postgres).
 */
import type { Db } from './db';
import { applyQuery, fieldsOf, matches, pick, type FieldGetter, type Query, type Where } from './query';
import { computedOf } from './computed';
import {
  LOG_TABLES,
  NESTED_KEYS,
  TABLE_KEYS,
  type InsertOptions,
  type LogTable,
  type MapStore,
  type NestedRows,
  type Repos,
  type SeqName,
  type SetStore,
  type Table,
} from './repo';
import { genericFacts } from './facts';

const copy = <T>(v: T): T => structuredClone(v);

/**
 * Applies a patch to the stored row in place (code that still holds the row sees the change, as the
 * mock's handlers did); `undefined` removes an optional field.
 */
function merge<T>(row: T, patch: Partial<T>): T {
  const out = row as Record<string, unknown>;
  for (const [k, v] of Object.entries(copy(patch))) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return row;
}

interface Slot<T> {
  rows(): T[];
  /** The whole database (computed fields read other collections). */
  db(): Db;
}

/** Reads the fields of a query: computed fields of the collection are prepared once per query. */
function getterFor(name: string, slot: Slot<unknown>, used: Set<string>): FieldGetter | undefined {
  const defs = computedOf(name);
  const fns = new Map<string, (row: unknown) => unknown>();
  for (const f of used) {
    const d = defs[f];
    if (d) fns.set(f, d.mem(slot.db()));
  }
  if (!fns.size) return undefined;
  return (row, field) => {
    const fn = fns.get(field);
    return fn ? fn(row) : (row as Record<string, unknown>)[field];
  };
}

function logTable<T>(name: string, slot: Slot<T>): LogTable<T> {
  const insertRows = (rows: readonly T[], opts?: InsertOptions) => {
    const arr = slot.rows();
    const items = rows.map(copy);
    if (opts?.at === 'start') arr.unshift(...items);
    else arr.push(...items);
  };
  const run = (q: Query<T> | undefined) => applyQuery(slot.rows(), q, getterFor(name, slot as Slot<unknown>, fieldsOf(q)));
  const filter = (where: Where<T> | undefined) => {
    const get = getterFor(name, slot as Slot<unknown>, fieldsOf({ where } as Query<T>));
    return slot.rows().filter((r) => matches(r, where, get));
  };
  return {
    name,
    async list(q?: Query<T>) {
      return run(q).map((r) => copy(pick(r, q?.fields)));
    },
    async select(fields, q) {
      return run({ ...q, fields } as Query<T>).map((r) => copy(pick(r, fields)));
    },
    async first(q?: Query<T>) {
      const r = run({ ...q, limit: 1 })[0];
      return r === undefined ? null : copy(pick(r, q?.fields));
    },
    async count(where?: Where<T>) {
      return filter(where).length;
    },
    async sum(field, where) {
      return filter(where).reduce((s, r) => s + (Number((r as Record<string, unknown>)[field]) || 0), 0);
    },
    async exists(where: Where<T>) {
      return filter(where).length > 0;
    },
    async insert(row: T, opts?: InsertOptions) {
      insertRows([row], opts);
      return copy(row);
    },
    async insertMany(rows: readonly T[], opts?: InsertOptions) {
      insertRows(rows, opts);
    },
    async updateWhere(where: Where<T>, patch: Partial<T>) {
      const arr = slot.rows();
      let n = 0;
      for (let i = 0; i < arr.length; i++) {
        if (!matches(arr[i], where)) continue;
        merge(arr[i] as T, patch);
        n++;
      }
      return n;
    },
    async removeWhere(where: Where<T>) {
      const arr = slot.rows();
      const keep = arr.filter((r) => !matches(r, where));
      const n = arr.length - keep.length;
      if (n) arr.splice(0, arr.length, ...keep);
      return n;
    },
  };
}

function table<T, K extends PropertyKey>(name: string, key: K, slot: Slot<T>): Table<T, K> {
  const keyOf = (r: T) => (r as Record<PropertyKey, unknown>)[key];
  const index = (k: unknown) => slot.rows().findIndex((r) => keyOf(r) === k);
  const base = logTable(name, slot);
  return {
    ...base,
    key,
    async get(k) {
      const r = slot.rows().find((x) => keyOf(x) === k);
      return r === undefined ? null : copy(r);
    },
    async getMany(keys) {
      const set = new Set<unknown>(keys);
      return slot.rows().filter((r) => set.has(keyOf(r))).map(copy);
    },
    async update(k, patch) {
      const i = index(k);
      if (i < 0) throw new Error(`${name}: no row ${String(k)}`);
      return copy(merge(slot.rows()[i] as T, patch));
    },
    async put(row, opts) {
      const i = index(keyOf(row));
      if (i >= 0) {
        const stored = slot.rows()[i] as Record<string, unknown>;
        for (const k of Object.keys(stored)) delete stored[k];
        Object.assign(stored, copy(row));
      } else await base.insert(row, opts);
      return copy(row);
    },
    async remove(k) {
      const i = index(k);
      if (i < 0) return false;
      slot.rows().splice(i, 1);
      return true;
    },
  };
}

const SEQ_FIELD: Record<SeqName, 'kpSeq' | 'guaranteeSeq' | 'caseSeq' | 'dealSeq' | 'contractSeq'> = {
  kp: 'kpSeq',
  guarantee: 'guaranteeSeq',
  case: 'caseSeq',
  deal: 'dealSeq',
  contract: 'contractSeq',
};

const NESTED_SLOT: { [N in keyof NestedRows]: (d: Db) => NestedRows[N][] } = {
  dmsParamChanges: (d) => d.dmsParams.changes,
  aiChanges: (d) => d.ai.changes,
  aiLogs: (d) => d.ai.logs,
  helpQuestions: (d) => d.help.questions,
};

/** Repositories over the database returned by `db()` (read on every call: a reset replaces it). */
export function memoryRepos(db: () => Db): Repos {
  const out: Record<string, unknown> = {};
  const rec = db as unknown as () => Record<string, unknown[]>;
  for (const [name, key] of Object.entries(TABLE_KEYS)) out[name] = table(name, key, { rows: () => rec()[name]!, db });
  for (const name of LOG_TABLES) out[name] = logTable(name, { rows: () => rec()[name]!, db });
  for (const [name, key] of Object.entries(NESTED_KEYS)) {
    const get = NESTED_SLOT[name as keyof NestedRows] as (d: Db) => unknown[];
    out[name] = table(name, key, { rows: () => get(db()), db });
  }
  const flags: MapStore<string> = {
    async get(k) {
      return db().ai.rebillFlags[k];
    },
    async all() {
      return { ...db().ai.rebillFlags };
    },
    async set(k, v) {
      db().ai.rebillFlags[k] = v;
    },
    async delete(k) {
      delete db().ai.rebillFlags[k];
    },
  };
  const statementKeys: SetStore = {
    async has(k) {
      return db().statementKeys.includes(k);
    },
    async add(k) {
      if (!db().statementKeys.includes(k)) db().statementKeys.push(k);
    },
  };
  const base: Omit<Repos, 'facts'> = {
    ...(out as Omit<Repos, 'aiRebillFlags' | 'statementKeys' | 'seq' | 'one' | 'facts'>),
    aiRebillFlags: flags,
    statementKeys,
    seq: {
      async next(name) {
        const d = db();
        d[SEQ_FIELD[name]] += 1;
        return d[SEQ_FIELD[name]];
      },
    },
    one: {
      async dmsParamValues() {
        return copy(db().dmsParams.values);
      },
      async setDmsParamValues(v) {
        db().dmsParams.values = copy(v);
      },
      async aiSettings() {
        return copy(db().ai.settings);
      },
      async setAiSettings(v) {
        db().ai.settings = copy(v);
      },
      async integrationsSeed() {
        return db().integrationsSeed;
      },
    },
  };
  return { ...base, facts: genericFacts(base) };
}
