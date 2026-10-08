/* Screen-level DTOs. Part of the API contract, alongside ./index.ts. */
import type { LegalFormCode } from '@mig/domain/config/legalForms';
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
  DealStage,
  Role,
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
  NumberingParameter,
  AppStatus,
  AuditEntry,
  Claim,
  ClaimStatus,
  Client,
  ClientDocument,
  ISODate,
  ISODateTime,
  Insured,
  InsuredRelation,
  FamilyMemberBrief,
  FamilyRelation,
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
  | 'appeal'
  | 'lead'
  | 'kp'
  | 'limit_request'
  | 'loss_ratio'
  | 'fraud_flag'
  | 'opinion'
  | 'qa_sample'
  | 'bank_payment'
  | 'payout'
  | 'scan'
  | 'param_change'
  | 'authority_change'
  | 'ai_change'
  | 'integration_error'
  | 'age_limit'
  | 'request';
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
  /** Where a `request` row (a task from a colleague or HR) leads: the place the task is about. */
  link?: string;
  /** A `request` row: its state for the executor's actions («Взять в работу», «Отклонить», «Отметить выполненным»). */
  request?: { status: TaskStatus; assigneeName?: string; mine: boolean; overdue: boolean };
  /** What `entityId` points to when the type alone does not say (payouts, scans). */
  subject?: 'claim' | 'registry' | 'contract' | 'endorsement' | 'insured';
  /** Legal form of `who` when the row's subject is a legal entity (client, clinic, assistance, payer). */
  legalForm?: LegalFormCode;
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
  /** Types present in this role's queue with counts: the tabs of the queue. */
  queueTypes: { type: QueueType; count: number }[];
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
/** GET /api/clients/:id/loss-stats — aggregates only: no claims, people or diagnoses. */
export interface ClientLossStats {
  clientId: UUID;
  clientName: string;
  clientLegalForm: LegalFormCode;
  premium: Money;
  lossRatio: number | null;
  lossRatioWarn: number;
  claimsCount: number;
  claimsAmount: Money;
  byCategory: { category: string; count: number; amount: Money }[];
  byMonth: { month: string; count: number; amount: Money }[];
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
export type InsuredListItem = Pick<Insured, 'id' | 'fullName' | 'clientId' | 'clientName' | 'policyId' | 'position' | 'status' | 'appStatus' | 'relation'> &
  Partial<Pick<Insured, 'pinflMasked' | 'phoneMasked' | 'birthDateMasked' | 'principalId' | 'principalName'>>;
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
  clientLegalForm?: LegalFormCode;
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
  companyLegalForm?: LegalFormCode;
  insuredCount: number;
  /** Active insured people without a pending exclusion, against the minimal group size. */
  group: { employees: number; family: number; min: number; countsFamily: boolean };
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
  /** People of the employee's family on the policy (names and relation only, no medical data). */
  family: FamilyMemberBrief[];
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
  /** Who the signed-in person is to the policy (an adult family member has an own login). */
  relation: InsuredRelation;
  /** false: reimbursements go to the employee's card (default for a family member). */
  payoutCardOwn: boolean;
  /** An adult family member: the employee may see this person's claims and appointments. */
  familyConsentGranted?: boolean;
  /** A family member's own app: the employee (policyholder) — names only. */
  principalName?: string;
  principalFirstName?: string;
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
  clinicLegalForm?: LegalFormCode;
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
  clinicLegalForm?: LegalFormCode;
  /** Approvals still missing before the letter is approved (four-eyes above the threshold). */
  approvalsNeeded: number;
  infoComment?: string;
}
export interface RegistrySummary extends Omit<Registry, 'lines'> {
  clinicName: string;
  clinicLegalForm?: LegalFormCode;
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
  /** Official Latin name without the legal form. */
  name: string;
  legalForm: LegalFormCode;
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
  /** A family member is a full insured person; the employee's name is shown next to the relation. */
  relation: InsuredRelation;
  principalName?: string;
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
  clinicLegalForm?: LegalFormCode;
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
  assistanceLegalForm?: LegalFormCode;
  /** Deadline of the MIG review: 10 working days after submission. */
  reviewDueAt?: ISODate;
  acceptedByName?: string;
  paidByName?: string;
}
export type RebillSummary = Omit<RebillView, 'lines'> & { lineCount: number; flaggedCount: number };
export interface AssistClinic {
  clinicId: UUID;
  clinicName: string;
  clinicLegalForm: LegalFormCode;
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
  clients: { id: UUID; name: string; legalForm: LegalFormCode; insuredCount: number; policyNumber: string; from: ISODate }[];
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
  assistanceLegalForm?: LegalFormCode;
  reviewedByName?: string;
}
export interface AssignmentView extends AssistanceAssignment {
  assistanceName: string | null;
  setByName: string;
}
export interface AssistanceReportRow {
  assistanceId: UUID | null;
  name: string;
  legalForm?: LegalFormCode;
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
  /** Templates of document numbers («Нумерация документов»), one per kind. */
  numbering: NumberingParameter[];
  changes: DmsParamChange[];
}

// ---------------- contract lifecycle (LIFECYCLE_SPEC) ----------------
export interface DealView extends Deal {
  clientName: string;
  clientLegalForm?: LegalFormCode;
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
  /** «Что нужно для следующего этапа»: what the current stage requires, its state and who is responsible. */
  checklist: DealChecklistItem[];
  /** The client already has an HR account: «Запросить у HR» creates a task in the HR cabinet. */
  hasHr: boolean;
}

// ---------------- next steps: tasks between roles, notifications, checklists ----------------

/** What a task asks for: each action closes the task by itself once done (or by «Выполнено»). */
export type TaskAction =
  | 'census_upload'
  | 'quote_calculate'
  | 'quote_approve'
  | 'kp_send'
  | 'kp_respond'
  | 'contract_draft'
  | 'contract_requisites'
  | 'insured_list'
  | 'legal_review'
  | 'sign_mig'
  | 'sign_client'
  | 'invoice_pay'
  /** The group fell below the minimum after an HR exclusion: review the terms (underwriter, manager). */
  | 'below_min_group'
  | 'other';

export type TaskSubjectType = 'deal' | 'contract' | 'client';

/** A request from one person to a role («Попросить …», «Запросить у HR»): a row of that role's queue. */
export interface WorkTask {
  id: UUID;
  action: TaskAction;
  toRole: Role;
  subjectType: TaskSubjectType;
  subjectId: UUID;
  clientId: UUID;
  clientName: string;
  /** Packed message: what is asked. */
  title: string;
  comment: string;
  /** The place the task is about, in the receiver's portal. */
  link: string;
  createdByName: string;
  createdAt: ISODateTime;
  /** The answer is due by (the «Срок ответа на запрос» parameter, in working days). */
  dueAt: ISODateTime;
  /** The day of `dueAt` (shown as «до …»). */
  dueDate: ISODate;
  /** `open` — waits for an executor, `in_progress` — taken, `done`, `rejected`. */
  status: TaskStatus;
  /** The person the request went to (the responsible one), or who took it from the role's pool. */
  assigneeName?: string;
  /** Closed (done or rejected) at / by. */
  doneAt?: ISODateTime;
  doneByName?: string;
  /** The executor's comment on «Отметить выполненным» or «Отклонить». */
  resolution?: string;
  /** Past `dueAt` and not closed. */
  overdue: boolean;
  /** Asked by the person reading it (the author may «Напомнить»). */
  byMe: boolean;
  /** The last «Напомнить» of the author. */
  remindedAt?: ISODateTime;
  /** What the request is about, as the author sees it: a deal, contract number or the client. */
  subjectLabel: string;
  /** Where the author's object is (staff portal). */
  subjectLink: string;
  history: TaskEvent[];
  /** The contract the HR task is about (number and id for the action in place). */
  contractId?: UUID;
  contractNumber?: string;
}

export type TaskStatus = 'open' | 'in_progress' | 'done' | 'rejected';

/** A line of the request's history (also written to the object's activity feed). */
export interface TaskEvent {
  at: ISODateTime;
  kind: 'created' | 'taken' | 'done' | 'rejected' | 'reminded';
  byName: string;
  comment?: string;
}

export interface UserNotification {
  id: UUID;
  /** Packed message. */
  text: string;
  /** Packed second line (e.g. the title of the task that was done). */
  detail?: string;
  link?: string;
  createdAt: ISODateTime;
  read: boolean;
}

/** Where a client is on the way to a policy: what the empty «Застрахованные» tab explains. */
export interface ClientPipeline {
  hasPolicy: boolean;
  hasHr: boolean;
  dealId?: UUID;
  dealNumber?: string;
  stage?: DealStage;
  contractId?: UUID;
  contractNumber?: string;
  contractStatus?: Contract['status'];
  invoiceId?: UUID;
  invoiceNumber?: string;
}

export interface DealChecklistItem {
  key: string;
  /** Packed message. */
  label: string;
  done: boolean;
  /** Blocks the move to the next stage until done. */
  required: boolean;
  /** Who is responsible. */
  role: Role;
  /** What the responsible person does (button for them, «Попросить» for others). */
  action?: TaskAction;
  /** Why the item is required or not (packed), e.g. «изменено пунктов: 2». */
  hint?: string;
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
  clientLegalForm?: LegalFormCode;
  census: Census | null;
  /** Ages are counted on this date: the desired start of the deal, or today. */
  startDate: ISODate;
  /** Why the author cannot approve alone; null — within authority. */
  authorityProblem: string | null;
  canApprove: boolean;
  canEdit: boolean;
  /** The group of the census against the minimal group size («Клиенты» parameters). */
  group: { size: number; min: number; countsFamily: boolean; below: boolean };
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
  insuredRows: { fullName: string; position: string; relation: InsuredRelation }[];
  invoices: Invoice[];
  payments: Payment[];
  endorsements: EndorsementSummary[];
  quote: Pick<Quote, 'id' | 'premiumEmployee' | 'premiumFamily' | 'total' | 'program'> | null;
  /** The client's paper original is overdue (LIFECYCLE_SPEC §8). */
  originalOverdue: boolean;
  assistanceName?: string;
  /** Appendix 2 (or the terms) against the minimal group size; `exception`: approved in the quote. */
  group: { size: number; min: number; below: boolean; exception: boolean };
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
  clientLegalForm: LegalFormCode;
  clientInn: string;
  migSignatory: SignatoryOption | null;
  clientSignatoryName: string;
  requests: ChangeRequest[];
  needsAmountApproval: boolean;
}

export interface InvoiceView extends Invoice {
  clientName: string;
  clientLegalForm?: LegalFormCode;
  /** INN of the company (not personal data): manual allocation warns about a third-party payer. */
  clientInn?: string;
  contractNumber?: string;
  endorsementNumber?: string;
}

export interface PaymentCandidateView {
  invoiceId: UUID;
  number: string;
  clientName: string;
  clientLegalForm?: LegalFormCode;
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
  clientLegalForm?: LegalFormCode;
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
  /** Official Latin name without the legal form; the document adds the form in its own language. */
  clientName: string;
  clientLegalForm?: LegalFormCode;
  contractNumber: string;
  /** Name of the assistance company without the form, or «MIG» when MIG serves the policy itself. */
  assistanceName: string;
  assistanceLegalForm?: LegalFormCode;
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

// ---- family members (FAMILY_SPEC) ----
/**
 * What the signed-in insured person may see about a person of the family: `self`; `full` — a child under the
 * age limit, or an adult who allowed it; `basic` — an adult family member: the fact of insurance, the
 * certificate and the QR only.
 */
export type FamilyAccess = 'self' | 'full' | 'basic';
/** GET /api/me/family: the profiles the app can switch between (the signed-in person first). */
export interface FamilyProfile {
  id: UUID;
  fullName: string;
  firstName: string;
  relation: InsuredRelation;
  access: FamilyAccess;
  status: 'active' | 'excluded';
  certificateNumber?: string;
  /** A child under the age limit (`maxChildAge`, `studentMaxAge` for a student): lives in the parent's app. */
  dependentChild: boolean;
  /** The person signs in with an own phone (an adult family member). */
  ownLogin: boolean;
  /** Another person of the family: reimbursements go to the person's own card (else to the employee's). */
  payoutCardOwn?: boolean;
}
export type FamilyRequestStatus = 'pending' | 'approved' | 'rejected';
/** A family member the employee asked to add from the app; HR approves it into a change request. */
export interface FamilyRequest {
  id: UUID;
  employeeId: UUID;
  employeeName: string;
  fullName: string;
  relation: FamilyRelation;
  birthDateMasked: string;
  pinflMasked: string;
  isStudent?: boolean;
  /** Age on the day of the request (the premium is by the age group). */
  age: number;
  status: FamilyRequestStatus;
  createdAt: ISODateTime;
  consentAt: ISODateTime;
  decidedAt?: ISODateTime;
  decidedByName?: string;
  rejectionReason?: string;
  /** The change request created on approval (POLICY_SPEC §5.1). */
  policyChangeId?: UUID;
}
/** GET /api/hr/family: family members of the company's employees, without medical data. */
export interface HrFamilyMember {
  id: UUID;
  fullName: string;
  relation: FamilyRelation;
  employeeId: UUID;
  employeeName: string;
  /** '••.••.2016': the year only, like every birth date in lists. */
  birthDateMasked: string;
  /** pending / rejected: an HR request MIG has not approved yet. */
  status: 'active' | 'excluded' | 'pending' | 'rejected';
  insuredFrom: ISODate;
  certificateNumber?: string;
  isStudent?: boolean;
  /** A child that reached the age limit: MIG decides on the exclusion (no automatic exclusion). */
  overAgeLimit?: boolean;
  appStatus: AppStatus;
  rejectionReason?: string;
}
