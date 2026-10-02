/*
 * In-memory "server" database. Rows hold full (unmasked) values; handlers mask on output.
 */
import type {
  DmsParamChange,
  DmsParamKey,
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
  KpDocument,
  LimitChangeRequest,
  Policy,
  Role,
  StaffUser,
  UUID,
} from '@/shared/types';

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
  // ---- DMS business parameters: only values changed from the demo defaults are stored ----
  dmsParams: {
    values: Partial<Record<DmsParamKey, { value: number; changedAt: string; changedByName: string }>>;
    changes: DmsParamChange[];
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
