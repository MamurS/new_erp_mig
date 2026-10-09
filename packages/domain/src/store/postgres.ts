/*
 * The Postgres implementation of the repositories (BACKEND_SPEC §4.2) over the schema generated from
 * schema.ts (docs/backend/DATABASE.md). SQL is built here; the driver lives in the API behind the tiny
 * `SqlSession` interface (one request transaction).
 *
 * Behaviour matches the memory implementation exactly (the conformance test compares them):
 * - the Where/Query DSL becomes parameterized SQL; `contains` is ILIKE with escaping; text compares and sorts
 *   by code points (COLLATE "C"); rows without a value come last in either direction; ties keep storage order
 *   (`_pos`), and `insert(…, { at: 'start' })` stores a negative `_pos`;
 * - rows come back like memory rows: `ts` as `YYYY-MM-DDTHH:mm:ss+05:00`, `date` as `YYYY-MM-DD`, `bigint` and
 *   `epoch` as numbers, json as values, SQL NULL as a missing property (or `null` for `T | null` fields);
 * - identity data is sealed with `PiiCrypto` (ciphertext, key version, search HMAC, mask); payout cards keep
 *   only the mask; passwords are not stored (Supabase Auth); file bytes go to the blob store (Supabase Storage)
 *   under the row's id, and the row keeps the bucket, the object name, the SHA-256 and the size.
 *
 * Row-level security: user repositories run as `authenticated` with the person's claims. Statements that RLS
 * reserves to the system by design (docs/backend/RLS.md) run privileged in the same transaction:
 * - every operation on a table with no policy at all (sessions, sign-in challenges, rate-limit counters,
 *   partner tokens, idempotency keys: the API's own state);
 * - inserts into a table no role may insert into (append-only side-effect logs written by the API);
 * - reading the secret columns (ciphertexts of identity data, partner secrets) of rows the person's RLS has
 *   already returned: the API decrypts them; the services mask them on the way out.
 * Anything else RLS does not allow fails loudly (`RlsDenied`), never silently: a write whose visible rows were
 * not all changed is an error.
 */
import { bucketOf, sha256OfBytes, type BlobStore, type BucketId } from './blob';
import type { Db, FileRow } from './db';
import { piiMask, type PiiCrypto } from './pii';
import { isOp, type Op, type Query, type Where } from './query';
import type { InsertOptions, LogTable, MapStore, Repos, SeqName, SetStore, Table } from './repo';
import { TABLES, sequenceName, type TableSpec } from './schema';
import { fieldMapping, keyColumn, physicalColumns, type FieldMapping } from './sql/physical';
import { qi } from './columns';
import { maskCard } from '../lib/mask';
import { genericFacts } from './facts';
import { pgFacts } from './postgresFacts';

export interface SqlResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

/** A connection that runs one parameterized statement (`$1`, `$2`, …). */
export interface Sql {
  query(text: string, params?: readonly unknown[]): Promise<SqlResult>;
}

/**
 * The connection of one request transaction. `query` runs as the transaction's role (`authenticated` with
 * the person's claims, or the service role for system work); `privileged` runs `fn` as the service role
 * (RLS bypass) and switches back, without other statements of the request in between.
 */
export interface SqlSession extends Sql {
  privileged<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
}

export interface PgReposOptions {
  crypto: PiiCrypto;
  /** System repositories: every statement privileged (sign-in, jobs, the partner API, `ctx.system`). */
  privileged?: boolean;
  /**
   * DEV/CI ONLY (`DEMO_PASSWORD`): the virtual `password` field of accounts reads as this value, so the demo
   * sign-in works without Supabase Auth. Part 2 removes it (passwords live in Supabase Auth).
   */
  demoPassword?: string;
  /** Where file bytes live (Supabase Storage in the API). Without it the bytes of new files are not kept. */
  blobs?: BlobStore;
}

/** A statement that row-level security did not let through (a service/RLS mismatch: a bug to fix). */
export class RlsDenied extends Error {
  constructor(table: string, op: string) {
    super(`Row-level security denied ${op} on ${table}`);
    this.name = 'RlsDenied';
  }
}

type Rec = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const none = (v: unknown) => v === undefined || v === null;

const CAST: Record<string, string> = {
  uuid: 'uuid',
  text: 'text',
  enum: 'text',
  int: 'integer',
  bigint: 'bigint',
  epoch: 'bigint',
  float: 'double precision',
  bool: 'boolean',
  date: 'date',
  ts: 'timestamptz',
  json: 'jsonb',
  textArray: 'text[]',
};

/** Builds the parameter list of one statement. */
class Params {
  readonly values: unknown[] = [];
  add(v: unknown, cast?: string): string {
    this.values.push(v);
    return `$${this.values.length}${cast ? `::${cast}` : ''}`;
  }
}

/** How a table is read and written. */
class TableMap {
  readonly fields: FieldMapping[];
  readonly byField = new Map<string, FieldMapping>();
  readonly key: string | null;
  readonly keyField: FieldMapping | null;
  readonly secret = new Set<string>();
  readonly table: string;
  /** Operations no role may do: privileged by design (see the header). */
  readonly systemOnly: boolean;
  readonly systemInsert: boolean;

  constructor(readonly spec: TableSpec) {
    this.table = `public.${spec.table}`;
    this.fields = Object.entries(spec.columns).map(([f, c]) => fieldMapping(f, c));
    for (const m of this.fields) this.byField.set(m.field, m);
    this.key = spec.key === null ? null : keyColumn(spec);
    this.keyField = spec.key === null ? null : this.byField.get(spec.key)!;
    for (const c of physicalColumns(spec)) if (c.secret) this.secret.add(c.name);
    const a = spec.access;
    this.systemOnly = !a.select && !a.insert && !a.update && !a.delete;
    this.systemInsert = !a.insert;
  }

  /** The select list (`secret`: include the secret columns). */
  selectList(withSecret: boolean): string {
    const out: string[] = [];
    for (const m of this.fields) {
      for (const col of m.columns) {
        if (!withSecret && this.secret.has(col)) continue;
        out.push(readExpr(m, col));
      }
    }
    if (this.key && !this.fields.some((m) => m.columns.includes(this.key!))) out.push(qi(this.key));
    return out.join(', ');
  }

  hasSecrets(): boolean {
    return this.secret.size > 0;
  }
}

/** The read expression of a column, aliased to the column name. */
function readExpr(m: FieldMapping, col: string): string {
  const c = qi(col);
  if (col !== m.column) return c;
  switch (m.kind) {
    case 'date':
      return `${c}::text as ${c}`;
    case 'ts':
      return `to_char(${c} at time zone app.tz(), 'YYYY-MM-DD"T"HH24:MI:SS"+05:00"') as ${c}`;
    default:
      return c;
  }
}

const num = (v: unknown) => (typeof v === 'string' ? Number(v) : v);

const bytesOf = (v: unknown): Uint8Array => (v instanceof Uint8Array ? v : new Uint8Array(0));

export function postgresRepos(session: SqlSession, o: PgReposOptions): Repos {
  const crypto = o.crypto;
  const priv = !!o.privileged;
  const maps = new Map<string, TableMap>();
  for (const t of TABLES) maps.set(t.collection, new TableMap(t));
  const mapOf = (collection: string) => maps.get(collection)!;

  /** Runs a statement as the session role, or privileged. */
  const run = (text: string, params: readonly unknown[], privileged: boolean): Promise<SqlResult> =>
    privileged && !priv ? session.privileged((s) => s.query(text, params)) : session.query(text, params);

  // ------------------------------------------------------------------ rows

  async function fromRow(t: TableMap, raw: Rec): Promise<Rec> {
    const out: Rec = {};
    for (const m of t.fields) {
      if (m.kind === 'virtual') {
        if (m.field === 'password' && o.demoPassword !== undefined) out.password = o.demoPassword;
        continue;
      }
      let v: unknown;
      if (m.pii) {
        const enc = raw[m.columns[0]!];
        const ver = raw[m.columns[1]!];
        if (none(enc) || none(ver)) v = null;
        else {
          const plain = await crypto.open(bytesOf(enc), Number(ver));
          v = m.kind === 'json' ? (JSON.parse(plain) as unknown) : plain;
        }
      } else v = raw[m.column!];
      if (none(v)) {
        if (m.nullAsNull) out[m.field] = null;
        continue;
      }
      if (m.kind === 'bigint' || m.kind === 'epoch') v = num(v);
      out[m.field] = v;
    }
    return out;
  }

  /** Column → SQL value expression pairs of a field's value. */
  async function columnsOf(m: FieldMapping, v: unknown, p: Params): Promise<[string, string][]> {
    if (m.kind === 'virtual') return [];
    const present = !none(v);
    if (m.pii) {
      const [encCol, verCol, hmacCol, maskCol] = m.columns;
      const plain = present ? (m.kind === 'json' ? JSON.stringify(v) : String(v)) : null;
      const sealed = plain === null ? null : await crypto.seal(plain);
      const out: [string, string][] = [
        [encCol!, p.add(sealed?.enc ?? null, 'bytea')],
        [verCol!, p.add(sealed?.keyVer ?? null, 'smallint')],
      ];
      if (hmacCol && maskCol) {
        out.push([hmacCol, p.add(plain === null ? null : await crypto.hmac(plain), 'bytea')]);
        out.push([maskCol, p.add(plain === null ? null : piiMask(m.field, plain), 'text')]);
      }
      return out;
    }
    if (m.card) {
      const [maskCol, tokenCol] = m.columns;
      const mask = present ? (String(v) ? maskCard(String(v)) : '') : null;
      return [
        [maskCol!, p.add(mask, 'text')],
        [tokenCol!, p.add(null, 'text')],
      ];
    }
    let value: unknown = present ? v : null;
    if (present && m.kind === 'json') value = JSON.stringify(v);
    return [[m.column!, p.add(value, CAST[m.kind])]];
  }

  async function rowColumns(t: TableMap, row: Rec, p: Params): Promise<[string, string][]> {
    const out: [string, string][] = [];
    for (const m of t.fields) out.push(...(await columnsOf(m, row[m.field], p)));
    return out;
  }

  // ------------------------------------------------------------------ where / order

  async function cond(t: TableMap, field: string, c: unknown, p: Params): Promise<string> {
    const m = t.byField.get(field);
    if (!m) throw new Error(`${t.spec.collection}: unknown field ${field} in a query`);
    if (m.kind === 'virtual' || m.card || (m.pii && m.pii !== 'encrypt+hmac')) throw new Error(`${t.spec.collection}.${field} cannot be queried`);
    const op: Op<unknown> = isOp(c) ? c : { eq: c as never };
    const parts: string[] = [];
    if (m.pii) {
      // Identity data: equality through the search HMAC, presence through the ciphertext.
      const h = qi(m.columns[2]!);
      const hash = async (v: unknown) => crypto.hmac(String(v));
      for (const k of Object.keys(op) as (keyof Op<unknown>)[]) {
        const v = op[k];
        if (k === 'eq') parts.push(none(v) ? `${h} is null` : `${h} = ${p.add(await hash(v), 'bytea')}`);
        else if (k === 'ne') parts.push(none(v) ? `${h} is not null` : `${h} is distinct from ${p.add(await hash(v), 'bytea')}`);
        else if (k === 'in') parts.push(`${h} = any(${p.add(await Promise.all((v as unknown[]).map(hash)), 'bytea[]')})`);
        else if (k === 'notIn') parts.push(`(${h} is null or ${h} <> all(${p.add(await Promise.all((v as unknown[]).map(hash)), 'bytea[]')}))`);
        else if (k === 'isNull') parts.push(v ? `${h} is null` : `${h} is not null`);
        else throw new Error(`${t.spec.collection}.${field}: ${k} on identity data`);
      }
      return parts.join(' and ') || 'true';
    }
    const col = qi(m.column!);
    const cast = CAST[m.kind]!;
    const isText = m.kind === 'text' || m.kind === 'enum';
    const isUuid = m.kind === 'uuid';
    const sortable = isText ? `${col} collate "C"` : col;
    const valid = (v: unknown) => !isUuid || (typeof v === 'string' && UUID.test(v));
    if ('eq' in op) {
      const v = op.eq;
      parts.push(none(v) ? `${col} is null` : valid(v) ? `${col} = ${p.add(v, cast)}` : 'false');
    }
    if ('ne' in op) {
      const v = op.ne;
      parts.push(none(v) ? `${col} is not null` : valid(v) ? `${col} is distinct from ${p.add(v, cast)}` : 'true');
    }
    if (op.in) {
      const vs = op.in.filter(valid);
      parts.push(vs.length ? `${col} = any(${p.add(vs, `${cast}[]`)})` : 'false');
    }
    if (op.notIn) {
      const vs = op.notIn.filter(valid);
      if (vs.length) parts.push(`(${col} is null or ${col} <> all(${p.add(vs, `${cast}[]`)}))`);
    }
    if (op.isNull !== undefined) parts.push(op.isNull ? `${col} is null` : `${col} is not null`);
    if (op.contains !== undefined) {
      if (!isText) parts.push('false');
      else parts.push(`${col} ilike ${p.add(`%${op.contains.replace(/[\\%_]/g, (x) => `\\${x}`)}%`, 'text')}`);
    }
    const cmp: [keyof Op<unknown>, string][] = [
      ['gt', '>'],
      ['gte', '>='],
      ['lt', '<'],
      ['lte', '<='],
    ];
    for (const [k, sym] of cmp) {
      const v = op[k];
      if (v === undefined) continue;
      if (isUuid) parts.push(`${col}::text collate "C" ${sym} ${p.add(String(v), 'text')}`);
      else parts.push(`${sortable} ${sym} ${p.add(v, cast)}${isText ? ' collate "C"' : ''}`);
    }
    return parts.join(' and ') || 'true';
  }

  async function whereSql<T>(t: TableMap, where: Where<T> | undefined, p: Params): Promise<string> {
    if (!where) return 'true';
    const parts: string[] = [];
    for (const [k, c] of Object.entries(where)) {
      if (c === undefined) continue;
      parts.push(await cond(t, k, c, p));
    }
    return parts.length ? parts.map((x) => `(${x})`).join(' and ') : 'true';
  }

  function orderSql<T>(t: TableMap, q: Query<T> | undefined): string {
    const parts: string[] = [];
    for (const [field, dir] of q?.orderBy ?? []) {
      const m = t.byField.get(field);
      if (!m || !m.column || m.pii || m.card) throw new Error(`${t.spec.collection}: cannot order by ${field}`);
      const col = qi(m.column);
      const expr = m.kind === 'text' || m.kind === 'enum' ? `${col} collate "C"` : m.kind === 'uuid' ? `${col}::text collate "C"` : col;
      parts.push(`${expr} ${dir} nulls last`);
    }
    parts.push('_pos');
    return parts.join(', ');
  }

  // ------------------------------------------------------------------ statements

  async function select<T>(t: TableMap, q: Query<T> | undefined): Promise<Rec[]> {
    const p = new Params();
    const withSecret = priv || t.systemOnly;
    let text = `select ${t.selectList(withSecret)} from ${t.table} where ${await whereSql(t, q?.where, p)} order by ${orderSql(t, q)}`;
    if (q?.limit !== undefined) text += ` limit ${p.add(q.limit, 'bigint')}`;
    if (q?.offset) text += ` offset ${p.add(q.offset, 'bigint')}`;
    const { rows } = await run(text, p.values, t.systemOnly);
    if (!withSecret && t.hasSecrets() && rows.length && t.key) {
      // The person's RLS chose the rows; their secret columns are read by the API itself.
      const cols = [...t.secret].map(qi).join(', ');
      const keyCast = CAST[t.keyField!.kind]!;
      const { rows: secrets } = await session.privileged((s) =>
        s.query(`select ${qi(t.key!)} as k, ${cols} from ${t.table} where ${qi(t.key!)} = any($1::${keyCast}[])`, [rows.map((r) => r[t.key!])]),
      );
      const byKey = new Map(secrets.map((s) => [String(s.k), s]));
      for (const r of rows) Object.assign(r, byKey.get(String(r[t.key])) ?? {});
    }
    const out: Rec[] = [];
    for (const r of rows) out.push(await fromRow(t, r));
    return out;
  }

  async function count<T>(t: TableMap, where: Where<T> | undefined): Promise<number> {
    const p = new Params();
    const { rows } = await run(`select count(*)::int as n from ${t.table} where ${await whereSql(t, where, p)}`, p.values, t.systemOnly);
    return Number(rows[0]?.n ?? 0);
  }

  async function insertRows(t: TableMap, rows: readonly Rec[], opts?: InsertOptions): Promise<void> {
    if (!rows.length) return;
    const privileged = t.systemOnly || t.systemInsert;
    if (t.spec.collection === 'audit') {
      for (const r of rows) await insertAudit(r, opts);
      return;
    }
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const p = new Params();
      let cols: string[] = [];
      const tuples: string[] = [];
      for (const r of chunk) {
        const pairs = await rowColumns(t, r, p);
        if (t.spec.collection === 'files' && o.blobs) pairs.push(...(await storeFile(r, p)));
        cols = pairs.map(([c]) => c);
        const pos = opts?.at === 'start' ? `-nextval('app.pos_seq')` : `nextval('app.pos_seq')`;
        tuples.push(`(${[...pairs.map(([, v]) => v), pos].join(', ')})`);
      }
      await run(`insert into ${t.table} (${[...cols, '_pos'].map(qi).join(', ')}) values ${tuples.join(', ')}`, p.values, privileged);
    }
  }

  /**
   * The bytes of a new file row go to the blob store under the row's id; the row gets the bucket, the object name,
   * the SHA-256 and the size (BACKEND_SPEC §8). The object is written before the row: a rolled-back request
   * leaves at most an unreferenced object, never a row without its bytes.
   */
  async function storeFile(r: Rec, p: Params): Promise<[string, string][]> {
    const bytes = r.bytes instanceof Uint8Array ? r.bytes : null;
    if (!bytes || !o.blobs) return [['bucket', p.add(null, 'text')], ['object_name', p.add(null, 'uuid')], ['sha256', p.add(null, 'text')], ['size_bytes', p.add(null, 'bigint')]];
    const f = r as unknown as FileRow;
    const bucket = bucketOf(f);
    await o.blobs.put(bucket, f.id, bytes, f.mime);
    return [
      ['bucket', p.add(bucket, 'text')],
      ['object_name', p.add(f.id, 'uuid')],
      ['sha256', p.add(await sha256OfBytes(bytes), 'text')],
      ['size_bytes', p.add(bytes.length, 'bigint')],
    ];
  }

  /** The audit log is written only through app.audit() (hash chain, actor from the claims). */
  async function insertAudit(r: Rec, opts?: InsertOptions): Promise<void> {
    const p = new Params();
    const args = [
      p.add(r.action, 'text'),
      p.add(r.targetType, 'text'),
      p.add(r.targetId ?? null, 'text'),
      p.add(r.targetLabel ?? null, 'text'),
      p.add(r.reason ?? null, 'text'),
      p.add(r.assistanceId ?? null, 'uuid'),
      p.add(r.actorName ?? null, 'text'),
      p.add(r.actorId ?? null, 'uuid'),
      p.add(r.actorRole ?? null, 'text'),
      p.add(r.at, 'timestamptz'),
      p.add(r.id, 'uuid'),
      opts?.at === 'start' ? `-nextval('app.pos_seq')` : 'null',
    ];
    await session.query(`select app.audit(${args.join(', ')})`, p.values);
  }

  /** Rows matching `where` the session can see (a write must change all of them, or RLS denied it). */
  async function visibleCount<T>(t: TableMap, where: Where<T> | undefined, privileged: boolean): Promise<number> {
    if (priv || privileged) return -1;
    return count(t, where);
  }

  async function updateWhere<T>(t: TableMap, where: Where<T> | undefined, patch: Rec, privileged = t.systemOnly): Promise<number> {
    const entries = Object.entries(patch);
    if (!entries.length) return count(t, where);
    const expected = await visibleCount(t, where, privileged);
    const p = new Params();
    const sets: string[] = [];
    for (const [field, v] of entries) {
      const m = t.byField.get(field);
      if (!m) throw new Error(`${t.spec.collection}: unknown field ${field} in an update`);
      for (const [c, e] of await columnsOf(m, v, p)) sets.push(`${qi(c)} = ${e}`);
    }
    if (!sets.length) return count(t, where);
    const { rowCount } = await run(`update ${t.table} set ${sets.join(', ')} where ${await whereSql(t, where, p)}`, p.values, privileged);
    if (expected >= 0 && rowCount < expected) throw new RlsDenied(t.spec.table, 'update');
    return rowCount;
  }

  async function removeWhere<T>(t: TableMap, where: Where<T> | undefined): Promise<number> {
    const expected = await visibleCount(t, where, t.systemOnly);
    const p = new Params();
    const { rowCount } = await run(`delete from ${t.table} where ${await whereSql(t, where, p)}`, p.values, t.systemOnly);
    if (expected >= 0 && rowCount < expected) throw new RlsDenied(t.spec.table, 'delete');
    return rowCount;
  }

  // ------------------------------------------------------------------ repositories

  function logTable<T>(t: TableMap): LogTable<T> {
    return {
      name: t.spec.collection,
      async list(q) {
        return (await select(t, q)) as T[];
      },
      async first(q) {
        return ((await select(t, { ...q, limit: 1 }))[0] as T | undefined) ?? null;
      },
      count: (where) => count(t, where),
      async exists(where) {
        return (await count(t, where)) > 0;
      },
      async insert(row, opts) {
        await insertRows(t, [row as Rec], opts);
        return structuredClone(row);
      },
      async insertMany(rows, opts) {
        await insertRows(t, rows as Rec[], opts);
      },
      updateWhere: (where, patch) => updateWhere(t, where, patch as Rec),
      removeWhere: (where) => removeWhere(t, where),
    };
  }

  function table<T, K extends PropertyKey>(t: TableMap): Table<T, K> {
    const keyField = t.spec.key!;
    const byKey = (k: unknown) => ({ [keyField]: k }) as Where<T>;
    const base = logTable<T>(t);
    return {
      ...base,
      key: keyField as K,
      async get(k) {
        return ((await select(t, { where: byKey(k), limit: 1 }))[0] as T | undefined) ?? null;
      },
      async getMany(keys) {
        if (!keys.length) return [];
        return (await select(t, { where: { [keyField]: { in: keys } } as Where<T> })) as T[];
      },
      async update(k, patch) {
        const row = (await select(t, { where: byKey(k), limit: 1 }))[0];
        if (!row) throw new Error(`${t.spec.collection}: no row ${String(k)}`);
        const n = await updateWhere(t, byKey(k), patch as Rec);
        if (n !== 1) throw new RlsDenied(t.spec.table, 'update');
        for (const [f, v] of Object.entries(structuredClone(patch) as Rec)) {
          if (v === undefined) delete row[f];
          else row[f] = v;
        }
        return row as T;
      },
      async put(row, opts) {
        const k = (row as Rec)[keyField];
        if (await base.exists(byKey(k))) {
          // The whole row is replaced: fields absent from it become NULL.
          const full: Rec = {};
          for (const m of t.fields) full[m.field] = (row as Rec)[m.field];
          delete full[keyField];
          await updateWhere(t, byKey(k), full);
        } else await insertRows(t, [row as Rec], opts);
        return structuredClone(row);
      },
      async remove(k) {
        return (await removeWhere(t, byKey(k))) > 0;
      },
    };
  }

  const out: Rec = {};
  for (const t of maps.values()) {
    if (t.spec.kind === 'keyed' || t.spec.kind === 'nested') out[t.spec.collection] = table(t);
    else if (t.spec.kind === 'log') out[t.spec.collection] = logTable(t);
  }
  if (o.blobs) out.files = filesWithBlobs(out.files as Table<Rec, PropertyKey>, o.blobs);

  /** Where the bytes of a file row are (the row must be visible to the session). */
  async function objectOf(id: unknown): Promise<{ bucket: BucketId; name: string } | null> {
    if (typeof id !== 'string' || !UUID.test(id)) return null;
    const { rows } = await run(`select bucket, object_name::text as name from public.files where id = $1::uuid`, [id], false);
    const r = rows[0];
    return r?.bucket && r.name ? { bucket: r.bucket as BucketId, name: String(r.name) } : null;
  }

  /**
   * `files.get` brings the bytes from the blob store (only there: lists never load bytes). A removed row leaves
   * its object behind (the request may still roll back); such objects are never served, since every download
   * goes through a row the person may see.
   */
  function filesWithBlobs(files: Table<Rec, PropertyKey>, blobs: BlobStore): Table<Rec, PropertyKey> {
    return {
      ...files,
      async get(k) {
        const row = await files.get(k);
        if (!row) return null;
        const obj = await objectOf(k);
        const bytes = obj ? await blobs.get(obj.bucket, obj.name) : null;
        if (bytes) row.bytes = bytes;
        return row;
      },
    };
  }

  // ------------------------------------------------------------------ singletons

  const params = mapOf('dmsParamValues');
  const flags = mapOf('aiRebillFlags');
  const keys = mapOf('statementKeys');

  const aiRebillFlags: MapStore<string> = {
    async get(k) {
      if (!UUID.test(k)) return undefined;
      const r = await select(flags, { where: { lineId: k } });
      return r[0]?.reason as string | undefined;
    },
    async all() {
      const rows = await select(flags, {});
      return Object.fromEntries(rows.map((r) => [String(r.lineId), String(r.reason)]));
    },
    async set(k, v) {
      // Written by the API (system): no role may write the flags (RLS.md).
      await run(`insert into ${flags.table} (line_id, reason) values ($1::uuid, $2::text) on conflict (line_id) do update set reason = excluded.reason`, [k, v], true);
    },
    async delete(k) {
      if (!UUID.test(k)) return;
      await run(`delete from ${flags.table} where line_id = $1::uuid`, [k], true);
    },
  };

  const statementKeys: SetStore = {
    async has(k) {
      return (await count(keys, { key: k })) > 0;
    },
    async add(k) {
      await run(`insert into ${keys.table} (key) values ($1::text) on conflict (key) do nothing`, [k], false);
    },
  };

  const one: Repos['one'] = {
    async dmsParamValues() {
      const rows = await select(params, {});
      const values: Rec = {};
      for (const { key, ...v } of rows) values[String(key)] = v;
      return values as Db['dmsParams']['values'];
    },
    async setDmsParamValues(v) {
      const current = await select(params, {});
      const next = v as Record<string, Rec>;
      for (const [key, value] of Object.entries(next)) await table(params).put({ key, ...value });
      const gone = current.map((r) => String(r.key)).filter((k) => !(k in next));
      if (gone.length) await removeWhere(params, { key: { in: gone } } as unknown as Where<Rec>);
    },
    async aiSettings() {
      const { rows } = await run(`select settings from public.ai_settings where id = 1`, [], false);
      return rows[0]?.settings as Db['ai']['settings'];
    },
    async setAiSettings(v) {
      await updateWhere(mapOf('aiSettings'), { id: 1 }, { settings: v });
    },
    async integrationsSeed() {
      const { rows } = await run(`select value from public.integrations_seed where id = 1`, [], false);
      return Number(rows[0]?.value ?? 0);
    },
  };

  const seq = {
    async next(name: SeqName) {
      const { rows } = await run(`select nextval('public.${sequenceName(name)}') as v`, [], false);
      return Number(rows[0]?.v);
    },
  };

  const base: Omit<Repos, 'facts'> = { ...(out as Omit<Repos, 'aiRebillFlags' | 'statementKeys' | 'seq' | 'one' | 'facts'>), aiRebillFlags, statementKeys, seq, one };
  // Narrow facts: the system computes them itself; a person asks the SQL functions of store/sql/facts.ts.
  return { ...base, facts: priv ? genericFacts(base) : pgFacts(session, crypto) };
}

