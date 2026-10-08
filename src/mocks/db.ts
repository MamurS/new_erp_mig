/*
 * In-memory "server" database. Rows hold full (unmasked) values; handlers mask on output.
 */
import type { UserNotification, WorkTask } from '@/shared/types/dto';
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
  FamilyRelation,
  Insured,
  InsuredRelation,
  Invoice,
  LimitCategory,
  KpDocument,
  LimitChangeRequest,
  Policy,
  Role,
  StaffUser,
  UUID,
} from '@/shared/types';
import type { HelpQuestionRow } from '@/shared/types/help';
import type { MigrationBatchStatus, MigrationContractPremium, MigrationIssue, MigrationPremiumSource, MigrationStep, MigrationStepStatus, MigrationTotals } from '@/shared/types/migration';

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
  /** Manager's log of work with the client (calls, meetings, letters): shown in «Активность». */
  log?: { at: string; text: string }[];
}
export interface InsuredRow extends Omit<Insured, 'birthDateMasked' | 'pinflMasked' | 'phoneMasked' | 'family' | 'principalName'> {
  /** Date of birth (ISO); the API sends it masked (`birthDateMasked`). */
  birthDate: string;
  pinfl: string;
  phone: string;
  email: string;
  /** Card for reimbursements; empty for a family member who did not set an own one: the employee's card is used. */
  payoutCard: string;
  consentGivenAt?: string;
  addedAt: string;
  excludedFrom?: string;
  /** Last change of the person's status (added, excluded) — `updatedSince` of the assistance roster. */
  updatedAt?: string;
  userId: UUID;
  /** Used limits by category as of the migration date (transferred from the previous system). */
  migratedUsed?: Partial<Record<LimitCategory, number>>;
  /** Annual premium of a transferred person (each person has an own one) and where it came from. */
  migratedPremium?: { amount: number; source: MigrationPremiumSource };
}
/** Change request of the insured list; personal data of a new person stays on the server only. */
export interface PolicyChangeRow extends PolicyChange {
  requestedById: UUID;
  /** Phone is empty for a child without an own login. */
  newPerson?: { birthDate: string; pinfl: string; phone: string; isStudent?: boolean };
  /** The app request of the employee the change came from. */
  familyRequestId?: UUID;
}
/** «Разрешить {сотруднику} видеть мои обращения»: an adult family member's consent; revoked ones stay as history. */
export interface FamilyConsentRow {
  id: UUID;
  /** The adult family member who gives the consent. */
  ownerId: UUID;
  /** The employee who may see the owner's claims and appointments. */
  viewerId: UUID;
  grantedAt: string;
  revokedAt?: string;
}
/** A family member the employee asked to add from the app; personal data stays on the server. */
export interface FamilyRequestRow {
  id: UUID;
  employeeId: UUID;
  clientId: UUID;
  fullName: string;
  birthDate: string;
  pinfl: string;
  relation: FamilyRelation;
  isStudent?: boolean;
  consentAt: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  decidedAt?: string;
  decidedById?: UUID;
  decidedByName?: string;
  rejectionReason?: string;
  policyChangeId?: UUID;
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
  /** Lockout key of the challenge; defaults to the user. Phone challenges lock by the number, known or not. */
  lockKey?: string;
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

/** A row of appendix 2: one person, with the relation and, for a family member, the employee's PINFL. */
export interface ContractInsuredRow {
  fullName: string;
  birthDate: string;
  pinfl: string;
  phone: string;
  position: string;
  relation: InsuredRelation;
  principalPinfl?: string;
  isStudent?: boolean;
}
/** A lifecycle change request; a new person's data stays on the server. */
export interface ChangeRequestRow extends ChangeRequest {
  newPerson?: { fullName: string; birthDate: string; pinfl: string; phone: string; position: string; relation: InsuredRelation; principalId?: UUID; isStudent?: boolean };
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
  // ---- family members (FAMILY_SPEC) ----
  familyConsents: FamilyConsentRow[];
  familyRequests: FamilyRequestRow[];
  // ---- help (questions asked in «Задать вопрос», stored redacted) ----
  help: { questions: HelpQuestionStored[] };
  // ---- next steps: tasks between roles («Попросить …», «Запросить у HR») and in-app notifications ----
  tasks: TaskRow[];
  notifications: NotificationRow[];
}

/** A task for a role (staff) or for the HR of a client (`toRole: 'hr'`, `clientId`). */
export interface TaskRow extends Omit<WorkTask, 'overdue' | 'byMe'> {
  createdById: UUID;
  /** The executor: the responsible person, or who took the request from the role's pool. */
  assigneeId?: UUID;
  /** The deal the request is about (its «События» feed), if any. */
  dealId?: UUID;
  /** «Завтра срок» and «Просрочен» were sent (once each). */
  dueSoonSent?: boolean;
  overdueSent?: boolean;
}

/** An in-app notification of one person (e.g. «задача выполнена»). */
export interface NotificationRow extends UserNotification {
  userId: UUID;
}

/** A question of «Задать вопрос»: the text is redacted; `askerId` only lets the asker rate the answer. */
export interface HelpQuestionStored extends HelpQuestionRow {
  askerId: UUID;
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
  /** Per-contract premium check as it was when the batch was applied. */
  contractPremiums?: MigrationContractPremium[];
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
