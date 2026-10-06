/*
 * Rows of the portfolio transfer files (/staff/admin/migration). One schema per file; the field names are
 * the CSV columns. The same schemas check a row in the screen (manual entry) and in the mock server.
 * Every value comes as a string from the CSV and is trimmed, length-limited and normalised.
 */
import { z } from 'zod';
import { msg } from '@/i18n';
import { LEGAL_FORMS } from '@/shared/config/legalForms';
import { digitsOnly } from '@/shared/lib/masks';
import { isoDateInput, phoneInput, pinflInput } from './forms';

/** Latin letters (with the Uzbek ʻ ʼ and their ASCII stand-ins), digits and common punctuation. */
const LATIN_ORG = /^[A-Za-z0-9][A-Za-z0-9 .,&'"()ʻʼ`’+/-]*$/;
/** «Surname Given Patronymic» in Latin script: 2–4 words. */
const LATIN_PERSON = /^[A-Za-zʻʼ'`’-]+(?: [A-Za-zʻʼ'`’-]+){1,3}$/;
/** Numbers of the previous system: ASCII letters, digits, «/», «.», «_», «-». */
const OLD_NUMBER = /^[A-Za-z0-9][A-Za-z0-9/._-]*$/;

const cell = (max: number) =>
  z
    .string({ required_error: msg('v.required'), invalid_type_error: msg('v.required') })
    .max(max * 4, msg('v.tooLong', { max }))
    .transform((v) => v.trim().replace(/\s+/g, ' '));

const required = (min: number, max: number) =>
  cell(max).pipe(
    z
      .string()
      .min(min, min <= 1 ? msg('v.required') : msg('v.tooShort', { min }))
      .max(max, msg('v.tooLong', { max })),
  );

const optional = (max: number) =>
  z
    .union([z.string(), z.undefined()])
    .transform((v) => (v ?? '').trim().replace(/\s+/g, ' '))
    .pipe(z.string().max(max, msg('v.tooLong', { max })))
    .transform((v) => (v === '' ? undefined : v));

export const latinOrgName = required(2, 120).pipe(z.string().regex(LATIN_ORG, msg('migration.v.latin')));
export const latinPersonName = required(5, 120).pipe(z.string().regex(LATIN_PERSON, msg('migration.v.latinPerson')));
export const oldNumber = required(1, 40).pipe(z.string().regex(OLD_NUMBER, msg('migration.v.oldNumber')));

/** Whole sums in UZS: spaces allowed («1 200 000»), no decimals, no sign. */
const money = (opts: { min?: number; required?: boolean } = {}) =>
  z
    .union([z.string(), z.undefined()])
    .transform((v) => (v ?? '').replace(/[\s\u00a0]/g, ''))
    .superRefine((v, ctx) => {
      if (v === '' && opts.required === false) return;
      if (!/^\d{1,13}$/.test(v)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: v === '' ? msg('v.required') : msg('migration.v.money') });
      else if (Number(v) < (opts.min ?? 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg('v.min', { min: opts.min ?? 0 }) });
    })
    .transform((v) => (v === '' ? 0 : Number(v)));

/** Like money(), but an empty cell is «not given» (undefined), not 0. */
const optionalMoney = (opts: { min?: number } = {}) =>
  z
    .union([z.string(), z.undefined()])
    .transform((v) => (v ?? '').replace(/[\s\u00a0]/g, ''))
    .superRefine((v, ctx) => {
      if (v === '') return;
      if (!/^\d{1,13}$/.test(v)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg('migration.v.money') });
      else if (Number(v) < (opts.min ?? 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg('v.min', { min: opts.min ?? 0 }) });
    })
    .transform((v) => (v === '' ? undefined : Number(v)));

/** A code of a fixed list, case-insensitive. */
const code = <T extends string>(values: readonly T[], message: string, fallback?: T) =>
  z
    .union([z.string(), z.undefined()])
    .transform((v) => (v ?? '').trim().toLowerCase())
    .superRefine((v, ctx) => {
      if (v === '' && fallback) return;
      if (!(values as readonly string[]).includes(v)) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    })
    .transform((v) => (v === '' && fallback ? fallback : (v as T)));

const date = cell(10).pipe(isoDateInput);
const optionalDate = z
  .union([z.string(), z.undefined()])
  .transform((v) => (v ?? '').trim())
  .pipe(z.union([z.literal('').transform(() => undefined), isoDateInput]));

const stir = cell(20)
  .transform((v) => digitsOnly(v))
  .pipe(z.string().regex(/^\d{9}$/, msg('v.innFormat')));

export const MIGRATION_PROGRAMS = ['basic', 'standard', 'standard_plus', 'premium'] as const;
export const MIGRATION_FREQUENCIES = ['single', 'quarterly', 'monthly'] as const;
export const MIGRATION_LIMIT_CATEGORIES = ['outpatient', 'dental', 'medicines', 'inpatient'] as const;
export const MIGRATION_CLAIM_CATEGORIES = ['medicines', 'doctor_visit', 'diagnostics', 'dental', 'inpatient'] as const;
/** Only open claims are transferred; closed ones stay in the archive of the previous system. */
export const MIGRATION_CLAIM_STATUSES = ['new', 'review', 'medical_review'] as const;

export const migrationClientRowSchema = z.object({
  name: latinOrgName,
  legalForm: code(LEGAL_FORMS, msg('migration.v.legalForm')),
  stir,
  bank: required(3, 120),
  account: cell(30)
    .transform((v) => digitsOnly(v))
    .pipe(z.string().regex(/^\d{20}$/, msg('v.accountFormat'))),
  mfo: cell(10)
    .transform((v) => digitsOnly(v))
    .pipe(z.string().regex(/^\d{5}$/, msg('v.mfoFormat'))),
  director: latinPersonName,
  directorBasis: optional(120),
  address: optional(200),
  hrName: latinPersonName,
  hrPhone: cell(20).pipe(phoneInput),
  hrEmail: cell(254)
    .transform((v) => v.toLowerCase())
    .pipe(z.string().min(1, msg('v.emailRequired')).max(254).email(msg('v.emailInvalid'))),
});

export const migrationContractRowSchema = z
  .object({
    oldNumber,
    clientStir: stir,
    startDate: date,
    endDate: date,
    program: code(MIGRATION_PROGRAMS, msg('migration.v.program')),
    /** Total premium of the contract. */
    premium: money({ min: 1 }),
    /**
     * Premium per person by type: an employee, a family member. Optional: without them every insured
     * person of the contract needs an individual premium (checked on the insured file, row by row).
     */
    premium_employee: optionalMoney({ min: 1 }),
    premium_family: optionalMoney(),
    paymentFrequency: code(MIGRATION_FREQUENCIES, msg('migration.v.frequency'), 'single'),
    /** Name of the assistance company; empty — MIG serves the client itself. */
    assistance: optional(120),
  })
  .superRefine((v, ctx) => {
    if (v.endDate <= v.startDate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: msg('v.endAfterStart') });
  });

export const MIGRATION_RELATIONS = ['employee', 'spouse', 'child', 'parent', 'other'] as const;

/**
 * A row per person (FAMILY_SPEC «Перенос портфеля»): an employee, or a family member with `relation` and the
 * employee's PINFL in `principal_pinfl` (an employee of the same file or already in the system, same contract).
 */
export const migrationInsuredRowSchema = z
  .object({
    fullName: latinPersonName,
    birthDate: date.pipe(z.string().refine((v) => Number(v.slice(0, 4)) >= 1920 && v <= new Date().toISOString().slice(0, 10), msg('v.birthDateCheck'))),
    pinfl: cell(20).pipe(pinflInput),
    /** Needed to sign in to the app; a row without it is loaded with a warning (not for a child). */
    phone: z
      .union([z.string(), z.undefined()])
      .transform((v) => (v ?? '').trim())
      .pipe(z.union([z.literal('').transform(() => undefined), phoneInput])),
    oldCertificate: oldNumber,
    inclusionDate: date,
    contractOldNumber: oldNumber,
    position: optional(80),
    /** Who the person is: empty — an employee. */
    relation: code(MIGRATION_RELATIONS, msg('v.relation'), 'employee'),
    /** The employee's PINFL for a family member. */
    principal_pinfl: z
      .union([z.string(), z.undefined()])
      .transform((v) => (v ?? '').trim())
      .pipe(z.union([z.literal('').transform(() => undefined), pinflInput])),
    /** Individual annual premium of this person; empty — by the contract's premium of the person's type. */
    premium: optionalMoney({ min: 1 }),
  })
  .superRefine((v, ctx) => {
    if (v.relation === 'employee' && v.principal_pinfl) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['principal_pinfl'], message: msg('v.principalForEmployee') });
    if (v.relation !== 'employee' && !v.principal_pinfl) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['principal_pinfl'], message: msg('v.principalRequired') });
  });

export const migrationLimitRowSchema = z
  .object({
    pinfl: z
      .union([z.string(), z.undefined()])
      .transform((v) => (v ?? '').trim())
      .pipe(z.union([z.literal('').transform(() => undefined), pinflInput])),
    oldCertificate: optional(40).pipe(z.string().regex(OLD_NUMBER, msg('migration.v.oldNumber')).optional()),
    category: code(MIGRATION_LIMIT_CATEGORIES, msg('migration.v.limitCategory')),
    usedAmount: money(),
  })
  .superRefine((v, ctx) => {
    if (!v.pinfl && !v.oldCertificate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pinfl'], message: msg('migration.v.insuredRefRequired') });
  });

export const migrationClaimRowSchema = z
  .object({
    oldNumber,
    pinfl: z
      .union([z.string(), z.undefined()])
      .transform((v) => (v ?? '').trim())
      .pipe(z.union([z.literal('').transform(() => undefined), pinflInput])),
    oldCertificate: optional(40).pipe(z.string().regex(OLD_NUMBER, msg('migration.v.oldNumber')).optional()),
    category: code(MIGRATION_CLAIM_CATEGORIES, msg('migration.v.claimCategory')),
    serviceDate: date,
    provider: required(2, 120),
    amountClaimed: money({ min: 1 }),
    reserve: money(),
    status: code(MIGRATION_CLAIM_STATUSES, msg('migration.v.openStatus')),
  })
  .superRefine((v, ctx) => {
    if (!v.pinfl && !v.oldCertificate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pinfl'], message: msg('migration.v.insuredRefRequired') });
  });

export const migrationInvoiceRowSchema = z
  .object({
    oldNumber,
    contractOldNumber: oldNumber,
    amount: money({ min: 1 }),
    paid: money({ required: false }),
    issuedAt: date,
    dueDate: optionalDate,
  })
  .superRefine((v, ctx) => {
    if (v.paid >= v.amount) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paid'], message: msg('migration.v.invoicePaid') });
    if (v.dueDate && v.dueDate < v.issuedAt) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dueDate'], message: msg('migration.v.dueBeforeIssued') });
  });

export type MigrationClientRow = z.output<typeof migrationClientRowSchema>;
export type MigrationContractRow = z.output<typeof migrationContractRowSchema>;
export type MigrationInsuredRow = z.output<typeof migrationInsuredRowSchema>;
export type MigrationLimitRow = z.output<typeof migrationLimitRowSchema>;
export type MigrationClaimRow = z.output<typeof migrationClaimRowSchema>;
export type MigrationInvoiceRow = z.output<typeof migrationInvoiceRowSchema>;

// ---------------------------------------------------------------- request bodies

const isoDay = /^\d{4}-\d{2}-\d{2}$/;

export const migrationBatchCreateSchema = z.object({
  /** Date the figures of the files are valid on (used limits, reserves). Not in the future. */
  migrationDate: z
    .string()
    .trim()
    .regex(isoDay, msg('v.dateFormat'))
    .refine((v) => v >= '2000-01-01' && v <= new Date().toISOString().slice(0, 10), msg('migration.v.migrationDate')),
});

/** A CSV file is sent as JSON `{ csv }` (≤ 1 MB, the size limit of the API). */
export const MIGRATION_CSV_MAX_BYTES = 900_000;
export const MIGRATION_CSV_MAX_ROWS = 5000;
export const migrationUploadSchema = z.object({ csv: z.string().max(MIGRATION_CSV_MAX_BYTES, msg('migration.v.fileTooLarge')) });
export const migrationConfirmSchema = z.object({ excludeErrors: z.boolean().default(false) });
export const migrationReasonSchema = z.object({ reason: z.string().trim().min(5, msg('v.reasonMin5')).max(500, msg('v.tooLong', { max: 500 })) });

/** Manual entry of one active contract: the fields of a contracts CSV row plus the migration date. */
export const migrationManualSchema = z.object({
  migrationDate: migrationBatchCreateSchema.shape.migrationDate,
  row: z.record(z.string().max(500)),
});
