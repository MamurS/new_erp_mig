/* Screen-level DTOs. Part of the API contract, alongside ./index.ts. */
import type {
  AiProviderId,
  AiScenario,
  AiSettings,
  AiSettingsChange,
  CoverageVerdict,
  CoverageVerdictDecision,
  LimitState,
  Census,
  ChangeRequest,
  ClaimDecisionKind,
  Contract,
  Deal,
  DealEvent,
  Endorsement,
  BankPayment,
  Payment,
  PaymentCandidateWhy,
  ReceiptFiscal,
  Quote,
  ReserveChange,
  StaffAuthority,
  StaffRole,
  DmsParamChange,
  DmsParameter,
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
  Clinic,
  ClinicRole,
  GuaranteeLetter,
  IntegrationClient,
  IntegrationMode,
  Registry,
  RegistryStatus,
  Visit,
  WebhookDelivery,
  WebhookEvent,
  AssistanceAssignment,
  AssistanceCase,
  AssistanceCompany,
  AssistanceKpi,
  AssistanceRole,
  Appointment,
  PriceListItem,
  QaSample,
  Rebill,
  RegistryLine,
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
export type QueueType =
  | 'appointment'
  | 'claim'
  | 'renewal'
  | 'guarantee'
  | 'registry'
  | 'clinic_no_response'
  | 'policy_change'
  | 'escalation'
  | 'rebill'
  | 'assistance_sla'
  | 'complaint'
  | 'deal'
  | 'quote'
  | 'contract'
  | 'endorsement'
  | 'invoice'
  | 'appeal';
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
  reserveHistory?: ReserveChange[];
  /** What the viewer may do in the settlement panel (claims_officer, doctor_expert). */
  settlement?: {
    canDecide: boolean;
    canApprovePending: boolean;
    canRequestOpinion: boolean;
    canGiveOpinion: boolean;
    canChangeReserve: boolean;
    authorityMax: Money | null;
  };
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
  /** pending / rejected: a request of HR that MIG has not approved (POLICY_SPEC §5.1). */
  status: 'active' | 'excluded' | 'pending' | 'rejected';
  excludedFrom?: ISODate;
  addedAt: ISODateTime;
  pendingExclusionFrom?: ISODate;
  rejectionReason?: string;
}
export interface HrImportError {
  row: number;
  field: string;
  message: string;
}
export interface HrImportResult {
  valid: number;
  added: number;
  /** Change requests sent to MIG (POLICY_SPEC §5.1). */
  requested?: number;
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
  /** Number of the insured person's certificate (LIFECYCLE_SPEC §10); shown on the card for the clinic. */
  certificateNumber?: string;
}
export interface CardToken {
  token: string;
  /** The same one-time token as 8 characters for manual entry, e.g. 'K7P4-QX2M'. */
  shortCode: string;
  expiresAt: ISODateTime;
}
export interface RecognizeResult {
  providerName: string;
  amount: Money;
  serviceDate: ISODate;
  /** Positions of the receipt (AI_COVERAGE_SPEC §4.1); their sum is `amount`. */
  items?: { name: string; amount: Money }[];
  /** Fiscal data of the receipt; the server recognizes it again from the uploaded photo, the client never sends it. */
  fiscal?: ReceiptFiscal;
}
/** GET /api/clients/:id/kp-defaults — prefilled parameters plus what the offer letter needs. */
export interface KpDefaults {
  params: KpParams;
  letter: Pick<KpDocument, 'clientName' | 'clientLegalForm' | 'clientInn' | 'policyId' | 'createdByName' | 'createdByEmail'>;
}

export type { LimitUsage };

// ---------- clinics (CLINIC_SPEC) ----------
export interface ClinicEvent {
  id: UUID;
  at: ISODateTime;
  text: string;
}
export interface ClinicOverview {
  clinicName: string;
  integrationMode: IntegrationMode;
  appointmentsToday: number;
  unanswered: number;
  unansweredOverdue: number;
  guaranteesPending: number;
  currentRegistry: { id: UUID; period: string; status: RegistryStatus; claimed: Money } | null;
  events: ClinicEvent[];
}
export interface ClinicVisitView {
  id: UUID;
  insuredName: string;
  method: Visit['method'];
  openedAt: ISODateTime;
  expiresAt: ISODateTime;
}
export interface ClinicUserView {
  id: UUID;
  email: string;
  fullName: string;
  role: ClinicRole;
  active: boolean;
  lastLoginAt?: ISODateTime;
}
export interface GuaranteeView extends GuaranteeLetter {
  clinicName: string;
  /** Approvals still missing before the letter is approved (four-eyes above the threshold). */
  approvalsNeeded: number;
  infoComment?: string;
}
export interface RegistrySummary extends Omit<Registry, 'lines'> {
  clinicName: string;
  lineCount: number;
  pendingCount: number;
  disputedCount: number;
}
export interface RegistryView extends Registry {
  clinicName: string;
  /** Pre-submit problems per line id (drafts). */
  problems: Record<string, string[]>;
  /** Lines with a guarantee: claimed amount versus the approved amount of the letter. */
  guaranteeChecks: Record<string, { approvedAmount: Money | null; ok: boolean }>;
  /** Names of the payers of the lines: 'mig' or an assistance id → name (ASSISTANCE_SPEC §5.3). */
  payerNames?: Record<string, string>;
}
export interface RegistryImportResult {
  total: number;
  valid: number;
  errors: { row: number; message: string }[];
  registryId?: UUID;
}
export interface ClinicDocuments {
  contract: { number: string; signedAt: ISODate; validUntil: ISODate };
  acts: { registryId: UUID; period: string; claimed: Money; accepted: Money; paid: Money; paidAt?: ISODateTime }[];
}
export interface IntegrationOverview {
  mode: IntegrationMode;
  connected: boolean;
  activeKeys: number;
  requests24h: number;
  errors24h: number;
  lastWebhook: { event: WebhookEvent; at: ISODateTime; status: WebhookDelivery['status'] } | null;
}
export interface ClinicCard {
  clinic: Clinic;
  contractNumber: string;
  metrics: { avgResponseMinutes: number | null; rejectedLineShare: number | null; amountToPay: Money };
  users: ClinicUserView[];
  keys: IntegrationClient[];
  webhooks: { endpoints: number; retrying: number; failed24h: number };
  apiErrors24h: number;
}

/** Preview of the initial list of insured persons (POLICY_SPEC §4). */
export interface PolicyListCheck {
  total: number;
  valid: number;
  employees: number;
  familyMembers: number;
  errors: HrImportError[];
}
export interface PolicyChangeDecisionResult {
  approved: number;
  rejected: number;
  endorsements: number;
}

// ---- assistance companies (ASSISTANCE_SPEC) ----
/** Short info about the assistance company, visible to its users and to the insured person. */
export interface AssistanceBrief {
  id: UUID;
  name: string;
  phone24x7: string;
  integrationMode: AssistanceCompany['integrationMode'];
}
export interface AssistQueueItem {
  id: UUID;
  kind: 'appointment' | 'case' | 'guarantee' | 'registry' | 'escalation' | 'rebill';
  title: string;
  subtitle: string;
  dueAt?: ISODateTime;
  to: string;
}
export interface AssistOverview {
  assistance: AssistanceBrief;
  authorityLimit: Money;
  queue: AssistQueueItem[];
  counters: { openCases: number; slaBreaches: number; guaranteesPending: number; linesPending: number; rebillsInReview: number };
  kpi: AssistanceKpi;
}
export interface AssistInsuredItem {
  id: UUID;
  fullName: string;
  clientName: string;
  policyNumber: string;
  programName: string;
  status: Insured['status'];
  phoneMasked: string;
  pinflMasked: string;
  birthDateMasked: string;
  access: 'full' | 'read';
}
export interface AssistInsuredDetail extends AssistInsuredItem {
  policyId: UUID;
  policyStart: ISODate;
  policyEnd: ISODate;
  limits: LimitUsage[];
  cases: AssistanceCase[];
  appointments: Appointment[];
  guarantees: GuaranteeView[];
}
export interface AssistCaseView extends AssistanceCase {
  access: 'full' | 'read';
}
export interface AssistAppointment extends Appointment {
  overdue: boolean;
  /** Deadline of the clinic's answer; after it the request is escalated to the assistance. */
  slaDueAt: ISODateTime;
}
export interface AssistChatThread {
  insuredId: UUID;
  insuredName: string;
  lastText: string;
  lastAt: ISODateTime;
  unanswered: boolean;
}
export interface AssistChatMessage {
  id: UUID;
  from: 'insured' | 'operator';
  text: string;
  at: ISODateTime;
}
/** One payer's part of a clinic registry. */
export interface SubRegistrySummary {
  id: UUID;
  clinicId: UUID;
  clinicName: string;
  period: string;
  status: RegistryStatus;
  source: Registry['source'];
  submittedAt?: ISODateTime;
  lineCount: number;
  pendingCount: number;
  disputedCount: number;
  unpaidCount: number;
  totals: Registry['totals'];
  /** Deadline of the review of the payer's lines (5 days after submission). */
  reviewDueAt?: ISODateTime;
}
export interface SubRegistryView extends SubRegistrySummary {
  lines: RegistryLine[];
  guaranteeChecks: Record<string, { approvedAmount: Money | null; ok: boolean }>;
}
export interface RebillView extends Rebill {
  assistanceName: string;
  /** Deadline of the MIG review: 10 working days after submission. */
  reviewDueAt?: ISODate;
  acceptedByName?: string;
  paidByName?: string;
}
export type RebillSummary = Omit<RebillView, 'lines'> & { lineCount: number; flaggedCount: number };
export interface AssistClinic {
  clinicId: UUID;
  clinicName: string;
  city: string;
  specialties: Clinic['specialties'];
  ownPrices: boolean;
  priceList: PriceListItem[];
}
export interface AssistUserView {
  id: UUID;
  email: string;
  fullName: string;
  role: AssistanceRole;
  active: boolean;
  lastLoginAt?: ISODateTime;
}
export interface AssistanceListItem extends AssistanceBrief {
  contractNumber: string;
  insuredCount: number;
  clientsCount: number;
  kpi: AssistanceKpi;
  rebillsToReview: number;
  slaBreaches: number;
}
export interface AssistanceCardView {
  assistance: AssistanceCompany;
  kpi: AssistanceKpi;
  insuredCount: number;
  clients: { id: UUID; name: string; insuredCount: number; policyNumber: string; from: ISODate }[];
  users: AssistUserView[];
  keys: IntegrationClient[];
  webhooks: { endpoints: number; retrying: number; failed24h: number };
  apiErrors24h: number;
  rebills: RebillSummary[];
  qa: QaSampleView[];
  audit: AuditEntry[];
  feePerInsured: Money | null;
  /** Complaints and cases with a breached SLA: visible to the MIG curator (§5.1). */
  attention: AssistanceCase[];
}
export interface QaSampleView extends QaSample {
  assistanceName: string;
  reviewedByName?: string;
}
export interface AssignmentView extends AssistanceAssignment {
  assistanceName: string | null;
  setByName: string;
}
export interface AssistanceReportRow {
  assistanceId: UUID | null;
  name: string;
  insuredCount: number;
  premium: Money;
  paid: Money;
  lossRatio: number | null;
  fee: Money;
  feePerInsured: Money | null;
}

/** GET /api/params: current values of the DMS parameters and the latest change requests. */
export interface DmsParamsView {
  parameters: DmsParameter[];
  changes: DmsParamChange[];
}

// ---------------- contract lifecycle (LIFECYCLE_SPEC) ----------------
export interface DealView extends Deal {
  clientName: string;
  ownerName: string;
  underwriterName?: string;
  /** Latest known annual premium: contract, approved quote or draft quote. */
  premium: Money | null;
  quoteId?: UUID;
  quoteStatus?: Quote['status'];
  kpId?: UUID;
  kpStatus?: KpDocument['status'];
  contractId?: UUID;
  contractStatus?: Contract['status'];
}

export interface DealCard extends DealView {
  client: Client;
  census: Census | null;
  quote: Quote | null;
  kp: KpDocument | null;
  contract: ContractSummary | null;
  events: DealEvent[];
  reminders: string[];
}

export interface ContractSummary {
  id: UUID;
  number: string;
  version: number;
  status: Contract['status'];
  total: Money;
  startDate: ISODate;
  endDate: ISODate;
}

export interface QuoteView extends Quote {
  dealNumber: string;
  clientName: string;
  census: Census | null;
  /** Ages are counted on this date: the desired start of the deal, or today. */
  startDate: ISODate;
  /** Why the author cannot approve alone; null — within authority. */
  authorityProblem: string | null;
  canApprove: boolean;
  canEdit: boolean;
}

export interface SignatoryOption {
  id: UUID;
  fullName: string;
  role: StaffRole;
  basis: string;
}

export interface ContractView extends Contract {
  client: Client;
  dealNumber: string;
  migSignatory: SignatoryOption | null;
  signatories: SignatoryOption[];
  /** Appendix 2 without PINFL and phones. */
  insuredRows: { fullName: string; position: string; familyMembers: number }[];
  invoices: Invoice[];
  payments: Payment[];
  endorsements: EndorsementSummary[];
  quote: Pick<Quote, 'id' | 'premiumEmployee' | 'premiumFamily' | 'total' | 'program'> | null;
  /** The client's paper original is overdue (LIFECYCLE_SPEC §8). */
  originalOverdue: boolean;
  assistanceName?: string;
}

export interface EndorsementSummary {
  id: UUID;
  number: string;
  kind: 'changes' | 'termination';
  status: Endorsement['status'];
  total: Money;
  createdAt?: ISODateTime;
}

export interface EndorsementView extends Endorsement {
  contractNumber: string;
  clientId: UUID;
  clientName: string;
  clientInn: string;
  migSignatory: SignatoryOption | null;
  clientSignatoryName: string;
  requests: ChangeRequest[];
  needsAmountApproval: boolean;
}

export interface InvoiceView extends Invoice {
  clientName: string;
  /** INN of the company (not personal data): manual allocation warns about a third-party payer. */
  clientInn?: string;
  contractNumber?: string;
  endorsementNumber?: string;
}

export interface PaymentCandidateView {
  invoiceId: UUID;
  number: string;
  clientName: string;
  clientInn: string;
  contractNumber?: string;
  remaining: Money;
  dueDate: ISODate;
  why: PaymentCandidateWhy;
}
export interface BankPaymentView extends BankPayment {
  remaining: Money;
  candidates: PaymentCandidateView[];
}

export interface ChangeRequestView extends ChangeRequest {
  contractNumber: string;
  clientName: string;
  endorsementNumber?: string;
}

export interface CertificateView {
  insuredId: UUID;
  fullName: string;
  certificateNumber: string;
  insuredFrom: ISODate;
  policyNumber: string;
  policyEndDate: ISODate;
  program: ProgramCode;
  clientName: string;
  contractNumber: string;
  assistanceName: string;
  assistancePhone: string;
}

export interface ImportPaymentsResult {
  matched: number;
  /** Sent to «Ручная разноска». */
  queued: number;
  /** Lines already imported earlier (or repeated in the file): payment document number, date, amount and INN. */
  skipped: number;
  unmatched: { line: number; reason: string }[];
  activated: number;
}

export interface ReserveReportRow {
  key: string;
  label: string;
  claims: number;
  reserve: Money;
}

export interface ReserveReport {
  date: ISODate;
  total: Money;
  claims: number;
  byClient: ReserveReportRow[];
  byAssistance: ReserveReportRow[];
  byCategory: ReserveReportRow[];
}

export interface StaffDirectoryItem {
  id: UUID;
  fullName: string;
  role: StaffRole;
  authority: StaffAuthority;
  canSign: boolean;
}

export interface ClaimLetter {
  claimNumber: string;
  insuredName: string;
  amountClaimed: Money;
  decision: { kind: ClaimDecisionKind; amount: Money; clauseRef?: string; reason: string; at: ISODateTime };
}

// ---------------- AI coverage check (AI_COVERAGE_SPEC) ----------------
export interface AiCheckItem {
  logId: UUID;
  /** What was checked, as the user typed it (never sent to a provider unredacted). */
  input: string;
  amount?: Money;
  /** Registry line or receipt position the item belongs to. */
  subjectId?: string;
  matches: { code: string; name: string; confidence: number }[];
  confidence: number;
  needsSpecialist: boolean;
  verdict: CoverageVerdict;
  /** Clinics see only «доступен / на исходе / исчерпан», never the sums. */
  limitStatus?: LimitState | null;
  clauses: { ref: string; label: string }[];
  explanation: string;
  /** Receipt positions in the app: «вернём», «не вернём», «уточним». */
  receiptLabel?: 'refund' | 'no_refund' | 'check';
  suspicious: boolean;
}

export interface AiCheckResult {
  available: boolean;
  items: AiCheckItem[];
  suspicious: boolean;
  /** Receipts: what is expected to be reimbursed (covered positions within the limit). */
  expectedReimbursement?: Money;
}

export interface AiStatus {
  killSwitch: boolean;
  scenarios: Record<AiScenario, boolean>;
}

export interface AiMetricsRow {
  scenario: AiScenario;
  calls: number;
  rated: number;
  agreeShare: number | null;
  specialistShare: number | null;
  avgLatencyMs: number | null;
}

export interface AiAdminView {
  settings: AiSettings;
  changes: AiSettingsChange[];
  metrics: AiMetricsRow[];
  disagreements: { id: UUID; at: ISODateTime; scenario: AiScenario; input: string; decision: CoverageVerdictDecision; comment: string; byName: string }[];
  promptVersion: string;
  providersAvailable: AiProviderId[];
}

export interface AiGoldenResult {
  total: number;
  correct: number;
  accuracy: number;
  errors: { text: string; expectedCodes: string[]; gotCodes: string[]; expectedDecision: CoverageVerdictDecision; gotDecision: CoverageVerdictDecision }[];
}
