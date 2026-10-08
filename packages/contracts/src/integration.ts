/*
 * Integration API contract (CLINIC_SPEC §6) — the single source of truth.
 * The mock server validates requests and responses with these schemas, scripts/build-openapi.mjs
 * turns them into docs/integration/openapi.yaml, and the clinic cabinet forms reuse the input ones.
 */
import { z } from 'zod';
import { msg } from '@mig/i18n';
import { DOC_NUMBER_RE, docNumber } from '@mig/domain/numbering';
import { limitCategory, specialty } from './schemas';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg('v.isoDate'));
const isoDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/, msg('v.isoDateTime'));
const money = z.number().int().min(1).max(10_000_000_000);
const text = (min: number, max: number) => z.string().trim().min(min, msg('v.tooShort', { min })).max(max, msg('v.tooLong', { max }));

export const INTEGRATION_BASE = '/api/integration/v1';

export const INTEGRATION_SCOPES = [
  'coverage:check',
  'appointments:read',
  'appointments:write',
  'slots:write',
  'guarantees:read',
  'guarantees:write',
  'registries:read',
  'registries:write',
  'payments:read',
] as const;
/** Scopes of assistance keys (ASSISTANCE_SPEC §8). `appointments:write` is shared with clinics. */
export const ASSIST_SCOPES = ['roster:read', 'cases:write', 'appointments:write', 'guarantees:decide', 'registries:review', 'payments:write', 'rebills:write'] as const;
export const ALL_SCOPES = [...new Set([...INTEGRATION_SCOPES, ...ASSIST_SCOPES])] as [string, ...string[]];
export const integrationScope = z.enum(INTEGRATION_SCOPES);
export const anyScope = z.enum(ALL_SCOPES as unknown as readonly [(typeof INTEGRATION_SCOPES)[number] | (typeof ASSIST_SCOPES)[number], ...((typeof INTEGRATION_SCOPES)[number] | (typeof ASSIST_SCOPES)[number])[]]);

export const WEBHOOK_EVENTS = [
  'appointment.requested',
  'appointment.cancelled',
  'guarantee.decided',
  'guarantee.documents_requested',
  'registry.reviewed',
  'registry.paid',
] as const;
/** Thin events for assistance companies (ASSISTANCE_SPEC §8). */
export const ASSIST_WEBHOOK_EVENTS = [
  'insured.added',
  'insured.excluded',
  'policy.assigned',
  'policy.unassigned',
  'appointment.requested',
  'guarantee.requested',
  'registry.received',
  'rebill.reviewed',
  'rebill.paid',
  'qa.disagreement',
] as const;
const ALL_EVENTS = [...new Set([...WEBHOOK_EVENTS, ...ASSIST_WEBHOOK_EVENTS])] as [(typeof WEBHOOK_EVENTS)[number] | (typeof ASSIST_WEBHOOK_EVENTS)[number], ...((typeof WEBHOOK_EVENTS)[number] | (typeof ASSIST_WEBHOOK_EVENTS)[number])[]];
export const webhookEvent = z.enum(ALL_EVENTS);

export const icd10 = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]\d{2}(\.\d{1,2})?$/, msg('v.icd10Format'));
export const serviceCode = z.string().trim().regex(/^[A-Z]{1,4}-\d{2,5}$/, msg('v.serviceCodeFormat'));
export const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, msg('v.periodFormat'));
export const serviceCategory = z.union([limitCategory, z.literal('diagnostics_advanced')]);

// ---------- errors (RFC 9457) ----------
export const problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  errors: z.record(z.string()).optional(),
});
export type Problem = z.infer<typeof problem>;

// ---------- auth ----------
export const tokenRequest = z.object({
  grant_type: z.literal('client_credentials'),
  client_id: z.string().trim().min(8).max(64),
  client_secret: z.string().trim().min(16).max(128),
  scope: z.string().max(500).optional(),
});
export const tokenResponse = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int(),
  scope: z.string(),
});

// ---------- coverage ----------
/** `qrToken` accepts the scanned `MIG-DMS:{token}`, the raw token or the 8-character short code. */
export const coverageCheckRequest = z.union([
  z.object({ qrToken: z.string().trim().min(8).max(200) }).strict(),
  z
    .object({
      // Any template MIG sets in «Нумерация документов»: ASCII letters, digits, «-» and «/».
      policyNumber: z
        .string()
        .trim()
        .toUpperCase()
        .max(60, msg('v.policyNumberFormat', { example: docNumber('policy', { year: 2026, n: 123 }) }))
        .regex(DOC_NUMBER_RE, msg('v.policyNumberFormat', { example: docNumber('policy', { year: 2026, n: 123 }) })),
      pinfl: z.string().trim().regex(/^\d{14}$/, msg('v.pinflFormat')),
    })
    .strict(),
]);
export const coverageCheckResult = z.object({
  visitId: uuid,
  person: z.object({ fullName: z.string(), birthYear: z.number().int() }),
  policy: z.object({ number: z.string(), programName: z.string(), validTo: isoDate, active: z.boolean() }),
  categories: z.array(
    z.object({
      category: serviceCategory,
      status: z.enum(['covered', 'needs_guarantee', 'not_covered']),
      limitState: z.enum(['available', 'low', 'exhausted']),
    }),
  ),
});
export const visit = z.object({
  id: uuid,
  clinicId: uuid,
  insuredId: uuid,
  openedById: uuid,
  method: z.enum(['qr', 'policy', 'api']),
  openedAt: isoDateTime,
  expiresAt: isoDateTime,
});

// ---------- appointments & slots ----------
export const integrationAppointment = z.object({
  id: uuid,
  clinicId: uuid,
  insuredName: z.string(),
  specialty,
  startsAt: isoDateTime,
  status: z.enum(['requested', 'confirmed', 'declined', 'completed', 'cancelled']),
  createdAt: isoDateTime,
  respondedBy: z.enum(['clinic', 'operator']).optional(),
  proposedStartsAt: isoDateTime.optional(),
});
export const appointmentList = z.object({ items: z.array(integrationAppointment), nextCursor: z.string().nullable() });
export const appointmentQuery = z.object({
  status: z.enum(['requested', 'confirmed', 'declined', 'completed', 'cancelled']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const rescheduleRequest = z.object({ startsAt: isoDateTime }).strict();
export const declineRequest = z.object({ reason: text(3, 300) }).strict();
export const slotsPutRequest = z
  .object({
    slots: z
      .array(
        z.object({
          specialty,
          startsAt: isoDateTime,
          durationMin: z.number().int().min(5).max(240),
          doctorRef: z.string().trim().max(64).optional(),
        }),
      )
      .max(5000),
  })
  .strict();
export const slotsPutResult = z.object({ replaced: z.number().int(), from: isoDate.nullable(), to: isoDate.nullable() });

// ---------- guarantees ----------
export const guaranteeCreateRequest = z
  .object({
    visitId: uuid,
    serviceCode,
    icd10,
    estimatedCost: money,
    comment: z.string().trim().max(1000).optional(),
  })
  .strict();
export const attachment = z.object({
  id: uuid,
  kind: z.enum(['receipt', 'invoice', 'referral', 'other']),
  fileName: z.string(),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  sizeBytes: z.number().int(),
  url: z.string(),
});
export const guaranteeLetter = z.object({
  id: uuid,
  number: z.string(),
  clinicId: uuid,
  visitId: uuid,
  insuredName: z.string(),
  serviceCode: z.string(),
  serviceName: z.string(),
  icd10: z.string(),
  estimatedCost: z.number().int(),
  approvedAmount: z.number().int().optional(),
  validUntil: isoDate.optional(),
  status: z.enum(['requested', 'info_requested', 'approved', 'rejected', 'used', 'expired']),
  approvals: z.array(z.object({ byId: uuid, byName: z.string(), at: isoDateTime })),
  reason: z.string().optional(),
  comment: z.string().optional(),
  attachments: z.array(attachment),
  createdAt: isoDateTime,
  assistanceId: uuid.nullable().optional(),
  assistanceName: z.string().optional(),
  escalated: z.boolean().optional(),
  assistanceOpinion: z.string().optional(),
  decidedBy: z.enum(['assistance', 'mig']).optional(),
});

// ---------- registries & payments ----------
export const registryLineInput = z
  .object({
    visitId: uuid,
    serviceDate: isoDate,
    serviceCode,
    icd10,
    quantity: z.number().int().min(1).max(999),
    price: money,
    guaranteeNumber: z
      .string()
      .trim()
      .max(60, msg('v.guaranteeNumberFormat', { example: docNumber('guarantee', { year: 2026, n: 123 }) }))
      .regex(DOC_NUMBER_RE, msg('v.guaranteeNumberFormat', { example: docNumber('guarantee', { year: 2026, n: 123 }) }))
      .optional(),
  })
  .strict();
export const registryCreateRequest = z.object({ period, lines: z.array(registryLineInput).min(1).max(5000) }).strict();
export const registryLine = z.object({
  id: uuid,
  visitId: uuid.optional(),
  insuredName: z.string(),
  serviceDate: isoDate,
  serviceCode: z.string(),
  serviceName: z.string(),
  icd10: z.string(),
  quantity: z.number().int(),
  price: z.number().int(),
  amount: z.number().int(),
  guaranteeNumber: z.string().optional(),
  status: z.enum(['pending', 'accepted', 'rejected', 'disputed']),
  rejectionReason: z.string().optional(),
  disputeComment: z.string().optional(),
  /** 'mig' or the id of the assistance company that checks and pays the line. */
  payer: z.union([z.literal('mig'), uuid]).optional(),
  payment: z.object({ paidAt: isoDate, amount: z.number().int(), orderNumber: z.string() }).optional(),
});
export const registry = z.object({
  id: uuid,
  clinicId: uuid,
  period: z.string(),
  status: z.enum(['draft', 'submitted', 'in_review', 'partially_accepted', 'accepted', 'paid']),
  source: z.enum(['portal', 'csv', 'api']),
  lines: z.array(registryLine),
  totals: z.object({ claimed: z.number().int(), accepted: z.number().int(), rejected: z.number().int(), paid: z.number().int() }),
  submittedAt: isoDateTime.optional(),
  paidAt: isoDateTime.optional(),
});
export const disputeRequest = z.object({ comment: text(3, 1000) }).strict();
export const payment = z.object({ registryId: uuid, period: z.string(), amount: z.number().int(), paidAt: isoDateTime });
export const paymentList = z.object({ items: z.array(payment), nextCursor: z.string().nullable() });

// ---------- assistance companies (ASSISTANCE_SPEC §8) ----------
const cursorQuery = { cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) };
const nextCursor = z.string().nullable();
export const limitWithRest = z.object({
  category: limitCategory,
  limit: z.number().int(),
  used: z.number().int(),
  /** Approved guarantee letters not yet used. */
  reserved: z.number().int(),
  left: z.number().int(),
});
export const rosterItem = z.object({
  insuredId: uuid,
  fullName: z.string(),
  birthDate: isoDate,
  policyNumber: z.string(),
  program: z.enum(['basic', 'standard', 'standard_plus', 'premium']),
  status: z.enum(['active', 'excluded']),
  insuredFrom: isoDate,
  excludedFrom: isoDate.optional(),
  limits: z.array(limitWithRest),
  updatedAt: isoDateTime,
});
export const rosterQuery = z.object({ updatedSince: isoDateTime.optional(), ...cursorQuery });
export const rosterPage = z.object({ items: z.array(rosterItem), nextCursor });
export const insuredLimits = z.object({ insuredId: uuid, limits: z.array(limitWithRest) });
export const caseType = z.enum(['appointment', 'consultation', 'guarantee', 'complaint', 'emergency']);
export const caseStatus = z.enum(['open', 'in_progress', 'waiting', 'resolved']);
export const assistanceCase = z.object({
  id: uuid,
  number: z.string(),
  insuredId: uuid,
  insuredName: z.string(),
  type: caseType,
  channel: z.enum(['phone', 'chat', 'app', 'clinic']),
  status: caseStatus,
  slaDueAt: isoDateTime,
  description: z.string(),
  resolution: z.string().optional(),
  links: z.object({ appointmentId: uuid.optional(), guaranteeId: uuid.optional(), claimId: uuid.optional() }),
  createdAt: isoDateTime,
});
export const caseCreateRequest = z.object({ insuredId: uuid, type: caseType, description: text(5, 1000) }).strict();
export const caseUpdateRequest = z
  .object({ status: caseStatus, resolution: text(3, 1000).optional() })
  .strict()
  .refine((v) => v.status !== 'resolved' || !!v.resolution, { message: msg('v.caseResolutionRequired'), path: ['resolution'] });
export const assistAppointmentQuery = z.object({ status: integrationAppointment.shape.status.optional(), ...cursorQuery });
export const guaranteeQuery = z.object({ status: guaranteeLetter.shape.status.optional(), ...cursorQuery });
export const guaranteeList = z.object({ items: z.array(guaranteeLetter), nextCursor });
export const guaranteeDecideRequest = z
  .object({
    decision: z.enum(['approve', 'reject', 'escalate']),
    amount: money.optional(),
    validUntil: isoDate.optional(),
    reason: text(3, 1000).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.decision === 'approve' && (!v.amount || !v.validUntil)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: msg('v.approveNeedsAmount') });
    if (v.decision !== 'approve' && !v.reason) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: msg('v.reasonOrOpinion') });
  });
export const registryQuery = z.object({ status: registry.shape.status.optional(), ...cursorQuery });
/** A clinic registry as the assistance sees it: only its own lines (sub-registry). */
export const registryList = z.object({ items: z.array(registry), nextCursor });
export const lineDecideRequest = z
  .object({ decision: z.enum(['accept', 'reject']), reason: text(3, 300).optional() })
  .strict()
  .refine((v) => v.decision === 'accept' || !!v.reason, { message: msg('v.rejectReasonGiven'), path: ['reason'] });
export const clinicPaymentRequest = z
  .object({ lineIds: z.array(uuid).min(1).max(500), paidAt: isoDate, amount: money, paymentOrderNumber: text(1, 40) })
  .strict();
export const rebillCheck = z.object({
  code: z.enum(['not_paid_to_clinic', 'policy_inactive', 'not_assigned', 'over_limit', 'no_guarantee', 'duplicate', 'price_mismatch', 'ai_disagrees']),
  message: z.string(),
});
export const rebillLine = z.object({
  id: uuid,
  registryLineId: uuid,
  clinicName: z.string(),
  insuredName: z.string(),
  serviceDate: isoDate,
  serviceName: z.string(),
  amount: z.number().int(),
  checks: z.array(rebillCheck),
  status: z.enum(['pending', 'accepted', 'rejected', 'disputed']),
  rejectionReason: z.string().optional(),
  disputeComment: z.string().optional(),
});
export const rebill = z.object({
  id: uuid,
  number: z.string(),
  assistanceId: uuid,
  period: z.string(),
  lines: z.array(rebillLine),
  fee: z.object({ model: z.enum(['pepm', 'percent_of_claims', 'per_case']), base: z.number(), value: z.number(), amount: z.number().int(), formula: z.string() }),
  totals: z.object({ claims: z.number().int(), fee: z.number().int(), total: z.number().int(), accepted: z.number().int(), rejected: z.number().int() }),
  status: z.enum(['draft', 'submitted', 'in_review', 'partially_accepted', 'accepted', 'paid']),
  submittedAt: isoDateTime.optional(),
  paidAt: isoDateTime.optional(),
});
/** Without `lineIds` the rebill takes every line of the assistance paid to clinics in the period. */
export const rebillCreateRequest = z.object({ period, lineIds: z.array(uuid).min(1).max(2000).optional() }).strict();

// ---------- webhooks (MIG → MIS) ----------
/** Thin event: no personal or medical data, the MIS fetches details through the API. */
export const webhookPayload = z.object({ id: uuid, type: webhookEvent, createdAt: isoDateTime, objectId: uuid });

// ---------- clinic cabinet forms ----------
const PRIVATE_V4: [number, number][] = [
  // [network, prefix length]
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10/8
  [0x64400000, 10], // 100.64/10 (CGNAT)
  [0x7f000000, 8], // 127/8
  [0xa9fe0000, 16], // 169.254/16
  [0xac100000, 12], // 172.16/12
  [0xc0a80000, 16], // 192.168/16
  [0xe0000000, 4], // multicast 224/4
  [0xf0000000, 4], // reserved 240/4
];

function ipv4ToInt(host: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
}

function isPrivateIpv4(host: string): boolean {
  const n = ipv4ToInt(host);
  if (n === null) return false;
  return PRIVATE_V4.some(([net, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === net;
  });
}

function isBlockedIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === '::' || h === '::1') return true;
  if (/^f[cd][0-9a-f]{0,2}:/.test(h)) return true; // fc00::/7 unique local
  if (/^fe[89ab][0-9a-f]?:/.test(h)) return true; // fe80::/10 link-local
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (mapped) return isPrivateIpv4(mapped[1]!);
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(h)) return true; // mapped IPv4 in hex form: block
  return false;
}

/**
 * Front-end part of SSRF protection (CLINIC_SPEC §9.6): https only, no credentials, no localhost,
 * no `.local`/`.internal` names, no private, loopback or link-local IP literals. The backend must
 * additionally resolve DNS and re-check the resolved addresses before every delivery.
 */
export function webhookUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return msg('v.url.full');
  }
  if (url.protocol !== 'https:') return msg('v.url.https');
  if (url.username || url.password) return msg('v.url.noCredentials');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return msg('v.url.hostRequired');
  if (host === 'localhost' || host.endsWith('.localhost')) return msg('v.url.noLocalhost');
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return msg('v.url.noLocalNetwork');
  if (host.startsWith('[')) {
    if (isBlockedIpv6(host.slice(1, -1))) return msg('v.url.noInternal');
  } else if (isPrivateIpv4(host)) {
    return msg('v.url.noInternal');
  } else if (/^\d+$/.test(host) || /^0x/i.test(host)) {
    return msg('v.url.domainOrIp');
  }
  return null;
}

export const webhookUrl = z
  .string()
  .trim()
  .max(2048, msg('v.tooLong', { max: 2048 }))
  .superRefine((v, ctx) => {
    const problem = webhookUrlProblem(v);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });

const ipEntry = z.string().regex(/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^[0-9a-fA-F:]+(\/\d{1,3})?$/, msg('v.ipEntry'));
export const keyCreateRequest = z.object({
  name: text(2, 60),
  scopes: z.array(anyScope).min(1, msg('v.scopesRequired')),
  ipAllowlist: z
    .string()
    .max(1000)
    .default('')
    .transform((v) => v.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(ipEntry).max(20, msg('v.maxAddresses'))),
});
export const webhookCreateRequest = z.object({
  url: webhookUrl,
  events: z.array(webhookEvent).min(1, msg('v.eventsRequired')),
});
export const keyCreated = z.object({ id: uuid, clientId: z.string(), clientSecret: z.string() });
export const webhookCreated = z.object({ id: uuid, signingSecret: z.string() });
