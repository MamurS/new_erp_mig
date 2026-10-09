/*
 * Declarative database schema (BACKEND_SPEC §5, §6): one spec per collection of the repository registry
 * (repo.ts). Every field of every row type is described (`ColumnsOf<Row>`), so a field added to a type
 * later and not mapped here fails the build. `scripts/gen-schema.mjs` turns this file into the SQL
 * migrations of `supabase/migrations/` (committed; a test fails when they differ), `scripts/gen-seed-sql.mjs`
 * into `supabase/seed.sql`, `scripts/gen-rls-tests.mjs` into the pgTAP tests of `supabase/tests/`.
 *
 * Conventions (docs/backend/DATABASE.md):
 * - table = snake_case of the collection (`audit` is `audit_log`, BACKEND_SPEC §9), column = snake_case of the field;
 * - service columns start with `_`: `_pos` (storage order), `_created_at`, `_updated_at`, `_created_by`
 *   (many rows already have domain fields `createdAt`/`updatedAt` with their own meaning);
 * - log tables (no key) get a synthetic `_id uuid`;
 * - access (`access`) is written as row predicates over the table's columns, gated by actions of the
 *   permissions matrix; the generator turns it into RLS policies (docs/backend/RLS.md).
 */
import type { TaskAction, TaskStatus, TaskSubjectType } from '@mig/contracts/dto';
import type {
  AiProviderId,
  AiScenario,
  AiSettings,
  AppStatus,
  AppointmentStatus,
  AssistanceCaseStatus,
  AssistanceCaseType,
  AssistanceRole,
  AuditAction,
  AuditEntry,
  BankPayment,
  ChangeRequestType,
  ClaimCategory,
  ClaimIntakeChannel,
  ClaimSource,
  ClaimStatus,
  ClientDocument,
  ClientStatus,
  ClinicRole,
  ContractStatus,
  Deal,
  DealStage,
  DmsParamChangeStatus,
  Endorsement,
  EndorsementStatus,
  FamilyRelation,
  GuaranteeLetter,
  GuaranteeStatus,
  InsuredRelation,
  IntegrationMode,
  IntegrationModeOf,
  Invoice,
  KpStatus,
  LimitCategory,
  LimitChangeRequest,
  PartnerType,
  Payment,
  PaymentQueueReason,
  PolicyChangeKind,
  PolicyChangeStatus,
  PolicyStatus,
  PricingBasis,
  ProgramCode,
  QaSample,
  QuoteStatus,
  RebillStatus,
  Registry,
  RegistryStatus,
  Role,
  Specialty,
  StaffRole,
  UUID,
  Visit,
  WebhookDelivery,
  WebhookEvent,
  Appointment,
  Clinic,
  AuthorityChange,
} from '@mig/contracts';
import type { HelpAnswerStatus, HelpLocale } from '@mig/contracts/help';
import type { MigrationBatchStatus } from '@mig/contracts/migration';
import { LEGAL_FORMS } from '../config/legalForms';
import type { Action } from '../auth/permissions';
import { bigint, bool, date, enumOf, epoch, float, int, json, opt, orNull, snake, text, textArray, ts, uuid, virtual, type Column, type ColumnsOf, type PlainColumn } from './columns';
import type { ChallengeRow, Db, FileRow, MigrationBatchRow } from './db';
import { NESTED_KEYS, TABLE_KEYS, type KeyedName, type LogName, type NestedRows, type RowOf } from './repo';

// ------------------------------------------------------------------------------------------------
// Access rules (RLS)
// ------------------------------------------------------------------------------------------------

/**
 * A row predicate (SQL over the table's columns). `always` — not gated by the grant's actions; `actions` — gated by
 * these actions instead of the grant's (a second scope of the same group, docs/PRIVILEGED_AUDIT.md).
 */
export interface Scope {
  pred: string;
  always?: true;
  actions?: readonly Action[];
}
export type ScopeLike = string | Scope;
/** One scope, or several (the role passes when any of them applies). */
export type GroupScope = ScopeLike | readonly ScopeLike[];
export type RoleGroup = 'staff' | 'hr' | 'insured' | 'clinic' | 'assist';
export const ROLE_GROUPS: readonly RoleGroup[] = ['staff', 'hr', 'insured', 'clinic', 'assist'];

/**
 * Who may do an operation: a group of roles with a row predicate. A plain string predicate is allowed
 * when the current role's rule for at least one of `actions` is not `false` (app.can); `always()` skips
 * that check. `anyone` — any signed-in user. All policies also require `app.active()` (a user, a role,
 * and aal2 for MIG staff, clinics and assistance companies).
 */
export interface Grant {
  actions?: readonly Action[];
  staff?: GroupScope;
  hr?: GroupScope;
  insured?: GroupScope;
  clinic?: GroupScope;
  assist?: GroupScope;
  anyone?: string;
}
export interface Access {
  select?: Grant;
  insert?: Grant;
  update?: Grant;
  delete?: Grant;
  /** Why (goes to docs/backend/RLS.md). */
  note: string;
}
const ALL = 'true';
const always = (pred = ALL): Scope => ({ pred, always: true });
const rw = (g: Grant): Pick<Access, 'insert' | 'update'> => ({ insert: g, update: g });

// Predicates shared by many tables (functions of schema `app`, SECURITY DEFINER: no RLS recursion).
const HR_CLIENT = 'client_id = app.company_id()';
const INS_PERSONS = 'insured_id = any(app.my_person_ids())';
const INS_SELF = 'insured_id = app.insured_id()';
const INS_CARDS = 'insured_id = any(app.my_card_ids())';
const CLINIC_OWN = 'clinic_id = app.clinic_id()';
const ASSIST_OWN = 'assistance_id = app.assistance_id()';
const ASSIST_INSURED = (day: string) => `app.assist_covers_insured(insured_id, ${day})`;
const HR_CONTRACT = 'app.client_of_contract(contract_id) = app.company_id()';
const SYSTEM_ONLY: Access = { note: 'System only (service role in the API): no policy for `authenticated`.' };

// ------------------------------------------------------------------------------------------------
// Table specs
// ------------------------------------------------------------------------------------------------

export type IndexSpec = string | readonly string[] | { trgm: string } | { unique: readonly string[] };

export type TableKind = 'keyed' | 'log' | 'nested' | 'single';

export interface TableSpec {
  /** Name in the repository registry (`Repos`). */
  collection: string;
  table: string;
  kind: TableKind;
  /** Field holding the primary key; null for log tables (synthetic `_id`). */
  key: string | null;
  columns: Readonly<Record<string, Column>>;
  indexes: readonly IndexSpec[];
  access: Access;
}

interface Opts {
  table?: string;
  indexes?: readonly IndexSpec[];
  access: Access;
}

function spec(collection: string, kind: TableKind, key: string | null, columns: object, o: Opts): TableSpec {
  return { collection, table: o.table ?? snake(collection), kind, key, columns: columns as Record<string, Column>, indexes: o.indexes ?? [], access: o.access };
}
const keyed = <N extends KeyedName>(name: N, columns: ColumnsOf<RowOf<N>>, o: Opts): TableSpec => spec(name, 'keyed', TABLE_KEYS[name], columns, o);
const logTable = <N extends LogName>(name: N, columns: ColumnsOf<RowOf<N>>, o: Opts): TableSpec => spec(name, 'log', null, columns, o);
const nested = <N extends keyof NestedRows>(name: N, columns: ColumnsOf<NestedRows[N]>, o: Opts): TableSpec => spec(name, 'nested', NESTED_KEYS[name], columns, o);
const single = <R>(name: string, key: keyof R & string, columns: ColumnsOf<R>, o: Opts): TableSpec => spec(name, 'single', key, columns, o);

/** `enum` over a constant list (legal forms). */
const legalForm = (): PlainColumn<'enum'> => ({ kind: 'enum', values: LEGAL_FORMS });
const ROLE = enumOf<Role>();
const role = () =>
  ROLE('operator', 'underwriter', 'doctor_expert', 'accountant', 'admin', 'sales_manager', 'legal', 'claims_officer', 'hr', 'insured', 'clinic_registrar', 'clinic_admin', 'asst_operator', 'asst_doctor', 'asst_billing', 'asst_admin');
const program = () => enumOf<ProgramCode>()('basic', 'standard', 'standard_plus', 'premium');
const relation = () => enumOf<InsuredRelation>()('employee', 'spouse', 'child', 'parent', 'other');
const specialty = () => enumOf<Specialty>()('therapist', 'pediatrician', 'dentist', 'cardiologist', 'gynecologist', 'ent', 'neurologist', 'ophthalmologist');
const partnerType = () => enumOf<PartnerType>()('clinic', 'assistance');
const ref = (table: string) => uuid({ ref: table });
const money = bigint;

/** Rows of the singleton collections (no row type in Db: a map, a value, a set). */
export interface DmsParamValueRow {
  key: string;
  value: number | string;
  changedAt: string;
  changedByName: string;
}
export interface AiSettingsRow {
  id: number;
  settings: AiSettings;
}
export interface IntegrationsSeedRow {
  id: number;
  value: number;
}
export interface AiRebillFlagRow {
  lineId: UUID;
  reason: string;
}
export interface StatementKeyRow {
  key: string;
}

/** Collections of Db stored as Postgres sequences (repo `seq`). */
export const SEQUENCES = { kp: 'kpSeq', guarantee: 'guaranteeSeq', case: 'caseSeq', deal: 'dealSeq', contract: 'contractSeq' } as const satisfies Record<string, keyof Db>;
export const sequenceName = (name: keyof typeof SEQUENCES): string => `seq_${name}`;

// Staff-only reading of business records most MIG roles work with.
const STAFF_READ = (...actions: Action[]): Grant => ({ actions, staff: ALL });

export const TABLES: readonly TableSpec[] = [
  keyed(
    'staff',
    {
      id: uuid(),
      fullName: text(),
      email: text({ unique: true }),
      role: enumOf<StaffRole>()('operator', 'underwriter', 'doctor_expert', 'accountant', 'admin', 'sales_manager', 'legal', 'claims_officer'),
      active: bool(),
      lastLoginAt: opt(ts()),
      authority: json(),
      signatory: opt(json()),
      password: virtual('Supabase Auth keeps the credentials'),
    },
    {
      indexes: ['role'],
      access: {
        select: { staff: always() },
        ...rw({ actions: ['users.manage', 'staff.authority.manage'], staff: ALL }),
        note: 'Every MIG employee sees colleagues (names, roles, signatories); the admin manages accounts and authority.',
      },
    },
  ),
  keyed(
    'hrUsers',
    { id: uuid(), email: text({ unique: true }), password: virtual('Supabase Auth keeps the credentials'), fullName: text(), companyId: ref('clients'), lastLoginAt: opt(ts()) },
    {
      indexes: ['companyId'],
      access: {
        select: { actions: ['clients.read', 'users.manage', 'deals.manage'], staff: ALL, hr: always('id = app.uid()') },
        ...rw({ actions: ['users.manage', 'deals.manage', 'leads.manage'], staff: ALL }),
        note: 'HR sees only the own account; the sales manager creates the HR account of a won client.',
      },
    },
  ),
  keyed(
    'clients',
    {
      id: uuid(),
      legalForm: legalForm(),
      name: text(),
      inn: text(),
      status: enumOf<ClientStatus>()('lead', 'draft', 'negotiation', 'active', 'renewal', 'expired'),
      managerId: ref('staff'),
      managerName: text(),
      hrContact: json(),
      log: opt(json()),
      activePolicyId: opt(ref('policies')),
      assistanceId: orNull(ref('assistances')),
      program: opt(program()),
      premium: money(),
      lossRatio: orNull(float()),
      renewalDate: opt(date()),
      createdAt: ts(),
      requisites: opt(json()),
      estimatedHeadcount: opt(int()),
      currentInsurer: opt(text()),
      migration: opt(json()),
    },
    {
      indexes: ['status', 'managerId', { trgm: 'name' }, 'inn', 'renewalDate'],
      access: {
        select: { ...STAFF_READ('clients.read', 'leads.manage', 'deals.manage', 'contracts.read', 'invoices.read', 'policies.read', 'kp.read', 'policy_changes.read'), hr: always('id = app.company_id()') },
        ...rw({ actions: ['clients.write', 'leads.manage', 'deals.manage', 'contracts.draft', 'assistance.assign', 'migration.manage'], staff: ALL }),
        note: 'MIG staff with client access; HR — the own company only (name, requisites).',
      },
    },
  ),
  keyed(
    'policies',
    {
      id: uuid(),
      number: text({ unique: true }),
      clientId: ref('clients'),
      clientName: text(),
      clientLegalForm: opt(legalForm()),
      program: program(),
      startDate: date(),
      endDate: date(),
      status: enumOf<PolicyStatus>()('draft', 'active', 'expired', 'cancelled'),
      premium: money(),
      insuredCount: int(),
      tariff: opt(json()),
      assistanceId: orNull(ref('assistances')),
      familyCount: opt(int()),
      contractId: opt(ref('contracts')),
    },
    {
      indexes: ['clientId', 'status', 'endDate', 'contractId'],
      access: {
        select: {
          ...STAFF_READ('policies.read', 'policies.write', 'assistance.assign', 'contracts.read', 'claims.read', 'insured.read'),
          hr: HR_CLIENT,
          insured: 'id = app.my_policy_id()',
          assist: "app.assist_access(id) <> 'none'",
          actions: ['policies.read', 'policies.write', 'assistance.assign', 'contracts.read', 'claims.read', 'insured.read', 'assist.insured.search'],
        },
        ...rw({ actions: ['policies.write', 'assistance.assign', 'contracts.draft', 'policy_changes.decide'], staff: ALL }),
        note: 'HR — policies of the own company; the insured — the own policy; an assistance company — policies assigned to it today, read-only for 12 months after (ASSISTANCE_SPEC §3).',
      },
    },
  ),
  keyed(
    'insured',
    {
      id: uuid(),
      clientId: ref('clients'),
      clientName: text(),
      policyId: ref('policies'),
      fullName: text(),
      position: text(),
      relation: relation(),
      principalId: opt(ref('insured')),
      isStudent: opt(bool()),
      ageLimit: opt(json()),
      appStatus: enumOf<AppStatus>()('active', 'invited', 'not_invited'),
      myIdVerified: bool(),
      attachedClinicId: ref('clinics'),
      insuredFrom: date(),
      status: enumOf<'active' | 'excluded'>()('active', 'excluded'),
      certificateNumber: opt(text()),
      contractId: opt(ref('contracts')),
      externalCertificateNumber: opt(text()),
      migration: opt(json()),
      birthDate: date(),
      pinfl: text({ pii: 'encrypt+hmac' }),
      phone: text({ pii: 'encrypt+hmac' }),
      email: text(),
      payoutCard: text({ card: true }),
      consentGivenAt: opt(ts()),
      addedAt: ts(),
      excludedFrom: opt(date()),
      updatedAt: opt(ts()),
      userId: uuid(),
      migratedUsed: opt(json()),
      migratedPremium: opt(json()),
    },
    {
      indexes: ['clientId', 'policyId', 'status', { trgm: 'fullName' }, 'principalId', 'userId', 'attachedClinicId', 'contractId', 'pinfl_hmac', 'phone_hmac'],
      access: {
        select: {
          actions: ['insured.read', 'assist.insured.search', 'clinic.check_patient', 'policy_changes.decide'],
          staff: ALL,
          hr: HR_CLIENT,
          insured: 'id = any(app.my_family_ids())',
          clinic: 'id = any(app.clinic_patient_ids())',
          assist: "app.assist_access(policy_id) <> 'none'",
        },
        insert: { actions: ['policies.write', 'policy_changes.decide', 'hr.employees.manage'], staff: ALL, hr: HR_CLIENT },
        update: {
          actions: ['policies.write', 'policy_changes.decide', 'hr.employees.manage', 'family.self_service'],
          staff: ALL,
          hr: HR_CLIENT,
          insured: 'id = app.insured_id()',
        },
        note: 'HR — employees of the own company; the insured — self and the own family (names); a clinic — patients with an open visit; an assistance company — persons of policies assigned to it today, read-only for 12 months after. Ciphertexts of PINFL and phone are not readable by `authenticated` (column privileges); lists use the view `insured_masked`.',
      },
    },
  ),
  keyed(
    'claims',
    {
      id: uuid(),
      number: text({ unique: true }),
      insuredId: ref('insured'),
      insuredName: text(),
      clientId: ref('clients'),
      clientName: text(),
      category: enumOf<ClaimCategory>()('medicines', 'doctor_visit', 'diagnostics', 'dental', 'inpatient'),
      source: enumOf<ClaimSource>()('app', 'clinic_invoice', 'operator', 'assistance'),
      intakeChannel: opt(enumOf<ClaimIntakeChannel>()('hr_letter', 'phone', 'email', 'other')),
      amountClaimed: money(),
      amountApproved: opt(money()),
      providerName: text(),
      serviceDate: date(),
      status: enumOf<ClaimStatus>()('new', 'review', 'medical_review', 'approved', 'rejected', 'to_pay', 'paid'),
      slaDueAt: ts(),
      createdAt: ts(),
      updatedAt: ts(),
      attachments: json(),
      history: json(),
      approvedById: opt(uuid()),
      reserve: opt(money()),
      flags: opt(json()),
      opinion: opt(json({ pii: 'encrypt' })),
      decision: opt(json()),
      pendingDecision: opt(json()),
      appeal: opt(json()),
      handledBy: opt(enumOf<'mig' | 'assistance'>()('mig', 'assistance')),
      receiptFiscal: opt(json()),
      externalNumber: opt(text()),
      migration: opt(json()),
      publicRejectionReason: opt(text()),
      registryLineId: opt(uuid()),
      reserveHistory: opt(json()),
      receiptHash: opt(text()),
      expectedPrice: opt(money()),
    },
    {
      indexes: ['status', 'insuredId', 'clientId', 'createdAt', 'serviceDate', 'registryLineId', 'receiptHash'],
      access: {
        select: {
          actions: ['claims.read', 'claims.decide', 'claims.medical_opinion', 'claims.reserves', 'assist.registries.review', 'assist.cases.manage'],
          staff: ALL,
          insured: INS_PERSONS,
          assist: ASSIST_INSURED('service_date'),
        },
        insert: { actions: ['claims.create', 'claims.decide', 'registries.review', 'assist.cases.manage', 'assist.registries.review'], staff: ALL, insured: INS_PERSONS, assist: ASSIST_INSURED('service_date') },
        update: {
          actions: ['claims.transition', 'claims.decide', 'claims.medical_opinion', 'claims.reserves', 'claims.create', 'assist.registries.review', 'assist.cases.manage'],
          staff: ALL,
          insured: INS_PERSONS,
          assist: ASSIST_INSURED('service_date'),
        },
        note: 'The insured — own claims, children’s and of adults who gave consent (appeal, new claim); an assistance company — claims of persons assigned to it on the service date (reimbursements it handles).',
      },
    },
  ),
  keyed(
    'appointments',
    {
      id: uuid(),
      insuredId: ref('insured'),
      insuredName: text(),
      clientName: text(),
      clinicId: ref('clinics'),
      clinicName: text(),
      specialty: specialty(),
      startsAt: ts(),
      status: enumOf<AppointmentStatus>()('requested', 'confirmed', 'declined', 'completed', 'cancelled'),
      createdAt: ts(),
      respondedBy: opt(enumOf<NonNullable<Appointment['respondedBy']>>()('clinic', 'operator')),
      respondedAt: opt(ts()),
      proposedStartsAt: opt(ts()),
      declineReason: opt(text()),
      fromClinicSystem: opt(bool()),
    },
    {
      indexes: ['insuredId', 'clinicId', 'status', 'startsAt'],
      access: {
        select: {
          actions: ['appointments.read', 'appointments.manage', 'clinic.appointments.manage', 'assist.appointments.manage', 'assist.insured.search'],
          staff: ALL,
          insured: INS_PERSONS,
          clinic: CLINIC_OWN,
          assist: "app.assist_scope(app.policy_of_insured(insured_id), (created_at at time zone app.tz())::date) <> 'none'",
        },
        ...rw({
          actions: ['appointments.manage', 'clinic.appointments.manage', 'assist.appointments.manage'],
          staff: ALL,
          insured: INS_PERSONS,
          clinic: CLINIC_OWN,
          assist: ASSIST_INSURED('(starts_at at time zone app.tz())::date'),
        }),
        note: 'The insured books for self and the family; a clinic — appointments of the own clinic; an assistance company — reads requests of persons assigned to it on the date of the request (read-only for 12 months after), writes those of persons assigned on the visit date.',
      },
    },
  ),
  keyed(
    'clinics',
    {
      id: uuid(),
      name: text(),
      legalForm: legalForm(),
      address: text(),
      district: text(),
      specialties: textArray(),
      onlineBooking: bool(),
      apiStatus: enumOf<Clinic['apiStatus']>()('online', 'offline', 'manual'),
      contractUntil: date(),
      distanceKm: opt(float()),
      integrationMode: enumOf<IntegrationMode>()('portal', 'api', 'hybrid'),
      responseSlaMinutes: opt(int()),
    },
    {
      indexes: [{ trgm: 'name' }],
      access: {
        select: { staff: always(), insured: always(), clinic: always('id = app.clinic_id()'), assist: always(), hr: always() },
        insert: { actions: ['clinics.manage'], staff: ALL },
        update: { actions: ['clinics.manage', 'clinic.integration.manage'], staff: ALL, clinic: 'id = app.clinic_id()' },
        note: 'The clinic network is public to every signed-in role (names, addresses, specialties); a clinic sees only itself; the admin manages the network.',
      },
    },
  ),
  keyed(
    'audit',
    {
      id: uuid(),
      at: ts(),
      actorId: uuid(),
      actorName: text(),
      actorRole: role(),
      action: enumOf<AuditAction>()(
        'login', 'logout', 'login_failed', 'reveal_pii', 'open_medical', 'limit_change_request', 'limit_change_approve', 'limit_change_reject', 'claim_transition', 'export',
        'role_change', 'user_deactivate', 'hr_add_employee', 'hr_exclude_employee', 'hr_import', 'kp_created', 'kp_sent', 'kp_revoked', 'kp_downloaded', 'clinic_check_patient',
        'clinic_check_failed', 'guarantee_requested', 'guarantee_decided', 'registry_submitted', 'registry_line_decided', 'registry_paid', 'integration_key_created',
        'integration_key_revoked', 'webhook_created', 'policy_issued', 'policy_change_requested', 'policy_change_decided', 'assistance_assigned', 'case_created',
        'guarantee_escalated', 'clinic_payment_recorded', 'rebill_submitted', 'rebill_line_decided', 'rebill_paid', 'qa_reviewed', 'complaint_resolved', 'dms_param_proposed',
        'dms_param_changed', 'dms_param_rejected', 'authority_proposed', 'authority_changed', 'authority_rejected', 'lead_created', 'deal_stage_changed', 'deal_lost',
        'census_uploaded', 'quote_saved', 'quote_submitted', 'quote_approved', 'quote_rejected', 'kp_accepted', 'kp_declined', 'contract_created', 'contract_updated',
        'contract_legal_submitted', 'contract_legal_approved', 'contract_legal_returned', 'contract_finance_approved', 'contract_sent', 'contract_signed', 'contract_scan_uploaded',
        'contract_scan_verified', 'contract_original', 'contract_activated', 'contract_terminated', 'contract_expired', 'policy_expired', 'payment_recorded', 'payments_imported', 'payment_allocated',
        'change_request_created', 'endorsement_created', 'endorsement_signed', 'claim_opinion_requested', 'claim_opinion_given', 'claim_decided', 'claim_decision_escalated',
        'claim_decision_rejected', 'claim_reserve_changed', 'claim_created', 'claim_flag_dismissed', 'claim_appealed', 'claim_appeal_resolved', 'ai_settings_proposed',
        'ai_settings_changed', 'ai_settings_rejected', 'ai_kill_switch', 'ai_feedback', 'migration_validated', 'migration_submitted', 'migration_applied', 'migration_rejected',
        'migration_rolled_back', 'migration_scan_attached', 'family_consent_granted', 'family_consent_revoked', 'family_request_created', 'family_request_decided',
        'payout_card_changed', 'task_created', 'task_done', 'task_taken', 'task_rejected', 'task_reminded',
      ),
      targetType: enumOf<AuditEntry['targetType']>()(
        'insured', 'claim', 'policy', 'client', 'export', 'user', 'session', 'kp', 'clinic', 'visit', 'guarantee', 'registry', 'integration', 'assistance', 'case', 'rebill',
        'parameter', 'deal', 'quote', 'contract', 'endorsement', 'invoice', 'ai', 'migration',
      ),
      targetId: opt(text()),
      targetLabel: opt(text()),
      reason: opt(text()),
      assistanceId: opt(uuid()),
    },
    {
      table: 'audit_log',
      indexes: ['at', 'actorId', ['targetType', 'targetId'], 'action', 'assistanceId'],
      access: {
        select: { actions: ['audit.read', 'assist.users.manage'], staff: ALL, assist: ASSIST_OWN },
        note: 'Append-only: no INSERT/UPDATE/DELETE privilege for any role, entries are written by `app.audit()` (SECURITY DEFINER) with a hash chain. Read: the MIG admin; the assistance admin — actions of the own company.',
      },
    },
  ),
  keyed(
    'limitRequests',
    {
      id: uuid(),
      policyId: ref('policies'),
      policyNumber: text(),
      insuredId: opt(ref('insured')),
      category: enumOf<LimitCategory>()('outpatient', 'dental', 'medicines', 'inpatient'),
      from: money(),
      to: money(),
      justification: text(),
      requestedById: uuid(),
      requestedByName: text(),
      status: enumOf<LimitChangeRequest['status']>()('pending', 'approved', 'rejected'),
      decidedById: opt(uuid()),
      decidedByName: opt(text()),
      createdAt: ts(),
    },
    {
      indexes: ['status', 'policyId'],
      access: {
        select: STAFF_READ('limits.request_change', 'limits.approve_change', 'policies.read'),
        ...rw(STAFF_READ('limits.request_change', 'limits.approve_change')),
        note: 'MIG staff only (four-eyes is checked by the service).',
      },
    },
  ),
  keyed(
    'invoices',
    {
      id: uuid(),
      clientId: ref('clients'),
      number: text({ unique: true }),
      amount: money(),
      issuedAt: date(),
      dueDate: date(),
      status: enumOf<Invoice['status']>()('unpaid', 'paid', 'overdue'),
      contractId: opt(ref('contracts')),
      endorsementId: opt(ref('endorsements')),
      paid: opt(money()),
      externalNumber: opt(text()),
      migration: opt(json()),
    },
    {
      indexes: ['clientId', 'contractId', 'status', 'dueDate'],
      access: {
        select: { actions: ['invoices.read', 'payments.record', 'contracts.read'], staff: ALL, hr: HR_CLIENT },
        ...rw(STAFF_READ('payments.record', 'contracts.draft', 'contracts.sign_mig', 'endorsements.manage')),
        note: 'HR sees the own company’s invoices; MIG accounting records payments.',
      },
    },
  ),
  keyed(
    'documents',
    {
      id: uuid(),
      clientId: ref('clients'),
      title: text(),
      kind: enumOf<ClientDocument['kind']>()('policy', 'contract', 'invoice', 'act', 'program', 'kp', 'endorsement', 'insured_list'),
      createdAt: date(),
      kpId: opt(ref('kp')),
    },
    {
      indexes: ['clientId'],
      access: {
        select: { actions: ['clients.read', 'contracts.read', 'kp.read', 'invoices.read', 'policies.read'], staff: ALL, hr: HR_CLIENT },
        ...rw(STAFF_READ('kp.create', 'kp.send', 'contracts.draft', 'contracts.sign_mig', 'migration.manage', 'clients.write')),
        note: 'Documents of a client: MIG staff (also the policy card of policies.read) and the own company’s HR.',
      },
    },
  ),
  keyed(
    'insuredDocuments',
    { id: uuid(), insuredId: ref('insured'), title: text(), createdAt: date() },
    {
      indexes: ['insuredId'],
      access: {
        select: { actions: ['insured.read'], staff: ALL, insured: always(INS_PERSONS) },
        insert: STAFF_READ('insured.read'),
        note: 'Documents issued to a person (guarantee letters): MIG staff and the person (and the family that may see them).',
      },
    },
  ),
  keyed(
    'chat',
    { id: uuid(), from: enumOf<'insured' | 'operator'>()('insured', 'operator'), text: text({ pii: 'encrypt' }), at: ts(), insuredId: ref('insured'), visibleAt: ts() },
    {
      indexes: ['insuredId', 'at'],
      access: {
        select: { actions: ['appointments.manage', 'assist.cases.manage'], staff: ALL, insured: always(INS_SELF), assist: ASSIST_INSURED('current_date') },
        insert: { actions: ['appointments.manage', 'assist.cases.manage'], staff: ALL, insured: always(INS_SELF), assist: ASSIST_INSURED('current_date') },
        note: 'The chat of the insured with the operator (MIG or the assigned assistance company); messages are encrypted at rest.',
      },
    },
  ),
  keyed(
    'files',
    {
      id: uuid(),
      mime: enumOf<FileRow['mime']>()('image/jpeg', 'image/png', 'image/webp', 'application/pdf'),
      claimId: opt(ref('claims')),
      insuredId: opt(ref('insured')),
      bytes: opt(virtual('Bytes live in Supabase Storage (private buckets), the row keeps the metadata')),
      seedText: opt(textArray()),
      guaranteeId: opt(ref('guarantees')),
      clinicId: opt(ref('clinics')),
      fileName: opt(text()),
      contractId: opt(ref('contracts')),
      endorsementId: opt(ref('endorsements')),
      clientId: opt(ref('clients')),
    },
    {
      indexes: ['claimId', 'insuredId', 'guaranteeId', 'contractId', 'clientId'],
      access: {
        select: {
          actions: ['claims.read', 'guarantees.read', 'contracts.read', 'guarantees.request', 'contracts.sign_client', 'claims.create'],
          staff: ALL,
          insured: INS_PERSONS,
          clinic: CLINIC_OWN,
          hr: HR_CLIENT,
        },
        insert: {
          actions: ['claims.create', 'guarantees.request', 'contracts.sign_client', 'contracts.verify_scan', 'contracts.draft'],
          staff: ALL,
          insured: INS_PERSONS,
          clinic: CLINIC_OWN,
          hr: HR_CLIENT,
        },
        note: 'File metadata: receipts of the insured, attachments of the own clinic, signed scans of the own company for HR.',
      },
    },
  ),
  keyed('sessions', { id: text(), userId: uuid(), role: role(), createdAt: epoch(), lastActivity: epoch() }, { indexes: ['userId', 'lastActivity'], access: SYSTEM_ONLY }),
  keyed(
    'challenges',
    {
      id: text(),
      userId: uuid(),
      kind: enumOf<ChallengeRow['kind']>()('staff', 'hr', 'insured', 'clinic', 'assist'),
      expiresAt: epoch(),
      attempts: int(),
      lockKey: opt(text()),
    },
    { indexes: ['userId', 'expiresAt'], access: SYSTEM_ONLY },
  ),
  keyed('grants', { id: text(), userId: uuid(), insuredId: ref('insured'), expiresAt: epoch() }, { indexes: ['userId', 'expiresAt'], access: SYSTEM_ONLY }),
  keyed('lockouts', { key: text(), until: epoch() }, { indexes: ['until'], access: SYSTEM_ONLY }),
  keyed(
    'kp',
    {
      id: uuid(),
      number: text({ unique: true }),
      clientId: ref('clients'),
      clientName: text(),
      clientLegalForm: legalForm(),
      clientInn: text(),
      policyId: opt(ref('policies')),
      params: json(),
      templateVersion: text(),
      totalPremium: money(),
      status: enumOf<KpStatus>()('draft', 'sent', 'revoked', 'accepted', 'declined'),
      createdById: ref('staff'),
      createdByName: text(),
      createdByEmail: text(),
      createdAt: ts(),
      sentAt: opt(ts()),
      dealId: opt(ref('deals')),
      quoteId: opt(ref('quotes')),
      response: opt(json()),
    },
    {
      indexes: ['clientId', 'dealId', 'status'],
      access: {
        select: { actions: ['kp.read'], staff: ALL, hr: `${HR_CLIENT} and status <> 'draft'` },
        insert: STAFF_READ('kp.create', 'deals.manage'),
        update: { actions: ['kp.create', 'kp.send', 'kp.respond', 'deals.manage', 'quotes.approve'], staff: ALL, hr: `${HR_CLIENT} and status <> 'draft'` },
        note: 'Commercial offers: MIG staff; HR — sent offers of the own company (accept or decline).',
      },
    },
  ),
  keyed(
    'clinicUsers',
    {
      id: uuid(),
      email: text({ unique: true }),
      password: virtual('Supabase Auth keeps the credentials'),
      fullName: text(),
      clinicId: ref('clinics'),
      role: enumOf<ClinicRole>()('clinic_registrar', 'clinic_admin'),
      active: bool(),
      createdAt: ts(),
      lastLoginAt: opt(ts()),
    },
    {
      indexes: ['clinicId'],
      access: {
        select: { actions: ['clinics.manage', 'clinic.users.manage', 'clinics.read'], staff: ALL, clinic: always(CLINIC_OWN) },
        ...rw({ actions: ['clinic.users.manage'], staff: ALL, clinic: CLINIC_OWN }),
        note: 'Users of a clinic: colleagues of the own clinic; the clinic admin manages them (MIG admin — the first admin).',
      },
    },
  ),
  keyed(
    'priceLists',
    { clinicId: ref('clinics'), items: json() },
    {
      access: {
        select: {
          actions: ['clinics.read', 'clinics.manage', 'registries.review', 'guarantees.decide', 'assist.registries.review', 'assist.guarantees.decide', 'ai.coverage.mig', 'ai.coverage.assist'],
          staff: ALL,
          clinic: always(CLINIC_OWN),
          assist: always(),
        },
        ...rw({ actions: ['clinics.manage', 'clinic.integration.manage'], staff: ALL, clinic: CLINIC_OWN }),
        note: 'Price lists: the own clinic, MIG and every assistance company (the network list is the reference of its referrals and contracts).',
      },
    },
  ),
  keyed(
    'cardTokens',
    { token: text(), shortCode: text(), insuredId: ref('insured'), expiresAt: epoch(), usedAt: opt(epoch()) },
    {
      indexes: ['insuredId', 'shortCode', 'expiresAt'],
      access: {
        select: { insured: always(INS_CARDS) },
        insert: { insured: always(INS_CARDS) },
        delete: { insured: always(INS_CARDS) },
        note: 'The insured issues QR/short-code tokens of the own card and of the active family under them (FAMILY_SPEC: card); a clinic redeems a token through app.fact_redeem_card_token, not by reading the table.',
      },
    },
  ),
  keyed(
    'visits',
    {
      id: uuid(),
      clinicId: ref('clinics'),
      insuredId: ref('insured'),
      openedById: uuid(),
      method: enumOf<Visit['method']>()('qr', 'policy', 'api'),
      openedAt: ts(),
      expiresAt: ts(),
    },
    {
      indexes: ['clinicId', 'insuredId', 'expiresAt'],
      access: {
        select: {
          actions: ['guarantees.read', 'registries.review', 'clinic.check_patient', 'assist.guarantees.decide', 'assist.registries.review', 'assist.cases.manage'],
          staff: ALL,
          clinic: CLINIC_OWN,
          assist: ASSIST_INSURED('(opened_at at time zone app.tz())::date'),
        },
        insert: { actions: ['clinic.check_patient', 'assist.cases.manage'], clinic: CLINIC_OWN, assist: ASSIST_INSURED('(opened_at at time zone app.tz())::date') },
        note: 'Visits open access of a clinic to a patient: the own clinic; an assistance company opens a visit for a person assigned to it.',
      },
    },
  ),
  keyed(
    'checkLocks',
    { userId: uuid(), until: epoch() },
    { indexes: ['until'], access: SYSTEM_ONLY },
  ),
  keyed(
    'guarantees',
    {
      id: uuid(),
      number: text({ unique: true }),
      clinicId: ref('clinics'),
      visitId: ref('visits'),
      insuredName: text(),
      serviceCode: text(),
      serviceName: text(),
      icd10: text(),
      estimatedCost: money(),
      approvedAmount: opt(money()),
      validUntil: opt(date()),
      status: enumOf<GuaranteeStatus>()('requested', 'info_requested', 'approved', 'rejected', 'used', 'expired'),
      approvals: json(),
      reason: opt(text()),
      comment: opt(text()),
      attachments: json(),
      createdAt: ts(),
      assistanceId: orNull(ref('assistances')),
      assistanceName: opt(text()),
      escalated: opt(bool()),
      assistanceOpinion: opt(text()),
      decidedBy: opt(enumOf<NonNullable<GuaranteeLetter['decidedBy']>>()('assistance', 'mig')),
      insuredId: ref('insured'),
      policyId: opt(ref('policies')),
      infoComment: opt(text()),
      decidedAt: opt(ts()),
    },
    {
      indexes: ['clinicId', 'status', 'insuredId', 'assistanceId', 'visitId', 'createdAt'],
      access: {
        select: {
          actions: ['guarantees.read', 'guarantees.decide', 'assist.guarantees.decide', 'qa.review', 'guarantees.request', 'assist.cases.manage'],
          staff: ALL,
          clinic: CLINIC_OWN,
          assist: ASSIST_OWN,
        },
        insert: {
          actions: ['guarantees.request', 'assist.cases.manage'],
          clinic: CLINIC_OWN,
          assist: "assistance_id = app.assistance_id() and app.assist_scope(policy_id, (created_at at time zone app.tz())::date) = 'full'",
        },
        update: { actions: ['guarantees.decide', 'assist.guarantees.decide', 'guarantees.request'], staff: ALL, clinic: CLINIC_OWN, assist: ASSIST_OWN },
        note: 'Guarantee letters: the requesting clinic (also on a referral of the assistance company, which writes the letter of its own current client); the deciding assistance company; MIG doctors (escalations and clients without an assistance company).',
      },
    },
  ),
  keyed(
    'registries',
    {
      id: uuid(),
      clinicId: ref('clinics'),
      period: text(),
      status: enumOf<RegistryStatus>()('draft', 'submitted', 'in_review', 'partially_accepted', 'accepted', 'paid'),
      source: enumOf<Registry['source']>()('portal', 'csv', 'api'),
      lines: json(),
      totals: json(),
      submittedAt: opt(ts()),
      paidAt: opt(ts()),
    },
    {
      indexes: ['clinicId', 'status', 'period'],
      access: {
        select: {
          actions: ['registries.review', 'registries.pay', 'rebills.review', 'registries.submit', 'clinic.check_patient', 'assist.registries.review', 'assist.clinic_payments.record'],
          staff: ALL,
          clinic: CLINIC_OWN,
          assist: 'app.registry_has_payer(lines, app.assistance_id())',
        },
        insert: { actions: ['registries.submit'], clinic: CLINIC_OWN },
        update: {
          actions: ['registries.review', 'registries.pay', 'registries.submit', 'assist.registries.review', 'assist.clinic_payments.record'],
          staff: ALL,
          clinic: CLINIC_OWN,
          assist: 'app.registry_has_payer(lines, app.assistance_id())',
        },
        note: 'Registries of services: the own clinic; an assistance company — registries with lines it pays; MIG review and payment.',
      },
    },
  ),
  keyed(
    'integrationClients',
    {
      id: uuid(),
      clinicId: uuid(),
      partnerType: opt(partnerType()),
      name: text(),
      clientId: text({ unique: true }),
      secretLast4: text(),
      scopes: textArray(),
      ipAllowlist: textArray(),
      createdAt: ts(),
      lastUsedAt: opt(ts()),
      revokedAt: opt(ts()),
      secretHash: text(),
    },
    {
      indexes: ['clinicId'],
      access: {
        select: { actions: ['clinics.manage', 'clinic.integration.manage', 'assistance.manage', 'assist.integration.manage'], staff: always(), clinic: CLINIC_OWN, assist: 'clinic_id = app.assistance_id()' },
        ...rw({ actions: ['clinic.integration.manage', 'assist.integration.manage'], staff: ALL, clinic: CLINIC_OWN, assist: 'clinic_id = app.assistance_id()' }),
        note: 'API keys of a partner (`clinic_id` is the partner: a clinic or an assistance company); `secret_hash` is not readable by `authenticated`.',
      },
    },
  ),
  keyed(
    'accessTokens',
    { tokenHash: text(), clientRowId: ref('integrationClients'), scopes: textArray(), expiresAt: epoch() },
    { indexes: ['clientRowId', 'expiresAt'], access: SYSTEM_ONLY },
  ),
  keyed(
    'webhooks',
    {
      id: uuid(),
      clinicId: uuid(),
      partnerType: opt(partnerType()),
      url: text(),
      events: textArray(),
      secretLast4: text(),
      active: bool(),
      createdAt: ts(),
      signingSecret: text({ pii: 'encrypt' }),
    },
    {
      indexes: ['clinicId'],
      access: {
        select: { actions: ['clinics.manage', 'clinic.integration.manage', 'assistance.manage', 'assist.integration.manage'], staff: ALL, clinic: CLINIC_OWN, assist: 'clinic_id = app.assistance_id()' },
        ...rw({ actions: ['clinic.integration.manage', 'assist.integration.manage'], staff: ALL, clinic: CLINIC_OWN, assist: 'clinic_id = app.assistance_id()' }),
        note: 'Webhook endpoints of a partner; the signing secret is encrypted and not readable by `authenticated`.',
      },
    },
  ),
  keyed(
    'webhookDeliveries',
    {
      id: uuid(),
      endpointId: ref('webhooks'),
      event: enumOf<WebhookEvent>()(
        'appointment.requested', 'appointment.cancelled', 'guarantee.decided', 'guarantee.documents_requested', 'registry.reviewed', 'registry.paid', 'insured.added',
        'insured.excluded', 'policy.assigned', 'policy.unassigned', 'guarantee.requested', 'registry.received', 'rebill.reviewed', 'rebill.paid', 'qa.disagreement',
      ),
      status: enumOf<WebhookDelivery['status']>()('delivered', 'retrying', 'failed'),
      attempts: int(),
      lastAttemptAt: ts(),
      responseCode: opt(int()),
      clinicId: uuid(),
      objectId: uuid(),
      body: text(),
      signature: text(),
      nextAttemptAt: opt(ts()),
    },
    {
      indexes: ['endpointId', 'status', 'clinicId'],
      access: {
        select: { actions: ['clinics.manage', 'clinic.integration.manage', 'assistance.manage', 'assist.integration.manage'], staff: ALL, clinic: CLINIC_OWN, assist: 'clinic_id = app.assistance_id()' },
        update: { actions: ['clinic.integration.manage', 'assist.integration.manage'], clinic: CLINIC_OWN, assist: 'clinic_id = app.assistance_id()' },
        note: 'Delivery log of webhooks: read by the partner, whose integration admin records a manual retry; written by the API outbox (system).',
      },
    },
  ),
  keyed('idempotency', { key: text(), status: int(), body: text(), at: epoch() }, { indexes: ['at'], access: SYSTEM_ONLY }),
  keyed(
    'apiLogs',
    { id: uuid(), clientId: text(), at: ts(), method: text(), pathTemplate: text(), status: int(), latencyMs: int(), clinicId: uuid() },
    {
      indexes: ['clinicId', 'at'],
      access: {
        select: { actions: ['clinics.manage', 'clinic.integration.manage', 'assistance.manage', 'assist.integration.manage'], staff: ALL, clinic: CLINIC_OWN, assist: 'clinic_id = app.assistance_id()' },
        note: 'Partner API call log (no values): read by the partner and the MIG admin; written by the API (system).',
      },
    },
  ),
  keyed(
    'clinicEvents',
    { id: uuid(), clinicId: ref('clinics'), at: ts(), text: text() },
    {
      indexes: ['clinicId', 'at'],
      access: {
        select: { actions: ['clinics.manage'], staff: ALL, clinic: always(CLINIC_OWN) },
        note: 'Event feed of a clinic cabinet: the own clinic; written as a side effect by the API (system).',
      },
    },
  ),
  keyed(
    'policyChanges',
    {
      id: uuid(),
      clientId: ref('clients'),
      clientName: text(),
      policyId: ref('policies'),
      policyNumber: text(),
      kind: enumOf<PolicyChangeKind>()('add', 'exclude'),
      insuredId: opt(ref('insured')),
      fullName: text(),
      position: text(),
      relation: relation(),
      principalId: opt(ref('insured')),
      principalName: opt(text()),
      effectiveDate: date(),
      premiumDelta: money(),
      status: enumOf<PolicyChangeStatus>()('pending', 'approved', 'rejected'),
      requestedAt: ts(),
      requestedByName: text(),
      decidedAt: opt(ts()),
      decidedByName: opt(text()),
      rejectionReason: opt(text()),
      endorsementId: opt(uuid()),
      requestedById: uuid(),
      newPerson: opt(json({ pii: 'encrypt' })),
      familyRequestId: opt(ref('familyRequests')),
    },
    {
      indexes: ['clientId', 'policyId', 'status'],
      access: {
        select: { actions: ['policy_changes.read', 'policy_changes.decide', 'family.requests.decide'], staff: ALL, hr: HR_CLIENT },
        insert: { actions: ['policy_changes.request', 'hr.employees.manage', 'family.requests.decide'], hr: HR_CLIENT },
        update: { actions: ['policy_changes.decide', 'policy_changes.request'], staff: ALL, hr: `${HR_CLIENT} and status = 'pending'` },
        note: 'HR requests changes of the own company’s insured list; the underwriter decides. The new person’s data is encrypted.',
      },
    },
  ),
  keyed(
    'assistances',
    {
      id: uuid(),
      name: text(),
      legalForm: legalForm(),
      phone24x7: text(),
      integrationMode: enumOf<IntegrationModeOf>()('portal', 'api', 'hybrid'),
      contract: json(),
      kpi: opt(json()),
    },
    {
      access: {
        select: { staff: always(), assist: always('id = app.assistance_id()'), insured: always(), hr: always(), clinic: always() },
        ...rw({ actions: ['assistance.manage'], staff: ALL }),
        note: 'Assistance companies: names and the 24/7 phone are shown to the insured, HR and clinics; a company sees itself; the MIG admin manages them.',
      },
    },
  ),
  keyed(
    'assistUsers',
    {
      id: uuid(),
      email: text({ unique: true }),
      password: virtual('Supabase Auth keeps the credentials'),
      fullName: text(),
      assistanceId: ref('assistances'),
      role: enumOf<AssistanceRole>()('asst_operator', 'asst_doctor', 'asst_billing', 'asst_admin'),
      active: bool(),
      createdAt: ts(),
      lastLoginAt: opt(ts()),
    },
    {
      indexes: ['assistanceId'],
      access: {
        select: { actions: ['assistance.manage', 'assist.users.manage'], staff: always(), assist: always(ASSIST_OWN) },
        ...rw({ actions: ['assist.users.manage', 'assistance.manage'], staff: ALL, assist: ASSIST_OWN }),
        note: 'Users of an assistance company: colleagues of the own company; its admin manages them.',
      },
    },
  ),
  keyed(
    'cases',
    {
      id: uuid(),
      number: text({ unique: true }),
      assistanceId: ref('assistances'),
      insuredId: ref('insured'),
      insuredName: text(),
      type: enumOf<AssistanceCaseType>()('appointment', 'consultation', 'guarantee', 'complaint', 'emergency'),
      channel: enumOf<'phone' | 'chat' | 'app' | 'clinic'>()('phone', 'chat', 'app', 'clinic'),
      status: enumOf<AssistanceCaseStatus>()('open', 'in_progress', 'waiting', 'resolved'),
      slaDueAt: ts(),
      description: text({ pii: 'encrypt' }),
      resolution: opt(text({ pii: 'encrypt' })),
      links: json(),
      createdAt: ts(),
      policyId: ref('policies'),
      createdById: opt(uuid()),
      resolvedAt: opt(ts()),
    },
    {
      indexes: ['assistanceId', 'insuredId', 'status', 'createdAt'],
      access: {
        select: {
          actions: ['assist.cases.manage', 'qa.review', 'assistance.manage'],
          // Every MIG employee sees the cases that need attention on the card of the company (complaints, past the SLA).
          staff: [ALL, always("status <> 'resolved' and (type = 'complaint' or sla_due_at < now())")],
          assist: ASSIST_OWN,
        },
        ...rw({ actions: ['assist.cases.manage'], staff: ALL, assist: ASSIST_OWN }),
        note: 'Cases of an assistance company: the own company; MIG (complaints, quality control). Free texts are encrypted.',
      },
    },
  ),
  keyed(
    'rebills',
    {
      id: uuid(),
      number: text({ unique: true }),
      assistanceId: ref('assistances'),
      period: text(),
      lines: json(),
      fee: json(),
      totals: json(),
      status: enumOf<RebillStatus>()('draft', 'submitted', 'in_review', 'partially_accepted', 'accepted', 'paid'),
      acceptedById: opt(uuid()),
      paidById: opt(uuid()),
      submittedAt: opt(ts()),
      paidAt: opt(ts()),
    },
    {
      indexes: ['assistanceId', 'status'],
      access: {
        select: {
          actions: ['rebills.review', 'rebills.pay', 'assist.rebills.submit', 'assist.registries.review'],
          // Every MIG employee sees the submitted rebills of a company on its card; drafts stay the company's.
          staff: [ALL, always("status <> 'draft'")],
          assist: ASSIST_OWN,
        },
        ...rw({ actions: ['rebills.review', 'rebills.pay', 'assist.rebills.submit'], staff: ALL, assist: ASSIST_OWN }),
        note: 'Re-invoices of an assistance company to MIG: the own company; MIG review and payment.',
      },
    },
  ),
  keyed(
    'qaSamples',
    {
      id: uuid(),
      assistanceId: ref('assistances'),
      subject: json(),
      verdict: opt(enumOf<NonNullable<QaSample['verdict']>>()('agree', 'disagree')),
      comment: opt(text()),
      reviewedById: opt(uuid()),
      createdAt: ts(),
    },
    {
      indexes: ['assistanceId'],
      access: {
        select: { actions: ['qa.review', 'assistance.manage', 'assist.guarantees.decide', 'assist.users.manage'], staff: always(), assist: ASSIST_OWN },
        update: STAFF_READ('qa.review'),
        note: 'Quality control samples: MIG doctors review; the assistance company sees the verdicts on its decisions.',
      },
    },
  ),
  keyed(
    'authorityChanges',
    {
      id: uuid(),
      staffId: ref('staff'),
      staffName: text(),
      from: json(),
      to: json(),
      reason: text(),
      status: enumOf<AuthorityChange['status']>()('pending', 'applied', 'rejected'),
      proposedById: ref('staff'),
      proposedByName: text(),
      proposedAt: ts(),
      decidedByName: opt(text()),
      decidedAt: opt(ts()),
      rejectReason: opt(text()),
    },
    {
      indexes: ['staffId', 'status'],
      access: { select: STAFF_READ('staff.authority.manage', 'users.manage'), ...rw(STAFF_READ('staff.authority.manage')), note: 'Authority changes (four-eyes): MIG admins.' },
    },
  ),
  keyed(
    'deals',
    {
      id: uuid(),
      number: text({ unique: true }),
      clientId: ref('clients'),
      type: enumOf<Deal['type']>()('new', 'renewal'),
      stage: enumOf<DealStage>()('lead', 'census', 'quote', 'kp_sent', 'kp_accepted', 'contract_draft', 'contract_review', 'contract_sent', 'signing', 'awaiting_payment', 'active', 'lost'),
      ownerId: ref('staff'),
      underwriterId: opt(ref('staff')),
      expectedStart: opt(date()),
      lostReason: opt(text()),
      previousPolicyId: opt(ref('policies')),
      createdAt: ts(),
      updatedAt: ts(),
    },
    {
      indexes: ['clientId', 'stage', 'ownerId'],
      access: {
        select: STAFF_READ('deals.manage', 'leads.manage', 'contracts.read', 'quotes.calculate', 'census.upload', 'kp.send', 'kp.create', 'payments.record'),
        ...rw(STAFF_READ('deals.manage', 'leads.manage', 'quotes.calculate', 'quotes.approve', 'census.upload', 'kp.create', 'kp.send', 'contracts.draft', 'contracts.sign_mig', 'payments.record')),
        note: 'The sales pipeline: MIG staff only.',
      },
    },
  ),
  keyed(
    'dealEvents',
    { id: uuid(), dealId: ref('deals'), at: ts(), actorName: text(), text: text() },
    {
      indexes: ['dealId', 'at'],
      access: {
        select: STAFF_READ('deals.manage', 'leads.manage', 'contracts.read', 'quotes.calculate', 'census.upload', 'kp.send', 'kp.create'),
        insert: {
          ...STAFF_READ('deals.manage', 'leads.manage', 'quotes.calculate', 'quotes.approve', 'census.upload', 'kp.create', 'kp.send', 'contracts.draft', 'contracts.legal_approve', 'contracts.sign_mig', 'payments.record', 'tasks.ask'),
          hr: 'app.client_of_deal(deal_id) = app.company_id()',
        },
        note: 'Deal activity feed: MIG staff read it; HR writes the events of its own actions (an offer answered, a signature, a request) into the feed of the own company’s deal.',
      },
    },
  ),
  keyed(
    'censuses',
    { id: uuid(), dealId: ref('deals'), rows: json(), uploadedAt: ts() },
    { indexes: ['dealId'], access: { select: STAFF_READ('census.upload', 'quotes.calculate', 'deals.manage'), insert: STAFF_READ('census.upload'), note: 'Anonymous census (gender, birth year): MIG sales and underwriting.' } },
  ),
  keyed(
    'quotes',
    {
      id: uuid(),
      dealId: ref('deals'),
      program: program(),
      rates: json(),
      adjustments: json(),
      groupDiscountPct: float(),
      premiumEmployee: money(),
      premiumFamily: money(),
      total: money(),
      discountFromTariffPct: float(),
      pricingBasis: enumOf<PricingBasis>()('flat_by_type', 'age_banded'),
      ageBandRates: json(),
      status: enumOf<QuoteStatus>()('draft', 'pending_approval', 'approved', 'rejected'),
      approvals: json(),
      createdById: ref('staff'),
      createdByName: opt(text()),
      rejectReason: opt(text()),
      updatedAt: opt(ts()),
      belowMinException: opt(json()),
    },
    {
      indexes: ['dealId', 'status'],
      access: { select: STAFF_READ('quotes.calculate', 'quotes.approve', 'deals.manage', 'contracts.draft', 'kp.create'), ...rw(STAFF_READ('quotes.calculate', 'quotes.approve')), note: 'Quotes: MIG underwriting.' },
    },
  ),
  keyed(
    'contracts',
    {
      id: uuid(),
      number: text({ unique: true }),
      dealId: ref('deals'),
      clientId: ref('clients'),
      clientName: text(),
      version: int(),
      templateId: enumOf<'contract'>()('contract'),
      templateVersion: text(),
      params: json(),
      clauseOverrides: json(),
      insuredListId: opt(uuid()),
      insuredCount: opt(int()),
      status: enumOf<ContractStatus>()('draft', 'legal_review', 'approved', 'sent', 'signing', 'signed', 'active', 'terminated', 'expired'),
      signing: json(),
      createdAt: ts(),
      quoteId: opt(ref('quotes')),
      legalComment: opt(text()),
      legalApprovedByName: opt(text()),
      financeApprovedByName: opt(text()),
      financeDiffers: opt(bool()),
      versions: json(),
      policyId: opt(ref('policies')),
      terminatedAt: opt(date()),
      activatedAt: opt(ts()),
      externalNumber: opt(text()),
      migration: opt(json()),
      migratedScan: opt(json()),
    },
    {
      indexes: ['clientId', 'dealId', 'status'],
      access: {
        select: { actions: ['contracts.read', 'contracts.draft', 'contracts.legal_approve', 'contracts.sign_client'], staff: ALL, hr: `${HR_CLIENT} and ((status <> 'draft' and status <> 'legal_review') or app.hr_asked_contract(id))` },
        insert: STAFF_READ('contracts.draft'),
        update: {
          actions: ['contracts.draft', 'contracts.legal_approve', 'contracts.sign_mig', 'contracts.verify_scan', 'contracts.originals', 'payments.record', 'endorsements.manage', 'contracts.sign_client'],
          staff: ALL,
          hr: `${HR_CLIENT} and (status in ('sent', 'signing', 'signed', 'active') or app.hr_asked_contract(id))`,
        },
        note: 'Contracts: MIG staff; HR — contracts of the own company once sent (signing, the insured list), and a draft while MIG asks HR for its appendix 2 (an open request).',
      },
    },
  ),
  keyed(
    'contractInsured',
    { contractId: ref('contracts'), rows: json({ pii: 'encrypt' }) },
    {
      access: {
        select: { actions: ['contracts.read', 'contracts.draft', 'contracts.sign_client'], staff: ALL, hr: HR_CONTRACT },
        ...rw({ actions: ['contracts.draft', 'contracts.sign_client', 'hr.employees.manage'], staff: ALL, hr: HR_CONTRACT }),
        note: 'Appendix 2 (the insured list with personal data, encrypted): MIG contract staff and the own company’s HR.',
      },
    },
  ),
  keyed(
    'payments',
    {
      id: uuid(),
      invoiceId: opt(ref('invoices')),
      contractId: opt(ref('contracts')),
      amount: money(),
      paidAt: date(),
      payerInn: text(),
      purpose: text(),
      source: enumOf<Payment['source']>()('manual', '1c'),
      recordedByName: text(),
      matchedBy: opt(enumOf<NonNullable<Payment['matchedBy']>>()('number', 'inn_amount', 'manual')),
      bankPaymentId: opt(ref('bankPayments')),
      docNumber: opt(text()),
      comment: opt(text()),
    },
    { indexes: ['invoiceId', 'contractId'], access: { select: STAFF_READ('payments.record', 'invoices.read', 'contracts.read'), insert: STAFF_READ('payments.record'), note: 'Payments: MIG accounting and the readers of the contract card.' } },
  ),
  keyed(
    'bankPayments',
    {
      id: uuid(),
      docNumber: opt(text()),
      date: date(),
      amount: money(),
      payerInn: text(),
      payerName: opt(text()),
      payerLegalForm: opt(legalForm()),
      purpose: text(),
      reason: enumOf<PaymentQueueReason>()('third_party', 'over_remaining', 'several_numbers', 'ambiguous', 'amount_mismatch', 'no_invoices', 'unknown_payer'),
      importedAt: ts(),
      importedByName: text(),
      allocated: money(),
      status: enumOf<BankPayment['status']>()('pending', 'allocated'),
      allocations: json(),
    },
    { indexes: ['status', 'payerInn'], access: { select: STAFF_READ('payments.record'), ...rw(STAFF_READ('payments.record')), note: 'Bank statement queue: MIG accounting.' } },
  ),
  keyed(
    'changeRequests',
    {
      id: uuid(),
      contractId: ref('contracts'),
      type: enumOf<ChangeRequestType>()('add_insured', 'exclude_insured', 'change_program', 'other'),
      effectiveDate: date(),
      insuredId: opt(ref('insured')),
      payload: json(),
      requestedBy: json(),
      status: enumOf<'pending' | 'included' | 'cancelled'>()('pending', 'included', 'cancelled'),
      endorsementId: opt(ref('endorsements')),
      createdAt: opt(ts()),
      description: opt(text()),
      newPerson: opt(json({ pii: 'encrypt' })),
      policyChangeId: opt(ref('policyChanges')),
    },
    {
      indexes: ['contractId', 'status'],
      access: {
        select: { actions: ['contracts.read', 'endorsements.manage', 'policy_changes.read'], staff: ALL, hr: HR_CONTRACT },
        ...rw({ actions: ['endorsements.manage', 'contracts.draft', 'policy_changes.decide', 'policy_changes.request'], staff: ALL, hr: HR_CONTRACT }),
        note: 'Change requests of a contract: MIG staff; HR of the own company.',
      },
    },
  ),
  keyed(
    'endorsements',
    {
      id: uuid(),
      number: text({ unique: true }),
      contractId: ref('contracts'),
      kind: opt(enumOf<NonNullable<Endorsement['kind']>>()('changes', 'termination')),
      terminationDate: opt(date()),
      changeRequestIds: textArray(),
      lines: json(),
      total: money(),
      clauseOverrides: json(),
      status: enumOf<EndorsementStatus>()('draft', 'legal_review', 'approved', 'sent', 'signing', 'signed'),
      signing: json(),
      createdAt: opt(ts()),
      invoiceId: opt(ref('invoices')),
      refundDocument: opt(text()),
      amountsApprovedByName: opt(text()),
    },
    {
      indexes: ['contractId', 'status'],
      access: {
        select: { actions: ['contracts.read', 'endorsements.manage'], staff: ALL, hr: HR_CONTRACT },
        insert: STAFF_READ('endorsements.manage', 'contracts.draft', 'policy_changes.decide'),
        update: { actions: ['endorsements.manage', 'contracts.draft', 'contracts.legal_approve', 'contracts.sign_mig', 'contracts.verify_scan', 'contracts.sign_client'], staff: ALL, hr: HR_CONTRACT },
        note: 'Endorsements: MIG staff; HR of the own company (signing).',
      },
    },
  ),
  keyed(
    'migrationBatches',
    {
      id: uuid(),
      seq: int(),
      kind: enumOf<MigrationBatchRow['kind']>()('csv', 'manual'),
      status: enumOf<MigrationBatchStatus>()('draft', 'pending_approval', 'applied', 'rejected', 'rolled_back', 'discarded'),
      migrationDate: date(),
      createdAt: ts(),
      createdById: ref('staff'),
      createdByName: text(),
      files: json({ pii: 'encrypt' }),
      steps: json(),
      totals: opt(json()),
      contractPremiums: opt(json()),
      submittedAt: opt(ts()),
      decidedAt: opt(ts()),
      decidedById: opt(ref('staff')),
      decidedByName: opt(text()),
      rejectReason: opt(text()),
      appliedAt: opt(ts()),
      rolledBackAt: opt(ts()),
      rolledBackByName: opt(text()),
      rollbackReason: opt(text()),
      applied: opt(json()),
    },
    { indexes: ['status'], access: { select: STAFF_READ('migration.manage', 'migration.approve'), ...rw(STAFF_READ('migration.manage', 'migration.approve')), note: 'Portfolio transfer batches: MIG admins; the uploaded files (personal data) are encrypted.' } },
  ),
  keyed(
    'familyConsents',
    { id: uuid(), ownerId: ref('insured'), viewerId: ref('insured'), grantedAt: ts(), revokedAt: opt(ts()) },
    {
      indexes: ['ownerId', 'viewerId'],
      access: {
        select: { actions: ['insured.read'], staff: ALL, insured: always('owner_id = app.insured_id() or viewer_id = app.insured_id()') },
        ...rw({ actions: ['family.self_service'], insured: 'owner_id = app.insured_id()' }),
        note: 'Consents of adult family members: given and revoked only by the owner; the viewer sees that a consent exists.',
      },
    },
  ),
  keyed(
    'familyRequests',
    {
      id: uuid(),
      employeeId: ref('insured'),
      clientId: ref('clients'),
      fullName: text(),
      birthDate: date(),
      pinfl: text({ pii: 'encrypt+hmac' }),
      relation: enumOf<FamilyRelation>()('spouse', 'child', 'parent', 'other'),
      isStudent: opt(bool()),
      consentAt: ts(),
      status: enumOf<'pending' | 'approved' | 'rejected'>()('pending', 'approved', 'rejected'),
      createdAt: ts(),
      decidedAt: opt(ts()),
      decidedById: opt(uuid()),
      decidedByName: opt(text()),
      rejectionReason: opt(text()),
      policyChangeId: opt(ref('policyChanges')),
    },
    {
      indexes: ['employeeId', 'clientId', 'status', 'pinfl_hmac'],
      access: {
        select: { actions: ['insured.read', 'policy_changes.decide', 'family.self_service', 'family.requests.decide'], staff: ALL, insured: 'employee_id = app.insured_id()', hr: HR_CLIENT },
        insert: { actions: ['family.self_service'], insured: `employee_id = app.insured_id() and ${HR_CLIENT.replace('app.company_id()', 'app.my_client_id()')}` },
        update: { actions: ['family.requests.decide'], hr: HR_CLIENT },
        note: 'An employee asks to add a family member from the app; HR of the own company decides.',
      },
    },
  ),
  keyed(
    'tasks',
    {
      id: uuid(),
      action: enumOf<TaskAction>()(
        'census_upload', 'quote_calculate', 'quote_approve', 'kp_send', 'kp_respond', 'contract_draft', 'contract_requisites', 'insured_list', 'legal_review', 'sign_mig',
        'sign_client', 'invoice_pay', 'below_min_group', 'other',
      ),
      toRole: role(),
      subjectType: enumOf<TaskSubjectType>()('deal', 'contract', 'client'),
      subjectId: uuid(),
      clientId: ref('clients'),
      clientName: text(),
      title: text(),
      comment: text(),
      link: text(),
      createdByName: text(),
      createdAt: ts(),
      dueAt: ts(),
      dueDate: date(),
      status: enumOf<TaskStatus>()('open', 'in_progress', 'done', 'rejected'),
      assigneeName: opt(text()),
      doneAt: opt(ts()),
      doneByName: opt(text()),
      resolution: opt(text()),
      remindedAt: opt(ts()),
      subjectLabel: text(),
      subjectLink: text(),
      history: json(),
      contractId: opt(ref('contracts')),
      contractNumber: opt(text()),
      createdById: uuid(),
      assigneeId: opt(uuid()),
      dealId: opt(ref('deals')),
      dueSoonSent: opt(bool()),
      overdueSent: opt(bool()),
    },
    {
      indexes: ['status', 'toRole', 'assigneeId', 'clientId', 'createdById', ['subjectType', 'subjectId'], 'dealId'],
      access: {
        select: {
          actions: ['tasks.receive', 'tasks.ask'],
          staff: "to_role = app.role() or created_by_id = app.uid() or assignee_id = app.uid() or to_role <> 'hr'",
          hr: `to_role = 'hr' and ${HR_CLIENT}`,
        },
        insert: { actions: ['tasks.ask', 'tasks.request_hr'], staff: 'created_by_id = app.uid()', hr: `created_by_id = app.uid() and ${HR_CLIENT}` },
        update: {
          actions: ['tasks.receive', 'tasks.ask'],
          staff: "to_role = app.role() or created_by_id = app.uid() or assignee_id = app.uid() or to_role <> 'hr'",
          hr: `(to_role = 'hr' or created_by_id = app.uid()) and ${HR_CLIENT}`,
        },
        note: 'Requests between roles: MIG staff see the staff queues (and their own requests to HR); HR — requests to the own company.',
      },
    },
  ),
  keyed(
    'notifications',
    { id: uuid(), text: text(), detail: opt(text()), link: opt(text()), createdAt: ts(), read: bool(), userId: uuid() },
    {
      indexes: ['userId', 'createdAt'],
      access: {
        select: { anyone: 'user_id = app.uid()' },
        insert: { anyone: ALL },
        update: { anyone: 'user_id = app.uid()' },
        note: 'In-app notifications: anyone may notify anyone (task done, request answered), only the addressee reads and marks them.',
      },
    },
  ),
  // ---- log tables (no key) ----
  logTable('loginFailures', { key: text(), at: epoch() }, { indexes: ['key', 'at'], access: SYSTEM_ONLY }),
  logTable('checkAttempts', { userId: uuid(), at: epoch(), ok: bool() }, { indexes: ['userId', 'at'], access: SYSTEM_ONLY }),
  logTable('apiCalls', { clientRowId: ref('integrationClients'), at: epoch() }, { indexes: ['clientRowId', 'at'], access: SYSTEM_ONLY }),
  logTable(
    'misSlots',
    { clinicId: ref('clinics'), specialty: specialty(), startsAt: ts(), durationMin: int(), doctorRef: opt(text()) },
    {
      indexes: ['clinicId', 'startsAt'],
      access: {
        select: { actions: ['appointments.manage', 'clinic.appointments.manage', 'assist.appointments.manage'], staff: ALL, insured: ALL, clinic: CLINIC_OWN, assist: ALL },
        insert: { actions: ['clinic.appointments.manage'], clinic: CLINIC_OWN },
        delete: { actions: ['clinic.appointments.manage'], clinic: CLINIC_OWN },
        note: 'Free slots published by a clinic system: read by everyone who books; written by the clinic (or its API client, system).',
      },
    },
  ),
  logTable(
    'smsOutbox',
    { at: ts(), insuredId: ref('insured'), text: text() },
    { indexes: ['insuredId'], access: { select: STAFF_READ('users.manage'), note: 'Imitated SMS invitations (stage 1): MIG admin; written by the API (system).' } },
  ),
  logTable(
    'assignments',
    { policyId: ref('policies'), assistanceId: orNull(ref('assistances')), from: date(), to: opt(date()), setById: uuid(), setAt: ts() },
    {
      indexes: ['policyId', 'assistanceId'],
      access: {
        select: { staff: always(), assist: always(ASSIST_OWN) },
        insert: STAFF_READ('assistance.assign', 'contracts.draft', 'contracts.sign_mig', 'payments.record'),
        update: STAFF_READ('assistance.assign'),
        note: 'Assignment of policies to assistance companies by date: MIG staff; a company sees its own assignments.',
      },
    },
  ),
  logTable(
    'clinicContracts',
    { clinicId: ref('clinics'), payer: text(), priceList: json() },
    {
      indexes: ['clinicId'],
      access: {
        select: { actions: ['clinics.manage', 'registries.review', 'assistance.manage', 'assist.registries.review', 'clinic.check_patient'], staff: ALL, clinic: always(CLINIC_OWN), assist: always('payer = app.assistance_id()::text') },
        ...rw(STAFF_READ('clinics.manage', 'assistance.manage')),
        note: 'Clinic contracts with a payer (MIG or an assistance company): the clinic, the payer (every user of the assistance company: its network page) and MIG.',
      },
    },
  ),
  // ---- nested collections ----
  nested(
    'dmsParamChanges',
    {
      id: uuid(),
      key: text(),
      from: json(),
      to: json(),
      reason: text(),
      status: enumOf<DmsParamChangeStatus>()('pending', 'applied', 'rejected'),
      proposedById: ref('staff'),
      proposedByName: text(),
      proposedAt: ts(),
      decidedById: opt(ref('staff')),
      decidedByName: opt(text()),
      decidedAt: opt(ts()),
      rejectReason: opt(text()),
    },
    { indexes: ['status'], access: { select: STAFF_READ('dms_params.read'), ...rw(STAFF_READ('dms_params.propose', 'dms_params.approve')), note: 'Parameter change requests (four-eyes): MIG staff.' } },
  ),
  nested(
    'aiChanges',
    {
      id: uuid(),
      to: json(),
      from: json(),
      reason: text(),
      status: enumOf<'pending' | 'applied' | 'rejected'>()('pending', 'applied', 'rejected'),
      proposedById: ref('staff'),
      proposedByName: text(),
      proposedAt: ts(),
      decidedByName: opt(text()),
      decidedAt: opt(ts()),
      rejectReason: opt(text()),
    },
    { indexes: ['status'], access: { select: STAFF_READ('ai.admin'), ...rw(STAFF_READ('ai.admin')), note: 'AI settings changes (four-eyes): MIG admins.' } },
  ),
  nested(
    'aiLogs',
    {
      id: uuid(),
      at: ts(),
      scenario: enumOf<AiScenario>()('insured', 'clinic', 'decision', 'rebill', 'help'),
      promptVersion: text(),
      provider: enumOf<AiProviderId>()('mock', 'local', 'external'),
      model: text(),
      inputHash: text(),
      inputRedacted: text(),
      output: json(),
      confidence: float(),
      latencyMs: int(),
      userId: uuid(),
      userRole: role(),
      subject: opt(json()),
      suspicious: bool(),
      feedback: opt(json()),
    },
    {
      indexes: ['at', 'userId'],
      access: {
        select: { actions: ['ai.admin'], staff: ALL, anyone: 'user_id = app.uid()' },
        insert: { anyone: 'user_id = app.uid()' },
        update: { actions: ['ai.admin'], staff: ALL, anyone: 'user_id = app.uid()' },
        delete: STAFF_READ('ai.admin'),
        note: 'AI call log (redacted input, no personal data): every user logs the own calls; MIG AI admins review.',
      },
    },
  ),
  nested(
    'helpQuestions',
    {
      id: uuid(),
      at: ts(),
      role: role(),
      locale: enumOf<HelpLocale>()('ru', 'uz-Latn', 'en'),
      question: text(),
      status: enumOf<Exclude<HelpAnswerStatus, 'disabled'>>()('answered', 'no_answer'),
      sources: textArray(),
      feedback: opt(json()),
      askerId: uuid(),
    },
    {
      indexes: ['at', 'askerId'],
      access: {
        select: { actions: ['ai.admin'], staff: ALL, anyone: 'asker_id = app.uid()' },
        insert: { anyone: 'asker_id = app.uid()' },
        update: { anyone: 'asker_id = app.uid()' },
        note: 'Questions of the help «Ask a question» (redacted): the asker rates the answer; MIG AI admins review.',
      },
    },
  ),
  // ---- singletons ----
  single<DmsParamValueRow>(
    'dmsParamValues',
    'key',
    { key: text(), value: json(), changedAt: ts(), changedByName: text() },
    { access: { select: { anyone: ALL }, ...rw(STAFF_READ('dms_params.approve')), note: 'Current values of DMS parameters (only changed ones): read by every role (limits, ages, deadlines); applied after the second confirmation.' } },
  ),
  single<AiSettingsRow>(
    'aiSettings',
    'id',
    { id: int(), settings: json() },
    { access: { select: { anyone: ALL }, update: STAFF_READ('ai.admin'), note: 'AI settings (one row): read by everyone (kill switch), changed by MIG AI admins.' } },
  ),
  single<IntegrationsSeedRow>('integrationsSeed', 'id', { id: int(), value: int() }, { access: { select: { anyone: ALL }, note: 'Seed of the demo integration status figures (one row).' } }),
  single<AiRebillFlagRow>(
    'aiRebillFlags',
    'lineId',
    { lineId: uuid(), reason: text() },
    {
      access: {
        select: { actions: ['rebills.review', 'rebills.pay', 'assist.rebills.submit'], staff: ALL },
        ...rw(STAFF_READ('rebills.review')),
        delete: STAFF_READ('rebills.review'),
        note: 'AI precheck flags of rebill lines: MIG reviewers read them; the reviewer of rebills sets and clears them (the AI precheck).',
      },
    },
  ),
  single<StatementKeyRow>(
    'statementKeys',
    'key',
    { key: text() },
    { access: { select: STAFF_READ('payments.record'), insert: STAFF_READ('payments.record'), note: 'Keys of imported bank statement lines: MIG accounting.' } },
  ),
];

/**
 * Who may get the ciphertext of an `encrypt+hmac` field through `app.reveal()` (audited): roles with one of
 * the actions (and the row visible to them), or the person themself.
 */
export const REVEAL: Readonly<Record<string, { actions: readonly Action[]; self: string }>> = {
  insured: { actions: ['insured.reveal_pii', 'assist.insured.reveal_pii'], self: "app.role() = 'insured' and id = app.insured_id()" },
  familyRequests: { actions: ['insured.reveal_pii'], self: "app.role() = 'insured' and employee_id = app.insured_id()" },
};

/**
 * Enum values added after their table was created: the table's own migration keeps the CHECK it was created with,
 * the named later migration widens it (migrations only go forward).
 */
export const LATER_ENUM_VALUES: readonly { collection: string; field: string; migration: string; values: readonly string[] }[] = [
  { collection: 'audit', field: 'action', migration: '20261013000100_job_actions.sql', values: ['contract_expired', 'policy_expired'] },
];

/** Values of an enum field its table was created with (LATER_ENUM_VALUES left out). */
export function initialEnumValues(collection: string, field: string, values: readonly string[]): readonly string[] {
  const later = new Set(LATER_ENUM_VALUES.filter((x) => x.collection === collection && x.field === field).flatMap((x) => x.values));
  return values.filter((v) => !later.has(v));
}

/**
 * Collections of Db that are not tables: Postgres sequences and objects split into the tables above; `jobMarks` is
 * `app.job_marks` of a later migration (system-only, store/sql/migrationsJobs.ts).
 */
export const NON_TABLE_COLLECTIONS = ['kpSeq', 'guaranteeSeq', 'caseSeq', 'dealSeq', 'contractSeq', 'integrationsSeed', 'statementKeys', 'dmsParams', 'ai', 'help', 'jobMarks'] as const satisfies readonly (keyof Db)[];
// Every collection of Db is stored somewhere: a keyed table, a log table, or one of the above.
type Stored = KeyedName | LogName | (typeof NON_TABLE_COLLECTIONS)[number];
export const _allCollectionsStored: [Exclude<keyof Db, Stored>] extends [never] ? true : { unmapped: Exclude<keyof Db, Stored> } = true;
// …and every repository has exactly one table.
type SpecNames = KeyedName | LogName | keyof NestedRows | 'dmsParamValues' | 'aiSettings' | 'integrationsSeed' | 'aiRebillFlags' | 'statementKeys';
export const SPEC_NAMES: readonly SpecNames[] = TABLES.map((t) => t.collection as SpecNames);

/** The spec of a repository collection. */
export function tableOf(collection: string): TableSpec {
  const t = TABLES.find((x) => x.collection === collection);
  if (!t) throw new Error(`No table for collection ${collection}`);
  return t;
}

// ------------------------------------------------------------------------------------------------
// List queries (migration `list_queries`, docs/backend/DATABASE.md, section "List queries")
// ------------------------------------------------------------------------------------------------

/**
 * A key of a list index: a field (its column), optionally with the collation the lists sort it by (`fullName@ru`,
 * `name@legal`; store/query.ts `Collation`), or a column of the table. Every list index ends with `_pos` (the unique
 * last key of every order), so `(scope, sort, _pos)` serves «filter, order, page» without a sort step.
 */
export type ListIndexKey = string;

export interface ListQuerySpec {
  /**
   * Text fields with a search key: a generated column `<column>_sk = app.search_key(<column>)` (lib/searchNormalize.ts
   * `searchKey`, mirrored in SQL) with a trigram index — the `search` operator of the lists compares it with LIKE.
   */
  search?: readonly string[];
  /** Composite indexes of the lists (filter columns, then the sort column; `_pos` is appended). */
  indexes?: readonly (readonly ListIndexKey[])[];
}

/**
 * Search keys and list indexes, by collection. They come in a later migration than the tables (migrations only go
 * forward), so they are declared here and not in the table specs above.
 */
export const LIST_QUERIES: Readonly<Record<string, ListQuerySpec>> = {
  clients: { search: ['name'], indexes: [['name@legal'], ['status', 'name@legal'], ['managerId', 'name@legal']] },
  policies: { search: ['number', 'clientName'], indexes: [['endDate'], ['clientId', 'endDate'], ['status', 'endDate']] },
  insured: {
    search: ['fullName', 'position'],
    indexes: [['fullName@ru'], ['clientId', 'fullName@ru'], ['clientId', 'relation', 'fullName@ru'], ['policyId', 'fullName@ru'], ['principalId', 'status']],
  },
  claims: {
    search: ['number', 'insuredName', 'clientName', 'externalNumber'],
    indexes: [['createdAt'], ['status', 'createdAt'], ['clientId', 'createdAt'], ['insuredId', 'createdAt']],
  },
  appointments: { search: ['insuredName', 'clinicName'], indexes: [['startsAt'], ['clinicId', 'startsAt'], ['insuredId', 'startsAt'], ['status', 'startsAt']] },
  clinics: { search: ['name', 'district'], indexes: [['name@legal']] },
  audit: { indexes: [['actorId'], ['assistanceId'], ['action']] },
  policyChanges: { search: ['fullName', 'position'], indexes: [['clientId', 'kind', 'relation'], ['insuredId', 'kind', 'status']] },
};

/** The list-query spec of a collection (empty for most). */
export function listQueriesOf(collection: string): ListQuerySpec {
  return LIST_QUERIES[collection] ?? {};
}

