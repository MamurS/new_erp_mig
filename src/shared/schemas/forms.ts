/*
 * Form schemas. The same schemas validate request bodies in the mock server (CLAUDE.md rule 8).
 * Every string is trimmed and length-limited; inputs are normalised (phones, dates, digits).
 */
import { z } from 'zod';
import { claimCategory, claimStatus, limitCategory, specialty, staffRole } from '@/shared/api/schemas';
import { todayISO } from '@/shared/lib/format';
import { digitsOnly, parseRuDate } from '@/shared/lib/masks';

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
