import { LEGAL_FORMS } from '@/shared/config/legalForms';
/*
 * Form schemas. The same schemas validate request bodies in the mock server (CLAUDE.md rule 8).
 * Every string is trimmed and length-limited; inputs are normalised (phones, dates, digits).
 */
import { z } from 'zod';
import { msg } from '@/i18n';
import { claimCategory, claimIntakeChannel, claimStatus, limitCategory, specialty, staffRole } from '@/shared/api/schemas';
import { todayISO } from '@/shared/lib/format';
import { digitsOnly, parseRuDate } from '@/shared/lib/masks';
import { dmsParamError, isDmsParamKey, isNumberingParamKey, numberingKindOf, numberingTemplateError } from '@/shared/config/dmsParameters';

const text = (min: number, max: number, message?: string) =>
  z
    .string({ required_error: msg('v.required') })
    .trim()
    .min(min, message ?? (min <= 1 ? msg('v.required') : msg('v.tooShort', { min })))
    .max(max, msg('v.tooLong', { max }));

const uuid = z.string().trim().uuid(msg('v.badId'));

/** Accepts `dd.mm.yyyy` or `yyyy-mm-dd`, outputs ISO date. */
export const isoDateInput = z
  .string({ required_error: msg('v.dateRequired') })
  .trim()
  .max(10)
  .transform((v, ctx) => {
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : parseRuDate(v);
    if (!iso || Number.isNaN(new Date(`${iso}T00:00:00Z`).getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg('v.dateFormat') });
      return z.NEVER;
    }
    return iso;
  });

/** Accepts any formatting of an Uzbek mobile number, outputs `+998XXXXXXXXX`. */
export const phoneInput = z
  .string({ required_error: msg('v.phoneRequired') })
  .trim()
  .max(20)
  .transform((v, ctx) => {
    let d = digitsOnly(v);
    if (d.startsWith('998')) d = d.slice(3);
    if (d.length !== 9) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg('v.phoneFormat') });
      return z.NEVER;
    }
    return `+998${d}`;
  });

export const pinflInput = z
  .string({ required_error: msg('v.pinflRequired') })
  .trim()
  .max(20)
  .transform((v) => digitsOnly(v))
  .refine((v) => /^\d{14}$/.test(v), msg('v.pinflFormat'));

export const otpCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, msg('v.otpFormat'));

// ---- auth ----
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, msg('v.emailRequired')).max(254).email(msg('v.emailInvalid')),
  password: z.string().min(1, msg('v.passwordRequired')).max(128),
});
export const otpSchema = z.object({ challengeId: z.string().trim().min(1).max(128), code: otpCode });
export const phoneLoginSchema = z.object({ phone: phoneInput });
export const phoneVerifySchema = otpSchema;

// ---- staff ----
export const piiField = z.enum(['pinfl', 'phone', 'birthDate', 'email']);
export const revealSchema = z.object({
  field: piiField,
  reason: text(10, 300, msg('v.reasonMin10')),
});
export const medicalAccessSchema = z.object({ reason: text(10, 300, msg('v.reasonMin10')) });
export const transitionSchema = z
  .object({
    to: claimStatus,
    amountApproved: z.number().int().positive(msg('v.amountPositive')).max(10_000_000_000).optional(),
    comment: z.string().trim().max(1000, msg('v.tooLong', { max: 1000 })).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.to === 'rejected' && !v.comment) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['comment'], message: msg('v.rejectReasonRequired') });
    }
  });
export const declineAppointmentSchema = z.object({ reason: text(3, 300) });
export const limitRequestSchema = z.object({
  policyId: uuid,
  insuredId: uuid.optional(),
  category: limitCategory,
  to: z.number({ invalid_type_error: msg('v.amountRequired') }).int().positive(msg('v.amountPositive')).max(1_000_000_000),
  justification: text(10, 1000, msg('v.justificationMin10')),
});
export const rejectLimitSchema = z.object({ comment: text(3, 500) });
const kpMoney = (required: string) =>
  z
    .number({ required_error: required, invalid_type_error: required })
    .int(msg('v.wholeAmounts'))
    .min(1, msg('v.amountPositive'))
    .max(1_000_000_000_000, msg('v.kpMaxAmount'));
const kpCount = z
  .number({ required_error: msg('v.countRequired'), invalid_type_error: msg('v.countRequired') })
  .int(msg('v.wholeNumber'))
  .min(0, msg('v.min', { min: 0 }))
  .max(100_000, msg('v.max', { max: '100 000' }));

/** Commercial offer parameters (KP_SPEC §4). `today` is injectable for tests. */
export const makeKpParamsSchema = (today: () => string = () => todayISO()) =>
  z
    .object({
      templateId: z.literal('gold'),
      lang: z.enum(['ru', 'en']),
      variant: z.enum(['white', 'grey', 'black']),
      sumInsured: kpMoney(msg('v.kpSumInsuredRequired')),
      premiumEmployee: kpMoney(msg('v.kpPremiumRequired')),
      premiumFamily: kpMoney(msg('v.kpPremiumRequired')),
      employees: kpCount.min(1, msg('v.atLeastOneEmployee')),
      familyMembers: kpCount,
      coverageStart: isoDateInput,
      coverageEnd: isoDateInput,
      validUntil: isoDateInput,
      paymentTerms: z.enum(['single', 'quarterly', 'monthly']),
      assistanceId: z.preprocess((v) => (v === '' ? null : v), uuid.nullable()).optional(),
    })
    .superRefine((v, ctx) => {
      if (v.coverageEnd <= v.coverageStart) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['coverageEnd'], message: msg('v.endAfterStart') });
      }
      if (v.validUntil < today()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['validUntil'], message: msg('v.validUntilPast') });
      }
    });
export const kpParamsSchema = makeKpParamsSchema();
export const clientCreateSchema = z.object({
  legalForm: z.enum(LEGAL_FORMS),
  name: text(2, 120),
  inn: z
    .string()
    .trim()
    .transform((v) => digitsOnly(v))
    .refine((v) => /^\d{9}$/.test(v), msg('v.innFormat')),
  status: z.enum(['draft', 'negotiation']).default('draft'),
});
export const clientPatchSchema = z.object({
  name: text(2, 120).optional(),
  status: z.enum(['draft', 'negotiation', 'active', 'renewal', 'expired']).optional(),
});
export const adminUserPatchSchema = z
  .object({ role: staffRole.optional(), active: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.active !== undefined, msg('v.noChanges'));
export const exportSchema = z.object({
  type: z.enum(['clients', 'claims_financial', 'policies', 'hr_employees', 'loss_ratio', 'claims_by_category', 'premium_by_month']),
});

// ---- hr ----
export const hrEmployeeSchema = z.object({
  fullName: text(5, 120, msg('v.fullNameRequired')).refine(
    (v) => v.split(/\s+/).length >= 2,
    msg('v.fullNameTwoWords'),
  ),
  birthDate: isoDateInput.pipe(
    z
      .string()
      .refine((v) => Number(v.slice(0, 4)) >= 1920 && v <= new Date().toISOString().slice(0, 10), msg('v.birthDateCheck')),
  ),
  pinfl: pinflInput,
  phone: phoneInput,
  position: text(2, 80),
  startDate: isoDateInput,
});
export type HrEmployeeInput = z.input<typeof hrEmployeeSchema>;
export type HrEmployeePayload = z.output<typeof hrEmployeeSchema>;
export const hrExcludeSchema = z.object({ excludeFrom: isoDateInput });

// ---- family members (FAMILY_SPEC) ----
/** «Surname Given Patronymic» in Latin script (as in the ID card), 2–4 words. */
const LATIN_PERSON = /^[A-Za-zʻʼ'`’-]+(?: [A-Za-zʻʼ'`’-]+){1,3}$/;
export const latinFullName = text(5, 120, msg('v.fullNameRequired'))
  .transform((v) => v.replace(/\s+/g, ' '))
  .pipe(z.string().regex(LATIN_PERSON, msg('v.fullNameLatin')));
const familyRelationInput = z.enum(['spouse', 'child', 'parent', 'other'], { errorMap: () => ({ message: msg('v.relation') }) });
const familyMemberFields = {
  fullName: latinFullName,
  birthDate: hrEmployeeSchema.shape.birthDate,
  pinfl: pinflInput,
  relation: familyRelationInput,
  /** A child studying full time: covered up to `studentMaxAge`. */
  isStudent: z.boolean().optional(),
};
/** HR adds a family member of an employee: a change request for MIG, like an employee. */
export const hrFamilyMemberSchema = z.object({
  employeeId: uuid,
  ...familyMemberFields,
  /** An adult family member's own phone: the login to the app. */
  phone: z
    .union([z.string(), z.undefined()])
    .transform((v) => (v ?? '').trim())
    .pipe(z.union([z.literal('').transform(() => undefined), phoneInput])),
  startDate: isoDateInput,
});
export type HrFamilyMemberInput = z.input<typeof hrFamilyMemberSchema>;
/** The employee asks to add a family member from the app; HR approves. */
export const familyRequestSchema = z.object({
  ...familyMemberFields,
  /** The employee confirms the family member's consent to the processing of personal data. */
  consent: z.literal(true, { errorMap: () => ({ message: msg('v.familyConsentRequired') }) }),
});
export type FamilyRequestInput = z.input<typeof familyRequestSchema>;
export const familyRequestDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    /** Start of coverage; by default the next day. */
    startDate: isoDateInput.optional(),
    reason: z.string().trim().max(300, msg('v.tooLong', { max: 300 })).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision === 'reject' && (v.reason ?? '').length < 5) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: msg('v.reasonMin5') });
  });
/** An adult family member allows (or stops allowing) the employee to see their claims and appointments. */
export const familyConsentSchema = z.object({ granted: z.boolean() });
/** Own card for reimbursements; null — back to the employee's card (a family member only). */
export const payoutCardSchema = z.object({
  card: z
    .union([z.string().trim().max(23).transform((v) => digitsOnly(v)).refine((v) => /^\d{16}$/.test(v), msg('v.cardFormat')), z.null()]),
});
export const hrInviteSchema = z.object({
  ids: z.union([z.array(uuid).min(1).max(2000), z.literal('all_not_in_app')]),
});

// ---- insured app ----
export const consentSchema = z.object({ version: z.string().trim().min(1).max(20) });
export const myClaimSchema = z.object({
  category: claimCategory,
  amount: z.number({ invalid_type_error: msg('v.amountRequired') }).int().positive(msg('v.amountRequired')).max(100_000_000, msg('v.amountTooLarge')),
  serviceDate: isoDateInput,
  providerName: text(2, 120, msg('v.providerRequired')),
});
/**
 * A claim registered by MIG staff (operator, claims officer): the insured person, how the claim reached MIG and
 * the same fields as a claim from the app. Attachments travel next to it in the multipart body.
 */
export const staffClaimSchema = myClaimSchema.extend({
  insuredId: z.string({ required_error: msg('v.insuredRequired') }).trim().uuid(msg('v.insuredRequired')),
  intakeChannel: z.enum(claimIntakeChannel.options, { errorMap: () => ({ message: msg('v.required') }) }),
});
export const myAppointmentSchema = z.object({
  clinicId: uuid,
  specialty,
  startsAt: z.string().trim().min(10).max(40),
});
export const chatSchema = z.object({ text: text(1, 1000, msg('v.messageRequired')) });

// ---------- clinics (CLINIC_SPEC) ----------
const emailInput = z.string().trim().toLowerCase().min(1, msg('v.emailRequired')).max(254).email(msg('v.emailInvalid'));
const clinicRole = z.enum(['clinic_registrar', 'clinic_admin']);

/** «+ Создать → Пользователь» (admin): a new MIG employee is invited by work email. */
export const staffUserInviteSchema = z.object({ email: emailInput, fullName: text(3, 120), role: staffRole });
export const clinicUserInviteSchema = z.object({ email: emailInput, fullName: text(3, 120), role: clinicRole });
export const clinicUserPatchSchema = z
  .object({ role: clinicRole.optional(), active: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.active !== undefined, msg('v.nothingToChange'));
export const clinicAdminInviteSchema = z.object({ email: emailInput, fullName: text(3, 120) });
export const clinicCreateSchema = z.object({
  legalForm: z.enum(LEGAL_FORMS).default('llc'),
  name: text(3, 120),
  address: text(5, 200),
  district: text(2, 60),
  specialties: z.array(specialty).min(1, msg('v.specialtiesRequired')),
  integrationMode: z.enum(['portal', 'api', 'hybrid']),
});
export const clinicModeSchema = z.object({ integrationMode: z.enum(['portal', 'api', 'hybrid']) });
export const registryBuildSchema = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, msg('v.periodFormat')) });
export const guaranteeAnswerSchema = z.object({ comment: text(3, 1000) });

export const guaranteeDecisionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    amount: z.number({ invalid_type_error: msg('v.amountRequired') }).int().min(1, msg('v.amountPositive')).max(10_000_000_000),
    validUntil: isoDateInput,
  }),
  z.object({ action: z.literal('reject'), reason: text(5, 500) }),
  z.object({ action: z.literal('request_info'), reason: text(5, 500) }),
]);
export const registryLineDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('accept') }),
  z.object({ decision: z.literal('reject'), reason: text(3, 300) }),
]);

// ---- policy issuance and changes of the insured list (POLICY_SPEC) ----
const programInput = z.enum(['basic', 'standard', 'standard_plus', 'premium'], { errorMap: () => ({ message: msg('v.programRequired') }) });
const tariffInput = z.number({ invalid_type_error: msg('v.tariffRequired') }).int().min(100_000, msg('v.min', { min: '100 000' })).max(1_000_000_000, msg('v.tariffTooLarge'));

/** Relation in a CSV cell: empty — an employee. */
const relationCell = z
  .union([z.string(), z.undefined()])
  .transform((v) => (v ?? '').trim().toLowerCase() || 'employee')
  .pipe(z.enum(['employee', 'spouse', 'child', 'parent', 'other'], { errorMap: () => ({ message: msg('v.relation') }) }));
const optionalPinflCell = z
  .union([z.string(), z.undefined()])
  .transform((v) => digitsOnly(v ?? ''))
  .refine((v) => v === '' || /^\d{14}$/.test(v), msg('v.pinflFormat'))
  .transform((v) => (v === '' ? undefined : v));
const optionalPhoneCell = z
  .union([z.string(), z.undefined()])
  .transform((v) => (v ?? '').trim())
  .pipe(z.union([z.literal('').transform(() => ''), phoneInput]));
const yesNoCell = z
  .union([z.string(), z.boolean(), z.undefined()])
  .transform((v) => v === true || ['1', 'yes', 'true', 'y', 'ha'].includes(String(v ?? '').trim().toLowerCase()));

/**
 * One row of the initial list of insured persons (CSV): a row per person. A family member has `relation`
 * (spouse, child, parent, other) and the employee's PINFL in `principal_pinfl`; the phone and the position
 * are optional for a family member.
 */
export const policyListRowSchema = hrEmployeeSchema
  .omit({ startDate: true, phone: true, position: true })
  .extend({
    phone: optionalPhoneCell,
    position: z
      .union([z.string(), z.undefined()])
      .transform((v) => (v ?? '').trim())
      .pipe(z.string().max(80, msg('v.tooLong', { max: 80 }))),
    relation: relationCell,
    principal_pinfl: optionalPinflCell,
    student: yesNoCell.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.relation === 'employee') {
      if (!v.phone) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['phone'], message: msg('v.phoneRequired') });
      if (v.position.length < 2) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['position'], message: msg('v.tooShort', { min: 2 }) });
      if (v.principal_pinfl) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['principal_pinfl'], message: msg('v.principalForEmployee') });
    } else if (!v.principal_pinfl) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['principal_pinfl'], message: msg('v.principalRequired') });
  });

export const policyTermsSchema = z
  .object({
    program: programInput,
    startDate: isoDateInput,
    endDate: isoDateInput,
    tariff: z.object({ employee: tariffInput, family: tariffInput }),
  })
  .superRefine((v, ctx) => {
    if (v.endDate < v.startDate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: msg('v.endBeforeStart') });
  });

export const policyHrInviteSchema = z.object({ fullName: text(5, 120, msg('v.fioRequired')), email: emailInput });

export const policyIssueSchema = z.object({
  program: programInput,
  startDate: isoDateInput,
  endDate: isoDateInput,
  tariff: z.object({ employee: tariffInput, family: tariffInput }),
  csv: z.string().min(1, msg('v.listRequired')).max(5 * 1024 * 1024, msg('v.fileOver5mb')),
  hr: policyHrInviteSchema.optional(),
});

export const policyChangeDecisionSchema = z
  .object({
    ids: z.array(uuid).min(1, msg('v.selectRequests')).max(200, msg('v.max200Requests')),
    decision: z.enum(['approve', 'reject']),
    reason: z.string().trim().max(300, msg('v.tooLong', { max: 300 })).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision === 'reject' && (v.reason ?? '').length < 5) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: msg('v.reasonMin5') });
  });

// ---- assistance companies (ASSISTANCE_SPEC) ----
const periodInput = z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, msg('v.periodFormat'));
const assistRole = z.enum(['asst_operator', 'asst_doctor', 'asst_billing', 'asst_admin'], { errorMap: () => ({ message: msg('v.roleRequired') }) });
export const caseTypeInput = z.enum(['appointment', 'consultation', 'guarantee', 'complaint', 'emergency'], { errorMap: () => ({ message: msg('v.caseTypeRequired') }) });
export const caseCreateSchema = z.object({
  insuredId: uuid,
  type: caseTypeInput,
  channel: z.enum(['phone', 'chat', 'app', 'clinic']).default('phone'),
  description: text(5, 1000, msg('v.caseDescMin5')),
});
export const caseUpdateSchema = z
  .object({
    status: z.enum(['open', 'in_progress', 'waiting', 'resolved']),
    resolution: z.string().trim().max(1000, msg('v.tooLong', { max: 1000 })).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'resolved' && (v.resolution ?? '').length < 3) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['resolution'], message: msg('v.resolutionRequired') });
  });
export const assistAppointmentSchema = myAppointmentSchema.extend({ insuredId: uuid, caseId: uuid.optional() });
export const assistGuaranteeDecisionSchema = z.discriminatedUnion('action', [
  ...guaranteeDecisionSchema.options,
  z.object({ action: z.literal('escalate'), reason: text(10, 1000, msg('v.doctorOpinionMin10')) }),
]);
export const clinicPaymentSchema = z.object({
  lineIds: z.array(uuid).min(1, msg('v.selectLines')).max(500, msg('v.maxLines', { max: 500 })),
  paidAt: isoDateInput,
  amount: z.number().int().min(1).max(100_000_000_000).optional(),
  orderNumber: text(1, 40, msg('v.orderNumberRequired')),
});
export const rebillCreateSchema = z.object({ period: periodInput, lineIds: z.array(uuid).max(2000).optional() });
export const rebillDisputeSchema = z.object({ comment: text(5, 1000, msg('v.objectionMin5')) });
export const rebillLineDecisionSchema = registryLineDecisionSchema;
export const qaReviewSchema = z
  .object({ verdict: z.enum(['agree', 'disagree'], { errorMap: () => ({ message: msg('v.verdictRequired') }) }), comment: z.string().trim().max(1000, msg('v.tooLong', { max: 1000 })).optional() })
  .superRefine((v, ctx) => {
    if (v.verdict === 'disagree' && (v.comment ?? '').length < 5) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['comment'], message: msg('v.disagreeMin5') });
  });
export const assignmentSchema = z.object({ assistanceId: uuid.nullable(), from: isoDateInput });
export const assistUserInviteSchema = z.object({ email: emailInput, fullName: text(3, 120), role: assistRole });
export const assistUserPatchSchema = z
  .object({ role: assistRole.optional(), active: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.active !== undefined, msg('v.nothingToChange'));
const feeModelInput = z.enum(['pepm', 'percent_of_claims', 'per_case'], { errorMap: () => ({ message: msg('v.feeModelRequired') }) });
export const assistanceContractSchema = z
  .object({
    feeModel: feeModelInput,
    feeValue: z.number({ invalid_type_error: msg('v.feeValueRequired') }).min(0).max(100_000_000),
    /** Individual authority; omitted — the DMS parameter `assistanceGuaranteeAuthority` applies. */
    guaranteeAuthorityLimit: z.number({ invalid_type_error: msg('v.amountRequired') }).int().min(0).max(10_000_000_000).optional(),
    rebillPaymentDays: z.number({ invalid_type_error: msg('v.termRequired') }).int().min(1, msg('v.minOneDay')).max(90, msg('v.max90Days')),
    /** Reimbursements of the insured are reviewed and paid by the assistance (default) or by MIG. */
    handlesReimbursements: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.feeModel === 'percent_of_claims' && (v.feeValue <= 0 || v.feeValue >= 1)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['feeValue'], message: msg('v.feeShare') });
    if (v.feeModel !== 'percent_of_claims' && (v.feeValue < 1 || !Number.isInteger(v.feeValue))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['feeValue'], message: msg('v.feeWholeUzs') });
  });
export const assistanceCreateSchema = z.object({
  legalForm: z.enum(LEGAL_FORMS).default('llc'),
  name: text(3, 120),
  phone24x7: text(5, 30),
  integrationMode: z.enum(['portal', 'api', 'hybrid']),
  contractNumber: text(3, 40),
  contract: assistanceContractSchema,
  admin: z.object({ email: emailInput, fullName: text(3, 120) }),
});
/** A guarantee letter requested by the assistance call centre on a call (ASSISTANCE_SPEC §5.2). */
export const assistGuaranteeRequestSchema = z.object({
  insuredId: uuid,
  clinicId: uuid,
  serviceCode: text(1, 20, msg('v.serviceRequired')),
  icd10: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]\d{2}(\.\d{1,2})?$/, msg('v.icd10Format')),
  estimatedCost: z.number({ invalid_type_error: msg('v.amountRequired') }).int().min(1, msg('v.amountPositive')).max(10_000_000_000),
  comment: z.string().trim().max(1000, msg('v.tooLong', { max: 1000 })).optional(),
  caseId: uuid.optional(),
});
export const complaintResolutionSchema = z.object({ resolution: text(5, 1000, msg('v.resolutionMin5')) });
/** An admin proposes a new value of a DMS parameter; it applies after a second person confirms. */
export const dmsParamChangeSchema = z
  .object({
    key: z
      .string()
      .trim()
      .max(60)
      .refine((k) => isDmsParamKey(k) || isNumberingParamKey(k), msg('v.unknownParam')),
    /** A number for DMS parameters; a numbering template (`numbering.*`) is a string, trimmed, without inner spaces. */
    value: z.union([z.number({ invalid_type_error: msg('v.numberRequired') }), z.string().max(200).transform((s) => s.trim())], { invalid_type_error: msg('v.numberRequired') }),
    reason: text(5, 500, msg('v.basisMin5')),
  })
  .superRefine((v, ctx) => {
    let error: string | null = null;
    if (isNumberingParamKey(v.key)) error = typeof v.value === 'string' ? numberingTemplateError(numberingKindOf(v.key), v.value) : msg('dom.numbering.chars');
    else if (isDmsParamKey(v.key)) error = typeof v.value === 'number' ? dmsParamError(v.key, v.value) : msg('v.numberRequired');
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: error });
  });
export const dmsParamRejectSchema = z.object({ reason: text(5, 500, msg('v.reasonMin5')) });

// ---------------- contract lifecycle (LIFECYCLE_SPEC) ----------------
const shareInput = (max: number, message: string) => z.number({ invalid_type_error: msg('v.numberRequired') }).min(0, message).max(max, message);
const moneyInput = z.number({ invalid_type_error: msg('v.amountRequired') }).int(msg('v.wholeAmount')).min(0, msg('v.notNegative')).max(100_000_000_000);
export const authorityChangeSchema = z
  .object({
    authority: z.object({
      quoteDiscountMaxPct: shareInput(1, msg('v.discountRange')).optional(),
      quotePremiumMax: moneyInput.optional(),
      claimDecisionMax: moneyInput.optional(),
    }),
    signatory: z.object({ basis: text(5, 200, msg('v.signatoryBasis')) }).nullable(),
    reason: text(5, 500, msg('v.changeBasisMin5')),
  });
export const authorityRejectSchema = z.object({ reason: text(5, 500, msg('v.reasonMin5')) });

const innInput = z
  .string({ required_error: msg('v.innRequired') })
  .trim()
  .transform((v) => digitsOnly(v))
  .refine((v) => /^\d{9}$/.test(v), msg('v.innFormat'));
export const requisitesSchema = z.object({
  bank: text(3, 120, msg('v.bankRequired')),
  account: z
    .string()
    .trim()
    .transform((v) => digitsOnly(v))
    .refine((v) => /^\d{20}$/.test(v), msg('v.accountFormat')),
  mfo: z
    .string()
    .trim()
    .transform((v) => digitsOnly(v))
    .refine((v) => /^\d{5}$/.test(v), msg('v.mfoFormat')),
  director: text(5, 120, msg('v.directorRequired')),
  directorBasis: text(3, 120, msg('v.directorBasis')),
  address: z.string().trim().max(200, msg('v.tooLong', { max: 200 })).optional(),
});
export const leadCreateSchema = z.object({
  legalForm: z.enum(LEGAL_FORMS),
  name: text(2, 120),
  inn: innInput,
  requisites: requisitesSchema,
  contactName: text(3, 120, msg('v.contactRequired')),
  contactPhone: phoneInput,
  contactEmail: emailInput,
  estimatedHeadcount: z.number({ invalid_type_error: msg('v.headcountRequired') }).int().min(1, msg('v.min', { min: 1 })).max(100_000),
  currentInsurer: z.string().trim().max(120, msg('v.tooLong', { max: 120 })).optional(),
  expectedStart: isoDateInput.optional(),
});
export const dealLostSchema = z.object({ reason: text(5, 500, msg('v.reasonMin5')) });
export const dealPatchSchema = z.object({ expectedStart: isoDateInput.optional(), underwriterId: uuid.optional() });

export const quoteAdjustmentSchema = z.object({
  label: text(2, 80, msg('v.adjustmentLabel')),
  /** Share: −0.08 = скидка 8%, 0.05 = надбавка 5%. */
  pct: z.number({ invalid_type_error: msg('v.pctRequired') }).min(-0.9, msg('v.pctMin')).max(2, msg('v.pctMax')),
  comment: text(5, 300, msg('v.commentRequiredMin5')),
});
export const quoteCreateSchema = z.object({ dealId: uuid, program: programInput, adjustments: z.array(quoteAdjustmentSchema).max(10, msg('v.maxLines', { max: 10 })).default([]) });
export const quotePatchSchema = z.object({ program: programInput, adjustments: z.array(quoteAdjustmentSchema).max(10, msg('v.maxLines', { max: 10 })) });
export const quoteApproveSchema = z.object({ comment: z.string().trim().max(500).optional() });
export const quoteRejectSchema = z.object({ reason: text(5, 500, msg('v.reasonMin5')) });
export const kpDeclineSchema = z.object({ reason: text(3, 500, msg('v.reasonRequired')) });

const scheduleInput = z.array(z.object({ dueDate: isoDateInput, amount: moneyInput })).min(1).max(12);
export const contractParamsSchema = z.object({
  startDate: isoDateInput,
  endDate: isoDateInput,
  program: programInput,
  premiumEmployee: moneyInput,
  premiumFamily: moneyInput,
  paymentFrequency: z.enum(['single', 'quarterly', 'monthly']),
  paymentSchedule: scheduleInput.optional(),
  activationRule: z.enum(['on_start_date', 'after_first_payment']),
  migSignatoryId: uuid,
  clientSignatory: z.object({ name: text(5, 120, msg('v.signerName')), position: text(2, 120, msg('v.position')), basis: text(3, 120, msg('v.authorityBasis')) }),
});
export const clauseOverrideSchema = z.object({ clauseId: z.string().trim().min(1).max(10), text: text(5, 4000, msg('v.clauseMin5')) });
export const contractPatchSchema = z.object({
  params: contractParamsSchema.partial().optional(),
  clauseOverrides: z.array(clauseOverrideSchema).max(60).optional(),
});
export const legalReturnSchema = z.object({ comment: text(5, 1000, msg('v.legalCommentMin5')) });
export const legalApproveSchema = z.object({ comment: z.string().trim().max(1000).optional() });
export const signSchema = z.discriminatedUnion('method', [
  z.object({ side: z.enum(['mig', 'client']), method: z.literal('eimzo'), certificateSerial: z.string().trim().regex(/^[0-9A-F]{8,20}$/, msg('v.keySerial')), password: text(1, 100, msg('v.keyPassword')) }),
  z.object({ side: z.literal('mig'), method: z.literal('paper') }),
]);
// eslint-disable-next-line mig/no-cyrillic-ui -- operator names are data values of the API
export const edoSendSchema = z.object({ provider: z.enum(['Didox', 'Faktura.uz', 'Soliq ЭДО'], { errorMap: () => ({ message: msg('v.edoRequired') }) }) });
export const scanVerifySchema = z.object({ side: z.enum(['mig', 'client']) });
export const originalsSchema = z
  .object({ migCopySentAt: isoDateInput.optional(), clientOriginalReceivedAt: isoDateInput.optional() })
  .refine((v) => v.migCopySentAt || v.clientOriginalReceivedAt, msg('v.dateRequired'));
export const terminateSchema = z.object({ date: isoDateInput, reason: text(5, 500, msg('v.terminationReasonMin5')) });
export const paymentSchema = z.object({
  invoiceId: uuid,
  amount: z.number({ invalid_type_error: msg('v.amountRequired') }).int(msg('v.wholeAmount')).min(1, msg('v.amountAboveZero')).max(100_000_000_000),
  paidAt: isoDateInput,
  purpose: z.string().trim().max(300).optional(),
});
/** «Ручная разноска»: a queued statement payment split across one or more invoices. */
export const paymentAllocationSchema = z.object({
  lines: z
    .array(z.object({ invoiceId: uuid, amount: z.number({ invalid_type_error: msg('v.amountRequired') }).int(msg('v.wholeAmount')).min(1, msg('v.amountAboveZero')).max(100_000_000_000) }))
    .min(1, msg('v.selectInvoice'))
    .max(10),
  comment: z.string().trim().max(500, msg('v.notLonger', { max: 500 })).optional(),
});
export type PaymentAllocationInput = z.infer<typeof paymentAllocationSchema>;
export const changeRequestCreateSchema = z.object({
  contractId: uuid,
  type: z.enum(['change_program', 'other']),
  effectiveDate: isoDateInput,
  program: programInput.optional(),
  description: z.string().trim().max(300).optional(),
  amount: z.number().int().min(-100_000_000_000).max(100_000_000_000).optional(),
});
export const endorsementCreateSchema = z.object({ contractId: uuid, changeRequestIds: z.array(uuid).max(500).optional() });
export const endorsementPatchSchema = z.object({ clauseOverrides: z.array(clauseOverrideSchema).max(30) });

// ---------------- claims settlement (LIFECYCLE_SPEC §13) ----------------
export const opinionRequestSchema = z.object({ question: z.string().trim().max(1000, msg('v.tooLong', { max: 1000 })).optional() });
export const opinionSchema = z.object({ text: text(10, 2000, msg('v.opinionMin10')), recommendation: z.enum(['approve', 'partial', 'reject']) });
export const claimDecideSchema = z.object({
  kind: z.enum(['approve', 'partial', 'reject']),
  amount: z.number({ invalid_type_error: msg('v.amountRequired') }).int().min(0).max(100_000_000_000),
  clauseRef: z.string().trim().max(40).optional(),
  reason: z.string().trim().max(1000, msg('v.tooLong', { max: 1000 })).default(''),
});
export const decisionRejectSchema = z.object({ comment: text(5, 500, msg('v.commentMin5')) });
export const reserveSchema = z.object({ amount: moneyInput, reason: text(5, 300, msg('v.reserveReasonMin5')) });
export const flagDismissSchema = z.object({ comment: text(5, 500, msg('v.commentRequiredMin5')) });
export const appealSchema = z.object({ text: text(10, 1000, msg('v.disagreeWhat', { min: 10 })) });
export const appealResolveSchema = z.object({ resolution: text(5, 1000, msg('v.appealResolutionMin5')) });
export const contractCreateSchema = z.object({ dealId: uuid });

// ---------------- AI coverage check (AI_COVERAGE_SPEC) ----------------
const aiScenario = z.enum(['insured', 'clinic', 'decision', 'rebill']);
export const aiCheckRequestSchema = z.object({
  scenario: aiScenario,
  query: z.string().trim().min(2, msg('v.aiQueryRequired')).max(300, msg('v.tooLong', { max: 300 })).optional(),
  items: z.array(z.object({ text: z.string().trim().min(1).max(200), amount: z.number().int().min(0).max(100_000_000_000).optional() })).max(30).optional(),
  subject: z.object({ type: z.enum(['visit', 'claim', 'guarantee', 'registry', 'registry_line']), id: uuid }).optional(),
  serviceCode: z.string().trim().max(20).optional(),
  icd10: z.string().trim().max(10).optional(),
  amount: z.number().int().min(0).max(100_000_000_000).optional(),
  lang: z.enum(['ru', 'uz']).optional(),
});
export const aiFeedbackSchema = z
  .object({ logId: uuid, agree: z.boolean(), comment: z.string().trim().max(500, msg('v.tooLong', { max: 500 })).optional() })
  .refine((v) => v.agree || (v.comment ?? '').length >= 5, { message: msg('v.disagreeWhat', { min: 5 }), path: ['comment'] });
const aiScenarioSettings = z.object({ enabled: z.boolean(), provider: z.enum(['mock', 'local', 'external']) });
export const aiSettingsSchema = z.object({
  scenarios: z.object({ insured: aiScenarioSettings, clinic: aiScenarioSettings, decision: aiScenarioSettings, rebill: aiScenarioSettings }),
  confidenceThreshold: z.number({ invalid_type_error: msg('v.numberRequired') }).min(0.3, msg('v.confidenceRange')).max(0.95, msg('v.confidenceRange')),
  killSwitch: z.boolean(),
});
export const aiSettingsChangeSchema = z.object({ to: aiSettingsSchema, reason: text(5, 500, msg('v.basisMin5')) });
export const aiRejectSchema = z.object({ reason: text(5, 500, msg('v.reasonMin5')) });
