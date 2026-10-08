/* Response schemas of the clinic cabinet and staff clinic endpoints (entities shared with the integration API). */
import { z } from 'zod';
import { LEGAL_FORMS } from '@mig/domain/config/legalForms';
import type * as D from './dto';
import type * as T from './index';
import * as I from './integration';
import { clinic } from './schemas';

const uuid = z.string().min(1);
const isoDateTime = z.string().min(10);
const clinicRole = z.enum(['clinic_registrar', 'clinic_admin']);

export const coverage: z.ZodType<T.CoverageCheckResult> = I.coverageCheckResult;
export const priceList: z.ZodType<T.PriceListItem[]> = z.array(
  z.object({ code: z.string(), name: z.string(), category: I.serviceCategory, price: z.number(), requiresGuarantee: z.boolean() }),
);

export const clinicOverview: z.ZodType<D.ClinicOverview> = z.object({
  clinicName: z.string(),
  clinicLegalForm: z.enum(LEGAL_FORMS).optional(),
  integrationMode: z.enum(['portal', 'api', 'hybrid']),
  appointmentsToday: z.number(),
  unanswered: z.number(),
  unansweredOverdue: z.number(),
  guaranteesPending: z.number(),
  currentRegistry: z.object({ id: uuid, period: z.string(), status: I.registry.shape.status, claimed: z.number() }).nullable(),
  events: z.array(z.object({ id: uuid, at: isoDateTime, text: z.string() })),
});

export const clinicVisits: z.ZodType<D.ClinicVisitView[]> = z.array(
  z.object({ id: uuid, insuredName: z.string(), method: z.enum(['qr', 'policy', 'api']), openedAt: isoDateTime, expiresAt: isoDateTime }),
);

const appointmentBase = z.object({
  id: uuid,
  insuredId: uuid,
  insuredName: z.string(),
  clientName: z.string(),
  clinicId: uuid,
  clinicName: z.string(),
  specialty: I.integrationAppointment.shape.specialty,
  startsAt: isoDateTime,
  status: I.integrationAppointment.shape.status,
  createdAt: isoDateTime,
  respondedBy: z.enum(['clinic', 'operator']).optional(),
  respondedAt: isoDateTime.optional(),
  proposedStartsAt: isoDateTime.optional(),
  declineReason: z.string().optional(),
  fromClinicSystem: z.boolean().optional(),
});
export type ClinicAppointment = T.Appointment & { overdue: boolean };
export const clinicAppointments: z.ZodType<ClinicAppointment[]> = z.array(appointmentBase.extend({ overdue: z.boolean() }));
export const clinicAppointment: z.ZodType<T.Appointment> = appointmentBase;

export const guaranteeView: z.ZodType<D.GuaranteeView> = I.guaranteeLetter.extend({
  clinicName: z.string(),
  clinicLegalForm: z.enum(LEGAL_FORMS).optional(),
  approvalsNeeded: z.number(),
  infoComment: z.string().optional(),
});
export const guaranteeViews = z.array(guaranteeView);

const registryBase = I.registry.omit({ lines: true });
export const registrySummaries: z.ZodType<D.RegistrySummary[]> = z.array(
  registryBase.extend({ clinicName: z.string(), clinicLegalForm: z.enum(LEGAL_FORMS).optional(), lineCount: z.number(), pendingCount: z.number(), disputedCount: z.number() }),
);
export const registryView: z.ZodType<D.RegistryView> = I.registry.extend({
  clinicName: z.string(),
  problems: z.record(z.array(z.string())),
  guaranteeChecks: z.record(z.object({ approvedAmount: z.number().nullable(), ok: z.boolean() })),
  payerNames: z.record(z.string()).optional(),
});
export const registryImport: z.ZodType<D.RegistryImportResult> = z.object({
  total: z.number(),
  valid: z.number(),
  errors: z.array(z.object({ row: z.number(), message: z.string() })),
  registryId: uuid.optional(),
});

export const clinicDocuments: z.ZodType<D.ClinicDocuments> = z.object({
  contract: z.object({ number: z.string(), signedAt: z.string(), validUntil: z.string() }),
  acts: z.array(z.object({ registryId: uuid, period: z.string(), claimed: z.number(), accepted: z.number(), paid: z.number(), paidAt: isoDateTime.optional() })),
});

export const clinicUser: z.ZodType<D.ClinicUserView> = z.object({
  id: uuid,
  email: z.string(),
  fullName: z.string(),
  role: clinicRole,
  active: z.boolean(),
  lastLoginAt: isoDateTime.optional(),
});
export const clinicUsers = z.array(clinicUser);

export const integrationClient: z.ZodType<T.IntegrationClient> = z.object({
  id: uuid,
  clinicId: uuid,
  partnerType: z.enum(['clinic', 'assistance']).optional(),
  name: z.string(),
  clientId: z.string(),
  secretLast4: z.string(),
  scopes: z.array(I.anyScope),
  ipAllowlist: z.array(z.string()),
  createdAt: isoDateTime,
  lastUsedAt: isoDateTime.optional(),
  revokedAt: isoDateTime.optional(),
});
export const integrationClients = z.array(integrationClient);
export const webhookEndpoints: z.ZodType<T.WebhookEndpoint[]> = z.array(
  z.object({ id: uuid, clinicId: uuid, partnerType: z.enum(['clinic', 'assistance']).optional(), url: z.string(), events: z.array(I.webhookEvent), secretLast4: z.string(), active: z.boolean(), createdAt: isoDateTime }),
);
export const webhookDelivery: z.ZodType<T.WebhookDelivery> = z.object({
  id: uuid,
  endpointId: uuid,
  event: I.webhookEvent,
  status: z.enum(['delivered', 'retrying', 'failed']),
  attempts: z.number(),
  lastAttemptAt: isoDateTime,
  responseCode: z.number().optional(),
  nextAttemptAt: isoDateTime.optional(),
  objectId: uuid.optional(),
});
export const webhookDeliveries = z.array(webhookDelivery);
export const apiLogs: z.ZodType<T.ApiCallLog[]> = z.array(
  z.object({ id: uuid, clientId: z.string(), at: isoDateTime, method: z.string(), pathTemplate: z.string(), status: z.number(), latencyMs: z.number() }),
);
export const integrationOverview: z.ZodType<D.IntegrationOverview> = z.object({
  mode: z.enum(['portal', 'api', 'hybrid']),
  connected: z.boolean(),
  activeKeys: z.number(),
  requests24h: z.number(),
  errors24h: z.number(),
  lastWebhook: z.object({ event: I.webhookEvent, at: isoDateTime, status: z.enum(['delivered', 'retrying', 'failed']) }).nullable(),
});
export const keyCreated = I.keyCreated;
export const webhookCreated = I.webhookCreated;

export const clinicCard: z.ZodType<D.ClinicCard> = z.object({
  clinic,
  contractNumber: z.string(),
  metrics: z.object({ avgResponseMinutes: z.number().nullable(), rejectedLineShare: z.number().nullable(), amountToPay: z.number() }),
  users: clinicUsers,
  keys: integrationClients,
  webhooks: z.object({ endpoints: z.number(), retrying: z.number(), failed24h: z.number() }),
  apiErrors24h: z.number(),
});
