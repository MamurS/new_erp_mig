/*
 * Form schemas. The same schemas validate request bodies in the mock server (CLAUDE.md rule 8).
 * Every string is trimmed and length-limited; inputs are normalised (phones, dates, digits).
 */
import { z } from 'zod';
import { claimCategory, claimStatus, limitCategory, specialty, staffRole } from '@/shared/api/schemas';
import { todayISO } from '@/shared/lib/format';
import { digitsOnly, parseRuDate } from '@/shared/lib/masks';
import { dmsParamError, isDmsParamKey } from '@/shared/config/dmsParameters';

const text = (min: number, max: number, msg?: string) =>
  z
    .string({ required_error: 'Заполните поле' })
    .trim()
    .min(min, msg ?? (min <= 1 ? 'Заполните поле' : `Минимум ${min} символов`))
    .max(max, `Не больше ${max} символов`);

const uuid = z.string().trim().uuid('Некорректный идентификатор');

/** Accepts `dd.mm.yyyy` or `yyyy-mm-dd`, outputs ISO date. */
export const isoDateInput = z
  .string({ required_error: 'Укажите дату' })
  .trim()
  .max(10)
  .transform((v, ctx) => {
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : parseRuDate(v);
    if (!iso || Number.isNaN(new Date(`${iso}T00:00:00Z`).getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Дата в формате ДД.ММ.ГГГГ' });
      return z.NEVER;
    }
    return iso;
  });

/** Accepts any formatting of an Uzbek mobile number, outputs `+998XXXXXXXXX`. */
export const phoneInput = z
  .string({ required_error: 'Укажите номер' })
  .trim()
  .max(20)
  .transform((v, ctx) => {
    let d = digitsOnly(v);
    if (d.startsWith('998')) d = d.slice(3);
    if (d.length !== 9) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Номер в формате +998 XX XXX XX XX' });
      return z.NEVER;
    }
    return `+998${d}`;
  });

export const pinflInput = z
  .string({ required_error: 'Укажите ПИНФЛ' })
  .trim()
  .max(20)
  .transform((v) => digitsOnly(v))
  .refine((v) => /^\d{14}$/.test(v), 'ПИНФЛ — 14 цифр');

export const otpCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Код — 6 цифр');

// ---- auth ----
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Укажите email').max(254).email('Некорректный email'),
  password: z.string().min(1, 'Укажите пароль').max(128),
});
export const otpSchema = z.object({ challengeId: z.string().trim().min(1).max(128), code: otpCode });
export const phoneLoginSchema = z.object({ phone: phoneInput });
export const phoneVerifySchema = otpSchema;

// ---- staff ----
export const piiField = z.enum(['pinfl', 'phone', 'birthDate', 'email']);
export const revealSchema = z.object({
  field: piiField,
  reason: text(10, 300, 'Опишите причину: минимум 10 символов'),
});
export const medicalAccessSchema = z.object({ reason: text(10, 300, 'Опишите причину: минимум 10 символов') });
export const transitionSchema = z
  .object({
    to: claimStatus,
    amountApproved: z.number().int().positive('Сумма должна быть больше нуля').max(10_000_000_000).optional(),
    comment: z.string().trim().max(1000, 'Не больше 1000 символов').optional(),
  })
  .superRefine((v, ctx) => {
    if (v.to === 'rejected' && !v.comment) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['comment'], message: 'Для отказа укажите причину' });
    }
  });
export const declineAppointmentSchema = z.object({ reason: text(3, 300) });
export const limitRequestSchema = z.object({
  policyId: uuid,
  insuredId: uuid.optional(),
  category: limitCategory,
  to: z.number({ invalid_type_error: 'Укажите сумму' }).int().positive('Сумма должна быть больше нуля').max(1_000_000_000),
  justification: text(10, 1000, 'Обоснование: минимум 10 символов'),
});
export const rejectLimitSchema = z.object({ comment: text(3, 500) });
const kpMoney = (label: string) =>
  z
    .number({ required_error: `Укажите ${label}`, invalid_type_error: `Укажите ${label}` })
    .int('Только целые суммы')
    .min(1, 'Сумма должна быть больше нуля')
    .max(1_000_000_000_000, 'Не больше 10¹² UZS');
const kpCount = z
  .number({ required_error: 'Укажите количество', invalid_type_error: 'Укажите количество' })
  .int('Только целое число')
  .min(0, 'Не меньше 0')
  .max(100_000, 'Не больше 100 000');

/** Commercial offer parameters (KP_SPEC §4). `today` is injectable for tests. */
export const makeKpParamsSchema = (today: () => string = () => todayISO()) =>
  z
    .object({
      templateId: z.literal('gold'),
      lang: z.enum(['ru', 'en']),
      variant: z.enum(['white', 'grey', 'black']),
      sumInsured: kpMoney('страховую сумму'),
      premiumEmployee: kpMoney('премию'),
      premiumFamily: kpMoney('премию'),
      employees: kpCount.min(1, 'Нужен хотя бы один сотрудник'),
      familyMembers: kpCount,
      coverageStart: isoDateInput,
      coverageEnd: isoDateInput,
      validUntil: isoDateInput,
      paymentTerms: z.enum(['single', 'quarterly', 'monthly']),
      assistanceId: z.preprocess((v) => (v === '' ? null : v), uuid.nullable()).optional(),
    })
    .superRefine((v, ctx) => {
      if (v.coverageEnd <= v.coverageStart) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['coverageEnd'], message: 'Окончание должно быть позже начала' });
      }
      if (v.validUntil < today()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['validUntil'], message: 'Срок действия не может быть в прошлом' });
      }
    });
export const kpParamsSchema = makeKpParamsSchema();
export const clientCreateSchema = z.object({
  legalForm: z.enum(['ООО', 'АО', 'СП ООО', 'ЧП']),
  name: text(2, 120),
  inn: z
    .string()
    .trim()
    .transform((v) => digitsOnly(v))
    .refine((v) => /^\d{9}$/.test(v), 'ИНН — 9 цифр'),
  status: z.enum(['draft', 'negotiation']).default('draft'),
});
export const clientPatchSchema = z.object({
  name: text(2, 120).optional(),
  status: z.enum(['draft', 'negotiation', 'active', 'renewal', 'expired']).optional(),
});
export const adminUserPatchSchema = z
  .object({ role: staffRole.optional(), active: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.active !== undefined, 'Нет изменений');
export const exportSchema = z.object({
  type: z.enum(['clients', 'claims_financial', 'policies', 'hr_employees', 'loss_ratio', 'claims_by_category', 'premium_by_month']),
});

// ---- hr ----
export const hrEmployeeSchema = z.object({
  fullName: text(5, 120, 'Укажите фамилию, имя и отчество').refine(
    (v) => v.split(/\s+/).length >= 2,
    'Укажите фамилию и имя',
  ),
  birthDate: isoDateInput.pipe(
    z
      .string()
      .refine((v) => Number(v.slice(0, 4)) >= 1920 && v <= new Date().toISOString().slice(0, 10), 'Проверьте дату рождения'),
  ),
  pinfl: pinflInput,
  phone: phoneInput,
  position: text(2, 80),
  startDate: isoDateInput,
});
export type HrEmployeeInput = z.input<typeof hrEmployeeSchema>;
export type HrEmployeePayload = z.output<typeof hrEmployeeSchema>;
export const hrExcludeSchema = z.object({ excludeFrom: isoDateInput });
export const hrInviteSchema = z.object({
  ids: z.union([z.array(uuid).min(1).max(2000), z.literal('all_not_in_app')]),
});

// ---- insured app ----
export const consentSchema = z.object({ version: z.string().trim().min(1).max(20) });
export const myClaimSchema = z.object({
  category: claimCategory,
  amount: z.number({ invalid_type_error: 'Укажите сумму' }).int().positive('Укажите сумму').max(100_000_000, 'Слишком большая сумма'),
  serviceDate: isoDateInput,
  providerName: text(2, 120, 'Укажите, где оплачивали'),
});
export const myAppointmentSchema = z.object({
  clinicId: uuid,
  specialty,
  startsAt: z.string().trim().min(10).max(40),
});
export const chatSchema = z.object({ text: text(1, 1000, 'Напишите сообщение') });

// ---------- clinics (CLINIC_SPEC) ----------
const emailInput = z.string().trim().toLowerCase().min(1, 'Укажите email').max(254).email('Некорректный email');
const clinicRole = z.enum(['clinic_registrar', 'clinic_admin']);

export const clinicUserInviteSchema = z.object({ email: emailInput, fullName: text(3, 120), role: clinicRole });
export const clinicUserPatchSchema = z
  .object({ role: clinicRole.optional(), active: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.active !== undefined, 'Нечего менять');
export const clinicAdminInviteSchema = z.object({ email: emailInput, fullName: text(3, 120) });
export const clinicCreateSchema = z.object({
  name: text(3, 120),
  address: text(5, 200),
  district: text(2, 60),
  specialties: z.array(specialty).min(1, 'Выберите специальности'),
  integrationMode: z.enum(['portal', 'api', 'hybrid']),
});
export const clinicModeSchema = z.object({ integrationMode: z.enum(['portal', 'api', 'hybrid']) });
export const registryBuildSchema = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Период ГГГГ-ММ') });
export const guaranteeAnswerSchema = z.object({ comment: text(3, 1000) });

export const guaranteeDecisionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    amount: z.number({ invalid_type_error: 'Укажите сумму' }).int().min(1, 'Сумма должна быть больше нуля').max(10_000_000_000),
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
const programInput = z.enum(['basic', 'standard', 'standard_plus', 'premium'], { errorMap: () => ({ message: 'Выберите программу' }) });
const tariffInput = z.number({ invalid_type_error: 'Укажите тариф' }).int().min(100_000, 'Не меньше 100 000').max(1_000_000_000, 'Слишком большой тариф');

/** One row of the initial list of insured persons (CSV). */
export const policyListRowSchema = hrEmployeeSchema.omit({ startDate: true }).extend({
  familyMembers: z
    .union([z.string(), z.number(), z.undefined()])
    .transform((v) => (v === undefined || String(v).trim() === '' ? 0 : Number(String(v).trim())))
    .pipe(z.number({ invalid_type_error: 'Число от 0 до 10' }).int('Число от 0 до 10').min(0, 'Число от 0 до 10').max(10, 'Число от 0 до 10')),
});

export const policyTermsSchema = z
  .object({
    program: programInput,
    startDate: isoDateInput,
    endDate: isoDateInput,
    tariff: z.object({ employee: tariffInput, family: tariffInput }),
  })
  .superRefine((v, ctx) => {
    if (v.endDate < v.startDate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'Окончание раньше начала' });
  });

export const policyHrInviteSchema = z.object({ fullName: text(5, 120, 'Укажите ФИО'), email: emailInput });

export const policyIssueSchema = z.object({
  program: programInput,
  startDate: isoDateInput,
  endDate: isoDateInput,
  tariff: z.object({ employee: tariffInput, family: tariffInput }),
  csv: z.string().min(1, 'Загрузите список застрахованных').max(5 * 1024 * 1024, 'Файл больше 5 МБ'),
  hr: policyHrInviteSchema.optional(),
});

export const policyChangeDecisionSchema = z
  .object({
    ids: z.array(uuid).min(1, 'Выберите заявки').max(200, 'Не больше 200 заявок за раз'),
    decision: z.enum(['approve', 'reject']),
    reason: z.string().trim().max(300, 'Не больше 300 символов').optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision === 'reject' && (v.reason ?? '').length < 5) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'Укажите причину: минимум 5 символов' });
  });

// ---- assistance companies (ASSISTANCE_SPEC) ----
const periodInput = z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Период ГГГГ-ММ');
const assistRole = z.enum(['asst_operator', 'asst_doctor', 'asst_billing', 'asst_admin'], { errorMap: () => ({ message: 'Выберите роль' }) });
export const caseTypeInput = z.enum(['appointment', 'consultation', 'guarantee', 'complaint', 'emergency'], { errorMap: () => ({ message: 'Выберите тип обращения' }) });
export const caseCreateSchema = z.object({
  insuredId: uuid,
  type: caseTypeInput,
  channel: z.enum(['phone', 'chat', 'app', 'clinic']).default('phone'),
  description: text(5, 1000, 'Опишите обращение: минимум 5 символов'),
});
export const caseUpdateSchema = z
  .object({
    status: z.enum(['open', 'in_progress', 'waiting', 'resolved']),
    resolution: z.string().trim().max(1000, 'Не больше 1000 символов').optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'resolved' && (v.resolution ?? '').length < 3) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['resolution'], message: 'Опишите решение' });
  });
export const assistAppointmentSchema = myAppointmentSchema.extend({ insuredId: uuid, caseId: uuid.optional() });
export const assistGuaranteeDecisionSchema = z.discriminatedUnion('action', [
  ...guaranteeDecisionSchema.options,
  z.object({ action: z.literal('escalate'), reason: text(10, 1000, 'Заключение врача: минимум 10 символов') }),
]);
export const clinicPaymentSchema = z.object({
  lineIds: z.array(uuid).min(1, 'Выберите строки').max(500, 'Не больше 500 строк'),
  paidAt: isoDateInput,
  amount: z.number().int().min(1).max(100_000_000_000).optional(),
  orderNumber: text(1, 40, 'Укажите номер платёжного поручения'),
});
export const rebillCreateSchema = z.object({ period: periodInput, lineIds: z.array(uuid).max(2000).optional() });
export const rebillDisputeSchema = z.object({ comment: text(5, 1000, 'Опишите возражение: минимум 5 символов') });
export const rebillLineDecisionSchema = registryLineDecisionSchema;
export const qaReviewSchema = z
  .object({ verdict: z.enum(['agree', 'disagree'], { errorMap: () => ({ message: 'Выберите оценку' }) }), comment: z.string().trim().max(1000, 'Не больше 1000 символов').optional() })
  .superRefine((v, ctx) => {
    if (v.verdict === 'disagree' && (v.comment ?? '').length < 5) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['comment'], message: 'Объясните несогласие: минимум 5 символов' });
  });
export const assignmentSchema = z.object({ assistanceId: uuid.nullable(), from: isoDateInput });
export const assistUserInviteSchema = z.object({ email: emailInput, fullName: text(3, 120), role: assistRole });
export const assistUserPatchSchema = z
  .object({ role: assistRole.optional(), active: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.active !== undefined, 'Нечего менять');
const feeModelInput = z.enum(['pepm', 'percent_of_claims', 'per_case'], { errorMap: () => ({ message: 'Выберите модель' }) });
export const assistanceContractSchema = z
  .object({
    feeModel: feeModelInput,
    feeValue: z.number({ invalid_type_error: 'Укажите размер' }).min(0).max(100_000_000),
    /** Individual authority; omitted — the DMS parameter `assistanceGuaranteeAuthority` applies. */
    guaranteeAuthorityLimit: z.number({ invalid_type_error: 'Укажите сумму' }).int().min(0).max(10_000_000_000).optional(),
    rebillPaymentDays: z.number({ invalid_type_error: 'Укажите срок' }).int().min(1, 'Не меньше 1 дня').max(90, 'Не больше 90 дней'),
    /** Reimbursements of the insured are reviewed and paid by the assistance (default) or by MIG. */
    handlesReimbursements: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.feeModel === 'percent_of_claims' && (v.feeValue <= 0 || v.feeValue >= 1)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['feeValue'], message: 'Доля от 0 до 1, например 0,07' });
    if (v.feeModel !== 'percent_of_claims' && (v.feeValue < 1 || !Number.isInteger(v.feeValue))) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['feeValue'], message: 'Целая сумма в UZS' });
  });
export const assistanceCreateSchema = z.object({
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
  serviceCode: text(1, 20, 'Выберите услугу'),
  icd10: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]\d{2}(\.\d{1,2})?$/, 'Код МКБ-10, например J06.9'),
  estimatedCost: z.number({ invalid_type_error: 'Укажите сумму' }).int().min(1, 'Сумма должна быть больше нуля').max(10_000_000_000),
  comment: z.string().trim().max(1000, 'Не больше 1000 символов').optional(),
  caseId: uuid.optional(),
});
export const complaintResolutionSchema = z.object({ resolution: text(5, 1000, 'Опишите решение: минимум 5 символов') });
/** An admin proposes a new value of a DMS parameter; it applies after a second person confirms. */
export const dmsParamChangeSchema = z
  .object({
    key: z.string().trim().max(60).refine(isDmsParamKey, 'Неизвестный параметр'),
    value: z.number({ invalid_type_error: 'Введите число' }),
    reason: text(5, 500, 'Опишите основание: минимум 5 символов'),
  })
  .superRefine((v, ctx) => {
    if (!isDmsParamKey(v.key)) return;
    const error = dmsParamError(v.key, v.value);
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: error });
  });
export const dmsParamRejectSchema = z.object({ reason: text(5, 500, 'Укажите причину: минимум 5 символов') });

// ---------------- contract lifecycle (LIFECYCLE_SPEC) ----------------
const shareInput = (max: number, msg: string) => z.number({ invalid_type_error: 'Введите число' }).min(0, msg).max(max, msg);
const moneyInput = z.number({ invalid_type_error: 'Укажите сумму' }).int('Целая сумма').min(0, 'Не меньше нуля').max(100_000_000_000);
export const authorityChangeSchema = z
  .object({
    authority: z.object({
      quoteDiscountMaxPct: shareInput(1, 'Скидка от 0 до 100%').optional(),
      quotePremiumMax: moneyInput.optional(),
      claimDecisionMax: moneyInput.optional(),
    }),
    signatory: z.object({ basis: text(5, 200, 'Основание: например, «Доверенность № 14 от 05.01.2026»') }).nullable(),
    reason: text(5, 500, 'Опишите основание изменения: минимум 5 символов'),
  });
export const authorityRejectSchema = z.object({ reason: text(5, 500, 'Укажите причину: минимум 5 символов') });

const innInput = z
  .string({ required_error: 'Укажите ИНН' })
  .trim()
  .transform((v) => digitsOnly(v))
  .refine((v) => /^\d{9}$/.test(v), 'ИНН — 9 цифр');
export const requisitesSchema = z.object({
  bank: text(3, 120, 'Укажите банк'),
  account: z
    .string()
    .trim()
    .transform((v) => digitsOnly(v))
    .refine((v) => /^\d{20}$/.test(v), 'Расчётный счёт — 20 цифр'),
  mfo: z
    .string()
    .trim()
    .transform((v) => digitsOnly(v))
    .refine((v) => /^\d{5}$/.test(v), 'МФО — 5 цифр'),
  director: text(5, 120, 'Укажите руководителя'),
  directorBasis: text(3, 120, 'Например, «Устав»'),
  address: z.string().trim().max(200, 'Не больше 200 символов').optional(),
});
export const leadCreateSchema = z.object({
  legalForm: z.enum(['ООО', 'АО', 'СП ООО', 'ЧП']),
  name: text(2, 120),
  inn: innInput,
  requisites: requisitesSchema,
  contactName: text(3, 120, 'Укажите контактное лицо'),
  contactPhone: phoneInput,
  contactEmail: emailInput,
  estimatedHeadcount: z.number({ invalid_type_error: 'Укажите численность' }).int().min(1, 'Не меньше 1').max(100_000),
  currentInsurer: z.string().trim().max(120, 'Не больше 120 символов').optional(),
  expectedStart: isoDateInput.optional(),
});
export const dealLostSchema = z.object({ reason: text(5, 500, 'Укажите причину: минимум 5 символов') });
export const dealPatchSchema = z.object({ expectedStart: isoDateInput.optional(), underwriterId: uuid.optional() });

export const quoteAdjustmentSchema = z.object({
  label: text(2, 80, 'Название надбавки или скидки'),
  /** Share: −0.08 = скидка 8%, 0.05 = надбавка 5%. */
  pct: z.number({ invalid_type_error: 'Укажите процент' }).min(-0.9, 'Не больше −90%').max(2, 'Не больше +200%'),
  comment: text(5, 300, 'Комментарий обязателен: минимум 5 символов'),
});
export const quoteCreateSchema = z.object({ dealId: uuid, program: programInput, adjustments: z.array(quoteAdjustmentSchema).max(10, 'Не больше 10 строк').default([]) });
export const quotePatchSchema = z.object({ program: programInput, adjustments: z.array(quoteAdjustmentSchema).max(10, 'Не больше 10 строк') });
export const quoteApproveSchema = z.object({ comment: z.string().trim().max(500).optional() });
export const quoteRejectSchema = z.object({ reason: text(5, 500, 'Укажите причину: минимум 5 символов') });
export const kpDeclineSchema = z.object({ reason: text(3, 500, 'Укажите причину') });

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
  clientSignatory: z.object({ name: text(5, 120, 'ФИО подписанта'), position: text(2, 120, 'Должность'), basis: text(3, 120, 'Основание полномочий') }),
});
export const clauseOverrideSchema = z.object({ clauseId: z.string().trim().min(1).max(10), text: text(5, 4000, 'Формулировка: минимум 5 символов') });
export const contractPatchSchema = z.object({
  params: contractParamsSchema.partial().optional(),
  clauseOverrides: z.array(clauseOverrideSchema).max(60).optional(),
});
export const legalReturnSchema = z.object({ comment: text(5, 1000, 'Комментарий для менеджера: минимум 5 символов') });
export const legalApproveSchema = z.object({ comment: z.string().trim().max(1000).optional() });
export const signSchema = z.discriminatedUnion('method', [
  z.object({ side: z.enum(['mig', 'client']), method: z.literal('eimzo'), certificateSerial: z.string().trim().regex(/^[0-9A-F]{8,20}$/, 'Серийный номер ключа'), password: text(1, 100, 'Введите пароль ключа') }),
  z.object({ side: z.literal('mig'), method: z.literal('paper') }),
]);
export const edoSendSchema = z.object({ provider: z.enum(['Didox', 'Faktura.uz', 'Soliq ЭДО'], { errorMap: () => ({ message: 'Выберите оператора ЭДО' }) }) });
export const scanVerifySchema = z.object({ side: z.enum(['mig', 'client']) });
export const originalsSchema = z
  .object({ migCopySentAt: isoDateInput.optional(), clientOriginalReceivedAt: isoDateInput.optional() })
  .refine((v) => v.migCopySentAt || v.clientOriginalReceivedAt, 'Укажите дату');
export const terminateSchema = z.object({ date: isoDateInput, reason: text(5, 500, 'Причина расторжения: минимум 5 символов') });
export const paymentSchema = z.object({
  invoiceId: uuid,
  amount: z.number({ invalid_type_error: 'Укажите сумму' }).int('Целая сумма').min(1, 'Сумма больше нуля').max(100_000_000_000),
  paidAt: isoDateInput,
  purpose: z.string().trim().max(300).optional(),
});
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
export const opinionRequestSchema = z.object({ question: z.string().trim().max(1000, 'Не больше 1000 символов').optional() });
export const opinionSchema = z.object({ text: text(10, 2000, 'Заключение: минимум 10 символов'), recommendation: z.enum(['approve', 'partial', 'reject']) });
export const claimDecideSchema = z.object({
  kind: z.enum(['approve', 'partial', 'reject']),
  amount: z.number({ invalid_type_error: 'Укажите сумму' }).int().min(0).max(100_000_000_000),
  clauseRef: z.string().trim().max(40).optional(),
  reason: z.string().trim().max(1000, 'Не больше 1000 символов').default(''),
});
export const decisionRejectSchema = z.object({ comment: text(5, 500, 'Комментарий: минимум 5 символов') });
export const reserveSchema = z.object({ amount: moneyInput, reason: text(5, 300, 'Причина изменения резерва: минимум 5 символов') });
export const flagDismissSchema = z.object({ comment: text(5, 500, 'Комментарий обязателен: минимум 5 символов') });
export const appealSchema = z.object({ text: text(10, 1000, 'Опишите, с чем вы не согласны: минимум 10 символов') });
export const appealResolveSchema = z.object({ resolution: text(5, 1000, 'Решение по апелляции: минимум 5 символов') });
export const contractCreateSchema = z.object({ dealId: uuid });
