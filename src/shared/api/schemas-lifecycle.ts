/* Response schemas of the contract lifecycle and claims settlement (LIFECYCLE_SPEC). */
import { z } from 'zod';
import type * as D from '@/shared/types/dto';
import type * as T from '@/shared/types';
import * as S from './schemas';

const uuid = z.string().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTime = z.string().min(10);
const money = z.number();

const dealStage = z.enum(['lead', 'census', 'quote', 'kp_sent', 'kp_accepted', 'contract_draft', 'contract_review', 'contract_sent', 'signing', 'awaiting_payment', 'active', 'lost']);
const contractStatus = z.enum(['draft', 'legal_review', 'approved', 'sent', 'signing', 'signed', 'active', 'terminated', 'expired']);
const endorsementStatus = z.enum(['draft', 'legal_review', 'approved', 'sent', 'signing', 'signed']);
const quoteStatus = z.enum(['draft', 'pending_approval', 'approved', 'rejected']);
const ageBand = z.enum(['0-17', '18-29', '30-39', '40-49', '50-59', '60+']);
const signMethod = z.enum(['eimzo', 'edo', 'paper', 'scan']);
const staffAuthority = S.staffAuthority;
const signatoryFlag = z.object({ canSign: z.literal(true), basis: z.string() });

export const authorityChange: z.ZodType<T.AuthorityChange> = z.object({
  id: uuid,
  staffId: uuid,
  staffName: z.string(),
  from: z.object({ authority: staffAuthority, signatory: signatoryFlag.optional() }),
  to: z.object({ authority: staffAuthority, signatory: signatoryFlag.optional() }),
  reason: z.string(),
  status: z.enum(['pending', 'applied', 'rejected']),
  proposedById: uuid,
  proposedByName: z.string(),
  proposedAt: isoDateTime,
  decidedByName: z.string().optional(),
  decidedAt: isoDateTime.optional(),
  rejectReason: z.string().optional(),
});
export const authorityChanges = z.array(authorityChange);
export const staffDirectory: z.ZodType<D.StaffDirectoryItem[]> = z.array(
  z.object({ id: uuid, fullName: z.string(), role: S.staffRole, authority: staffAuthority, canSign: z.boolean() }),
);

const deal = z.object({
  id: uuid,
  number: z.string(),
  clientId: uuid,
  type: z.enum(['new', 'renewal']),
  stage: dealStage,
  ownerId: uuid,
  underwriterId: uuid.optional(),
  expectedStart: isoDate.optional(),
  lostReason: z.string().optional(),
  previousPolicyId: uuid.optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
const dealViewBase = deal.extend({
  clientName: z.string(),
  ownerName: z.string(),
  underwriterName: z.string().optional(),
  premium: money.nullable(),
  quoteId: uuid.optional(),
  quoteStatus: quoteStatus.optional(),
  kpId: uuid.optional(),
  kpStatus: z.enum(['draft', 'sent', 'revoked', 'accepted', 'declined']).optional(),
  contractId: uuid.optional(),
  contractStatus: contractStatus.optional(),
});
export const dealView: z.ZodType<D.DealView> = dealViewBase;
export const dealViews = z.array(dealViewBase);

export const census: z.ZodType<T.Census> = z.object({
  id: uuid,
  dealId: uuid,
  rows: z.array(z.object({ gender: z.enum(['m', 'f']), birthYear: z.number(), relation: z.enum(['employee', 'spouse', 'child']) })),
  uploadedAt: isoDateTime,
});
export const censusUpload = z.object({ census, errors: z.array(z.object({ row: z.number(), message: z.string() })), dropped: z.array(z.string()) });

const quoteBase = z.object({
  id: uuid,
  dealId: uuid,
  program: S.programCode,
  rates: z.array(z.object({ band: ageBand, count: z.number(), baseRate: money, coefficient: z.number(), premium: money })),
  adjustments: z.array(z.object({ label: z.string(), pct: z.number(), comment: z.string() })),
  groupDiscountPct: z.number(),
  premiumEmployee: money,
  premiumFamily: money,
  total: money,
  discountFromTariffPct: z.number(),
  status: quoteStatus,
  approvals: z.array(z.object({ byId: uuid, byName: z.string(), at: isoDateTime, comment: z.string().optional() })),
  createdById: uuid,
  createdByName: z.string().optional(),
  rejectReason: z.string().optional(),
  updatedAt: isoDateTime.optional(),
});
export const quote: z.ZodType<T.Quote> = quoteBase;
export const quoteView: z.ZodType<D.QuoteView> = quoteBase.extend({
  dealNumber: z.string(),
  clientName: z.string(),
  census: census.nullable(),
  startDate: isoDate,
  authorityProblem: z.string().nullable(),
  canApprove: z.boolean(),
  canEdit: z.boolean(),
});

const sideSignature = z.object({
  method: signMethod,
  signedAt: isoDateTime,
  signerName: z.string(),
  certificate: z.object({ serial: z.string(), owner: z.string(), validTo: isoDate }).optional(),
  edoProvider: z.string().optional(),
  scanFileId: uuid.optional(),
  scanVerifiedById: uuid.optional(),
  scanVerifiedByName: z.string().optional(),
});
export const signing: z.ZodType<T.Signing> = z.object({
  mig: sideSignature.optional(),
  client: sideSignature.optional(),
  paperOriginal: z.object({
    required: z.boolean(),
    migCopySentAt: isoDate.optional(),
    clientOriginalReceivedAt: isoDate.optional(),
    receivedById: uuid.optional(),
    receivedByName: z.string().optional(),
  }),
  edoPending: z.object({ provider: z.string(), sentAt: isoDateTime }).optional(),
  pendingScans: z.array(z.object({ side: z.enum(['mig', 'client']), fileId: uuid, uploadedAt: isoDateTime, uploadedByName: z.string() })).optional(),
  printedAt: isoDateTime.optional(),
});
const clauseOverride = z.object({ clauseId: z.string(), original: z.string(), text: z.string(), byId: uuid, byName: z.string().optional(), at: isoDateTime });
const signatoryOption = z.object({ id: uuid, fullName: z.string(), role: S.staffRole, basis: z.string() });
const endorsementSummary = z.object({ id: uuid, number: z.string(), kind: z.enum(['changes', 'termination']), status: endorsementStatus, total: money, createdAt: isoDateTime.optional() });
const payment: z.ZodType<T.Payment> = z.object({
  id: uuid,
  invoiceId: uuid.optional(),
  contractId: uuid.optional(),
  amount: money,
  paidAt: isoDate,
  payerInn: z.string(),
  purpose: z.string(),
  source: z.enum(['manual', '1c']),
  recordedByName: z.string(),
  matchedBy: z.enum(['number', 'inn_amount', 'manual']).optional(),
  bankPaymentId: uuid.optional(),
  docNumber: z.string().optional(),
  comment: z.string().optional(),
});

export const contractView: z.ZodType<D.ContractView> = z.object({
  id: uuid,
  number: z.string(),
  dealId: uuid,
  clientId: uuid,
  clientName: z.string(),
  version: z.number(),
  templateId: z.literal('contract'),
  templateVersion: z.string(),
  params: z.object({
    startDate: isoDate,
    endDate: isoDate,
    program: S.programCode,
    premiumEmployee: money,
    premiumFamily: money,
    employees: z.number(),
    familyMembers: z.number(),
    total: money,
    paymentFrequency: z.enum(['single', 'quarterly', 'monthly']),
    paymentSchedule: z.array(z.object({ dueDate: isoDate, amount: money })),
    activationRule: z.enum(['on_start_date', 'after_first_payment']),
    migSignatoryId: uuid,
    clientSignatory: z.object({ name: z.string(), position: z.string(), basis: z.string() }),
    assistanceId: uuid.nullable().optional(),
  }),
  clauseOverrides: z.array(clauseOverride),
  insuredListId: uuid.optional(),
  insuredCount: z.number().optional(),
  status: contractStatus,
  signing,
  createdAt: isoDateTime,
  quoteId: uuid.optional(),
  legalComment: z.string().optional(),
  legalApprovedByName: z.string().optional(),
  financeApprovedByName: z.string().optional(),
  financeDiffers: z.boolean().optional(),
  versions: z.array(z.object({ version: z.number(), at: isoDateTime, byName: z.string(), changes: z.string() })),
  policyId: uuid.optional(),
  terminatedAt: isoDate.optional(),
  activatedAt: isoDateTime.optional(),
  client: S.client,
  dealNumber: z.string(),
  migSignatory: signatoryOption.nullable(),
  signatories: z.array(signatoryOption),
  insuredRows: z.array(z.object({ fullName: z.string(), position: z.string(), familyMembers: z.number() })),
  invoices: z.array(S.invoice),
  payments: z.array(payment),
  endorsements: z.array(endorsementSummary),
  quote: z.object({ id: uuid, premiumEmployee: money, premiumFamily: money, total: money, program: S.programCode }).nullable(),
  originalOverdue: z.boolean(),
  assistanceName: z.string().optional(),
});
export const contractViews = z.array(contractView);

const changeRequestBase = z.object({
  id: uuid,
  contractId: uuid,
  type: z.enum(['add_insured', 'exclude_insured', 'change_program', 'other']),
  effectiveDate: isoDate,
  insuredId: uuid.optional(),
  payload: z.record(z.unknown()),
  requestedBy: z.object({ id: uuid, role: S.role, name: z.string().optional() }),
  status: z.enum(['pending', 'included', 'cancelled']),
  endorsementId: uuid.optional(),
  createdAt: isoDateTime.optional(),
  description: z.string().optional(),
});
export const changeRequestViews: z.ZodType<D.ChangeRequestView[]> = z.array(changeRequestBase.extend({ contractNumber: z.string(), clientName: z.string(), endorsementNumber: z.string().optional() }));

const endorsementBase = z.object({
  id: uuid,
  number: z.string(),
  contractId: uuid,
  kind: z.enum(['changes', 'termination']).optional(),
  terminationDate: isoDate.optional(),
  changeRequestIds: z.array(uuid),
  lines: z.array(z.object({ changeRequestId: z.string(), description: z.string(), days: z.number(), amount: money, formula: z.string() })),
  total: money,
  clauseOverrides: z.array(clauseOverride),
  status: endorsementStatus,
  signing,
  createdAt: isoDateTime.optional(),
  invoiceId: uuid.optional(),
  refundDocument: z.string().optional(),
  amountsApprovedByName: z.string().optional(),
});
export const endorsementView: z.ZodType<D.EndorsementView> = endorsementBase.extend({
  contractNumber: z.string(),
  clientId: uuid,
  clientName: z.string(),
  clientInn: z.string(),
  migSignatory: signatoryOption.nullable(),
  clientSignatoryName: z.string(),
  requests: z.array(changeRequestBase),
  needsAmountApproval: z.boolean(),
});
export const endorsementViews = z.array(endorsementView);

export const invoiceViews: z.ZodType<D.InvoiceView[]> = z.array(
  z.object({
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
    clientName: z.string(),
    clientInn: z.string().optional(),
    contractNumber: z.string().optional(),
    endorsementNumber: z.string().optional(),
  }),
);
export const paymentResult = payment;
export const importResult: z.ZodType<D.ImportPaymentsResult> = z.object({ matched: z.number(), queued: z.number(), skipped: z.number(), unmatched: z.array(z.object({ line: z.number(), reason: z.string() })), activated: z.number() });

const certificate = z.object({
  insuredId: uuid,
  fullName: z.string(),
  certificateNumber: z.string(),
  insuredFrom: isoDate,
  policyNumber: z.string(),
  policyEndDate: isoDate,
  program: S.programCode,
  clientName: z.string(),
  contractNumber: z.string(),
  assistanceName: z.string(),
  assistancePhone: z.string(),
});
export const certificateView: z.ZodType<D.CertificateView> = certificate;
export const certificates: z.ZodType<D.CertificateView[]> = z.array(certificate);

export const dealCard: z.ZodType<D.DealCard> = dealViewBase.extend({
  client: S.client,
  census: census.nullable(),
  quote: quoteBase.nullable(),
  kp: S.kpDocument.nullable(),
  contract: z.object({ id: uuid, number: z.string(), version: z.number(), status: contractStatus, total: money, startDate: isoDate, endDate: isoDate }).nullable(),
  events: z.array(z.object({ id: uuid, dealId: uuid, at: isoDateTime, actorName: z.string(), text: z.string() })),
  reminders: z.array(z.string()),
});

const reportRow = z.object({ key: z.string(), label: z.string(), claims: z.number(), reserve: money });
export const reserveReport: z.ZodType<D.ReserveReport> = z.object({
  date: isoDate,
  total: money,
  claims: z.number(),
  byClient: z.array(reportRow),
  byAssistance: z.array(reportRow),
  byCategory: z.array(reportRow),
});

export const claimLetter: z.ZodType<D.ClaimLetter> = z.object({
  claimNumber: z.string(),
  insuredName: z.string(),
  amountClaimed: money,
  decision: z.object({ kind: z.enum(['approve', 'partial', 'reject']), amount: money, clauseRef: z.string().optional(), reason: z.string(), at: isoDateTime }),
});

export const bankPaymentView: z.ZodType<D.BankPaymentView> = z.object({
  id: uuid,
  docNumber: z.string().optional(),
  date: isoDate,
  amount: money,
  payerInn: z.string(),
  payerName: z.string().optional(),
  purpose: z.string(),
  reason: z.enum(['third_party', 'over_remaining', 'several_numbers', 'ambiguous', 'amount_mismatch', 'no_invoices', 'unknown_payer']),
  importedAt: isoDateTime,
  importedByName: z.string(),
  allocated: money,
  status: z.enum(['pending', 'allocated']),
  allocations: z.array(z.object({ invoiceId: uuid, invoiceNumber: z.string(), amount: money, at: isoDateTime, byName: z.string(), comment: z.string().optional() })),
  remaining: money,
  candidates: z.array(
    z.object({
      invoiceId: uuid,
      number: z.string(),
      clientName: z.string(),
      clientInn: z.string(),
      contractNumber: z.string().optional(),
      remaining: money,
      dueDate: isoDate,
      why: z.enum(['number', 'inn_amount', 'inn', 'amount']),
    }),
  ),
});
export const bankPaymentViews = z.array(bankPaymentView);
