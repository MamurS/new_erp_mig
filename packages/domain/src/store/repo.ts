/*
 * Repository interfaces (BACKEND_SPEC §4): the services see the data only through them. Two
 * implementations: `memory` (the mock server's database in the browser and in tests) and `postgres`
 * (the API). Every call is async, every row that comes back is a copy: a change is saved only by
 * `update`/`insert`, as it would be in a database.
 */
import type { Db } from './db';
import type { Facts } from './facts';
import type { Query, Where } from './query';
import type { ComputedOf } from './computed';

/** Row type of a collection of the database. */
export type RowOf<N extends keyof Db> = Db[N] extends readonly (infer R)[] ? R : never;

export interface InsertOptions {
  /** Where the row goes in storage order: `start` for «newest first» lists (default `end`). */
  at?: 'start' | 'end';
}

/**
 * Rows without a primary key: append-only logs and link tables. `X` — computed fields of the table
 * (store/computed.ts): queries may filter and order by them, rows do not carry them.
 */
export interface LogTable<T, X = object> {
  readonly name: string;
  list(q?: Query<T, X>): Promise<T[]>;
  /** Only the given fields of the matching rows (no decryption of identity data the list does not show). */
  select<F extends keyof T & string>(fields: readonly F[], q?: Omit<Query<T, X>, 'fields'>): Promise<Pick<T, F>[]>;
  first(q?: Query<T, X>): Promise<T | null>;
  count(where?: Where<T & X>): Promise<number>;
  /** Sum of a numeric field over the matching rows (0 when none). */
  sum(field: keyof T & string, where?: Where<T & X>): Promise<number>;
  exists(where: Where<T & X>): Promise<boolean>;
  insert(row: T, opts?: InsertOptions): Promise<T>;
  insertMany(rows: readonly T[], opts?: InsertOptions): Promise<void>;
  /** Merges `patch` into every matching row; returns how many changed. */
  updateWhere(where: Where<T>, patch: Partial<T>): Promise<number>;
  removeWhere(where: Where<T>): Promise<number>;
}

/** Value of the primary key field `K` of row `T`. */
export type KeyValue<T, K extends PropertyKey> = K extends keyof T ? T[K] : never;

/** Rows with a primary key in field `K`. */
export interface Table<T, K extends PropertyKey = 'id', X = object> extends LogTable<T, X> {
  readonly key: K;
  get(key: KeyValue<T, K>): Promise<T | null>;
  getMany(keys: readonly KeyValue<T, K>[]): Promise<T[]>;
  /** Merges `patch` into the row and returns it; a missing row is a programming error (throws). */
  update(key: KeyValue<T, K>, patch: Partial<T>): Promise<T>;
  /** Inserts or replaces the whole row. */
  put(row: T, opts?: InsertOptions): Promise<T>;
  remove(key: KeyValue<T, K>): Promise<boolean>;
}

/** A small map of named values (settings, flags). */
export interface MapStore<V> {
  get(key: string): Promise<V | undefined>;
  all(): Promise<Record<string, V>>;
  set(key: string, value: V): Promise<void>;
  delete(key: string): Promise<void>;
}

/** A set of strings (keys of imported statement lines). */
export interface SetStore {
  has(key: string): Promise<boolean>;
  add(key: string): Promise<void>;
}

/**
 * Marks of the background jobs (services/jobRunner.ts): an action of a job is done once per subject and occurrence
 * (the reminder of one SLA breach, the renewal deal of one policy). System-only: `app.job_marks` in Postgres.
 */
export interface JobMarks {
  /** Marks the occurrence: true when it was not marked yet (the caller acts), false when it already was. */
  claim(job: string, subject: string, occurrence: string): Promise<boolean>;
}

/** Document number sequences: `next` returns the incremented value. */
export type SeqName = 'kp' | 'guarantee' | 'case' | 'deal' | 'contract';
export interface Seqs {
  next(name: SeqName): Promise<number>;
}

/** Single values: DMS parameter overrides, AI settings, the demo integrations seed. */
export interface Singletons {
  dmsParamValues(): Promise<Db['dmsParams']['values']>;
  setDmsParamValues(v: Db['dmsParams']['values']): Promise<void>;
  aiSettings(): Promise<Db['ai']['settings']>;
  setAiSettings(v: Db['ai']['settings']): Promise<void>;
  integrationsSeed(): Promise<number>;
}

/** Tables with a primary key and the field that holds it. */
export const TABLE_KEYS = {
  staff: 'id',
  hrUsers: 'id',
  clients: 'id',
  policies: 'id',
  insured: 'id',
  claims: 'id',
  appointments: 'id',
  clinics: 'id',
  audit: 'id',
  limitRequests: 'id',
  invoices: 'id',
  documents: 'id',
  insuredDocuments: 'id',
  chat: 'id',
  files: 'id',
  sessions: 'id',
  challenges: 'id',
  grants: 'id',
  lockouts: 'key',
  kp: 'id',
  clinicUsers: 'id',
  priceLists: 'clinicId',
  cardTokens: 'token',
  visits: 'id',
  checkLocks: 'userId',
  guarantees: 'id',
  registries: 'id',
  integrationClients: 'id',
  accessTokens: 'tokenHash',
  webhooks: 'id',
  webhookDeliveries: 'id',
  idempotency: 'key',
  apiLogs: 'id',
  clinicEvents: 'id',
  policyChanges: 'id',
  assistances: 'id',
  assistUsers: 'id',
  cases: 'id',
  rebills: 'id',
  qaSamples: 'id',
  authorityChanges: 'id',
  deals: 'id',
  dealEvents: 'id',
  censuses: 'id',
  quotes: 'id',
  contracts: 'id',
  contractInsured: 'contractId',
  payments: 'id',
  bankPayments: 'id',
  changeRequests: 'id',
  endorsements: 'id',
  migrationBatches: 'id',
  familyConsents: 'id',
  familyRequests: 'id',
  tasks: 'id',
  notifications: 'id',
} as const satisfies { [N in keyof Db]?: keyof RowOf<N> };

/** Tables without a primary key. */
export const LOG_TABLES = ['loginFailures', 'checkAttempts', 'apiCalls', 'misSlots', 'smsOutbox', 'assignments', 'clinicContracts'] as const satisfies readonly (keyof Db)[];

export type KeyedName = keyof typeof TABLE_KEYS;
export type LogName = (typeof LOG_TABLES)[number];

/** Collections kept inside an object of the memory database, exposed as tables of their own. */
export interface NestedRows {
  dmsParamChanges: Db['dmsParams']['changes'][number];
  aiChanges: Db['ai']['changes'][number];
  aiLogs: Db['ai']['logs'][number];
  helpQuestions: Db['help']['questions'][number];
}
export const NESTED_KEYS = { dmsParamChanges: 'id', aiChanges: 'id', aiLogs: 'id', helpQuestions: 'id' } as const satisfies { [N in keyof NestedRows]: keyof NestedRows[N] };

export type Repos = { [N in KeyedName]: Table<RowOf<N>, (typeof TABLE_KEYS)[N], ComputedOf<N>> } & { [N in LogName]: LogTable<RowOf<N>, ComputedOf<N>> } & {
  [N in keyof NestedRows]: Table<NestedRows[N], (typeof NESTED_KEYS)[N]>;
} & {
  /** AI precheck flags of registry lines: line id → reason. */
  aiRebillFlags: MapStore<string>;
  statementKeys: SetStore;
  jobMarks: JobMarks;
  seq: Seqs;
  one: Singletons;
  /** Narrow facts about rows the person's row-level security hides (store/facts.ts). */
  facts: Facts;
};

// Names used in the specification and in the services.
export type ClientRepo = Repos['clients'];
export type PolicyRepo = Repos['policies'];
export type InsuredRepo = Repos['insured'];
export type ClaimRepo = Repos['claims'];
export type ContractRepo = Repos['contracts'];
export type AuditRepo = Repos['audit'];
