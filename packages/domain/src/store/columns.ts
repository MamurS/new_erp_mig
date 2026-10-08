/*
 * Column vocabulary of the declarative database schema (schema.ts). A column spec is typed against the
 * TypeScript type of the field it stores, so the compiler rejects a kind that cannot hold the value, a
 * missing `opt()` for an optional field or a missing `orNull()` for a nullable one.
 */

/** Storage kinds. `virtual` fields are not stored in Postgres at all (passwords live in Supabase Auth, file bytes in Storage). */
export type ColumnKind = 'uuid' | 'text' | 'int' | 'bigint' | 'float' | 'bool' | 'date' | 'ts' | 'epoch' | 'json' | 'textArray' | 'enum' | 'virtual';

/**
 * - `encrypt`: AES-256-GCM in the API; stored as `<col>_enc bytea` + `<col>_key_ver smallint`.
 * - `encrypt+hmac`: additionally `<col>_hmac bytea` (search by equality) and `<col>_mask text` (the masked form for lists).
 */
export type PiiMode = 'encrypt' | 'encrypt+hmac';

export interface ColumnOptions {
  /** Foreign key to the key column of another collection (deferrable: rows may arrive in any order within a transaction). */
  ref?: string;
  pii?: PiiMode;
  /** Payout card number: stored only as `<col>_mask` and the bank token `<col>_token`, never the number. */
  card?: true;
  /** Unique (business numbers such as `number`). */
  unique?: true;
  /** Why a `virtual` field is not stored. */
  note?: string;
}

/** `undefined`: an optional field, SQL NULL reads back as a missing property; `null`: SQL NULL reads back as `null`. */
export type NullMode = 'undefined' | 'null';

export interface Column<K extends ColumnKind = ColumnKind> extends ColumnOptions {
  kind: K;
  null?: NullMode;
  /** Allowed values of an `enum` column (a CHECK constraint). */
  values?: readonly string[];
}

/** A column as built, before `opt()` / `orNull()`. */
export type PlainColumn<K extends ColumnKind = ColumnKind> = Omit<Column<K>, 'null'> & { null?: undefined };

const make =
  <K extends ColumnKind>(kind: K) =>
  (o: ColumnOptions = {}): PlainColumn<K> => ({ kind, ...o });

export const uuid = make('uuid');
export const text = make('text');
export const int = make('int');
export const bigint = make('bigint');
export const float = make('float');
export const bool = make('bool');
export const date = make('date');
export const ts = make('ts');
export const epoch = make('epoch');
export const json = make('json');
export const textArray = make('textArray');
export const virtual = (note: string): PlainColumn<'virtual'> => ({ kind: 'virtual', note });

/** An optional field (`x?: T`): nullable column, NULL → property absent. */
export const opt = <K extends ColumnKind>(c: PlainColumn<K>): Column<K> & { null: 'undefined' } => ({ ...c, null: 'undefined' });
/** A field that may hold `null` (`x: T | null` or `x?: T | null`): nullable column, NULL → `null`. */
export const orNull = <K extends ColumnKind>(c: PlainColumn<K>): Column<K> & { null: 'null' } => ({ ...c, null: 'null' });

type Missing<T extends string, L extends readonly string[]> = Exclude<T, L[number]>;
/**
 * `enumOf<ClaimStatus>()('new', 'review', …)`: the list must cover the union exactly (a missing or an extra
 * value is a compile error), so a value added to the union later fails the build until the schema has it.
 */
export function enumOf<T extends string>() {
  return <const L extends readonly T[]>(...values: L & ([Missing<T, L>] extends [never] ? unknown : { missing: Missing<T, L> })): PlainColumn<'enum'> => ({
    kind: 'enum',
    values,
  });
}

/** Kinds that can store a value of type V. */
type KindFor<V> = [V] extends [string]
  ? 'uuid' | 'text' | 'date' | 'ts' | 'enum'
  : [V] extends [number]
    ? 'int' | 'bigint' | 'float' | 'epoch'
    : [V] extends [boolean]
      ? 'bool'
      : [V] extends [readonly string[]]
        ? 'textArray' | 'json'
        : 'json';

type IsOptional<Row, K extends keyof Row> = object extends Pick<Row, K> ? true : false;

/** The spec a field of `Row` must have. */
export type ColumnFor<Row, K extends keyof Row> = null extends Row[K]
  ? Column<KindFor<NonNullable<Row[K]>> | 'virtual'> & { null: 'null' }
  : IsOptional<Row, K> extends true
    ? Column<KindFor<NonNullable<Row[K]>> | 'virtual'> & { null: 'undefined' }
    : Column<KindFor<Row[K]> | 'virtual'> & { null?: undefined };

/** Every field of the row type must be described: a field added later and not mapped is a compile error. */
export type ColumnsOf<Row> = { [K in keyof Row]-?: ColumnFor<Row, K> };

/** `hrUsers` → `hr_users`, `latencyMs` → `latency_ms`. */
export function snake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z])([A-Z][a-z])/g, '$1_$2').toLowerCase();
}

// Reserved key words of Postgres that cannot be bare column names (SQL:2016 reserved + PG type/function reserved).
const RESERVED = new Set(
  (
    'all analyse analyze and any array as asc asymmetric authorization binary both case cast check collate collation column concurrently constraint create cross ' +
    'current_catalog current_date current_role current_schema current_time current_timestamp current_user default deferrable desc distinct do else end except ' +
    'false fetch for foreign freeze from full grant group having ilike in initially inner intersect into is isnull join lateral leading left like limit localtime ' +
    'localtimestamp natural not notnull null offset on only or order outer overlaps placing primary references returning right select session_user similar some ' +
    'symmetric system_user table tablesample then to trailing true union unique user using variadic verbose when where window with'
  ).split(' '),
);

/** Quoted identifier when needed (`from`, `to`, `user`). */
export function qi(name: string): string {
  return RESERVED.has(name) || !/^[a-z_][a-z0-9_]*$/.test(name) ? `"${name.replace(/"/g, '""')}"` : name;
}
