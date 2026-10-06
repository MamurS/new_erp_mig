/*
 * Transfer of the existing portfolio (/staff/admin/migration): the files, their templates, parsing and a
 * dry-run validation of every row. Pure functions: the mock server gives the references of its database
 * (MigrationDbRefs) and the screen uses the same column lists and templates.
 *
 * Load order: clients → contracts → insured → limits → claims → invoices. A row refers to rows of the
 * earlier files of the same batch (only rows without errors) or to records already in the system.
 */
import Papa from 'papaparse';
import type { z } from 'zod';
import { msg } from '@/i18n/core';
import type { LimitCategory, Money, ProgramCode, UUID } from '@/shared/types';
import type { MigrationIssue, MigrationMetric, MigrationReconRow, MigrationStep, MigrationTotals } from '@/shared/types/migration';
import { PROGRAMS } from './programs';
import { toCsv } from '@/shared/lib/csv';
import {
  MIGRATION_CSV_MAX_ROWS,
  migrationClaimRowSchema,
  migrationClientRowSchema,
  migrationContractRowSchema,
  migrationInsuredRowSchema,
  migrationInvoiceRowSchema,
  migrationLimitRowSchema,
  type MigrationClaimRow,
  type MigrationClientRow,
  type MigrationContractRow,
  type MigrationInsuredRow,
  type MigrationInvoiceRow,
  type MigrationLimitRow,
} from '@/shared/schemas/migration';

export const MIGRATION_STEPS = ['clients', 'contracts', 'insured', 'limits', 'claims', 'invoices'] as const satisfies readonly MigrationStep[];

/** Columns of each file, in the order of the template. */
export const MIGRATION_COLUMNS: Record<MigrationStep, readonly string[]> = {
  clients: ['name', 'legalForm', 'stir', 'bank', 'account', 'mfo', 'director', 'directorBasis', 'address', 'hrName', 'hrPhone', 'hrEmail'],
  contracts: ['oldNumber', 'clientStir', 'startDate', 'endDate', 'program', 'premium', 'paymentFrequency', 'assistance'],
  insured: ['fullName', 'birthDate', 'pinfl', 'phone', 'oldCertificate', 'inclusionDate', 'contractOldNumber', 'position', 'familyMembers'],
  limits: ['pinfl', 'oldCertificate', 'category', 'usedAmount'],
  claims: ['oldNumber', 'pinfl', 'oldCertificate', 'category', 'serviceDate', 'provider', 'amountClaimed', 'reserve', 'status'],
  invoices: ['oldNumber', 'contractOldNumber', 'amount', 'paid', 'issuedAt', 'dueDate'],
};

/** Columns that must be present in the header (a value may still be optional). */
export const MIGRATION_REQUIRED_COLUMNS: Record<MigrationStep, readonly string[]> = {
  clients: ['name', 'legalForm', 'stir', 'bank', 'account', 'mfo', 'director', 'hrName', 'hrPhone', 'hrEmail'],
  contracts: ['oldNumber', 'clientStir', 'startDate', 'endDate', 'program', 'premium'],
  insured: ['fullName', 'birthDate', 'pinfl', 'oldCertificate', 'inclusionDate', 'contractOldNumber'],
  limits: ['category', 'usedAmount'],
  claims: ['oldNumber', 'category', 'serviceDate', 'provider', 'amountClaimed', 'reserve', 'status'],
  invoices: ['oldNumber', 'contractOldNumber', 'amount', 'issuedAt'],
};

/** Example row of every template; the rows refer to each other, like a real batch. */
const EXAMPLE: Record<MigrationStep, Record<string, string>> = {
  clients: {
    name: 'Example Trade',
    legalForm: 'llc',
    stir: '301234567',
    bank: 'Example Bank ATB',
    account: '20208000900100200300',
    mfo: '00014',
    director: 'Karimov Anvar Rustamovich',
    directorBasis: 'Ustav',
    address: 'Tashkent, Yunusobod, 12',
    hrName: 'Saidova Malika Bahodirovna',
    hrPhone: '+998901234567',
    hrEmail: 'hr@example-trade.uz',
  },
  contracts: { oldNumber: 'MIG-2026/0458', clientStir: '301234567', startDate: '2026-03-01', endDate: '2027-02-28', program: 'standard', premium: '125000000', paymentFrequency: 'quarterly', assistance: '' },
  insured: {
    fullName: 'Rahimov Jasur Olimovich',
    birthDate: '1988-05-14',
    pinfl: '31405880123456',
    phone: '+998901112233',
    oldCertificate: 'C-0458-0001',
    inclusionDate: '2026-03-01',
    contractOldNumber: 'MIG-2026/0458',
    position: 'Accountant',
    familyMembers: '1',
  },
  limits: { pinfl: '31405880123456', oldCertificate: 'C-0458-0001', category: 'outpatient', usedAmount: '1250000' },
  claims: { oldNumber: 'CL-2026-7781', pinfl: '31405880123456', oldCertificate: 'C-0458-0001', category: 'diagnostics', serviceDate: '2026-09-12', provider: 'Shifo Med Center', amountClaimed: '850000', reserve: '850000', status: 'review' },
  invoices: { oldNumber: 'INV-2026-0091', contractOldNumber: 'MIG-2026/0458', amount: '31250000', paid: '0', issuedAt: '2026-09-01', dueDate: '2026-09-15' },
};

/** Template: header and one example row (cells are CSV-injection safe). */
export function migrationTemplateCsv(step: MigrationStep): string {
  const cols = MIGRATION_COLUMNS[step];
  return toCsv(cols, [cols.map((c) => EXAMPLE[step][c] ?? '')]);
}

/** File names carry no personal data. */
export const migrationFileName = (step: MigrationStep, kind: 'template' | 'demo' | 'demo-fixed' = 'template') => `migration-${step}-${kind}.csv`;

// ---------------------------------------------------------------- parsing

export type RawRow = Record<string, string>;

/** A cell exported with the CSV-injection guard («'=…») is read back without the apostrophe. */
function unguard(v: string): string {
  return /^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v;
}

export function parseMigrationCsv(step: MigrationStep, text: string): { rows: RawRow[] } | { error: string } {
  const parsed = Papa.parse<RawRow>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim(), transform: (v) => unguard(v) });
  const header = parsed.meta.fields ?? [];
  const missing = MIGRATION_REQUIRED_COLUMNS[step].filter((c) => !header.includes(c));
  if (missing.length) return { error: msg('migration.v.missingColumns', { columns: missing.join(', ') }) };
  if (parsed.data.length === 0) return { error: msg('migration.v.emptyFile') };
  if (parsed.data.length > MIGRATION_CSV_MAX_ROWS) return { error: msg('migration.v.tooManyRows', { max: MIGRATION_CSV_MAX_ROWS }) };
  return { rows: parsed.data };
}

// ---------------------------------------------------------------- references

/** Where a row refers to: a row of an earlier file of the batch (its CSV row number) or a record in the system. */
export type MigrationRef = { batch: number } | { db: UUID };

/** What the system already has, as the validation needs it. */
export interface MigrationDbRefs {
  /** Clients by STIR (ИНН). */
  clients: Map<string, { id: UUID; hasActivePolicy: boolean }>;
  /** Contracts transferred earlier, by their old number. */
  contracts: Map<string, { id: UUID; program: ProgramCode; startDate: string; endDate: string; active: boolean }>;
  /** Active insured persons: by PINFL and by old certificate number (transferred ones). */
  insuredByPinfl: Map<string, { id: UUID; program: ProgramCode; from: string }>;
  insuredByCertificate: Map<string, { id: UUID; program: ProgramCode; from: string }>;
  /** Phones of active insured persons (the app login finds a person by phone). */
  phones: Set<string>;
  /** Old numbers of transferred claims and invoices. */
  claimNumbers: Set<string>;
  invoiceNumbers: Set<string>;
  /** Assistance companies by lower-case name. */
  assistances: Map<string, UUID>;
  /** Limits already transferred for a person: `insuredId:category`. */
  limits: Set<string>;
}

export const emptyDbRefs = (): MigrationDbRefs => ({
  clients: new Map(),
  contracts: new Map(),
  insuredByPinfl: new Map(),
  insuredByCertificate: new Map(),
  phones: new Set(),
  claimNumbers: new Set(),
  invoiceNumbers: new Set(),
  assistances: new Map(),
  limits: new Set(),
});

export interface ValidRow<T, R = undefined> {
  /** CSV row number (the header is row 1). */
  row: number;
  data: T;
  ref: R;
}

export interface StepResult<T, R = undefined> {
  step: MigrationStep;
  total: number;
  valid: ValidRow<T, R>[];
  issues: MigrationIssue[];
  errorRows: number;
  warningRows: number;
  fileTotals: MigrationTotals;
  validTotals: MigrationTotals;
}

export interface BatchResults {
  clients?: StepResult<MigrationClientRow>;
  contracts?: StepResult<MigrationContractRow, { client: MigrationRef; assistanceId: UUID | null }>;
  insured?: StepResult<MigrationInsuredRow, { contract: MigrationRef }>;
  limits?: StepResult<MigrationLimitRow, { insured: MigrationRef }>;
  claims?: StepResult<MigrationClaimRow, { insured: MigrationRef }>;
  invoices?: StepResult<MigrationInvoiceRow, { contract: MigrationRef }>;
}

/** Input of a validation: the parsed rows of each file loaded so far (in order) and the migration date. */
export interface BatchInput {
  migrationDate: string;
  files: Partial<Record<MigrationStep, RawRow[]>>;
}

/** Money figure of a raw row (lenient: an unreadable value counts as 0). */
function rawAmount(step: MigrationStep, r: RawRow): number {
  const n = (v: string | undefined) => {
    const s = (v ?? '').replace(/[\s ]/g, '');
    return /^\d{1,13}$/.test(s) ? Number(s) : 0;
  };
  if (step === 'contracts') return n(r.premium);
  if (step === 'limits') return n(r.usedAmount);
  if (step === 'claims') return n(r.reserve);
  if (step === 'invoices') return Math.max(0, n(r.amount) - n(r.paid));
  return 0;
}

function validAmount(step: MigrationStep, data: unknown): number {
  const d = data as Record<string, number>;
  if (step === 'contracts') return d.premium ?? 0;
  if (step === 'limits') return d.usedAmount ?? 0;
  if (step === 'claims') return d.reserve ?? 0;
  if (step === 'invoices') return Math.max(0, (d.amount ?? 0) - (d.paid ?? 0));
  return 0;
}

class Collector {
  readonly issues: MigrationIssue[] = [];
  private readonly errors = new Set<number>();
  private readonly warnings = new Set<number>();
  error(row: number, field: string, message: string) {
    this.issues.push({ row, field, level: 'error', message });
    this.errors.add(row);
  }
  warn(row: number, field: string, message: string) {
    this.issues.push({ row, field, level: 'warning', message });
    this.warnings.add(row);
  }
  hasError(row: number) {
    return this.errors.has(row);
  }
  get errorRows() {
    return this.errors.size;
  }
  get warningRows() {
    return this.warnings.size;
  }
}

/** Schema check of every row; returns the parsed rows (null for a row with schema errors). */
function parseRows<S extends z.ZodTypeAny>(schema: S, rows: RawRow[], c: Collector): (z.output<S> | null)[] {
  return rows.map((raw, idx) => {
    const row = idx + 2;
    const r = schema.safeParse(raw);
    if (r.success) return r.data as z.output<S>;
    const seen = new Set<string>();
    for (const issue of r.error.issues) {
      const field = String(issue.path[0] ?? '');
      if (seen.has(field)) continue;
      seen.add(field);
      c.error(row, field, issue.message);
    }
    return null;
  });
}

function finish<T, R>(step: MigrationStep, rows: RawRow[], parsed: ({ data: T; ref: R } | null)[], c: Collector): StepResult<T, R> {
  const valid: ValidRow<T, R>[] = [];
  parsed.forEach((p, idx) => {
    if (p && !c.hasError(idx + 2)) valid.push({ row: idx + 2, data: p.data, ref: p.ref });
  });
  c.issues.sort((a, b) => a.row - b.row || (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
  return {
    step,
    total: rows.length,
    valid,
    issues: c.issues,
    errorRows: c.errorRows,
    warningRows: c.warningRows,
    fileTotals: { rows: rows.length, amount: rows.reduce((s, r) => s + rawAmount(step, r), 0) },
    validTotals: { rows: valid.length, amount: valid.reduce((s, v) => s + validAmount(step, v.data), 0) },
  };
}

/** PINFL digits 2–7 are the birth date DDMMYY. */
export function pinflMatchesBirthDate(pinfl: string, birthDate: string): boolean {
  const [y, m, d] = birthDate.split('-');
  return pinfl.slice(1, 7) === `${d}${m}${y?.slice(2)}`;
}

interface ContractFacts {
  program: ProgramCode;
  startDate: string;
  endDate: string;
}

/** Validates the files loaded so far, in the load order. Nothing is written. */
export function validateBatch(input: BatchInput, refs: MigrationDbRefs): BatchResults {
  const out: BatchResults = {};
  const date = input.migrationDate;
  const f = input.files;

  // ---- clients
  if (f.clients) {
    const c = new Collector();
    const parsed = parseRows(migrationClientRowSchema, f.clients, c);
    const seen = new Map<string, number>();
    const res = parsed.map((p, idx) => {
      const row = idx + 2;
      if (!p) return null;
      if (refs.clients.has(p.stir)) c.error(row, 'stir', msg('migration.v.clientExists'));
      const first = seen.get(p.stir);
      if (first !== undefined) c.error(row, 'stir', msg('migration.v.repeatedInFile', { row: first }));
      else seen.set(p.stir, row);
      if (/\b(llc|mchj|ooo|jsc|aj|xk|ltd)\b/i.test(p.name)) c.warn(row, 'name', msg('migration.v.nameHasForm'));
      return { data: p, ref: undefined };
    });
    out.clients = finish('clients', f.clients, res, c);
  }

  // ---- contracts
  const batchClients = new Map((out.clients?.valid ?? []).map((v) => [v.data.stir, v.row]));
  if (f.contracts) {
    const c = new Collector();
    const parsed = parseRows(migrationContractRowSchema, f.contracts, c);
    const seen = new Map<string, number>();
    const res = parsed.map((p, idx) => {
      const row = idx + 2;
      if (!p) return null;
      const key = p.oldNumber.toUpperCase();
      if (refs.contracts.has(key)) c.error(row, 'oldNumber', msg('migration.v.contractExists'));
      const first = seen.get(key);
      if (first !== undefined) c.error(row, 'oldNumber', msg('migration.v.repeatedInFile', { row: first }));
      else seen.set(key, row);
      let client: MigrationRef | null = null;
      const inBatch = batchClients.get(p.clientStir);
      const inDb = refs.clients.get(p.clientStir);
      if (inBatch !== undefined) client = { batch: inBatch };
      else if (inDb) {
        client = { db: inDb.id };
        if (inDb.hasActivePolicy) c.warn(row, 'clientStir', msg('migration.v.clientHasPolicy'));
      } else c.error(row, 'clientStir', msg('migration.v.clientNotFound'));
      if (p.endDate < date) c.error(row, 'endDate', msg('migration.v.contractExpired'));
      if (p.startDate > date) c.warn(row, 'startDate', msg('migration.v.startsAfterMigration'));
      let assistanceId: UUID | null = null;
      if (p.assistance) {
        const id = refs.assistances.get(p.assistance.toLowerCase());
        if (id) assistanceId = id;
        else c.error(row, 'assistance', msg('migration.v.assistanceNotFound'));
      }
      return client ? { data: p, ref: { client, assistanceId } } : null;
    });
    out.contracts = finish('contracts', f.contracts, res, c);
  }

  // ---- insured
  const batchContracts = new Map((out.contracts?.valid ?? []).map((v) => [v.data.oldNumber.toUpperCase(), { row: v.row, facts: v.data as ContractFacts }]));
  const contractOf = (old: string): { ref: MigrationRef; facts: ContractFacts } | null => {
    const key = old.toUpperCase();
    const b = batchContracts.get(key);
    if (b) return { ref: { batch: b.row }, facts: b.facts };
    const d = refs.contracts.get(key);
    if (d && d.active) return { ref: { db: d.id }, facts: d };
    return null;
  };
  if (f.insured) {
    const c = new Collector();
    const parsed = parseRows(migrationInsuredRowSchema, f.insured, c);
    const pinfls = new Map<string, number>();
    const certs = new Map<string, number>();
    const phones = new Map<string, number>();
    const res = parsed.map((p, idx) => {
      const row = idx + 2;
      if (!p) return null;
      if (refs.insuredByPinfl.has(p.pinfl)) c.error(row, 'pinfl', msg('migration.v.pinflInsured'));
      const fp = pinfls.get(p.pinfl);
      if (fp !== undefined) c.error(row, 'pinfl', msg('migration.v.repeatedInFile', { row: fp }));
      else pinfls.set(p.pinfl, row);
      const cert = p.oldCertificate.toUpperCase();
      if (refs.insuredByCertificate.has(cert)) c.error(row, 'oldCertificate', msg('migration.v.certificateExists'));
      const fc = certs.get(cert);
      if (fc !== undefined) c.error(row, 'oldCertificate', msg('migration.v.repeatedInFile', { row: fc }));
      else certs.set(cert, row);
      if (!pinflMatchesBirthDate(p.pinfl, p.birthDate)) c.warn(row, 'pinfl', msg('migration.v.pinflBirthDate'));
      if (!p.phone) c.warn(row, 'phone', msg('migration.v.noPhone'));
      else {
        if (refs.phones.has(p.phone)) c.error(row, 'phone', msg('migration.v.phoneTaken'));
        const fph = phones.get(p.phone);
        if (fph !== undefined) c.error(row, 'phone', msg('migration.v.repeatedInFile', { row: fph }));
        else phones.set(p.phone, row);
      }
      const contract = contractOf(p.contractOldNumber);
      if (!contract) {
        c.error(row, 'contractOldNumber', msg('migration.v.contractNotFound'));
        return null;
      }
      if (p.inclusionDate < contract.facts.startDate || p.inclusionDate > contract.facts.endDate) c.error(row, 'inclusionDate', msg('migration.v.outsideTerm'));
      else if (p.inclusionDate > date) c.warn(row, 'inclusionDate', msg('migration.v.includedAfterMigration'));
      return { data: p, ref: { contract: contract.ref } };
    });
    out.insured = finish('insured', f.insured, res, c);
  }

  // ---- insured persons for limits and claims
  const insuredFacts = (v: ValidRow<MigrationInsuredRow, { contract: MigrationRef }>): { program: ProgramCode; from: string } => {
    const ref = v.ref.contract;
    if ('batch' in ref) {
      const b = [...batchContracts.values()].find((x) => x.row === ref.batch);
      return { program: b?.facts.program ?? 'standard', from: b?.facts.startDate ?? v.data.inclusionDate };
    }
    const d = [...refs.contracts.values()].find((x) => x.id === ref.db);
    return { program: d?.program ?? 'standard', from: d?.startDate ?? v.data.inclusionDate };
  };
  const batchInsured = out.insured?.valid ?? [];
  const byPinfl = new Map(batchInsured.map((v) => [v.data.pinfl, v]));
  const byCert = new Map(batchInsured.map((v) => [v.data.oldCertificate.toUpperCase(), v]));
  /** Resolves a person by PINFL and/or old certificate; both given must point to the same person. */
  const personOf = (pinfl: string | undefined, cert: string | undefined, row: number, c: Collector): { ref: MigrationRef; key: string; program: ProgramCode; from: string } | null => {
    const fromBatch = [pinfl ? byPinfl.get(pinfl) : undefined, cert ? byCert.get(cert.toUpperCase()) : undefined];
    const fromDb = [pinfl ? refs.insuredByPinfl.get(pinfl) : undefined, cert ? refs.insuredByCertificate.get(cert.toUpperCase()) : undefined];
    const found = [
      ...fromBatch.filter((x) => !!x).map((v) => ({ ref: { batch: v!.row } as MigrationRef, key: `b${v!.row}`, ...insuredFacts(v!) })),
      ...fromDb.filter((x) => !!x).map((v) => ({ ref: { db: v!.id } as MigrationRef, key: `d${v!.id}`, program: v!.program, from: v!.from })),
    ];
    if (found.length === 0) {
      c.error(row, pinfl ? 'pinfl' : 'oldCertificate', msg('migration.v.insuredNotFound'));
      return null;
    }
    if (new Set(found.map((x) => x.key)).size > 1) {
      c.error(row, 'oldCertificate', msg('migration.v.insuredMismatch'));
      return null;
    }
    return found[0]!;
  };

  // ---- used limits
  if (f.limits) {
    const c = new Collector();
    const parsed = parseRows(migrationLimitRowSchema, f.limits, c);
    const seen = new Map<string, number>();
    const res = parsed.map((p, idx) => {
      const row = idx + 2;
      if (!p) return null;
      const person = personOf(p.pinfl, p.oldCertificate, row, c);
      if (!person) return null;
      const key = `${person.key}:${p.category}`;
      const first = seen.get(key);
      if (first !== undefined) c.error(row, 'category', msg('migration.v.repeatedInFile', { row: first }));
      else seen.set(key, row);
      if ('db' in person.ref && refs.limits.has(`${person.ref.db}:${p.category}`)) c.error(row, 'category', msg('migration.v.limitExists'));
      const limit = PROGRAMS[person.program].limits[p.category as LimitCategory];
      if (p.usedAmount > limit) c.error(row, 'usedAmount', msg('migration.v.overLimit', { limit }));
      else if (p.usedAmount === limit) c.warn(row, 'usedAmount', msg('migration.v.limitExhausted'));
      return { data: p, ref: { insured: person.ref } };
    });
    out.limits = finish('limits', f.limits, res, c);
  }

  // ---- open claims
  if (f.claims) {
    const c = new Collector();
    const parsed = parseRows(migrationClaimRowSchema, f.claims, c);
    const seen = new Map<string, number>();
    const res = parsed.map((p, idx) => {
      const row = idx + 2;
      if (!p) return null;
      const key = p.oldNumber.toUpperCase();
      if (refs.claimNumbers.has(key)) c.error(row, 'oldNumber', msg('migration.v.claimExists'));
      const first = seen.get(key);
      if (first !== undefined) c.error(row, 'oldNumber', msg('migration.v.repeatedInFile', { row: first }));
      else seen.set(key, row);
      if (p.serviceDate > date) c.error(row, 'serviceDate', msg('migration.v.serviceAfterMigration'));
      if (p.reserve > p.amountClaimed) c.warn(row, 'reserve', msg('migration.v.reserveOverClaimed'));
      const person = personOf(p.pinfl, p.oldCertificate, row, c);
      if (!person) return null;
      if (p.serviceDate < person.from) c.warn(row, 'serviceDate', msg('migration.v.serviceBeforeCover'));
      return { data: p, ref: { insured: person.ref } };
    });
    out.claims = finish('claims', f.claims, res, c);
  }

  // ---- unpaid invoices
  if (f.invoices) {
    const c = new Collector();
    const parsed = parseRows(migrationInvoiceRowSchema, f.invoices, c);
    const seen = new Map<string, number>();
    const res = parsed.map((p, idx) => {
      const row = idx + 2;
      if (!p) return null;
      const key = p.oldNumber.toUpperCase();
      if (refs.invoiceNumbers.has(key)) c.error(row, 'oldNumber', msg('migration.v.invoiceExists'));
      const first = seen.get(key);
      if (first !== undefined) c.error(row, 'oldNumber', msg('migration.v.repeatedInFile', { row: first }));
      else seen.set(key, row);
      if ((p.dueDate ?? p.issuedAt) < date) c.warn(row, 'dueDate', msg('migration.v.overdue'));
      const contract = contractOf(p.contractOldNumber);
      if (!contract) {
        c.error(row, 'contractOldNumber', msg('migration.v.contractNotFound'));
        return null;
      }
      return { data: p, ref: { contract: contract.ref } };
    });
    out.invoices = finish('invoices', f.invoices, res, c);
  }
  return out;
}

// ---------------------------------------------------------------- reconciliation

const METRICS: { metric: MigrationMetric; step: MigrationStep; money: boolean }[] = [
  { metric: 'clients', step: 'clients', money: false },
  { metric: 'contracts', step: 'contracts', money: false },
  { metric: 'premium', step: 'contracts', money: true },
  { metric: 'insured', step: 'insured', money: false },
  { metric: 'limitsUsed', step: 'limits', money: true },
  { metric: 'claims', step: 'claims', money: false },
  { metric: 'reserves', step: 'claims', money: true },
  { metric: 'invoices', step: 'invoices', money: false },
  { metric: 'invoicesOutstanding', step: 'invoices', money: true },
];

export type LoadedTotals = Record<MigrationMetric, number>;

/**
 * Reconciliation: figures computed from the files against `loaded` — what the system holds for the batch
 * (after the load) or the rows to be written (before it). Rows with errors are shown as excluded.
 */
export function reconcile(steps: Partial<Record<MigrationStep, { fileTotals: MigrationTotals; validTotals: MigrationTotals }>>, loaded: LoadedTotals | null): MigrationReconRow[] {
  return METRICS.flatMap(({ metric, step, money }) => {
    const s = steps[step];
    if (!s) return [];
    const file = money ? s.fileTotals.amount : s.fileTotals.rows;
    const valid = money ? s.validTotals.amount : s.validTotals.rows;
    const got = loaded ? loaded[metric] : valid;
    return [{ metric, money, file, excluded: file - valid, loaded: got, match: got === file }];
  });
}

/** Totals of a batch from its records in the system. */
export function loadedTotals(records: {
  clients: number;
  contracts: { total: Money }[];
  insured: number;
  limitsUsed: Money;
  claims: { reserve: Money }[];
  invoices: { amount: Money; paid: Money }[];
}): LoadedTotals {
  return {
    clients: records.clients,
    contracts: records.contracts.length,
    premium: records.contracts.reduce((s, c) => s + c.total, 0),
    insured: records.insured,
    limitsUsed: records.limitsUsed,
    claims: records.claims.length,
    reserves: records.claims.reduce((s, c) => s + c.reserve, 0),
    invoices: records.invoices.length,
    invoicesOutstanding: records.invoices.reduce((s, i) => s + Math.max(0, i.amount - i.paid), 0),
  };
}

/** A step may be validated only when every earlier step is confirmed or skipped. */
export function stepAvailable(statuses: Partial<Record<MigrationStep, string>>, step: MigrationStep): boolean {
  const idx = MIGRATION_STEPS.indexOf(step);
  return MIGRATION_STEPS.slice(0, idx).every((s) => statuses[s] === 'confirmed' || statuses[s] === 'skipped');
}
