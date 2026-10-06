/*
 * In-memory "server" database. Rows hold full (unmasked) values; handlers mask on output.
 */
import type {
  AiCallLog,
  AiSettings,
  AiSettingsChange,
  AuthorityChange,
  Census,
  ChangeRequest,
  Contract,
  Deal,
  DealEvent,
  Endorsement,
  BankPayment,
  Payment,
  Quote,
  ReserveChange,
  DmsParamChange,
  DmsParamKey,
  NumberingParamKey,
  Appointment,
  AuditEntry,
  ChatMessage,
  Claim,
  Client,
  ClientDocument,
  ApiCallLog,
  Clinic,
  ClinicRole,
  GuaranteeLetter,
  IntegrationClient,
  PolicyChange,
  PriceListItem,
  AssistanceAssignment,
  AssistanceCase,
  AssistanceCompany,
  AssistanceRole,
  ClinicContract,
  QaSample,
  Rebill,
  Registry,
  Specialty,
  Visit,
  WebhookDelivery,
  WebhookEndpoint,
  Insured,
  Invoice,
  LimitCategory,
  KpDocument,
  LimitChangeRequest,
  Policy,
  Role,
  StaffUser,
  UUID,
} from '@/shared/types';
import type { MigrationBatchStatus, MigrationIssue, MigrationStep, MigrationStepStatus, MigrationTotals } from '@/shared/types/migration';

export interface StaffRow extends StaffUser {
  password: string;
}
export interface HrUserRow {
  id: UUID;
  email: string;
  password: string;
  fullName: string;
  companyId: UUID;
  lastLoginAt?: string;
}
export interface ClinicUserRow {
  id: UUID;
  email: string;
  password: string;
  fullName: string;
  clinicId: UUID;
  role: ClinicRole;
  active: boolean;
  createdAt: string;
  lastLoginAt?: string;
}
/** One-time QR / short-code token of the insured card (CLINIC_SPEC §3). */
export interface CardTokenRow {
  token: string;
  shortCode: string; // 8 chars without the dash
  insuredId: UUID;
  expiresAt: number;
  usedAt?: number;
}
export interface GuaranteeRow extends GuaranteeLetter {
  insuredId: UUID;
  /** Policy of the patient: the payer is resolved on the date of the request (ASSISTANCE_SPEC §5.2). */
  policyId?: UUID;
  infoComment?: string; // clinic's answer to «нужны документы»
  /** Time of the final decision (KPI «ГП решены в срок»). */
  decidedAt?: string;
}
export interface IntegrationClientRow extends IntegrationClient {
  secretHash: string; // SHA-256 hex; the secret itself is never stored
}
export interface AccessTokenRow {
  tokenHash: string;
  clientRowId: UUID;
  scopes: string[];
  expiresAt: number;
}
export interface WebhookEndpointRow extends WebhookEndpoint {
  /** HMAC key. Needed in clear to sign; never returned. The backend keeps it encrypted (DECISIONS). */
  signingSecret: string;
}
export interface WebhookDeliveryRow extends WebhookDelivery {
  clinicId: UUID;
  objectId: UUID;
  body: string;
  signature: string;
  nextAttemptAt?: string;
}
export interface IdempotencyRow {
  key: string; // clientId + method + path + Idempotency-Key
  status: number;
  body: string;
  at: number;
}
export interface ApiCallLogRow extends ApiCallLog {
  clinicId: UUID;
}
export interface AssistUserRow {
  id: UUID;
  email: string;
  password: string;
  fullName: string;
  assistanceId: UUID;
  role: AssistanceRole;
  active: boolean;
  createdAt: string;
  lastLoginAt?: string;
}
export interface AssistanceCaseRow extends AssistanceCase {
  policyId: UUID;
  createdById?: UUID;
  resolvedAt?: string;
}
export interface ClinicEventRow {
  id: UUID;
  clinicId: UUID;
  at: string;
  text: string;
}

export interface ClientRow extends Omit<Client, 'hrContact' | 'insuredCount'> {
  hrContact: { name: string; phone: string; email: string };
}
export interface InsuredRow extends Omit<Insured, 'birthDateMasked' | 'pinflMasked' | 'phoneMasked'> {
  birthDate: string;
  pinfl: string;
  phone: string;
  email: string;
  payoutCard: string;
  consentGivenAt?: string;
  addedAt: string;
  excludedFrom?: string;
  /** Last change of the person's status (added, excluded) — `updatedSince` of the assistance roster. */
  updatedAt?: string;
  userId: UUID;
  /** Used limits by category as of the migration date (transferred from the previous system). */
  migratedUsed?: Partial<Record<LimitCategory, number>>;
}
/** Change request of the insured list; personal data of a new person stays on the server only. */
export interface PolicyChangeRow extends PolicyChange {
  requestedById: UUID;
  newPerson?: { birthDate: string; pinfl: string; phone: string };
}
export interface ClaimRow extends Claim {
  /** Plain-language reason for the insured person (no internal comments). */
  publicRejectionReason?: string;
  /** Set for claims created from an accepted line of a clinic registry. */
  registryLineId?: UUID;
  /** History of the claim reserve with authors (LIFECYCLE_SPEC §13). */
  reserveHistory?: ReserveChange[];
  /** SHA-256 of the receipt image (duplicate check). */
  receiptHash?: string;
  /** Price of the service by the price list, when known (flag «Сумма выше прайса»). */
  expectedPrice?: number;
}
export interface FileRow {
  id: UUID;
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  claimId?: UUID;
  insuredId?: UUID;
  /** Uploaded bytes (kept in memory only). Seeded receipts are rendered on demand. */
  bytes?: Uint8Array;
  seedText?: string[];
  /** Attachment of a guarantee letter: visible to its clinic and to MIG staff with guarantees.read. */
  guaranteeId?: UUID;
  clinicId?: UUID;
  fileName?: string;
  /** Signed scan of a contract or an endorsement: visible to MIG staff with contracts.read and the client's HR. */
  contractId?: UUID;
  endorsementId?: UUID;
  clientId?: UUID;
}
export interface ChatRow extends ChatMessage {
  insuredId: UUID;
  visibleAt: string;
}
export interface SessionRow {
  id: string;
  userId: UUID;
  role: Role;
  createdAt: number;
  lastActivity: number;
}
export interface ChallengeRow {
  id: string;
  userId: UUID;
  kind: 'staff' | 'hr' | 'insured' | 'clinic' | 'assist';
  expiresAt: number;
  attempts: number;
}
export interface GrantRow {
  id: string;
  userId: UUID;
  insuredId: UUID;
  expiresAt: number;
}
export interface InsuredDocRow {
  id: UUID;
  insuredId: UUID;
  title: string;
  createdAt: string;
}

export interface ContractInsuredRow {
  fullName: string;
  birthDate: string;
  pinfl: string;
  phone: string;
  position: string;
  familyMembers: number;
}
/** A lifecycle change request; a new person's data stays on the server. */
export interface ChangeRequestRow extends ChangeRequest {
  newPerson?: { fullName: string; birthDate: string; pinfl: string; phone: string; position: string; familyMembers: number };
  /** Policy change of POLICY_SPEC the request came from. */
  policyChangeId?: UUID;
}

export interface Db {
  staff: StaffRow[];
  hrUsers: HrUserRow[];
  clients: ClientRow[];
  policies: Policy[];
  insured: InsuredRow[];
  claims: ClaimRow[];
  appointments: Appointment[];
  clinics: Clinic[];
  audit: AuditEntry[];
  limitRequests: LimitChangeRequest[];
  invoices: Invoice[];
  documents: ClientDocument[];
  insuredDocuments: InsuredDocRow[];
  chat: ChatRow[];
  files: FileRow[];
  sessions: SessionRow[];
  challenges: ChallengeRow[];
  grants: GrantRow[];
  loginFailures: { key: string; at: number }[];
  lockouts: { key: string; until: number }[];
  kp: KpDocument[];
  kpSeq: number;
  clinicUsers: ClinicUserRow[];
  priceLists: { clinicId: UUID; items: PriceListItem[] }[];
  cardTokens: CardTokenRow[];
  visits: Visit[];
  checkAttempts: { userId: UUID; at: number; ok: boolean }[];
  checkLocks: { userId: UUID; until: number }[];
  guarantees: GuaranteeRow[];
  guaranteeSeq: number;
  registries: Registry[];
  integrationClients: IntegrationClientRow[];
  accessTokens: AccessTokenRow[];
  webhooks: WebhookEndpointRow[];
  webhookDeliveries: WebhookDeliveryRow[];
  idempotency: IdempotencyRow[];
  apiCalls: { clientRowId: UUID; at: number }[];
  apiLogs: ApiCallLogRow[];
  clinicEvents: ClinicEventRow[];
  misSlots: { clinicId: UUID; specialty: Specialty; startsAt: string; durationMin: number; doctorRef?: string }[];
  integrationsSeed: number;
  policyChanges: PolicyChangeRow[];
  // ---- assistance companies (ASSISTANCE_SPEC) ----
  assistances: AssistanceCompany[];
  assignments: AssistanceAssignment[];
  assistUsers: AssistUserRow[];
  cases: AssistanceCaseRow[];
  caseSeq: number;
  clinicContracts: ClinicContract[];
  rebills: Rebill[];
  qaSamples: QaSample[];
  // ---- contract lifecycle and settlement (LIFECYCLE_SPEC) ----
  authorityChanges: AuthorityChange[];
  deals: Deal[];
  dealEvents: DealEvent[];
  dealSeq: number;
  censuses: Census[];
  quotes: Quote[];
  contracts: Contract[];
  contractSeq: number;
  /** Appendix 2 lists in the HR import format: personal data stays on the server. */
  contractInsured: { contractId: UUID; rows: ContractInsuredRow[] }[];
  payments: Payment[];
  /** Statement payments waiting for manual allocation («Ручная разноска»). */
  bankPayments: BankPayment[];
  /** Keys of imported statement lines (`statementLineKey`): a repeated upload is skipped. */
  statementKeys: string[];
  changeRequests: ChangeRequestRow[];
  endorsements: Endorsement[];
  /** SMS invitations of the insured (imitation). */
  smsOutbox: { at: string; insuredId: UUID; text: string }[];
  // ---- DMS business parameters: only values changed from the demo defaults are stored ----
  dmsParams: {
    /** Numeric parameters and numbering templates (`numbering.<kind>`). */
    values: Partial<Record<DmsParamKey, { value: number; changedAt: string; changedByName: string }>> & Partial<Record<NumberingParamKey, { value: string; changedAt: string; changedByName: string }>>;
    changes: DmsParamChange[];
  };
  // ---- AI coverage check (AI_COVERAGE_SPEC): settings with four-eyes changes, the call log ----
  /** `rebillFlags`: registry line id → reason of the AI precheck flag `ai_disagrees`. */
  ai: { settings: AiSettings; changes: AiSettingsChange[]; logs: AiCallLog[]; rebillFlags: Record<UUID, string> };
  // ---- transfer of the existing portfolio (/staff/admin/migration) ----
  migrationBatches: MigrationBatchRow[];
}

/**
 * A batch of the portfolio transfer. The parsed files (with personal data) stay on the server; `applied`
 * lists what the batch created, so it can be rolled back, and the client fields it changed.
 */
export interface MigrationBatchRow {
  id: UUID;
  seq: number;
  kind: 'csv' | 'manual';
  status: MigrationBatchStatus;
  migrationDate: string;
  createdAt: string;
  createdById: UUID;
  createdByName: string;
  files: Partial<Record<MigrationStep, { rows: Record<string, string>[]; uploadedAt: string; uploadedByName: string }>>;
  /** `validRows`: CSV rows that were valid when the step was confirmed (they must stay the same until applied). */
  steps: Partial<Record<MigrationStep, { status: MigrationStepStatus; excludeErrors: boolean; validRows?: number[] }>>;
  /** Report of the dry run kept after applying (the files themselves are dropped then). */
  totals?: Partial<Record<MigrationStep, { fileTotals: MigrationTotals; validTotals: MigrationTotals; errorRows: number; warningRows: number; issues: MigrationIssue[] }>>;
  submittedAt?: string;
  decidedAt?: string;
  decidedById?: UUID;
  decidedByName?: string;
  rejectReason?: string;
  appliedAt?: string;
  rolledBackAt?: string;
  rolledBackByName?: string;
  rollbackReason?: string;
  applied?: {
    clientIds: UUID[];
    dealIds: UUID[];
    contractIds: UUID[];
    policyIds: UUID[];
    insuredIds: UUID[];
    claimIds: UUID[];
    invoiceIds: UUID[];
    documentIds: UUID[];
    /** Existing clients the batch gave a contract: their fields before, restored by a rollback. */
    clientsBefore: { id: UUID; fields: Pick<ClientRow, 'activePolicyId' | 'status' | 'program' | 'premium' | 'renewalDate' | 'assistanceId'> }[];
    /** Limits transferred for persons already in the system (category → amount). */
    limitsOnExisting: { insuredId: UUID; used: Partial<Record<LimitCategory, number>> }[];
    limitsCount: number;
    /** Audit entries existing at the moment of applying: later entries on the batch's records are new actions. */
    auditMark: string;
  };
}

let current: Db | null = null;
let factory: (() => Db) | null = null;

export function registerSeed(fn: () => Db): void {
  factory = fn;
}

export function db(): Db {
  if (!current) {
    if (!factory) throw new Error('seed not registered');
    current = factory();
  }
  return current;
}

export function replaceDb(next: Db): void {
  current = next;
}

/** A client has a live commercial offer (draft or sent). */
export function hasLiveKp(d: Db, clientId: UUID): boolean {
  return d.kp.some((k) => k.clientId === clientId && k.status !== 'revoked');
}

export function resetDb(): Db {
  if (!factory) throw new Error('seed not registered');
  current = factory();
  return current;
}
