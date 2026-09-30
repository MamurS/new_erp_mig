/* Response schemas of the assistance portal (/api/assist/...) and of the MIG assistance screens. */
import { z } from 'zod';
import type * as D from '@/shared/types/dto';
import type * as T from '@/shared/types';
import * as I from '@/shared/integration/schemas';
import * as S from './schemas';
import * as C from './schemas-clinic';

const uuid = z.string().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTime = z.string().min(10);
const money = z.number();
const access = z.enum(['full', 'read']);
const integrationMode = z.enum(['portal', 'api', 'hybrid']);
const feeModel = z.enum(['pepm', 'percent_of_claims', 'per_case']);
const assistRole = z.enum(['asst_operator', 'asst_doctor', 'asst_billing', 'asst_admin']);

export const kpi: z.ZodType<T.AssistanceKpi> = z.object({
  appointmentResponseMinutesAvg: z.number(),
  guaranteesOnTimeShare: z.number(),
  qaAgreementShare: z.number(),
  complaintsPer1000: z.number(),
  lossRatio: z.number().nullable(),
});
const brief = z.object({ id: uuid, name: z.string(), phone24x7: z.string(), integrationMode });
export const assistanceBrief: z.ZodType<D.AssistanceBrief> = brief;
export const myAssistance: z.ZodType<{ assistance: D.AssistanceBrief | null }> = z.object({ assistance: brief.nullable() });
export const assistanceCompany: z.ZodType<T.AssistanceCompany> = brief.extend({
  contract: z.object({
    number: z.string(),
    validFrom: isoDate,
    validTo: isoDate,
    feeModel,
    feeValue: z.number(),
    guaranteeAuthorityLimit: money,
    rebillPaymentDays: z.number(),
  }),
  kpi: kpi.optional(),
});

const caseBase = z.object({
  id: uuid,
  number: z.string(),
  assistanceId: uuid,
  insuredId: uuid,
  insuredName: z.string(),
  type: I.caseType,
  channel: z.enum(['phone', 'chat', 'app', 'clinic']),
  status: I.caseStatus,
  slaDueAt: isoDateTime,
  description: z.string(),
  resolution: z.string().optional(),
  links: z.object({ appointmentId: uuid.optional(), guaranteeId: uuid.optional(), claimId: uuid.optional() }),
  createdAt: isoDateTime,
});
export const assistanceCase: z.ZodType<T.AssistanceCase> = caseBase;
export const caseView: z.ZodType<D.AssistCaseView> = caseBase.extend({ access });
export const caseViews = z.array(caseView);

export const overview: z.ZodType<D.AssistOverview> = z.object({
  assistance: brief,
  authorityLimit: money,
  queue: z.array(
    z.object({
      id: uuid,
      kind: z.enum(['appointment', 'case', 'guarantee', 'registry', 'escalation', 'rebill']),
      title: z.string(),
      subtitle: z.string(),
      dueAt: isoDateTime.optional(),
      to: z.string(),
    }),
  ),
  counters: z.object({ openCases: z.number(), slaBreaches: z.number(), guaranteesPending: z.number(), linesPending: z.number(), rebillsInReview: z.number() }),
  kpi,
});

const insuredItem = z.object({
  id: uuid,
  fullName: z.string(),
  clientName: z.string(),
  policyNumber: z.string(),
  programName: z.string(),
  status: z.enum(['active', 'excluded']),
  phoneMasked: z.string(),
  pinflMasked: z.string(),
  birthDateMasked: z.string(),
  access,
});
export const insuredItems: z.ZodType<D.AssistInsuredItem[]> = z.array(insuredItem);
export const insuredDetail: z.ZodType<D.AssistInsuredDetail> = insuredItem.extend({
  policyId: uuid,
  policyStart: isoDate,
  policyEnd: isoDate,
  limits: S.limitUsages,
  cases: z.array(caseBase),
  appointments: S.appointments,
  guarantees: C.guaranteeViews,
});

export const assistAppointments: z.ZodType<D.AssistAppointment[]> = z.array(S.appointment.and(z.object({ overdue: z.boolean() })));
export const chatThreads: z.ZodType<D.AssistChatThread[]> = z.array(z.object({ insuredId: uuid, insuredName: z.string(), lastText: z.string(), lastAt: isoDateTime, unanswered: z.boolean() }));
export const chatMessage: z.ZodType<D.AssistChatMessage> = z.object({ id: uuid, from: z.enum(['insured', 'operator']), text: z.string(), at: isoDateTime });
export const chatMessages = z.array(chatMessage);

const subSummary = z.object({
  id: uuid,
  clinicId: uuid,
  clinicName: z.string(),
  period: z.string(),
  status: I.registry.shape.status,
  source: I.registry.shape.source,
  submittedAt: isoDateTime.optional(),
  lineCount: z.number(),
  pendingCount: z.number(),
  disputedCount: z.number(),
  unpaidCount: z.number(),
  totals: I.registry.shape.totals,
});
export const subRegistries: z.ZodType<D.SubRegistrySummary[]> = z.array(subSummary);
export const subRegistry: z.ZodType<D.SubRegistryView> = subSummary.extend({
  lines: z.array(I.registryLine),
  guaranteeChecks: z.record(z.object({ approvedAmount: z.number().nullable(), ok: z.boolean() })),
});

const rebillBase = I.rebill.extend({
  assistanceName: z.string(),
  reviewDueAt: isoDate.optional(),
  acceptedById: uuid.optional(),
  paidById: uuid.optional(),
  acceptedByName: z.string().optional(),
  paidByName: z.string().optional(),
});
export const rebillView: z.ZodType<D.RebillView> = rebillBase;
export const rebillSummaries: z.ZodType<D.RebillSummary[]> = z.array(rebillBase.omit({ lines: true }).extend({ lineCount: z.number(), flaggedCount: z.number() }));

export const assistClinics: z.ZodType<D.AssistClinic[]> = z.array(z.object({ clinicId: uuid, clinicName: z.string(), city: z.string(), specialties: z.array(S.specialty), ownPrices: z.boolean(), priceList: C.priceList }));
const assistUser = z.object({ id: uuid, email: z.string(), fullName: z.string(), role: assistRole, active: z.boolean(), lastLoginAt: isoDateTime.optional() });
export const assistUserView: z.ZodType<D.AssistUserView> = assistUser;
export const assistUsers = z.array(assistUser);

const qaBase = z.object({
  id: uuid,
  assistanceId: uuid,
  subject: z.object({ type: z.enum(['guarantee', 'registry_line']), id: uuid, label: z.string() }),
  verdict: z.enum(['agree', 'disagree']).optional(),
  comment: z.string().optional(),
  reviewedById: uuid.optional(),
  createdAt: isoDateTime,
  assistanceName: z.string(),
  reviewedByName: z.string().optional(),
});
export const qaSample: z.ZodType<D.QaSampleView> = qaBase;
export const qaSamples = z.array(qaBase);

export const assistanceList: z.ZodType<D.AssistanceListItem[]> = z.array(
  brief.extend({ contractNumber: z.string(), insuredCount: z.number(), clientsCount: z.number(), kpi, rebillsToReview: z.number(), slaBreaches: z.number() }),
);
export const assistanceCard: z.ZodType<D.AssistanceCardView> = z.object({
  assistance: assistanceCompany,
  kpi,
  insuredCount: z.number(),
  clients: z.array(z.object({ id: uuid, name: z.string(), insuredCount: z.number(), policyNumber: z.string(), from: isoDate })),
  users: assistUsers,
  keys: C.integrationClients,
  webhooks: z.object({ endpoints: z.number(), retrying: z.number(), failed24h: z.number() }),
  apiErrors24h: z.number(),
  rebills: z.array(rebillBase.omit({ lines: true }).extend({ lineCount: z.number(), flaggedCount: z.number() })),
  qa: qaSamples,
  audit: S.auditList,
  feePerInsured: z.number().nullable(),
  attention: z.array(caseBase),
});
export const assignments: z.ZodType<D.AssignmentView[]> = z.array(
  z.object({ policyId: uuid, assistanceId: uuid.nullable(), from: isoDate, to: isoDate.optional(), setById: uuid, setAt: isoDateTime, assistanceName: z.string().nullable(), setByName: z.string() }),
);
export const reportByAssistance: z.ZodType<D.AssistanceReportRow[]> = z.array(
  z.object({
    assistanceId: uuid.nullable(),
    name: z.string(),
    insuredCount: z.number(),
    premium: money,
    paid: money,
    lossRatio: z.number().nullable(),
    fee: money,
    feePerInsured: z.number().nullable(),
  }),
);
