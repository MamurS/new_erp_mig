export type UUID = string;
export type ISODate = string;      // '2026-09-29'
export type ISODateTime = string;  // '2026-09-29T14:21:00+05:00'
export type Money = number;        // целые сумы UZS

export type StaffRole = 'operator' | 'underwriter' | 'doctor_expert' | 'accountant' | 'admin';
export type ClinicRole = 'clinic_registrar' | 'clinic_admin';
export type Role = StaffRole | 'hr' | 'insured' | ClinicRole;

export interface SessionUser {
  id: UUID;
  role: Role;
  displayName: string;
  companyId?: UUID;        // для hr
  insuredId?: UUID;        // для insured
  clinicId?: UUID;         // для clinic_registrar и clinic_admin
  consentGivenAt?: ISODateTime; // для insured
}

export type ProgramCode = 'basic' | 'standard' | 'standard_plus' | 'premium';
export type LimitCategory = 'outpatient' | 'dental' | 'medicines' | 'inpatient';

export interface Program {
  code: ProgramCode;
  name: string;                           // 'Базовая' | 'Стандарт' | 'Стандарт+' | 'Премиум'
  limits: Record<LimitCategory, Money>;
}

export type ClientStatus = 'draft' | 'negotiation' | 'active' | 'renewal' | 'expired';

export interface Client {
  id: UUID;
  legalForm: 'ООО' | 'АО' | 'СП ООО' | 'ЧП';
  name: string;
  inn: string;                             // 9 цифр, не ПДн
  status: ClientStatus;
  managerId: UUID;
  managerName: string;
  hrContact: { name: string; phoneMasked: string; emailMasked: string };
  activePolicyId?: UUID;
  program?: ProgramCode;
  insuredCount: number;
  premium: Money;
  lossRatio: number | null;                // 0..1.5, null если полиса ещё нет
  renewalDate?: ISODate;
  createdAt: ISODateTime;
}

export type PolicyStatus = 'draft' | 'active' | 'expired' | 'cancelled';

export interface Policy {
  id: UUID;
  number: string;                          // 'ДМС-2026-000123'
  clientId: UUID;
  clientName: string;
  program: ProgramCode;
  startDate: ISODate;
  endDate: ISODate;
  status: PolicyStatus;
  premium: Money;
  insuredCount: number;
}

export type AppStatus = 'active' | 'invited' | 'not_invited';

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
  familyMembersCount: number;
  appStatus: AppStatus;
  myIdVerified: boolean;
  attachedClinicId: UUID;
  insuredFrom: ISODate;
  status: 'active' | 'excluded';
}

export type PiiField = 'pinfl' | 'phone' | 'birthDate' | 'email';

export interface LimitUsage {
  category: LimitCategory;
  limit: Money;
  used: Money;
}

export type ClaimStatus = 'new' | 'review' | 'medical_review' | 'approved' | 'rejected' | 'to_pay' | 'paid';
export type ClaimCategory = 'medicines' | 'doctor_visit' | 'diagnostics' | 'dental' | 'inpatient';
export type ClaimSource = 'app' | 'clinic_invoice' | 'operator';

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
  number: string;                          // 'У-2026-004512'
  insuredId: UUID;
  insuredName: string;
  clientId: UUID;
  clientName: string;
  category: ClaimCategory;
  source: ClaimSource;
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
  name: string;
  address: string;
  district: string;
  specialties: Specialty[];
  onlineBooking: boolean;
  apiStatus: 'online' | 'offline' | 'manual';
  contractUntil: ISODate;
  distanceKm?: number;                     // заполняется для /api/me/... (вымышленное)
  integrationMode: IntegrationMode;
  responseSlaMinutes: number;              // срок ответа клиники на заявку
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
  | 'integration_key_created' | 'integration_key_revoked' | 'webhook_created';

export interface AuditEntry {
  id: UUID;
  at: ISODateTime;
  actorId: UUID;
  actorName: string;
  actorRole: Role;
  action: AuditAction;
  targetType: 'insured' | 'claim' | 'policy' | 'client' | 'export' | 'user' | 'session' | 'kp' | 'clinic' | 'visit' | 'guarantee' | 'registry' | 'integration';
  targetId?: UUID;
  targetLabel?: string;                    // без ПДн: номер полиса или убытка, либо «Застрахованный #a1b2»
  reason?: string;
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
}

export interface ClientDocument {
  id: UUID;
  clientId: UUID;
  title: string;
  kind: 'policy' | 'contract' | 'invoice' | 'act' | 'program' | 'kp';
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
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  code: 'unauthorized' | 'forbidden' | 'not_found' | 'validation' | 'conflict' | 'rate_limited' | 'server';
  message: string;                         // безопасный текст для показа пользователю
  fields?: Record<string, string>;         // ошибки валидации по полям
}

// ---------- Коммерческое предложение (KP_SPEC §4) ----------
export type KpVariant = 'white' | 'grey' | 'black';
export type KpLang = 'ru' | 'en';
export type KpStatus = 'draft' | 'sent' | 'revoked';
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
}

export interface KpDocument {
  id: UUID;
  number: string;             // 'КП-2026-000123'
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
  number: string;              // 'ГП-2026-000321'
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
  | 'guarantees:read' | 'guarantees:write' | 'registries:read' | 'registries:write' | 'payments:read';

export interface IntegrationClient {
  id: UUID;
  clinicId: UUID;
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
  | 'registry.reviewed' | 'registry.paid';

export interface WebhookEndpoint {
  id: UUID;
  clinicId: UUID;
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
