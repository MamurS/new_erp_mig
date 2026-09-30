/* Runtime validation of API responses at the client boundary (SPEC §9.1). */
import { z } from 'zod';
import type * as T from '@/shared/types';
import type * as D from '@/shared/types/dto';

const uuid = z.string().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTime = z.string().min(10);
const money = z.number();

export const role = z.enum(['operator', 'underwriter', 'doctor_expert', 'accountant', 'admin', 'hr', 'insured', 'clinic_registrar', 'clinic_admin', 'asst_operator', 'asst_doctor', 'asst_billing', 'asst_admin']);
export const staffRole = z.enum(['operator', 'underwriter', 'doctor_expert', 'accountant', 'admin']);
export const programCode = z.enum(['basic', 'standard', 'standard_plus', 'premium']);
export const limitCategory = z.enum(['outpatient', 'dental', 'medicines', 'inpatient']);
export const claimStatus = z.enum(['new', 'review', 'medical_review', 'approved', 'rejected', 'to_pay', 'paid']);
export const claimCategory = z.enum(['medicines', 'doctor_visit', 'diagnostics', 'dental', 'inpatient']);
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
const limitsRecord = z.object({ outpatient: money, dental: money, medicines: money, inpatient: money });

export const sessionUser: z.ZodType<T.SessionUser> = z.object({
  id: uuid,
  role,
  displayName: z.string(),
  companyId: uuid.optional(),
  insuredId: uuid.optional(),
  clinicId: uuid.optional(),
  assistanceId: uuid.optional(),
  consentGivenAt: isoDateTime.optional(),
});

export const challenge: z.ZodType<D.ChallengeResponse> = z.object({
  challengeId: z.string(),
  resendInSec: z.number(),
});
export const sessionResponse: z.ZodType<D.SessionResponse> = z.object({ sessionId: z.string(), user: sessionUser });

export const program: z.ZodType<T.Program> = z.object({ code: programCode, name: z.string(), limits: limitsRecord });

export const client: z.ZodType<T.Client> = z.object({
  id: uuid,
  legalForm: z.enum(['ООО', 'АО', 'СП ООО', 'ЧП']),
  name: z.string(),
  inn: z.string(),
  status: z.enum(['draft', 'negotiation', 'active', 'renewal', 'expired']),
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
  program: programCode,
  startDate: isoDate,
  endDate: isoDate,
  status: z.enum(['draft', 'active', 'expired', 'cancelled']),
  premium: money,
  insuredCount: z.number(),
  tariff: z.object({ employee: money, family: money }).optional(),
  familyCount: z.number().optional(),
  assistanceId: uuid.nullable().optional(),
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
  familyMembersCount: z.number(),
  appStatus,
  myIdVerified: z.boolean(),
  attachedClinicId: uuid,
  insuredFrom: isoDate,
  status: z.enum(['active', 'excluded']),
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
const claimBase = z.object({
  id: uuid,
  number: z.string(),
  insuredId: uuid,
  insuredName: z.string(),
  clientId: uuid,
  clientName: z.string(),
  category: claimCategory,
  source: z.enum(['app', 'clinic_invoice', 'operator', 'assistance']),
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
  address: z.string(),
  district: z.string(),
  specialties: z.array(specialty),
  onlineBooking: z.boolean(),
  apiStatus: z.enum(['online', 'offline', 'manual']),
  contractUntil: isoDate,
  distanceKm: z.number().optional(),
  integrationMode: z.enum(['portal', 'api', 'hybrid']),
  responseSlaMinutes: z.number(),
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
  ]),
  targetType: z.enum(['insured', 'claim', 'policy', 'client', 'export', 'user', 'session', 'kp', 'clinic', 'visit', 'guarantee', 'registry', 'integration', 'assistance', 'case', 'rebill']),
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
export const dashboard: z.ZodType<D.DashboardSummary> = z.object({
  firstName: z.string(),
  queueCount: z.number(),
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
    type: z.enum(['appointment', 'claim', 'renewal', 'guarantee', 'registry', 'clinic_no_response', 'policy_change', 'escalation', 'rebill', 'assistance_sla', 'complaint']),
    entityId: uuid,
    who: z.string(),
    details: z.string(),
    status: z.string(),
    statusTone: z.enum(['default', 'success', 'warning', 'danger', 'info']),
    dueAt: isoDateTime,
    action: z.enum(['confirm', 'open', 'prepare_offer']),
    policyId: uuid.optional(),
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
  z.object({ clientId: uuid, clientName: z.string(), lossRatio: z.number() }) satisfies z.ZodType<D.LossRatioRow>,
);
export const claimsByCategoryRows = z.array(
  z.object({ category: claimCategory, count: z.number(), amount: money }) satisfies z.ZodType<D.ClaimsByCategoryRow>,
);
export const premiumByMonthRows = z.array(
  z.object({ month: z.string(), premium: money }) satisfies z.ZodType<D.PremiumByMonthRow>,
);

export const hrOverview: z.ZodType<D.HrOverview> = z.object({
  companyName: z.string(),
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
  familyMembersCount: z.number(),
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
});
export const mePolicy: z.ZodType<D.MePolicy> = z.object({
  number: z.string(),
  program: programCode,
  programName: z.string(),
  companyName: z.string(),
  startDate: isoDate,
  endDate: isoDate,
  limits: limitsRecord,
});
export const cardToken: z.ZodType<D.CardToken> = z.object({ token: z.string(), shortCode: z.string(), expiresAt: isoDateTime });
export const recognizeResult: z.ZodType<D.RecognizeResult> = z.object({
  providerName: z.string(),
  amount: money,
  serviceDate: isoDate,
});
export const consentResult = z.object({ consentGivenAt: isoDateTime });
export const ok = z.object({ ok: z.literal(true) });
export const idResult = z.object({ id: uuid });
export const inviteResult = z.object({ invited: z.number() });

// ---- commercial offers ----
const legalForm = z.enum(['ООО', 'АО', 'СП ООО', 'ЧП']);
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
  status: z.enum(['draft', 'sent', 'revoked']),
  createdById: uuid,
  createdByName: z.string(),
  createdByEmail: z.string(),
  createdAt: isoDateTime,
  sentAt: isoDateTime.optional(),
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
  familyMembers: z.number(),
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
