/*
 * Physical layout of the declarative schema: SQL columns of every field, their types and constraints.
 * Used by the migration generator and by the postgres repositories (BACKEND_SPEC §4, step 4) to map a
 * row of the domain to columns and back.
 */
import { qi, snake, type Column, type ColumnKind } from '../columns';
import { TABLES, initialEnumValues, tableOf, type TableSpec } from '../schema';

/** Service columns present in every table (not part of the row types). */
export const META_COLUMNS = ['_pos', '_created_at', '_updated_at', '_created_by'] as const;
/** Synthetic primary key of log tables. */
export const LOG_ID = '_id';

export interface PhysicalColumn {
  name: string;
  sqlType: string;
  notNull: boolean;
  /** CHECK expression (enums). */
  check?: string;
  /** `table(column)` of a foreign key. */
  references?: string;
  unique?: boolean;
  /** Never readable by `authenticated` (ciphertexts, key versions, bank tokens, secret hashes). */
  secret?: boolean;
}

/** How one field of the row type is stored. */
export interface FieldMapping {
  field: string;
  kind: ColumnKind;
  /** Column holding the value (for PII: the ciphertext; for cards: the mask); absent for virtual fields. */
  column?: string;
  /** All SQL columns of the field. */
  columns: string[];
  nullable: boolean;
  /** SQL NULL reads back as `null` (not as a missing property). */
  nullAsNull: boolean;
  pii?: 'encrypt' | 'encrypt+hmac';
  card?: boolean;
  ref?: string;
  values?: readonly string[];
}

const SQL_TYPE: Record<Exclude<ColumnKind, 'virtual'>, string> = {
  uuid: 'uuid',
  text: 'text',
  int: 'integer',
  bigint: 'bigint',
  float: 'double precision',
  bool: 'boolean',
  date: 'date',
  ts: 'timestamptz',
  epoch: 'bigint',
  json: 'jsonb',
  textArray: 'text[]',
  enum: 'text',
};

export const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** Key column of a table (SQL name). */
export function keyColumn(t: TableSpec): string {
  return t.key === null ? LOG_ID : snake(t.key);
}

export function fieldMapping(field: string, c: Column): FieldMapping {
  const base = snake(field);
  const nullable = c.null !== undefined;
  const m: FieldMapping = { field, kind: c.kind, columns: [], nullable, nullAsNull: c.null === 'null' };
  if (c.kind === 'virtual') return m;
  if (c.ref) m.ref = c.ref;
  if (c.values) m.values = c.values;
  if (c.pii) {
    m.pii = c.pii;
    m.column = `${base}_enc`;
    m.columns = c.pii === 'encrypt+hmac' ? [`${base}_enc`, `${base}_key_ver`, `${base}_hmac`, `${base}_mask`] : [`${base}_enc`, `${base}_key_ver`];
  } else if (c.card) {
    m.card = true;
    m.column = `${base}_mask`;
    m.columns = [`${base}_mask`, `${base}_token`];
  } else {
    m.column = base;
    m.columns = [base];
  }
  return m;
}

/** Field mappings of a collection (repositories: row ↔ columns). */
export function fieldMappings(collection: string): FieldMapping[] {
  const t = tableOf(collection);
  return Object.entries(t.columns).map(([f, c]) => fieldMapping(f, c));
}

/** Fields stored as jsonb. */
export function jsonFields(collection: string): string[] {
  return fieldMappings(collection)
    .filter((m) => m.kind === 'json' && !m.pii)
    .map((m) => m.field);
}

/** SQL columns of the fields of a table (without the service columns), in declaration order. */
export function physicalColumns(t: TableSpec): PhysicalColumn[] {
  const out: PhysicalColumn[] = [];
  for (const [field, c] of Object.entries(t.columns)) {
    if (c.kind === 'virtual') continue;
    const base = snake(field);
    const notNull = c.null === undefined;
    if (c.pii) {
      // Identity data (PINFL, phone) and credentials are never readable by `authenticated`; encrypted free
      // texts are readable with the row (encryption at rest, the API decrypts).
      const secret = c.pii === 'encrypt+hmac' || SECRET_FIELDS.has(`${t.collection}.${field}`);
      out.push({ name: `${base}_enc`, sqlType: 'bytea', notNull, secret });
      out.push({ name: `${base}_key_ver`, sqlType: 'smallint', notNull, secret });
      if (c.pii === 'encrypt+hmac') {
        out.push({ name: `${base}_hmac`, sqlType: 'bytea', notNull });
        out.push({ name: `${base}_mask`, sqlType: 'text', notNull });
      }
      continue;
    }
    if (c.card) {
      out.push({ name: `${base}_mask`, sqlType: 'text', notNull });
      out.push({ name: `${base}_token`, sqlType: 'text', notNull: false, secret: true });
      continue;
    }
    const col: PhysicalColumn = { name: base, sqlType: SQL_TYPE[c.kind], notNull };
    if (c.kind === 'enum' && c.values) col.check = `${qi(base)} in (${initialEnumValues(t.collection, field, c.values).map(lit).join(', ')})`;
    if (c.ref) {
      const target = tableOf(c.ref);
      col.references = `public.${target.table}(${keyColumn(target)})`;
    }
    if (c.unique) col.unique = true;
    if (SECRET_FIELDS.has(`${t.collection}.${field}`)) col.secret = true;
    out.push(col);
  }
  return out;
}

/** Plain columns that hold secrets (verified by the API with the service role only). */
const SECRET_FIELDS = new Set(['integrationClients.secretHash', 'webhooks.signingSecret']);

/** Columns `authenticated` may select (everything except secrets). */
export function readableColumns(t: TableSpec): string[] {
  const cols = physicalColumns(t);
  const own = cols.filter((c) => !c.secret).map((c) => c.name);
  return [...(t.key === null ? [LOG_ID] : []), ...own, ...META_COLUMNS];
}

export function hasSecrets(t: TableSpec): boolean {
  return physicalColumns(t).some((c) => c.secret);
}

/** Resolves an index entry (a field name or a physical column) to the SQL column. */
export function indexColumn(t: TableSpec, name: string): string {
  if (name in t.columns) {
    const m = fieldMapping(name, t.columns[name]!);
    if (!m.column) throw new Error(`Index on a virtual field ${t.collection}.${name}`);
    return m.column;
  }
  const all = [...physicalColumns(t).map((c) => c.name), ...META_COLUMNS];
  if (!all.includes(name)) throw new Error(`Unknown index column ${t.collection}.${name}`);
  return name;
}

export { TABLES, tableOf };
