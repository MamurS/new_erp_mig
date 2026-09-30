/* Screen-level DTOs. Part of the API contract, alongside ./index.ts. */
import type {
  AppStatus,
  AuditEntry,
  Claim,
  ClaimStatus,
  Client,
  ClientDocument,
  ISODate,
  ISODateTime,
  Insured,
  Invoice,
  KpDocument,
  KpParams,
  LimitCategory,
  LimitUsage,
  Money,
  Policy,
  Program,
  ProgramCode,
  SessionUser,
  UUID,
} from './index';

// ---- auth ----
export interface ChallengeResponse {
  challengeId: string;
  /** Seconds until a new code may be requested. */
  resendInSec: number;
}
export interface SessionResponse {
  sessionId: string;
  user: SessionUser;
}

// ---- dashboard ----
export type KpiFormat = 'number' | 'money';
export interface Kpi {
  key: string;
  label: string;
  value: number;
  format: KpiFormat;
  hint?: string;
  tone?: 'default' | 'warning' | 'danger';
  to?: string;
}
export type QueueType = 'appointment' | 'claim' | 'renewal';
export interface QueueItem {
  id: UUID;
  type: QueueType;
  entityId: UUID;
  who: string;
  details: string;
  status: string;
  statusTone: 'default' | 'success' | 'warning' | 'danger' | 'info';
  dueAt: ISODateTime;
  action: 'confirm' | 'open' | 'prepare_offer';
  /** Client id for renewal rows (offer is prepared on the client's active policy). */
  policyId?: UUID;
}
export interface AttentionItem {
  key: 'renewals_no_offer' | 'high_loss_ratio' | 'sla_overdue';
  label: string;
  count: number;
  to: string;
}
export interface DashboardSummary {
  firstName: string;
  queueCount: number;
  kpis: Kpi[];
  attention: AttentionItem[];
}
export interface IntegrationStatus {
  name: string;
  status: 'ok' | 'degraded' | 'down';
  lastSyncAt: ISODateTime;
  queue: number;
}

// ---- clients ----
export interface ClientActivity {
  at: ISODateTime;
  text: string;
}
export interface ClientDetail extends Client {
  claimsByMonth: { month: string; amount: Money; count: number }[];
  claimsByCategory: { category: string; count: number; amount: Money }[];
  activity: ClientActivity[];
  hasRenewalOffer: boolean;
}
export interface ClientListResponse extends PageLike<Client> {
  totalPremium: Money;
}
export interface PageLike<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ---- policies ----
export interface PolicyDetail extends Policy {
  programInfo: Program;
  documents: ClientDocument[];
}

// ---- insured ----
export interface InsuredDetail extends Insured {
  policyNumber: string;
  program: ProgramCode;
  policyStart: ISODate;
  policyEnd: ISODate;
  emailMasked: string;
}
/** accountant sees only name-level data. */
export type InsuredListItem = Pick<Insured, 'id' | 'fullName' | 'clientId' | 'clientName' | 'policyId' | 'position' | 'status' | 'appStatus'> &
  Partial<Pick<Insured, 'pinflMasked' | 'phoneMasked' | 'birthDateMasked'>>;
export interface RevealResponse {
  value: string;
  expiresInSec: number;
}
export interface MedicalGrant {
  grantId: string;
  expiresAt: ISODateTime;
}
export interface InsuredClaimSummary {
  id: UUID;
  number: string;
  category: Claim['category'];
  amountClaimed: Money;
  status: ClaimStatus;
  createdAt: ISODateTime;
}
export interface InsuredDocument {
  id: UUID;
  title: string;
  createdAt: ISODate;
}

// ---- claims ----
export interface LimitCheck {
  category: LimitCategory;
  limit: Money;
  used: Money;
  remaining: Money;
  remainingAfter: Money;
}
export interface ClaimDetail extends Claim {
  limitCheck: LimitCheck;
  allowedTransitions: ClaimStatus[];
  medicalReviewRequired: boolean;
  /** Hints for transitions that exist for the role but are blocked by a rule. */
  blockedTransitions: { to: ClaimStatus; reason: string }[];
}

// ---- reports ----
export interface LossRatioRow {
  clientId: UUID;
  clientName: string;
  lossRatio: number;
}
export interface ClaimsByCategoryRow {
  category: Claim['category'];
  count: number;
  amount: Money;
}
export interface PremiumByMonthRow {
  month: string; // '2026-09'
  premium: Money;
}

// ---- admin ----
export type AuditPage = PageLike<AuditEntry>;

// ---- hr ----
export interface HrOverview {
  companyName: string;
  insuredCount: number;
  notInApp: number;
  nextInvoice: Invoice | null;
  policy: { number: string; program: ProgramCode; programName: string; startDate: ISODate; endDate: ISODate } | null;
  manager: { name: string; phone: string; email: string };
}
export interface HrEmployee {
  id: UUID;
  fullName: string;
  position: string;
  program: ProgramCode;
  insuredFrom: ISODate;
  familyMembersCount: number;
  appStatus: AppStatus;
  status: 'active' | 'excluded';
  excludedFrom?: ISODate;
  addedAt: ISODateTime;
}
export interface HrImportError {
  row: number;
  field: string;
  message: string;
}
export interface HrImportResult {
  valid: number;
  added: number;
  errors: HrImportError[];
}
export interface HrStatsSlice {
  label: string;
  /** null when fewer than k=10 people are in the slice. */
  value: number | null;
}
export interface HrStats {
  insuredCount: number;
  appUsers: number | null;
  claimsThisQuarter: number | null;
  budgetUsedPct: number | null;
  byAgeGroup: HrStatsSlice[];
  byAppStatus: HrStatsSlice[];
  k: number;
}

// ---- insured app ----
export interface MeProfile {
  fullName: string;
  firstName: string;
  companyName: string;
  phoneMasked: string;
  pinflMasked: string;
  payoutCardMasked: string;
  consentGivenAt?: ISODateTime;
}
export interface MePolicy {
  number: string;
  program: ProgramCode;
  programName: string;
  companyName: string;
  startDate: ISODate;
  endDate: ISODate;
  limits: Record<LimitCategory, Money>;
}
export interface CardToken {
  token: string;
  expiresAt: ISODateTime;
}
export interface RecognizeResult {
  providerName: string;
  amount: Money;
  serviceDate: ISODate;
}
/** GET /api/clients/:id/kp-defaults — prefilled parameters plus what the offer letter needs. */
export interface KpDefaults {
  params: KpParams;
  letter: Pick<KpDocument, 'clientName' | 'clientLegalForm' | 'clientInn' | 'policyId' | 'createdByName' | 'createdByEmail'>;
}

export type { LimitUsage };
