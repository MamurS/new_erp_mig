import { LEGAL_FORMS } from '@/shared/config/legalForms';
/* Runtime validation of API responses at the client boundary (SPEC §9.1). */
import { z } from 'zod';
import { QUEUE_TYPES } from '@/shared/domain/queue';
import { DOC_NUMBER_KINDS } from '@/shared/domain/numbering';
import type * as T from '@/shared/types';
import type * as D from '@/shared/types/dto';

const uuid = z.string().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTime = z.string().min(10);
const money = z.number();

export const role = z.enum(['operator', 'underwriter', 'doctor_expert', 'accountant', 'admin', 'hr', 'insured', 'clinic_registrar', 'clinic_admin', 'asst_operator', 'asst_doctor', 'asst_billing', 'asst_admin', 'sales_manager', 'legal', 'claims_officer']);
export const staffAuthority: z.ZodType<T.StaffAuthority> = z.object({
  quoteDiscountMaxPct: z.number().optional(),
  quotePremiumMax: z.number().optional(),
  claimDecisionMax: z.number().optional(),
});
export const staffRole = z.enum(['operator', 'underwriter', 'doctor_expert', 'accountant', 'admin', 'sales_manager', 'legal', 'claims_officer']);
export const programCode = z.enum(['basic', 'standard', 'standard_plus', 'premium']);
export const limitCategory = z.enum(['outpatient', 'dental', 'medicines', 'inpatient']);
export const claimStatus = z.enum(['new', 'review', 'medical_review', 'approved', 'rejected', 'to_pay', 'paid']);
export const claimCategory = z.enum(['medicines', 'doctor_visit', 'diagnostics', 'dental', 'inpatient']);
export const claimIntakeChannel = z.enum(['hr_letter', 'phone', 'email', 'other']);
export const specialty = z.enum([
  'therapist',
  'pediatrician',
  'dentist',
  'cardiologist',
  'gynecologist',
  'ent',
  'neurologist',
  'ophthalmologist',
]);
const appStatus = z.enum(['active', 'invited', 'not_invited']);
export const insuredRelation = z.enum(['employee', 'spouse', 'child', 'parent', 'other']);
export const familyRelation = z.enum(['spouse', 'child', 'parent', 'other']);
const familyMemberBrief: z.ZodType<T.FamilyMemberBrief> = z.object({ id: uuid, fullName: z.string(), relation: familyRelation, status: z.enum(['active', 'excluded']) });
const limitsRecord = z.object({ outpatient: money, dental: money, medicines: money, inpatient: money });
/** «Перенесено из старой системы»: batch, date and author of the transfer. */
export const migrationMark: z.ZodType<T.MigrationMark> = z.object({ batchId: uuid, at: isoDateTime, byName: z.string() });

export const sessionUser: z.ZodType<T.SessionUser> = z.object({
  id: uuid,
  role,
  displayName: z.string(),
  companyId: uuid.optional(),
  insuredId: uuid.optional(),
  clinicId: uuid.optional(),
  assistanceId: uuid.optional(),
  consentGivenAt: isoDateTime.optional(),
  authority: staffAuthority.optional(),
  canSign: z.boolean().optional(),
});

export const challenge: z.ZodType<D.ChallengeResponse> = z.object({
  challengeId: z.string(),
  resendInSec: z.number(),
});
export const sessionResponse: z.ZodType<D.SessionResponse> = z.object({ sessionId: z.string(), user: sessionUser });

export const program: z.ZodType<T.Program> = z.object({ code: programCode, name: z.string(), limits: limitsRecord });

export const client: z.ZodType<T.Client> = z.object({
  id: uuid,
  legalForm: z.enum(LEGAL_FORMS),
  name: z.string(),
  inn: z.string(),
  status: z.enum(['lead', 'draft', 'negotiation', 'active', 'renewal', 'expired']),
  managerId: uuid,
  managerName: z.string(),
  hrContact: z.object({ name: z.string(), phoneMasked: z.string(), emailMasked: z.string() }),
  activePolicyId: uuid.optional(),
  assistanceId: uuid.nullable().optional(),
  program: programCode.optional(),
  insuredCount: z.number(),
  premium: money,
  lossRatio: z.number().nullable(),
  renewalDate: isoDate.optional(),
  createdAt: isoDateTime,
  requisites: z
    .object({ bank: z.string(), account: z.string(), mfo: z.string(), director: z.string(), directorBasis: z.string(), address: z.string().optional() })
    .optional(),
  estimatedHeadcount: z.number().optional(),
  currentInsurer: z.string().optional(),
  migration: migrationMark.optional(),
});

export function page<S extends z.ZodTypeAny>(item: S) {
  return z.object({ items: z.array(item), total: z.number(), page: z.number(), pageSize: z.number() });
}

export const clientList: z.ZodType<D.ClientListResponse> = page(client).extend({ totalPremium: money });

const clientDocument: z.ZodType<T.ClientDocument> = z.object({
  id: uuid,
  clientId: uuid,
  title: z.string(),
  kind: z.enum(['policy', 'contract', 'invoice', 'act', 'program', 'kp', 'endorsement', 'insured_list']),
  createdAt: isoDate,
  kpId: uuid.optional(),
});
export const clientDocuments = z.array(clientDocument);

// Strict: an unexpected field (a list of claims, a name) fails validation instead of reaching the screen.
export const clientLossStats: z.ZodType<D.ClientLossStats> = z
  .object({
    clientId: uuid,
    clientName: z.string(),
    clientLegalForm: z.enum(LEGAL_FORMS),
    premium: money,
    lossRatio: z.number().nullable(),
    lossRatioWarn: z.number(),
    claimsCount: z.number(),
    claimsAmount: money,
    byCategory: z.array(z.object({ category: z.string(), count: z.number(), amount: money }).strict()),
    byMonth: z.array(z.object({ month: z.string(), count: z.number(), amount: money }).strict()),
  })
  .strict();
export const clientDetail: z.ZodType<D.ClientDetail> = z.intersection(
  client,
  z.object({
    claimsByMonth: z.array(z.object({ month: z.string(), amount: money, count: z.number() })),
    claimsByCategory: z.array(z.object({ category: z.string(), count: z.number(), amount: money })),
    activity: z.array(z.object({ at: isoDateTime, text: z.string() })),
    hasRenewalOffer: z.boolean(),
  }),
);

export const policy: z.ZodType<T.Policy> = z.object({
  id: uuid,
  number: z.string(),
  clientId: uuid,
  clientName: z.string(),
  clientLegalForm: z.enum(LEGAL_FORMS).optional(),
  program: programCode,
  startDate: isoDate,
  endDate: isoDate,
  status: z.enum(['draft', 'active', 'expired', 'cancelled']),
  premium: money,
  insuredCount: z.number(),
  tariff: z.object({ employee: money, family: money }).optional(),
  familyCount: z.number().optional(),
  assistanceId: uuid.nullable().optional(),
  contractId: uuid.optional(),
});
export const policyPage = page(policy);
export const policyDetail: z.ZodType<D.PolicyDetail> = z.intersection(
  policy,
  z.object({ programInfo: program, documents: z.array(clientDocument) }),
);

const insuredBase = z.object({
  id: uuid,
  clientId: uuid,
  clientName: z.string(),
  policyId: uuid,
  fullName: z.string(),
  position: z.string(),
  birthDateMasked: z.string(),
  pinflMasked: z.string(),
  phoneMasked: z.string(),
  relation: insuredRelation,
  principalId: uuid.optional(),
  principalName: z.string().optional(),
  isStudent: z.boolean().optional(),
  ageLimit: z.object({ age: z.number(), reachedOn: isoDate }).optional(),
  family: z.array(familyMemberBrief),
  appStatus,
  myIdVerified: z.boolean(),
  attachedClinicId: uuid,
  insuredFrom: isoDate,
  status: z.enum(['active', 'excluded']),
  certificateNumber: z.string().optional(),
  contractId: uuid.optional(),
  externalCertificateNumber: z.string().optional(),
  migration: migrationMark.optional(),
});
export const insured: z.ZodType<T.Insured> = insuredBase;
export const insuredListItem: z.ZodType<D.InsuredListItem> = z.object({
  id: uuid,
  fullName: z.string(),
  clientId: uuid,
  clientName: z.string(),
  policyId: uuid,
  position: z.string(),
  status: z.enum(['active', 'excluded']),
  appStatus,
  relation: insuredRelation,
  principalId: uuid.optional(),
  principalName: z.string().optional(),
  pinflMasked: z.string().optional(),
  phoneMasked: z.string().optional(),
  birthDateMasked: z.string().optional(),
});
export const insuredPage = page(insuredListItem);
export const insuredDetail: z.ZodType<D.InsuredDetail> = insuredBase.extend({
  policyNumber: z.string(),
  program: programCode,
  policyStart: isoDate,
  policyEnd: isoDate,
  emailMasked: z.string(),
});
export const limitUsage: z.ZodType<T.LimitUsage> = z.object({ category: limitCategory, limit: money, used: money, reserved: money.optional() });
export const limitUsages = z.array(limitUsage);
export const reveal: z.ZodType<D.RevealResponse> = z.object({ value: z.string(), expiresInSec: z.number() });
export const medicalGrant: z.ZodType<D.MedicalGrant> = z.object({ grantId: z.string(), expiresAt: isoDateTime });
export const medicalRecords = z.array(
  z.object({
    id: uuid,
    insuredId: uuid,
    date: isoDate,
    clinicName: z.string(),
    specialty,
    diagnosisCode: z.string(),
    summary: z.string(),
  }) satisfies z.ZodType<T.MedicalRecordEntry>,
);
export const insuredClaims = z.array(
  z.object({
    id: uuid,
    number: z.string(),
    category: claimCategory,
    amountClaimed: money,
    status: claimStatus,
    createdAt: isoDateTime,
  }) satisfies z.ZodType<D.InsuredClaimSummary>,
);
export const insuredDocuments = z.array(
  z.object({ id: uuid, title: z.string(), createdAt: isoDate }) satisfies z.ZodType<D.InsuredDocument>,
);

const attachment: z.ZodType<T.Attachment> = z.object({
  id: uuid,
  kind: z.enum(['receipt', 'invoice', 'referral', 'other']),
  fileName: z.string(),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  sizeBytes: z.number(),
  url: z.string().refine((u) => u.startsWith('blob:') || u.startsWith('/api/files/'), 'bad url'),
});
const claimEvent: z.ZodType<T.ClaimEvent> = z.object({
  at: isoDateTime,
  actorName: z.string(),
  from: claimStatus.optional(),
  to: claimStatus,
  comment: z.string().optional(),
});
const fraudFlag: z.ZodType<T.FraudFlag> = z.object({
  id: uuid,
  code: z.enum(['duplicate_receipt', 'frequent_claims', 'outside_coverage', 'before_exclusion', 'above_price']),
  message: z.string(),
  dismissed: z.object({ byName: z.string(), at: isoDateTime, comment: z.string() }).optional(),
});
const claimDecision = z.object({
  kind: z.enum(['approve', 'partial', 'reject']),
  amount: money,
  clauseId: z.string().optional(),
  reason: z.string(),
  byId: uuid,
  byName: z.string(),
  at: isoDateTime,
});
const receiptFiscal: z.ZodType<T.ReceiptFiscal> = z.object({
  fiscalNumber: z.string().optional(),
  issuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  amount: money,
  sellerInn: z.string(),
});
const claimBase = z.object({
  id: uuid,
  number: z.string(),
  insuredId: uuid,
  insuredName: z.string(),
  clientId: uuid,
  clientName: z.string(),
  category: claimCategory,
  source: z.enum(['app', 'clinic_invoice', 'operator', 'assistance']),
  intakeChannel: claimIntakeChannel.optional(),
  amountClaimed: money,
  amountApproved: money.optional(),
  providerName: z.string(),
  serviceDate: isoDate,
  status: claimStatus,
  slaDueAt: isoDateTime,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  attachments: z.array(attachment),
  history: z.array(claimEvent),
  approvedById: uuid.optional(),
  reserve: money.optional(),
  flags: z.array(fraudFlag).optional(),
  opinion: z
    .object({
      requestedAt: isoDateTime,
      requestedByName: z.string(),
      question: z.string().optional(),
      text: z.string().optional(),
      recommendation: z.enum(['approve', 'partial', 'reject']).optional(),
      byName: z.string().optional(),
      at: isoDateTime.optional(),
    })
    .optional(),
  decision: claimDecision.extend({ approvedByName: z.string().optional() }).optional(),
  pendingDecision: claimDecision.extend({ required: money }).optional(),
  appeal: z
    .object({
      at: isoDateTime,
      by: z.enum(['insured', 'clinic']),
      text: z.string(),
      status: z.enum(['open', 'resolved']),
      resolution: z.string().optional(),
      resolvedAt: isoDateTime.optional(),
    })
    .optional(),
  handledBy: z.enum(['mig', 'assistance']).optional(),
  receiptFiscal: receiptFiscal.optional(),
  externalNumber: z.string().optional(),
  migration: migrationMark.optional(),
});
export const claim: z.ZodType<T.Claim> = claimBase;
export const claimPage = page(claim);
export const claimDetail: z.ZodType<D.ClaimDetail> = claimBase.extend({
  limitCheck: z.object({
    category: limitCategory,
    limit: money,
    used: money,
    remaining: money,
    remainingAfter: money,
  }),
  allowedTransitions: z.array(claimStatus),
  medicalReviewRequired: z.boolean(),
  blockedTransitions: z.array(z.object({ to: claimStatus, reason: z.string() })),
  reserveHistory: z.array(z.object({ at: isoDateTime, byName: z.string(), from: money, to: money, reason: z.string() })).optional(),
  settlement: z
    .object({
      canDecide: z.boolean(),
      canApprovePending: z.boolean(),
      canRequestOpinion: z.boolean(),
      canGiveOpinion: z.boolean(),
      canChangeReserve: z.boolean(),
      authorityMax: money.nullable(),
    })
    .optional(),
});

const myClaimStatus = z.enum(['received', 'checking', 'approved', 'rejected', 'paid']);
export const myClaim: z.ZodType<T.MyClaim> = z.object({
  id: uuid,
  number: z.string(),
  category: claimCategory,
  amountClaimed: money,
  amountApproved: money.optional(),
  providerName: z.string(),
  serviceDate: isoDate,
  status: myClaimStatus,
  steps: z.array(
    z.object({
      key: z.enum(['received', 'checked', 'approved', 'paid']),
      at: isoDateTime.optional(),
      done: z.boolean(),
    }),
  ),
  expectedPayoutBy: isoDate.optional(),
  rejectionReason: z.string().optional(),
  payoutCardMasked: z.string(),
  clauseRef: z.string().optional(),
  canAppeal: z.boolean().optional(),
  appealStatus: z.enum(['open', 'resolved']).optional(),
  letterAvailable: z.boolean().optional(),
});
export const myClaims = z.array(myClaim);

export const appointment: z.ZodType<T.Appointment> = z.object({
  id: uuid,
  insuredId: uuid,
  insuredName: z.string(),
  clientName: z.string(),
  clinicId: uuid,
  clinicName: z.string(),
  specialty,
  startsAt: isoDateTime,
  status: z.enum(['requested', 'confirmed', 'declined', 'completed', 'cancelled']),
  createdAt: isoDateTime,
  respondedBy: z.enum(['clinic', 'operator']).optional(),
  respondedAt: isoDateTime.optional(),
  proposedStartsAt: isoDateTime.optional(),
  declineReason: z.string().optional(),
  fromClinicSystem: z.boolean().optional(),
});
export const appointmentPage = page(appointment);
export const appointments = z.array(appointment);

export const clinic: z.ZodType<T.Clinic> = z.object({
  id: uuid,
  name: z.string(),
  legalForm: z.enum(LEGAL_FORMS),
  address: z.string(),
  district: z.string(),
  specialties: z.array(specialty),
  onlineBooking: z.boolean(),
  apiStatus: z.enum(['online', 'offline', 'manual']),
  contractUntil: isoDate,
  distanceKm: z.number().optional(),
  integrationMode: z.enum(['portal', 'api', 'hybrid']),
  responseSlaMinutes: z.number().optional(),
});
export const clinics = z.array(clinic);
export const slots = z.array(z.object({ clinicId: uuid, startsAt: isoDateTime, fromClinicSystem: z.boolean().optional() }) satisfies z.ZodType<T.Slot>);

export const auditEntry: z.ZodType<T.AuditEntry> = z.object({
  id: uuid,
  at: isoDateTime,
  actorId: uuid,
  actorName: z.string(),
  actorRole: role,
  action: z.enum([
    'login',
    'logout',
    'login_failed',
    'reveal_pii',
    'open_medical',
    'limit_change_request',
    'limit_change_approve',
    'limit_change_reject',
    'claim_transition',
    'export',
    'role_change',
    'user_deactivate',
    'hr_add_employee',
    'hr_exclude_employee',
    'hr_import',
    'kp_created',
    'kp_sent',
    'kp_revoked',
    'kp_downloaded',
    'clinic_check_patient',
    'clinic_check_failed',
    'guarantee_requested',
    'guarantee_decided',
    'registry_submitted',
    'registry_line_decided',
    'registry_paid',
    'integration_key_created',
    'integration_key_revoked',
    'webhook_created',
    'policy_issued',
    'policy_change_requested',
    'policy_change_decided',
    'assistance_assigned',
    'case_created',
    'guarantee_escalated',
    'clinic_payment_recorded',
    'rebill_submitted',
    'rebill_line_decided',
    'rebill_paid',
    'qa_reviewed',
    'complaint_resolved',
    'dms_param_proposed',
    'dms_param_changed',
    'dms_param_rejected',
    'authority_proposed',
    'authority_changed',
    'authority_rejected',
    'lead_created',
    'deal_stage_changed',
    'deal_lost',
    'census_uploaded',
    'quote_saved',
    'quote_submitted',
    'quote_approved',
    'quote_rejected',
    'kp_accepted',
    'kp_declined',
    'contract_created',
    'contract_updated',
    'contract_legal_submitted',
    'contract_legal_approved',
    'contract_legal_returned',
    'contract_finance_approved',
    'contract_sent',
    'contract_signed',
    'contract_scan_uploaded',
    'contract_scan_verified',
    'contract_original',
    'contract_activated',
    'contract_terminated',
    'payment_recorded',
    'payments_imported',
    'payment_allocated',
    'change_request_created',
    'endorsement_created',
    'endorsement_signed',
    'claim_opinion_requested',
    'claim_opinion_given',
    'claim_decided',
    'claim_decision_escalated',
    'claim_decision_rejected',
    'claim_reserve_changed',
    'claim_created',
    'claim_flag_dismissed',
    'claim_appealed',
    'claim_appeal_resolved',
    'ai_settings_proposed',
    'ai_settings_changed',
    'ai_settings_rejected',
    'ai_kill_switch',
    'ai_feedback',
    'migration_validated',
    'migration_submitted',
    'migration_applied',
    'migration_rejected',
    'migration_rolled_back',
    'migration_scan_attached',
    'family_consent_granted',
    'family_consent_revoked',
    'family_request_created',
    'family_request_decided',
    'payout_card_changed',
    'task_created',
    'task_done',
  ]),
  targetType: z.enum(['insured', 'claim', 'policy', 'client', 'export', 'user', 'session', 'kp', 'clinic', 'visit', 'guarantee', 'registry', 'integration', 'assistance', 'case', 'rebill', 'parameter', 'deal', 'quote', 'contract', 'endorsement', 'invoice', 'ai', 'migration']),
  targetId: uuid.optional(),
  targetLabel: z.string().optional(),
  reason: z.string().optional(),
  assistanceId: uuid.optional(),
});
export const auditPage = page(auditEntry);
export const auditList = z.array(auditEntry);

export const limitRequest: z.ZodType<T.LimitChangeRequest> = z.object({
  id: uuid,
  policyId: uuid,
  policyNumber: z.string(),
  insuredId: uuid.optional(),
  category: limitCategory,
  from: money,
  to: money,
  justification: z.string(),
  requestedById: uuid,
  requestedByName: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  decidedById: uuid.optional(),
  decidedByName: z.string().optional(),
  createdAt: isoDateTime,
});
export const limitRequests = z.array(limitRequest);

export const invoice: z.ZodType<T.Invoice> = z.object({
  id: uuid,
  clientId: uuid,
  number: z.string(),
  amount: money,
  issuedAt: isoDate,
  dueDate: isoDate,
  status: z.enum(['unpaid', 'paid', 'overdue']),
  contractId: uuid.optional(),
  endorsementId: uuid.optional(),
  paid: money.optional(),
  externalNumber: z.string().optional(),
  migration: migrationMark.optional(),
});
export const invoices = z.array(invoice);

export const chatMessage: z.ZodType<T.ChatMessage> = z.object({
  id: uuid,
  from: z.enum(['insured', 'operator']),
  text: z.string(),
  at: isoDateTime,
});
export const chatMessages = z.array(chatMessage);

export const staffUser: z.ZodType<T.StaffUser> = z.object({
  id: uuid,
  fullName: z.string(),
  email: z.string(),
  role: staffRole,
  active: z.boolean(),
  lastLoginAt: isoDateTime.optional(),
  authority: staffAuthority,
  signatory: z.object({ canSign: z.literal(true), basis: z.string() }).optional(),
});
export const staffUsers = z.array(staffUser);

const kpi: z.ZodType<D.Kpi> = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number(),
  format: z.enum(['number', 'money']),
  hint: z.string().optional(),
  tone: z.enum(['default', 'warning', 'danger']).optional(),
  to: z.string().optional(),
});
const queueType = z.enum(QUEUE_TYPES);
export const dashboard: z.ZodType<D.DashboardSummary> = z.object({
  firstName: z.string(),
  queueCount: z.number(),
  queueTypes: z.array(z.object({ type: queueType, count: z.number() })),
  kpis: z.array(kpi),
  attention: z.array(
    z.object({
      key: z.enum(['renewals_no_offer', 'high_loss_ratio', 'sla_overdue']),
      label: z.string(),
      count: z.number(),
      to: z.string(),
    }),
  ),
});
export const queueItems = z.array(
  z.object({
    id: uuid,
    type: queueType,
    entityId: uuid,
    who: z.string(),
    details: z.string(),
    status: z.string(),
    statusTone: z.enum(['default', 'success', 'warning', 'danger', 'info']),
    dueAt: isoDateTime,
    action: z.enum(['confirm', 'open', 'prepare_offer']),
    subject: z.enum(['claim', 'registry', 'contract', 'endorsement', 'insured']).optional(),
    legalForm: z.enum(LEGAL_FORMS).optional(),
    policyId: uuid.optional(),
    link: z.string().optional(),
  }) satisfies z.ZodType<D.QueueItem>,
);
export const integrations = z.array(
  z.object({
    name: z.string(),
    status: z.enum(['ok', 'degraded', 'down']),
    lastSyncAt: isoDateTime,
    queue: z.number(),
  }) satisfies z.ZodType<D.IntegrationStatus>,
);

export const lossRatioRows = z.array(
  z.object({ clientId: uuid, clientName: z.string(), clientLegalForm: z.enum(LEGAL_FORMS).optional(), lossRatio: z.number() }) satisfies z.ZodType<D.LossRatioRow>,
);
export const claimsByCategoryRows = z.array(
  z.object({ category: claimCategory, count: z.number(), amount: money }) satisfies z.ZodType<D.ClaimsByCategoryRow>,
);
export const premiumByMonthRows = z.array(
  z.object({ month: z.string(), premium: money }) satisfies z.ZodType<D.PremiumByMonthRow>,
);

export const hrOverview: z.ZodType<D.HrOverview> = z.object({
  companyName: z.string(),
  companyLegalForm: z.enum(LEGAL_FORMS).optional(),
  insuredCount: z.number(),
  notInApp: z.number(),
  nextInvoice: invoice.nullable(),
  policy: z
    .object({ number: z.string(), program: programCode, programName: z.string(), startDate: isoDate, endDate: isoDate })
    .nullable(),
  manager: z.object({ name: z.string(), phone: z.string(), email: z.string() }),
});
export const hrEmployee: z.ZodType<D.HrEmployee> = z.object({
  id: uuid,
  fullName: z.string(),
  position: z.string(),
  program: programCode,
  insuredFrom: isoDate,
  family: z.array(familyMemberBrief),
  appStatus,
  status: z.enum(['active', 'excluded', 'pending', 'rejected']),
  excludedFrom: isoDate.optional(),
  addedAt: isoDateTime,
  pendingExclusionFrom: isoDate.optional(),
  rejectionReason: z.string().optional(),
});
export const hrEmployeePage = page(hrEmployee);
export const hrImportResult: z.ZodType<D.HrImportResult> = z.object({
  valid: z.number(),
  added: z.number(),
  requested: z.number().optional(),
  errors: z.array(z.object({ row: z.number(), field: z.string(), message: z.string() })),
});
const slice = z.object({ label: z.string(), value: z.number().nullable() });
export const hrStats: z.ZodType<D.HrStats> = z.object({
  insuredCount: z.number(),
  appUsers: z.number().nullable(),
  claimsThisQuarter: z.number().nullable(),
  budgetUsedPct: z.number().nullable(),
  byAgeGroup: z.array(slice),
  byAppStatus: z.array(slice),
  k: z.number(),
});

export const meProfile: z.ZodType<D.MeProfile> = z.object({
  fullName: z.string(),
  firstName: z.string(),
  companyName: z.string(),
  phoneMasked: z.string(),
  pinflMasked: z.string(),
  payoutCardMasked: z.string(),
  consentGivenAt: isoDateTime.optional(),
  relation: insuredRelation,
  payoutCardOwn: z.boolean(),
  familyConsentGranted: z.boolean().optional(),
  principalName: z.string().optional(),
  principalFirstName: z.string().optional(),
});
export const mePolicy: z.ZodType<D.MePolicy> = z.object({
  number: z.string(),
  program: programCode,
  programName: z.string(),
  companyName: z.string(),
  startDate: isoDate,
  endDate: isoDate,
  limits: limitsRecord,
  certificateNumber: z.string().optional(),
});
export const cardToken: z.ZodType<D.CardToken> = z.object({ token: z.string(), shortCode: z.string(), expiresAt: isoDateTime });
export const recognizeResult: z.ZodType<D.RecognizeResult> = z.object({
  providerName: z.string(),
  amount: money,
  serviceDate: isoDate,
  items: z.array(z.object({ name: z.string(), amount: money })).optional(),
  fiscal: receiptFiscal.optional(),
});
export const consentResult = z.object({ consentGivenAt: isoDateTime });
export const ok = z.object({ ok: z.literal(true) });
export const idResult = z.object({ id: uuid });
export const inviteResult = z.object({ invited: z.number() });

// ---- commercial offers ----
const legalForm = z.enum(LEGAL_FORMS);
export const kpParams: z.ZodType<T.KpParams> = z.object({
  templateId: z.literal('gold'),
  lang: z.enum(['ru', 'en']),
  variant: z.enum(['white', 'grey', 'black']),
  sumInsured: z.number().int().nonnegative(),
  premiumEmployee: z.number().int().nonnegative(),
  premiumFamily: z.number().int().nonnegative(),
  employees: z.number().int().nonnegative(),
  familyMembers: z.number().int().nonnegative(),
  coverageStart: isoDate,
  coverageEnd: isoDate,
  validUntil: isoDate,
  paymentTerms: z.enum(['single', 'quarterly', 'monthly']),
  assistanceId: uuid.nullable().optional(),
});
export const kpDocument: z.ZodType<T.KpDocument> = z.object({
  id: uuid,
  number: z.string(),
  clientId: uuid,
  clientName: z.string(),
  clientLegalForm: legalForm,
  clientInn: z.string(),
  policyId: uuid.optional(),
  params: kpParams,
  templateVersion: z.string(),
  totalPremium: z.number().int().nonnegative(),
  status: z.enum(['draft', 'sent', 'revoked', 'accepted', 'declined']),
  createdById: uuid,
  createdByName: z.string(),
  createdByEmail: z.string(),
  createdAt: isoDateTime,
  sentAt: isoDateTime.optional(),
  dealId: uuid.optional(),
  quoteId: uuid.optional(),
  response: z.object({ at: isoDateTime, byName: z.string(), via: z.enum(['hr', 'manager']), reason: z.string().optional() }).optional(),
});
export const kpDocuments = z.array(kpDocument);
export const kpDefaults: z.ZodType<D.KpDefaults> = z.object({
  params: kpParams,
  letter: z.object({
    clientName: z.string(),
    clientLegalForm: legalForm,
    clientInn: z.string(),
    policyId: uuid.optional(),
    createdByName: z.string(),
    createdByEmail: z.string(),
  }),
});

// ---- policy issuance and changes of the insured list (POLICY_SPEC) ----
const importErrors = z.array(z.object({ row: z.number(), field: z.string(), message: z.string() }));
export const policyListCheck: z.ZodType<D.PolicyListCheck> = z.object({
  total: z.number(),
  valid: z.number(),
  employees: z.number(),
  familyMembers: z.number(),
  errors: importErrors,
});
export const policyChange: z.ZodType<T.PolicyChange> = z.object({
  id: uuid,
  clientId: uuid,
  clientName: z.string(),
  policyId: uuid,
  policyNumber: z.string(),
  kind: z.enum(['add', 'exclude']),
  insuredId: uuid.optional(),
  fullName: z.string(),
  position: z.string(),
  relation: insuredRelation,
  principalId: uuid.optional(),
  principalName: z.string().optional(),
  effectiveDate: isoDate,
  premiumDelta: money,
  status: z.enum(['pending', 'approved', 'rejected']),
  requestedAt: isoDateTime,
  requestedByName: z.string(),
  decidedAt: isoDateTime.optional(),
  decidedByName: z.string().optional(),
  rejectionReason: z.string().optional(),
  endorsementId: uuid.optional(),
});
export const policyChanges = z.array(policyChange);
export const policyChangeDecisionResult: z.ZodType<D.PolicyChangeDecisionResult> = z.object({ approved: z.number(), rejected: z.number(), endorsements: z.number() });

// ---- DMS business parameters ----
const dmsParamKey = z.enum([
  'assistanceGuaranteeAuthority',
  'guaranteeDualApprovalThreshold',
  'guaranteeValidityDays',
  'qaSampleShare',
  'rebillReviewWorkdays',
  'subRegistryReviewDays',
  'clinicResponseMinutes',
  'limitLowShare',
  'lossRatioWarn',
  'kpValidityDays',
  'loginMaxAttempts',
  'loginWindowMinutes',
  'loginLockMinutes',
  'pinflChecksPerHour',
  'pinflFailsBeforeLock',
  'pinflLockMinutes',
  'tariffBaseBasic',
  'tariffBaseStandard',
  'tariffBaseStandardPlus',
  'tariffBasePremium',
  'tariffCoef0to17',
  'tariffCoef18to29',
  'tariffCoef30to39',
  'tariffCoef40to49',
  'tariffCoef50to59',
  'tariffCoef60plus',
  'groupDiscountFrom',
  'groupDiscountShare',
  'paperOriginalReminderDays',
  'overdueBlocksService',
  'endorsementPeriodicity',
  'refundRule',
  'coverageStartRule',
  'renewalLeadDays',
  'leadIdleDays',
  'kpNoAnswerDays',
  'fraudMaxClaimsPerMonth',
  'fraudPriceExcessShare',
  'fraudDaysBeforeExclusion',
  'limitMode',
  'maxChildAge',
  'studentMaxAge',
]);
/** Portals other than the MIG one receive only part of the values. */
export const dmsParamValues: z.ZodType<Partial<T.DmsParamValues>> = z.record(dmsParamKey, z.number());
const docNumberKind = z.enum(DOC_NUMBER_KINDS);
const numberingParamKey = z.custom<T.NumberingParamKey>((v) => typeof v === 'string' && v.startsWith('numbering.') && (DOC_NUMBER_KINDS as readonly string[]).includes(v.slice('numbering.'.length)));
export const dmsParamChange: z.ZodType<T.DmsParamChange> = z.object({
  id: uuid,
  key: z.union([dmsParamKey, numberingParamKey]),
  from: z.union([z.number(), z.string()]),
  to: z.union([z.number(), z.string()]),
  reason: z.string(),
  status: z.enum(['pending', 'applied', 'rejected']),
  proposedById: uuid,
  proposedByName: z.string(),
  proposedAt: isoDateTime,
  decidedById: uuid.optional(),
  decidedByName: z.string().optional(),
  decidedAt: isoDateTime.optional(),
  rejectReason: z.string().optional(),
});
export const dmsParamsView: z.ZodType<D.DmsParamsView> = z.object({
  parameters: z.array(z.object({ key: dmsParamKey, value: z.number(), isDemo: z.boolean(), changedAt: isoDateTime.optional(), changedByName: z.string().optional() })),
  numbering: z.array(z.object({ kind: docNumberKind, value: z.string(), isDemo: z.boolean(), changedAt: isoDateTime.optional(), changedByName: z.string().optional() })),
  changes: z.array(dmsParamChange),
});

// ---- family members (FAMILY_SPEC) ----
export const familyProfile: z.ZodType<D.FamilyProfile> = z.object({
  id: uuid,
  fullName: z.string(),
  firstName: z.string(),
  relation: insuredRelation,
  access: z.enum(['self', 'full', 'basic']),
  status: z.enum(['active', 'excluded']),
  certificateNumber: z.string().optional(),
  dependentChild: z.boolean(),
  ownLogin: z.boolean(),
  payoutCardOwn: z.boolean().optional(),
});
export const familyProfiles = z.array(familyProfile);
export const familyRequest: z.ZodType<D.FamilyRequest> = z.object({
  id: uuid,
  employeeId: uuid,
  employeeName: z.string(),
  fullName: z.string(),
  relation: familyRelation,
  birthDateMasked: z.string(),
  pinflMasked: z.string(),
  isStudent: z.boolean().optional(),
  age: z.number(),
  status: z.enum(['pending', 'approved', 'rejected']),
  createdAt: isoDateTime,
  consentAt: isoDateTime,
  decidedAt: isoDateTime.optional(),
  decidedByName: z.string().optional(),
  rejectionReason: z.string().optional(),
  policyChangeId: uuid.optional(),
});
export const familyRequests = z.array(familyRequest);
export const hrFamilyMember: z.ZodType<D.HrFamilyMember> = z.object({
  id: uuid,
  fullName: z.string(),
  relation: familyRelation,
  employeeId: uuid,
  employeeName: z.string(),
  birthDateMasked: z.string(),
  status: z.enum(['active', 'excluded', 'pending', 'rejected']),
  insuredFrom: isoDate,
  certificateNumber: z.string().optional(),
  isStudent: z.boolean().optional(),
  overAgeLimit: z.boolean().optional(),
  appStatus,
  rejectionReason: z.string().optional(),
});
export const hrFamilyMembers = z.array(hrFamilyMember);
export const familyConsentResult = z.object({ granted: z.boolean() });
export const payoutCardResult = z.object({ payoutCardMasked: z.string(), payoutCardOwn: z.boolean() });
