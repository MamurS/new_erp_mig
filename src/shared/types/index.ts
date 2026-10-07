import type { LegalFormCode } from '@/shared/config/legalForms';
import type { DocNumberKind } from '@/shared/domain/numbering';
export type UUID = string;
export type ISODate = string;      // '2026-09-29'
export type ISODateTime = string;  // '2026-09-29T14:21:00+05:00'
export type Money = number;        // целые сумы UZS

export type StaffRole = 'operator' | 'underwriter' | 'doctor_expert' | 'accountant' | 'admin' | 'sales_manager' | 'legal' | 'claims_officer';
export type ClinicRole = 'clinic_registrar' | 'clinic_admin';
export type AssistanceRole = 'asst_operator' | 'asst_doctor' | 'asst_billing' | 'asst_admin';
export type Role = StaffRole | 'hr' | 'insured' | ClinicRole | AssistanceRole;

export interface SessionUser {
  id: UUID;
  role: Role;
  displayName: string;
  companyId?: UUID;        // для hr
  insuredId?: UUID;        // для insured
  clinicId?: UUID;         // для clinic_registrar и clinic_admin
  assistanceId?: UUID;     // для ролей ассистанса
  consentGivenAt?: ISODateTime; // для insured
  authority?: StaffAuthority;   // полномочия сотрудника МИГ (LIFECYCLE_SPEC §2)
  canSign?: boolean;            // сотрудник МИГ — подписант договоров
}

/** Personal authority of a MIG employee; above it an action goes to someone of the same role with more. */
export interface StaffAuthority {
  quoteDiscountMaxPct?: number;    // максимальная скидка от тарифа без согласования, доля 0..1
  quotePremiumMax?: Money;         // максимальная годовая премия котировки без согласования
  claimDecisionMax?: Money;        // максимальная сумма решения по убытку без согласования
  /** May approve a quote below the minimal group size (an exception with a mandatory comment). */
  allowBelowMinGroup?: boolean;
}

export type ProgramCode = 'basic' | 'standard' | 'standard_plus' | 'premium';
export type LimitCategory = 'outpatient' | 'dental' | 'medicines' | 'inpatient';

export interface Program {
  code: ProgramCode;
  name: string;                           // 'Базовая' | 'Стандарт' | 'Стандарт+' | 'Премиум'
  limits: Record<LimitCategory, Money>;
}

/** Record transferred from the previous system by a migration batch («Перенесено из старой системы»). */
export interface MigrationMark {
  batchId: UUID;
  /** When the batch was applied (after the second administrator's confirmation). */
  at: ISODateTime;
  /** Administrator who prepared the batch. */
  byName: string;
}

export type ClientStatus = 'lead' | 'draft' | 'negotiation' | 'active' | 'renewal' | 'expired';

export interface Client {
  id: UUID;
  /** Code of the legal form (src/shared/config/legalForms.ts); `name` is the official Latin name without it. */
  legalForm: LegalFormCode;
  name: string;
  inn: string;                             // 9 цифр, не ПДн
  status: ClientStatus;
  managerId: UUID;
  managerName: string;
  hrContact: { name: string; phoneMasked: string; emailMasked: string };
  activePolicyId?: UUID;
  assistanceId?: UUID | null;              // текущий ассистанс (для списков), null — без ассистанса
  program?: ProgramCode;
  insuredCount: number;
  premium: Money;
  lossRatio: number | null;                // 0..1.5, null если полиса ещё нет
  renewalDate?: ISODate;
  createdAt: ISODateTime;
  requisites?: ClientRequisites;           // реквизиты для договора (LIFECYCLE_SPEC §3)
  estimatedHeadcount?: number;             // ориентировочная численность (лид)
  currentInsurer?: string;                 // текущий страховщик (лид)
  migration?: MigrationMark;               // перенесён из старой системы
}

export interface ClientRequisites {
  bank: string;
  account: string;                         // р/с, 20 цифр
  mfo: string;                             // 5 цифр
  director: string;                        // руководитель
  directorBasis: string;                   // основание полномочий: «Устав»
  address?: string;
}

export type PolicyStatus = 'draft' | 'active' | 'expired' | 'cancelled';

export interface Policy {
  id: UUID;
  number: string;                          // 'DMS-2026-000123'
  clientId: UUID;
  clientName: string;
  clientLegalForm?: LegalFormCode;
  program: ProgramCode;
  startDate: ISODate;
  endDate: ISODate;
  status: PolicyStatus;
  premium: Money;
  insuredCount: number;
  tariff?: PolicyTariff;                   // годовые тарифы полиса (POLICY_SPEC §3)
  assistanceId?: UUID | null;              // текущий ассистанс полиса (ASSISTANCE_SPEC §3)
  familyCount?: number;                    // застрахованных членов семьи
  contractId?: UUID;                       // договор, по которому выпущен полис (LIFECYCLE_SPEC §10)
}

export interface PolicyTariff {
  employee: Money;                         // годовой тариф на сотрудника
  family: Money;                           // годовой тариф на члена семьи
}

export type PolicyChangeKind = 'add' | 'exclude';
export type PolicyChangeStatus = 'pending' | 'approved' | 'rejected';

/** Заявка на изменение состава застрахованных (POLICY_SPEC §6). Без ПИНФЛ, телефона и даты рождения. */
export interface PolicyChange {
  id: UUID;
  clientId: UUID;
  clientName: string;
  policyId: UUID;
  policyNumber: string;
  kind: PolicyChangeKind;
  insuredId?: UUID;
  fullName: string;
  position: string;
  /** Who the person is to the policy; a family member is added under an employee (`principalId`). */
  relation: InsuredRelation;
  principalId?: UUID;
  principalName?: string;
  effectiveDate: ISODate;
  premiumDelta: Money;                     // + доплата, − возврат
  status: PolicyChangeStatus;
  requestedAt: ISODateTime;
  requestedByName: string;
  decidedAt?: ISODateTime;
  decidedByName?: string;
  rejectionReason?: string;
  endorsementId?: UUID;
}

export type AppStatus = 'active' | 'invited' | 'not_invited';

/** Who the insured person is to the policy: the employee or a member of the employee's family. */
export type InsuredRelation = 'employee' | 'spouse' | 'child' | 'parent' | 'other';
export type FamilyRelation = Exclude<InsuredRelation, 'employee'>;

/** A person of the employee's family as other screens list them (no personal data). */
export interface FamilyMemberBrief {
  id: UUID;
  fullName: string;
  relation: FamilyRelation;
  status: 'active' | 'excluded';
}

export interface Insured {
  id: UUID;
  clientId: UUID;
  clientName: string;
  policyId: UUID;
  fullName: string;
  position: string;
  birthDateMasked: string;                 // '••.••.1987'
  pinflMasked: string;                     // '••••••••••1234'
  phoneMasked: string;                     // '+998 •• ••• •• 67'
  relation: InsuredRelation;
  /** The employee whose family the person belongs to; absent for an employee. */
  principalId?: UUID;
  principalName?: string;
  /** A child studying full time: covered up to `studentMaxAge` instead of `maxChildAge`. */
  isStudent?: boolean;
  /** A child that reached the age limit (`maxChildAge` / `studentMaxAge`): MIG decides on the exclusion. */
  ageLimit?: { age: number; reachedOn: ISODate };
  /** People of the employee's family (an employee only; empty otherwise). */
  family: FamilyMemberBrief[];
  appStatus: AppStatus;
  myIdVerified: boolean;
  attachedClinicId: UUID;
  insuredFrom: ISODate;
  status: 'active' | 'excluded';
  certificateNumber?: string;              // 'SERT-2026-000123-0001' (LIFECYCLE_SPEC §10)
  contractId?: UUID;
  externalCertificateNumber?: string;      // номер сертификата в старой системе
  migration?: MigrationMark;
}

export type PiiField = 'pinfl' | 'phone' | 'birthDate' | 'email';

export interface LimitUsage {
  category: LimitCategory;
  limit: Money;
  used: Money;
  reserved?: Money;                        // резерв одобренных ГП (ASSISTANCE_SPEC §5.2)
}

export type ClaimStatus = 'new' | 'review' | 'medical_review' | 'approved' | 'rejected' | 'to_pay' | 'paid';
export type ClaimCategory = 'medicines' | 'doctor_visit' | 'diagnostics' | 'dental' | 'inpatient';
export type ClaimSource = 'app' | 'clinic_invoice' | 'operator' | 'assistance';
/** How a claim registered by MIG staff reached MIG (HR letter, phone call, email, other). */
export type ClaimIntakeChannel = 'hr_letter' | 'phone' | 'email' | 'other';

export interface Attachment {
  id: UUID;
  kind: 'receipt' | 'invoice' | 'referral' | 'other';
  fileName: string;                        // без ПДн: 'receipt-1.jpg'
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  sizeBytes: number;
  url: string;                             // только blob: или /api/files/:id
}

export interface ClaimEvent {
  at: ISODateTime;
  actorName: string;
  from?: ClaimStatus;
  to: ClaimStatus;
  comment?: string;
}

export interface Claim {
  id: UUID;
  number: string;                          // 'U-2026-004512'
  insuredId: UUID;
  insuredName: string;
  clientId: UUID;
  clientName: string;
  category: ClaimCategory;
  source: ClaimSource;
  intakeChannel?: ClaimIntakeChannel;      // только для убытков, заведённых сотрудником МИГ
  amountClaimed: Money;
  amountApproved?: Money;
  providerName: string;
  serviceDate: ISODate;
  status: ClaimStatus;
  slaDueAt: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  attachments: Attachment[];
  history: ClaimEvent[];
  approvedById?: UUID;
  // ---- settlement by claims_officer (LIFECYCLE_SPEC §13) ----
  reserve?: Money;                         // резерв заявленного убытка; 0 после оплаты, отказа или закрытия
  flags?: FraudFlag[];
  opinion?: MedicalOpinion;
  decision?: ClaimDecision;
  pendingDecision?: PendingClaimDecision;  // решение выше полномочий автора ждёт согласования
  appeal?: ClaimAppeal;
  handledBy?: 'mig' | 'assistance';        // кто рассматривает возмещение (handlesReimbursements)
  receiptFiscal?: ReceiptFiscal;           // фискальные данные чека, распознанные сервером по фото
  externalNumber?: string;                 // номер убытка в старой системе
  migration?: MigrationMark;
}

/** Fiscal data printed on a receipt (Uzbekistan online cash registers). */
export interface ReceiptFiscal {
  /** Fiscal sign (ФП): unique per receipt; may be unreadable on the photo. */
  fiscalNumber?: string;
  /** Local date and time of the receipt, 'YYYY-MM-DDTHH:mm'. */
  issuedAt: string;
  /** Receipt total (may differ from the claimed amount when positions were removed). */
  amount: Money;
  /** INN of the point of sale (a company, not personal data). */
  sellerInn: string;
}

export type FraudFlagCode = 'duplicate_receipt' | 'frequent_claims' | 'outside_coverage' | 'before_exclusion' | 'above_price';

export interface FraudFlag {
  id: UUID;
  code: FraudFlagCode;
  message: string;                         // объяснение без ПДн
  dismissed?: { byName: string; at: ISODateTime; comment: string };
}

export interface MedicalOpinion {
  requestedAt: ISODateTime;
  requestedByName: string;
  question?: string;
  text?: string;
  recommendation?: 'approve' | 'partial' | 'reject';
  byName?: string;
  at?: ISODateTime;
}

export type ClaimDecisionKind = 'approve' | 'partial' | 'reject';

export interface ClaimDecision {
  kind: ClaimDecisionKind;
  amount: Money;                           // одобренная сумма (0 при отказе)
  clauseId?: string;                       // обязателен для отказа и частичного одобрения
  reason: string;
  byId: UUID;
  byName: string;
  at: ISODateTime;
  approvedByName?: string;                 // кто согласовал решение выше полномочий
}

export interface PendingClaimDecision extends Omit<ClaimDecision, 'approvedByName'> {
  /** Authority the decision needs (its amount); anyone of the role with at least this much may approve. */
  required: Money;
}

export interface ClaimAppeal {
  at: ISODateTime;
  by: 'insured' | 'clinic';
  text: string;
  status: 'open' | 'resolved';
  resolution?: string;
  resolvedAt?: ISODateTime;
}

export interface ReserveChange {
  at: ISODateTime;
  byName: string;
  from: Money;
  to: Money;
  reason: string;
}

/** То, что видит застрахованный: без внутренних комментариев и имён сотрудников. */
export interface MyClaim {
  id: UUID;
  number: string;
  category: ClaimCategory;
  amountClaimed: Money;
  amountApproved?: Money;
  providerName: string;
  serviceDate: ISODate;
  status: 'received' | 'checking' | 'approved' | 'rejected' | 'paid';
  steps: { key: 'received' | 'checked' | 'approved' | 'paid'; at?: ISODateTime; done: boolean }[];
  expectedPayoutBy?: ISODate;
  rejectionReason?: string;                // понятным языком
  payoutCardMasked: string;                // '•••• 4417'
  clauseRef?: string;                      // «п. 4.3 правил страхования» при отказе или частичном одобрении
  canAppeal?: boolean;
  appealStatus?: 'open' | 'resolved';
  letterAvailable?: boolean;               // письмо о решении по убытку
}

export type Specialty =
  | 'therapist' | 'pediatrician' | 'dentist' | 'cardiologist'
  | 'gynecologist' | 'ent' | 'neurologist' | 'ophthalmologist';

export type AppointmentStatus = 'requested' | 'confirmed' | 'declined' | 'completed' | 'cancelled';

export interface Appointment {
  id: UUID;
  insuredId: UUID;
  insuredName: string;
  clientName: string;
  clinicId: UUID;
  clinicName: string;
  specialty: Specialty;
  startsAt: ISODateTime;
  status: AppointmentStatus;
  createdAt: ISODateTime;
  respondedBy?: 'clinic' | 'operator';     // кто подтвердил или отклонил
  respondedAt?: ISODateTime;
  proposedStartsAt?: ISODateTime;          // клиника предложила другое время, ждём ответа застрахованного
  declineReason?: string;
  fromClinicSystem?: boolean;              // слот пришёл из МИС клиники (режим api)
}

export interface Clinic {
  id: UUID;
  /** Official Latin name without the legal form and without quotes. */
  name: string;
  legalForm: LegalFormCode;
  address: string;
  district: string;
  specialties: Specialty[];
  onlineBooking: boolean;
  apiStatus: 'online' | 'offline' | 'manual';
  contractUntil: ISODate;
  distanceKm?: number;                     // заполняется для /api/me/... (вымышленное)
  integrationMode: IntegrationMode;
  responseSlaMinutes?: number;             // индивидуальный срок ответа на заявку; нет — параметр ДМС clinicResponseMinutes
}

export interface Slot {
  clinicId: UUID;
  startsAt: ISODateTime;
  fromClinicSystem?: boolean;              // слот передан МИС клиники
}

export interface MedicalRecordEntry {
  id: UUID;
  insuredId: UUID;
  date: ISODate;
  clinicName: string;
  specialty: Specialty;
  diagnosisCode: string;                   // МКБ-10, вымышленные сочетания
  summary: string;
}

export type AuditAction =
  | 'login' | 'logout' | 'login_failed'
  | 'reveal_pii' | 'open_medical'
  | 'limit_change_request' | 'limit_change_approve' | 'limit_change_reject'
  | 'claim_transition' | 'export'
  | 'role_change' | 'user_deactivate'
  | 'hr_add_employee' | 'hr_exclude_employee' | 'hr_import'
  | 'kp_created' | 'kp_sent' | 'kp_revoked' | 'kp_downloaded'
  | 'clinic_check_patient' | 'clinic_check_failed'
  | 'guarantee_requested' | 'guarantee_decided'
  | 'registry_submitted' | 'registry_line_decided' | 'registry_paid'
  | 'integration_key_created' | 'integration_key_revoked' | 'webhook_created'
  | 'policy_issued' | 'policy_change_requested' | 'policy_change_decided'
  | 'assistance_assigned' | 'case_created' | 'guarantee_escalated' | 'clinic_payment_recorded'
  | 'rebill_submitted' | 'rebill_line_decided' | 'rebill_paid' | 'qa_reviewed' | 'complaint_resolved'
  | 'dms_param_proposed' | 'dms_param_changed' | 'dms_param_rejected'
  | 'authority_proposed'
  | 'authority_changed'
  | 'authority_rejected'
  | 'lead_created'
  | 'deal_stage_changed'
  | 'deal_lost'
  | 'census_uploaded'
  | 'quote_saved'
  | 'quote_submitted'
  | 'quote_approved'
  | 'quote_rejected'
  | 'kp_accepted'
  | 'kp_declined'
  | 'contract_created'
  | 'contract_updated'
  | 'contract_legal_submitted'
  | 'contract_legal_approved'
  | 'contract_legal_returned'
  | 'contract_finance_approved'
  | 'contract_sent'
  | 'contract_signed'
  | 'contract_scan_uploaded'
  | 'contract_scan_verified'
  | 'contract_original'
  | 'contract_activated'
  | 'contract_terminated'
  | 'payment_recorded'
  | 'payments_imported'
  | 'payment_allocated'
  | 'change_request_created'
  | 'endorsement_created'
  | 'endorsement_signed'
  | 'claim_opinion_requested'
  | 'claim_opinion_given'
  | 'claim_decided'
  | 'claim_decision_escalated'
  | 'claim_decision_rejected'
  | 'claim_reserve_changed'
  | 'claim_created'
  | 'claim_flag_dismissed'
  | 'claim_appealed'
  | 'claim_appeal_resolved'
  | 'ai_settings_proposed'
  | 'ai_settings_changed'
  | 'ai_settings_rejected'
  | 'ai_kill_switch'
  | 'ai_feedback'
  | 'migration_validated'
  | 'migration_submitted'
  | 'migration_applied'
  | 'migration_rejected'
  | 'migration_rolled_back'
  | 'migration_scan_attached'
  | 'family_consent_granted'
  | 'family_consent_revoked'
  | 'family_request_created'
  | 'family_request_decided'
  | 'payout_card_changed'
  | 'task_created'
  | 'task_done';

export interface AuditEntry {
  id: UUID;
  at: ISODateTime;
  actorId: UUID;
  actorName: string;
  actorRole: Role;
  action: AuditAction;
  targetType: 'insured' | 'claim' | 'policy' | 'client' | 'export' | 'user' | 'session' | 'kp' | 'clinic' | 'visit' | 'guarantee' | 'registry' | 'integration' | 'assistance' | 'case' | 'rebill' | 'parameter' | 'deal' | 'quote' | 'contract' | 'endorsement' | 'invoice' | 'ai' | 'migration';
  targetId?: UUID;
  targetLabel?: string;                    // без ПДн: номер полиса или убытка, либо «Застрахованный #a1b2»
  reason?: string;
  assistanceId?: UUID;                     // действие пользователя ассистанса (фильтр в журнале)
}

export interface LimitChangeRequest {
  id: UUID;
  policyId: UUID;
  policyNumber: string;
  insuredId?: UUID;
  category: LimitCategory;
  from: Money;
  to: Money;
  justification: string;
  requestedById: UUID;
  requestedByName: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedById?: UUID;
  decidedByName?: string;
  createdAt: ISODateTime;
}

export interface Invoice {
  id: UUID;
  clientId: UUID;
  number: string;
  amount: Money;
  issuedAt: ISODate;
  dueDate: ISODate;
  status: 'unpaid' | 'paid' | 'overdue';
  contractId?: UUID;                       // счёт по графику платежей договора (LIFECYCLE_SPEC §9)
  endorsementId?: UUID;                    // счёт на доплату по доп. соглашению
  paid?: Money;                            // оплачено (частичная оплата допустима)
  externalNumber?: string;                 // номер счёта в старой системе
  migration?: MigrationMark;
}

export interface ClientDocument {
  id: UUID;
  clientId: UUID;
  title: string;
  kind: 'policy' | 'contract' | 'invoice' | 'act' | 'program' | 'kp' | 'endorsement' | 'insured_list';
  createdAt: ISODate;
  kpId?: UUID;                             // для kind === 'kp'
}

export interface ChatMessage {
  id: UUID;
  from: 'insured' | 'operator';
  text: string;
  at: ISODateTime;
}

export interface StaffUser {
  id: UUID;
  fullName: string;
  email: string;
  role: StaffRole;
  active: boolean;
  lastLoginAt?: ISODateTime;
  authority: StaffAuthority;
  signatory?: { canSign: true; basis: string };   // «Доверенность № … от …»
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  code: 'unauthorized' | 'forbidden' | 'not_found' | 'validation' | 'conflict' | 'rate_limited' | 'server';
  /** Message key from src/i18n (`srv.*`, `errors.*`): the text is chosen by the client in its language. */
  key: string;
  params?: Record<string, string | number>;
  /** Field errors: packed message keys (`key` or `key|{json params}`), see msg() in src/i18n/core.ts. */
  fields?: Record<string, string>;
}

// ---------- Коммерческое предложение (KP_SPEC §4) ----------
export type KpVariant = 'white' | 'grey' | 'black';
export type KpLang = 'ru' | 'en';
export type KpStatus = 'draft' | 'sent' | 'revoked' | 'accepted' | 'declined';
export type KpPaymentTerms = 'single' | 'quarterly' | 'monthly';

export interface KpParams {
  templateId: 'gold';
  lang: KpLang;
  variant: KpVariant;
  sumInsured: Money;          // страховая сумма на одного застрахованного
  premiumEmployee: Money;     // премия за сотрудника
  premiumFamily: Money;       // премия за члена семьи
  employees: number;          // число сотрудников
  familyMembers: number;      // число членов семей
  coverageStart: ISODate;
  coverageEnd: ISODate;
  validUntil: ISODate;        // срок действия предложения
  paymentTerms: KpPaymentTerms;
  assistanceId?: UUID | null; // ассистанс на период продления (ASSISTANCE_SPEC §7); null — обслуживает МИГ
}

export interface KpDocument {
  id: UUID;
  number: string;             // 'KP-2026-000123'
  clientId: UUID;
  clientName: string;
  clientLegalForm: Client['legalForm'];   // для страницы-письма
  clientInn: string;                      // для страницы-письма (не ПДн)
  policyId?: UUID;
  params: KpParams;
  templateVersion: string;    // 'GOLD 09/26' — фиксируется на момент создания
  totalPremium: Money;        // employees*premiumEmployee + familyMembers*premiumFamily
  status: KpStatus;
  createdById: UUID;
  createdByName: string;
  createdByEmail: string;     // рабочая почта андеррайтера для страницы-письма
  createdAt: ISODateTime;
  sentAt?: ISODateTime;
  dealId?: UUID;                           // сделка (LIFECYCLE_SPEC §6)
  quoteId?: UUID;                          // утверждённая котировка, из которой взяты параметры
  response?: { at: ISODateTime; byName: string; via: 'hr' | 'manager'; reason?: string };
}

// ---------- Клиники и интеграция (CLINIC_SPEC §7) ----------
export type IntegrationMode = 'portal' | 'api' | 'hybrid';

export interface Visit {
  id: UUID;
  clinicId: UUID;
  insuredId: UUID;
  openedById: UUID;            // пользователь или ключ API
  method: 'qr' | 'policy' | 'api';
  openedAt: ISODateTime;
  expiresAt: ISODateTime;
}

export type CoverageStatus = 'covered' | 'needs_guarantee' | 'not_covered';
export type LimitState = 'available' | 'low' | 'exhausted';
export type ServiceCategory = LimitCategory | 'diagnostics_advanced';

export interface CoverageCheckResult {
  visitId: UUID;
  person: { fullName: string; birthYear: number };
  policy: { number: string; programName: string; validTo: ISODate; active: boolean };
  categories: { category: ServiceCategory; status: CoverageStatus; limitState: LimitState }[];
}

export type GuaranteeStatus = 'requested' | 'info_requested' | 'approved' | 'rejected' | 'used' | 'expired';

export interface GuaranteeLetter {
  id: UUID;
  number: string;              // 'GP-2026-000321'
  clinicId: UUID;
  visitId: UUID;
  insuredName: string;
  serviceCode: string;
  serviceName: string;
  icd10: string;
  estimatedCost: Money;
  approvedAmount?: Money;
  validUntil?: ISODate;
  status: GuaranteeStatus;
  approvals: { byId: UUID; byName: string; at: ISODateTime }[];
  reason?: string;             // причина решения врача-эксперта
  comment?: string;            // комментарий врача клиники к запросу
  attachments: Attachment[];
  createdAt: ISODateTime;
  assistanceId?: UUID | null;  // кто решает: ассистанс застрахованного или МИГ (null)
  assistanceName?: string;
  escalated?: boolean;         // ассистанс передал решение в МИГ (выше полномочий)
  assistanceOpinion?: string;  // заключение врача ассистанса при эскалации
  decidedBy?: 'assistance' | 'mig';
}

export type RegistryStatus = 'draft' | 'submitted' | 'in_review' | 'partially_accepted' | 'accepted' | 'paid';
export type RegistryLineStatus = 'pending' | 'accepted' | 'rejected' | 'disputed';

export interface RegistryLine {
  id: UUID;
  visitId?: UUID;
  insuredName: string;
  serviceDate: ISODate;
  serviceCode: string;
  serviceName: string;
  icd10: string;
  quantity: number;
  price: Money;
  amount: Money;
  guaranteeNumber?: string;
  status: RegistryLineStatus;
  rejectionReason?: string;
  disputeComment?: string;
  payer?: Payer;                           // кто проверяет и оплачивает строку (ASSISTANCE_SPEC §5.3)
  payment?: { paidAt: ISODate; amount: Money; orderNumber: string };
}

export interface Registry {
  id: UUID;
  clinicId: UUID;
  period: string;              // 'YYYY-MM'
  status: RegistryStatus;
  source: 'portal' | 'csv' | 'api';
  lines: RegistryLine[];
  totals: { claimed: Money; accepted: Money; rejected: Money; paid: Money };
  submittedAt?: ISODateTime;
  paidAt?: ISODateTime;
}

export interface PriceListItem {
  code: string;
  name: string;
  category: ServiceCategory;
  price: Money;
  requiresGuarantee: boolean;
}

export type IntegrationScope =
  | 'coverage:check' | 'appointments:read' | 'appointments:write' | 'slots:write'
  | 'guarantees:read' | 'guarantees:write' | 'registries:read' | 'registries:write' | 'payments:read'
  | 'roster:read' | 'cases:write' | 'guarantees:decide' | 'registries:review' | 'payments:write' | 'rebills:write';

export type PartnerType = 'clinic' | 'assistance';

export interface IntegrationClient {
  id: UUID;
  /** Id of the partner: a clinic, or an assistance company when partnerType is 'assistance'. */
  clinicId: UUID;
  partnerType?: PartnerType;
  name: string;
  clientId: string;
  secretLast4: string;
  scopes: IntegrationScope[];
  ipAllowlist: string[];
  createdAt: ISODateTime;
  lastUsedAt?: ISODateTime;
  revokedAt?: ISODateTime;
}

export type WebhookEvent =
  | 'appointment.requested' | 'appointment.cancelled'
  | 'guarantee.decided' | 'guarantee.documents_requested'
  | 'registry.reviewed' | 'registry.paid'
  // ассистанс-компании (ASSISTANCE_SPEC §8)
  | 'insured.added' | 'insured.excluded' | 'policy.assigned' | 'policy.unassigned'
  | 'guarantee.requested' | 'registry.received' | 'rebill.reviewed' | 'rebill.paid' | 'qa.disagreement';

export interface WebhookEndpoint {
  id: UUID;
  /** Id of the partner (see IntegrationClient.clinicId). */
  clinicId: UUID;
  partnerType?: PartnerType;
  url: string;
  events: WebhookEvent[];
  secretLast4: string;
  active: boolean;
  createdAt: ISODateTime;
}

export interface WebhookDelivery {
  id: UUID;
  endpointId: UUID;
  event: WebhookEvent;
  status: 'delivered' | 'retrying' | 'failed';
  attempts: number;
  lastAttemptAt: ISODateTime;
  responseCode?: number;
}

export interface ApiCallLog {
  id: UUID;
  clientId: string;
  at: ISODateTime;
  method: string;
  pathTemplate: string;        // '/guarantees/{id}' — без значений
  status: number;
  latencyMs: number;
}

// ---------- ассистанс-компании (ASSISTANCE_SPEC §4, §11) ----------
export type FeeModel = 'pepm' | 'percent_of_claims' | 'per_case';
export type IntegrationModeOf = 'portal' | 'api' | 'hybrid';

export interface AssistanceKpi {
  appointmentResponseMinutesAvg: number;
  guaranteesOnTimeShare: number;           // доля ГП, решённых в срок
  qaAgreementShare: number;                // доля решений, подтверждённых контрольной выборкой МИГ
  complaintsPer1000: number;
  lossRatio: number | null;                // по портфелю ассистанса
}

export interface AssistanceCompany {
  id: UUID;
  /** Official Latin name without the legal form and without quotes. */
  name: string;
  legalForm: LegalFormCode;
  phone24x7: string;                       // показывается застрахованным
  integrationMode: IntegrationModeOf;
  contract: {
    number: string;
    validFrom: ISODate;
    validTo: ISODate;
    feeModel: FeeModel;
    feeValue: number;                      // PEPM: сум за застрахованного в месяц; percent: доля 0..1; per_case: сум за обращение
    guaranteeAuthorityLimit?: Money;       // ГП до этой суммы ассистанс одобряет сам; нет — параметр ДМС assistanceGuaranteeAuthority
    rebillPaymentDays: number;             // срок оплаты счёта МИГ
    handlesReimbursements?: boolean;       // возмещения застрахованным рассматривает ассистанс (по умолчанию да)
  };
  kpi?: AssistanceKpi;
}

export interface AssistanceAssignment {
  policyId: UUID;
  assistanceId: UUID | null;
  from: ISODate;
  to?: ISODate;
  setById: UUID;
  setAt: ISODateTime;
}

export type AssistanceCaseType = 'appointment' | 'consultation' | 'guarantee' | 'complaint' | 'emergency';
export type AssistanceCaseStatus = 'open' | 'in_progress' | 'waiting' | 'resolved';

export interface AssistanceCase {
  id: UUID;
  number: string;                          // 'OBR-2026-012345'
  assistanceId: UUID;
  insuredId: UUID;
  insuredName: string;
  type: AssistanceCaseType;
  channel: 'phone' | 'chat' | 'app' | 'clinic';
  status: AssistanceCaseStatus;
  slaDueAt: ISODateTime;
  description: string;
  resolution?: string;
  links: { appointmentId?: UUID; guaranteeId?: UUID; claimId?: UUID };
  createdAt: ISODateTime;
}

export type Payer = 'mig' | UUID;          // UUID = assistanceId

export interface ClinicContract {
  clinicId: UUID;
  payer: Payer;
  priceList: PriceListItem[];
}

export type RebillStatus = 'draft' | 'submitted' | 'in_review' | 'partially_accepted' | 'accepted' | 'paid';
export type RebillCheckCode = 'not_paid_to_clinic' | 'policy_inactive' | 'not_assigned' | 'over_limit' | 'no_guarantee' | 'duplicate' | 'price_mismatch' | 'ai_disagrees';

export interface RebillLine {
  id: UUID;
  registryLineId: UUID;
  clinicName: string;
  insuredName: string;
  serviceDate: ISODate;
  serviceName: string;
  amount: Money;
  checks: { code: RebillCheckCode; message: string }[];
  status: 'pending' | 'accepted' | 'rejected' | 'disputed';
  rejectionReason?: string;
  disputeComment?: string;
}

export interface Rebill {
  id: UUID;
  number: string;                          // 'SChA-2026-09-A1'
  assistanceId: UUID;
  period: string;                          // 'YYYY-MM'
  lines: RebillLine[];
  fee: { model: FeeModel; base: number; value: number; amount: Money; formula: string };
  totals: { claims: Money; fee: Money; total: Money; accepted: Money; rejected: Money };
  status: RebillStatus;
  acceptedById?: UUID;
  paidById?: UUID;
  submittedAt?: ISODateTime;
  paidAt?: ISODateTime;
}

export interface QaSample {
  id: UUID;
  assistanceId: UUID;
  subject: { type: 'guarantee' | 'registry_line'; id: UUID; label: string };
  verdict?: 'agree' | 'disagree';
  comment?: string;
  reviewedById?: UUID;
  createdAt: ISODateTime;
}

// ---------- DMS business parameters (src/shared/config/dmsParameters.ts) ----------
export type DmsParamKey =
  | 'assistanceGuaranteeAuthority'
  | 'guaranteeDualApprovalThreshold'
  | 'guaranteeValidityDays'
  | 'qaSampleShare'
  | 'rebillReviewWorkdays'
  | 'subRegistryReviewDays'
  | 'clinicResponseMinutes'
  | 'limitLowShare'
  | 'lossRatioWarn'
  | 'kpValidityDays'
  | 'loginMaxAttempts'
  | 'loginWindowMinutes'
  | 'loginLockMinutes'
  | 'pinflChecksPerHour'
  | 'pinflFailsBeforeLock'
  | 'pinflLockMinutes'
  | 'tariffBaseBasic'
  | 'tariffBaseStandard'
  | 'tariffBaseStandardPlus'
  | 'tariffBasePremium'
  | 'tariffCoef0to17'
  | 'tariffCoef18to29'
  | 'tariffCoef30to39'
  | 'tariffCoef40to49'
  | 'tariffCoef50to59'
  | 'tariffCoef60plus'
  | 'groupDiscountFrom'
  | 'groupDiscountShare'
  | 'paperOriginalReminderDays'
  | 'overdueBlocksService'
  | 'endorsementPeriodicity'
  | 'refundRule'
  | 'coverageStartRule'
  | 'renewalLeadDays'
  | 'leadIdleDays'
  | 'kpNoAnswerDays'
  | 'fraudMaxClaimsPerMonth'
  | 'fraudPriceExcessShare'
  | 'fraudDaysBeforeExclusion'
  | 'limitMode'
  | 'maxChildAge'
  | 'studentMaxAge'
  | 'minGroupSize'
  | 'minGroupCountsFamily'
  | 'allowedLegalForms'
  | 'belowMinDuringTerm';

export type DmsParamValues = Record<DmsParamKey, number>;

/** Numbering template of a document kind (src/shared/domain/numbering.ts), changed like the other parameters. */
export type NumberingParamKey = `numbering.${DocNumberKind}`;
/** Any parameter a change request may target: a numeric DMS parameter or a numbering template. */
export type ParamKey = DmsParamKey | NumberingParamKey;

export interface NumberingParameter {
  kind: DocNumberKind;
  /** Template such as 'DMS-D-{YYYY}-{N:6}'. */
  value: string;
  /** Never changed since the seed: a demo value MIG still has to confirm. */
  isDemo: boolean;
  changedAt?: ISODateTime;
  changedByName?: string;
}

export interface DmsParameter {
  key: DmsParamKey;
  value: number;
  /** Never changed since the seed: the value is a demo value MIG still has to confirm. */
  isDemo: boolean;
  changedAt?: ISODateTime;
  changedByName?: string;
}

export type DmsParamChangeStatus = 'pending' | 'applied' | 'rejected';

/** A change is applied only after a second person (admin or underwriter) confirms it: four-eyes. */
export interface DmsParamChange {
  id: UUID;
  key: ParamKey;
  /** A number for DMS parameters, a template string for `numbering.*`. */
  from: number | string;
  to: number | string;
  reason: string;
  status: DmsParamChangeStatus;
  proposedById: UUID;
  proposedByName: string;
  proposedAt: ISODateTime;
  decidedById?: UUID;
  decidedByName?: string;
  decidedAt?: ISODateTime;
  rejectReason?: string;
}

// ---------- contract lifecycle (LIFECYCLE_SPEC) ----------
export interface AuthorityChange {
  id: UUID;
  staffId: UUID;
  staffName: string;
  from: { authority: StaffAuthority; signatory?: { canSign: true; basis: string } };
  to: { authority: StaffAuthority; signatory?: { canSign: true; basis: string } };
  reason: string;
  status: 'pending' | 'applied' | 'rejected';
  proposedById: UUID;
  proposedByName: string;
  proposedAt: ISODateTime;
  decidedByName?: string;
  decidedAt?: ISODateTime;
  rejectReason?: string;
}

export type DealStage =
  | 'lead' | 'census' | 'quote' | 'kp_sent' | 'kp_accepted'
  | 'contract_draft' | 'contract_review' | 'contract_sent' | 'signing'
  | 'awaiting_payment' | 'active' | 'lost';

export interface Deal {
  id: UUID;
  number: string;                          // 'SD-2026-000045'
  clientId: UUID;
  type: 'new' | 'renewal';
  stage: DealStage;
  ownerId: UUID;                           // sales_manager
  underwriterId?: UUID;
  expectedStart?: ISODate;
  lostReason?: string;
  previousPolicyId?: UUID;                 // для продления
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface DealEvent {
  id: UUID;
  dealId: UUID;
  at: ISODateTime;
  actorName: string;
  text: string;
}

/** Relation of a census row: the same as an insured person's (a row per person). */
export type CensusRelation = InsuredRelation;

export interface Census {
  id: UUID;
  dealId: UUID;
  rows: { gender: 'm' | 'f'; birthYear: number; relation: CensusRelation }[];
  uploadedAt: ISODateTime;
}

export type AgeBand = '0-17' | '18-29' | '30-39' | '40-49' | '50-59' | '60+';

export type QuoteStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected';

/**
 * How the premium of a person included during the term is set by the contract:
 * `flat_by_type` — premium_employee / premium_family of the contract; `age_banded` — the annual rate of the
 * person's age band from the contract's band table (an appendix taken from the approved quote).
 */
export type PricingBasis = 'flat_by_type' | 'age_banded';

/** A row of the age-band rate table: ages from `minAge` to `maxAge` inclusive (`null` = and older), annual premium per person. */
export interface AgeBandRate {
  minAge: number;
  maxAge: number | null;
  annual: Money;
}

export interface Quote {
  id: UUID;
  dealId: UUID;
  program: ProgramCode;
  rates: { band: AgeBand; count: number; baseRate: Money; coefficient: number; premium: Money }[];
  adjustments: { label: string; pct: number; comment: string }[];
  groupDiscountPct: number;                // скидка за размер группы, доля
  premiumEmployee: Money;
  premiumFamily: Money;
  total: Money;
  discountFromTariffPct: number;           // доля 0..1
  /** Basis the underwriter chose for inclusions during the term; goes into the contract. */
  pricingBasis: PricingBasis;
  /** Annual rate per person of each age band (tariff × coefficient × discounts): the contract's band table. */
  ageBandRates: AgeBandRate[];
  status: QuoteStatus;
  approvals: { byId: UUID; byName: string; at: ISODateTime; comment?: string }[];
  createdById: UUID;
  createdByName?: string;
  rejectReason?: string;
  updatedAt?: ISODateTime;
}

export type SignMethod = 'eimzo' | 'edo' | 'paper' | 'scan';

export interface SideSignature {
  method: SignMethod;
  signedAt: ISODateTime;
  signerName: string;
  certificate?: { serial: string; owner: string; validTo: ISODate };  // для eimzo/edo
  edoProvider?: string;                     // для edo
  scanFileId?: UUID;                        // для scan
  scanVerifiedById?: UUID;                  // кто из МИГ проверил скан
  scanVerifiedByName?: string;
}

export interface Signing {
  mig?: SideSignature;
  client?: SideSignature;
  paperOriginal: {
    required: boolean;
    migCopySentAt?: ISODate;
    clientOriginalReceivedAt?: ISODate;
    receivedById?: UUID;
    receivedByName?: string;
  };
  /** Document sent to an EDO operator and waiting for the client's signature there. */
  edoPending?: { provider: string; sentAt: ISODateTime };
  /** Scan uploaded but not yet verified: the signature does not count until then. */
  pendingScans?: { side: 'mig' | 'client'; fileId: UUID; uploadedAt: ISODateTime; uploadedByName: string }[];
  /** «Подписано МИГ» on paper is recorded, the copies are printed. */
  printedAt?: ISODateTime;
}

export type ContractStatus =
  | 'draft' | 'legal_review' | 'approved' | 'sent' | 'signing' | 'signed'
  | 'active' | 'terminated' | 'expired';

export type PaymentFrequency = 'single' | 'quarterly' | 'monthly';
export type ActivationRule = 'on_start_date' | 'after_first_payment';

export interface ClauseOverride {
  clauseId: string;
  original: string;
  text: string;
  byId: UUID;
  byName?: string;
  at: ISODateTime;
}

export interface Contract {
  id: UUID;
  number: string;                          // 'DMS-D-2026-000123'
  dealId: UUID;
  clientId: UUID;
  clientName: string;
  version: number;
  templateId: 'contract';
  templateVersion: string;
  params: {
    startDate: ISODate;
    endDate: ISODate;
    program: ProgramCode;
    premiumEmployee: Money;
    premiumFamily: Money;
    employees: number;
    familyMembers: number;
    total: Money;
    /** Premium of a person included during the term: by type (default) or by the age band table. */
    pricingBasis: PricingBasis;
    /** Age-band rate table (appendix from the approved quote); required for `age_banded`. */
    ageBandRates?: AgeBandRate[];
    paymentFrequency: PaymentFrequency;
    paymentSchedule: { dueDate: ISODate; amount: Money }[];
    activationRule: ActivationRule;
    migSignatoryId: UUID;
    clientSignatory: { name: string; position: string; basis: string };
    assistanceId?: UUID | null;
  };
  clauseOverrides: ClauseOverride[];
  insuredListId?: UUID;
  insuredCount?: number;                   // строк в приложении 2
  status: ContractStatus;
  signing: Signing;
  createdAt: ISODateTime;
  quoteId?: UUID;
  legalComment?: string;                   // комментарий юриста при возврате
  legalApprovedByName?: string;
  financeApprovedByName?: string;          // андеррайтер утвердил финансовые условия, отличные от котировки
  financeDiffers?: boolean;
  versions: { version: number; at: ISODateTime; byName: string; changes: string }[];
  policyId?: UUID;
  terminatedAt?: ISODate;
  activatedAt?: ISODateTime;
  /** Number of the contract in the previous system of MIG (searchable). */
  externalNumber?: string;
  migration?: MigrationMark;
  /** Signed scan attached after the transfer. */
  migratedScan?: { fileId: UUID; uploadedAt: ISODateTime; uploadedByName: string };
}

export interface Payment {
  id: UUID;
  invoiceId?: UUID;
  contractId?: UUID;
  amount: Money;
  paidAt: ISODate;
  payerInn: string;
  purpose: string;
  source: 'manual' | '1c';
  recordedByName: string;
  /** How a statement payment found its invoice; `manual` — allocated by the accountant. */
  matchedBy?: 'number' | 'inn_amount' | 'manual';
  /** The statement line it came from (manual allocation). */
  bankPaymentId?: UUID;
  /** Number of the payment document in the bank statement. */
  docNumber?: string;
  /** Required when the payer's INN differs from the invoiced client. */
  comment?: string;
}

/** Why a statement payment was not matched automatically. */
export type PaymentQueueReason = 'third_party' | 'over_remaining' | 'several_numbers' | 'ambiguous' | 'amount_mismatch' | 'no_invoices' | 'unknown_payer';
/** Why an invoice is suggested for a queued payment. */
export type PaymentCandidateWhy = 'number' | 'inn_amount' | 'inn' | 'amount';

/** A statement payment waiting for manual allocation («Ручная разноска»). */
export interface BankPayment {
  id: UUID;
  /** Number of the payment document in the bank statement. */
  docNumber?: string;
  date: ISODate;
  amount: Money;
  payerInn: string;
  /** Payer as known by its INN (a client), else as written in the statement. */
  payerName?: string;
  payerLegalForm?: LegalFormCode;
  purpose: string;
  reason: PaymentQueueReason;
  importedAt: ISODateTime;
  importedByName: string;
  /** Already allocated to invoices; the rest stays in the queue. */
  allocated: Money;
  status: 'pending' | 'allocated';
  allocations: { invoiceId: UUID; invoiceNumber: string; amount: Money; at: ISODateTime; byName: string; comment?: string }[];
}

export type ChangeRequestType = 'add_insured' | 'exclude_insured' | 'change_program' | 'other';

export interface ChangeRequest {
  id: UUID;
  contractId: UUID;
  type: ChangeRequestType;
  effectiveDate: ISODate;
  insuredId?: UUID;
  payload: Record<string, unknown>;
  requestedBy: { id: UUID; role: Role; name?: string };
  status: 'pending' | 'included' | 'cancelled';
  endorsementId?: UUID;
  createdAt?: ISODateTime;
  description?: string;                    // без ПДн: «Прикрепление: Иванов И. (сотрудник)»
}

export type EndorsementStatus = 'draft' | 'legal_review' | 'approved' | 'sent' | 'signing' | 'signed';

export interface Endorsement {
  id: UUID;
  number: string;                          // 'DS-3/DMS-D-2026-000123'
  contractId: UUID;
  kind?: 'changes' | 'termination';
  terminationDate?: ISODate;
  changeRequestIds: UUID[];
  lines: { changeRequestId: UUID; description: string; days: number; amount: Money; formula: string }[];
  total: Money;                            // >0 доплата, <0 возврат
  clauseOverrides: ClauseOverride[];
  status: EndorsementStatus;
  signing: Signing;
  createdAt?: ISODateTime;
  invoiceId?: UUID;
  refundDocument?: string;                 // номер документа на возврат
  amountsApprovedByName?: string;
}

// ---------- AI coverage check (AI_COVERAGE_SPEC) ----------
/** Group of a catalog service: coverage rules refer to it. */
export type ServiceGroup =
  | 'consultation' | 'lab' | 'diagnostics' | 'hightech' | 'procedure' | 'physio' | 'vaccination' | 'checkup' | 'ambulance'
  | 'dental_treatment' | 'dental_hygiene' | 'dental_prosthetics'
  | 'rx_drug' | 'otc_drug' | 'vitamins' | 'supplements' | 'cosmetics' | 'cosmetology' | 'optics'
  | 'inpatient' | 'surgery' | 'maternity';

export interface ServiceCatalogItem {
  code: string;                            // 'DG-314'; коды прайсов клиник совпадают
  name: string;
  synonyms: string[];                      // разговорные формулировки и сокращения ru/uz
  category: ServiceGroup;
  limitCategory: LimitCategory;
  requiresGuarantee: boolean;
}

export type CoverageDecision = 'covered' | 'needs_guarantee' | 'excluded';

export interface CoverageRule {
  program: ProgramCode;
  serviceCode?: string;                    // правило на услугу важнее правила на группу
  category?: ServiceGroup;
  decision: CoverageDecision;
  subLimit?: Money;
  waitingDays?: number;                    // от даты начала покрытия застрахованного
  clauseIds: string[];                     // 'program:6.2', 'contract:4.3'
}

export type CoverageVerdictDecision = CoverageDecision | 'limit_exhausted' | 'policy_inactive' | 'unknown';

export interface CoverageVerdict {
  decision: CoverageVerdictDecision;
  clauseIds: string[];
  limit: { category: LimitCategory; remaining: Money; afterThis?: Money } | null;
  notes: string[];
}

/** `help` — answers of «Задать вопрос» in the help (help.answer), built from the guide only. */
export type AiScenario = 'insured' | 'clinic' | 'decision' | 'rebill' | 'help';
export type AiProviderId = 'mock' | 'local' | 'external';

export interface AiSettings {
  scenarios: Record<AiScenario, { enabled: boolean; provider: AiProviderId }>;
  confidenceThreshold: number;             // доля 0..1: ниже — «Нужна проверка специалиста»
  killSwitch: boolean;                     // «Отключить ИИ везде»
}

export interface AiSettingsChange {
  id: UUID;
  /** What changes: a full new settings object (the editor sends the whole form). */
  to: AiSettings;
  from: AiSettings;
  reason: string;
  status: 'pending' | 'applied' | 'rejected';
  proposedById: UUID;
  proposedByName: string;
  proposedAt: ISODateTime;
  decidedByName?: string;
  decidedAt?: ISODateTime;
  rejectReason?: string;
}

/** One AI answer: no personal data, the input is stored as a hash. */
export interface AiCallLog {
  id: UUID;
  at: ISODateTime;
  scenario: AiScenario;
  promptVersion: string;
  provider: AiProviderId;
  model: string;
  inputHash: string;
  /** Redacted input (labels instead of names and numbers) — for the review of disagreements. */
  inputRedacted: string;
  output: { codes: string[]; decision: CoverageVerdictDecision; needsSpecialist: boolean };
  confidence: number;
  latencyMs: number;
  userId: UUID;
  userRole: Role;
  subject?: { type: 'claim' | 'guarantee' | 'registry_line' | 'rebill_line' | 'query' | 'receipt_item'; id?: UUID };
  suspicious: boolean;
  feedback?: { agree: boolean; comment?: string; byName: string; at: ISODateTime };
}
