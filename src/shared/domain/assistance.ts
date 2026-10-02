/*
 * Assistance companies (ASSISTANCE_SPEC): scope by the date of the event, payers of registry lines,
 * fees, automatic checks of rebills, limits with guarantee reserves, quality-control sampling.
 * Pure functions shared by the UI and the mock server.
 */
import type {
  AssistanceAssignment,
  AssistanceCaseStatus,
  AssistanceCaseType,
  FeeModel,
  ISODate,
  LimitCategory,
  Money,
  Payer,
  RebillCheckCode,
  RebillStatus,
  ServiceCategory,
  UUID,
} from '@/shared/types';

// ---- tunables (demo values; QA share, review terms and the authority limit are DMS parameters) ----
/** The former assistance keeps read-only access to its cases for this long after a change. */
export const FORMER_ACCESS_MONTHS = 12;
/** Case SLA by type, minutes. */
export const CASE_SLA_MINUTES: Record<AssistanceCaseType, number> = {
  emergency: 15,
  appointment: 120,
  consultation: 240,
  guarantee: 480,
  complaint: 24 * 60,
};
/** A guarantee letter is decided in time when the decision comes within this many hours. */
export const GUARANTEE_DECISION_HOURS = 24;

export const CASE_TYPE_LABEL: Record<AssistanceCaseType, string> = {
  appointment: 'Запись к врачу',
  consultation: 'Консультация',
  guarantee: 'Гарантийное письмо',
  complaint: 'Жалоба',
  emergency: 'Экстренный случай',
};
export const CASE_STATUS_LABEL: Record<AssistanceCaseStatus, string> = { open: 'Новое', in_progress: 'В работе', waiting: 'Ожидает', resolved: 'Решено' };
export const CASE_CHANNEL_LABEL = { phone: 'Звонок', chat: 'Чат', app: 'Приложение', clinic: 'Клиника' } as const;
export const FEE_MODEL_LABEL: Record<FeeModel, string> = { pepm: 'За застрахованного в месяц', percent_of_claims: 'Процент от выплат', per_case: 'За обращение' };
export const REBILL_STATUS_LABEL: Record<RebillStatus, string> = {
  draft: 'Черновик',
  submitted: 'Отправлен',
  in_review: 'На проверке',
  partially_accepted: 'Принят частично',
  accepted: 'Принят',
  paid: 'Оплачен',
};
export const REBILL_STATUS_CHIP: Record<RebillStatus, string> = { draft: 'neutral', submitted: 'sky', in_review: 'warning', partially_accepted: 'peach', accepted: 'success', paid: 'success' };
export const REBILL_CHECK_LABEL: Record<RebillCheckCode, string> = {
  not_paid_to_clinic: 'Не оплачено клинике',
  policy_inactive: 'Полис не действует',
  not_assigned: 'Не закреплён за ассистансом',
  over_limit: 'Сверх лимита',
  no_guarantee: 'Нет одобренного ГП',
  duplicate: 'Дубль',
  price_mismatch: 'Цена не по прайсу',
};

// ---- assignment on the date of the event (§3) ----
const within = (a: Pick<AssistanceAssignment, 'from' | 'to'>, date: ISODate) => a.from <= date && (!a.to || date <= a.to);

/** The assistance company of a policy on a date; null — the client is served by MIG. */
export function assistanceOn(assignments: readonly AssistanceAssignment[], policyId: UUID, date: ISODate): UUID | null {
  const a = assignments.filter((x) => x.policyId === policyId && within(x, date)).sort((x, y) => (x.from < y.from ? 1 : -1))[0];
  return a?.assistanceId ?? null;
}

export const payerOn = (assignments: readonly AssistanceAssignment[], policyId: UUID, date: ISODate): Payer => assistanceOn(assignments, policyId, date) ?? 'mig';

function addMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}

/**
 * Access of an assistance company to a record of a policy dated `eventDate` (§3, §13.1–13.2):
 * `full` — the policy is assigned to it on that date and still is;
 * `read` — it served the policy on that date, but the policy moved away less than 12 months ago;
 * `none` — anything else (the server answers 404).
 */
export function assistanceScope(
  assignments: readonly AssistanceAssignment[],
  assistanceId: UUID,
  policyId: UUID,
  eventDate: ISODate,
  today: ISODate,
): 'full' | 'read' | 'none' {
  const period = assignments.find((a) => a.policyId === policyId && a.assistanceId === assistanceId && within(a, eventDate));
  if (!period) return 'none';
  if (!period.to || period.to >= today) return 'full';
  return addMonths(period.to, FORMER_ACCESS_MONTHS) >= today ? 'read' : 'none';
}

// ---- payers of registry lines (§5.3) ----
export function splitByPayer<T extends { payer?: Payer }>(lines: readonly T[]): Map<Payer, T[]> {
  const out = new Map<Payer, T[]>();
  for (const l of lines) {
    const key = l.payer ?? 'mig';
    out.set(key, [...(out.get(key) ?? []), l]);
  }
  return out;
}

// ---- fee (§4, §5.5) ----
export interface FeeBase {
  /** Insured persons assigned to the assistance in the month (PEPM). */
  insuredCount: number;
  /** Claims included in the rebill (percent of claims). */
  claimsAmount: Money;
  /** Cases of the month (per case). */
  casesCount: number;
}

const money = (v: number) => new Intl.NumberFormat('ru-RU').format(v).replace(/[\u00a0\u202f]/g, ' ');

export function feeFor(model: FeeModel, value: number, base: FeeBase): { model: FeeModel; base: number; value: number; amount: Money; formula: string } {
  if (model === 'pepm') {
    const amount = Math.round(base.insuredCount * value);
    return { model, base: base.insuredCount, value, amount, formula: `${money(base.insuredCount)} застрахованных × ${money(value)} UZS = ${money(amount)} UZS` };
  }
  if (model === 'percent_of_claims') {
    const amount = Math.round(base.claimsAmount * value);
    return { model, base: base.claimsAmount, value, amount, formula: `${money(base.claimsAmount)} UZS × ${Math.round(value * 1000) / 10}% = ${money(amount)} UZS` };
  }
  const amount = Math.round(base.casesCount * value);
  return { model, base: base.casesCount, value, amount, formula: `${money(base.casesCount)} обращений × ${money(value)} UZS = ${money(amount)} UZS` };
}

// ---- automatic checks of a rebill line (§5.5) ----
export interface RebillLineFacts {
  /** The registry line is accepted by the assistance. */
  accepted: boolean;
  /** The line is paid to the clinic. */
  paidToClinic: boolean;
  /** The policy was active on the service date. */
  policyActive: boolean;
  /** The policy was assigned to this assistance on the service date. */
  assigned: boolean;
  /** Amount of the line and what was left of the limit before it (after earlier lines and reserves of other letters). */
  amount: Money;
  limitLeft: Money;
  /** The service requires a guarantee letter; the letter, if any, and its approved amount. */
  requiresGuarantee: boolean;
  guaranteeApproved: Money | null;
  /** The same registry line is already in another rebill (any assistance, any month). */
  duplicate: boolean;
  /** Price of the line and the price list of the pair «clinic + this assistance». */
  price: Money;
  contractPrice: Money | null;
}

export function rebillChecks(f: RebillLineFacts): { code: RebillCheckCode; message: string }[] {
  const out: { code: RebillCheckCode; message: string }[] = [];
  if (!f.accepted || !f.paidToClinic) out.push({ code: 'not_paid_to_clinic', message: f.accepted ? 'Строка принята, но оплата клинике не отмечена' : 'Строка реестра не принята ассистансом' });
  if (!f.policyActive) out.push({ code: 'policy_inactive', message: 'На дату услуги полис не действовал' });
  if (!f.assigned) out.push({ code: 'not_assigned', message: 'На дату услуги полис не был закреплён за этим ассистансом' });
  if (f.amount > f.limitLeft) out.push({ code: 'over_limit', message: `Сумма ${money(f.amount)} больше остатка лимита ${money(Math.max(0, f.limitLeft))}` });
  if (f.requiresGuarantee && f.guaranteeApproved === null) out.push({ code: 'no_guarantee', message: 'Для услуги нужно одобренное гарантийное письмо' });
  else if (f.guaranteeApproved !== null && f.amount > f.guaranteeApproved) out.push({ code: 'no_guarantee', message: `Сумма больше одобренной по ГП (${money(f.guaranteeApproved)})` });
  if (f.duplicate) out.push({ code: 'duplicate', message: 'Эта строка реестра уже есть в другом счёте' });
  if (f.contractPrice === null) out.push({ code: 'price_mismatch', message: 'Услуги нет в прайсе пары «клиника + ассистанс»' });
  else if (f.price > f.contractPrice) out.push({ code: 'price_mismatch', message: `Цена ${money(f.price)} выше прайса ${money(f.contractPrice)}` });
  return out;
}

// ---- limits with reserves (§5.2, §5.3) ----
/** Which limit a clinic service uses. */
export const LIMIT_OF_SERVICE: Record<ServiceCategory, LimitCategory> = {
  outpatient: 'outpatient',
  diagnostics_advanced: 'outpatient',
  dental: 'dental',
  medicines: 'medicines',
  inpatient: 'inpatient',
};

export function limitLeft(limit: Money, used: Money, reserved = 0): Money {
  return Math.max(0, limit - used - reserved);
}

// ---- quality control (§5.6) ----
/** FNV-1a: deterministic and cheap, enough for sampling. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Deterministic monthly sample: the same decision is in or out of the sample for a given month. */
/** `share`: DMS parameter `qaSampleShare`. */
export function inQaSample(decisionId: UUID, month: string, share: number): boolean {
  return hash(`${month}:${decisionId}`) % 10_000 < Math.round(share * 10_000);
}

export function qaSample<T extends { id: UUID }>(decisions: readonly T[], month: string, share: number): T[] {
  return decisions.filter((d) => inQaSample(d.id, month, share));
}

// ---- SLA (§6) ----
export function slaState(dueAt: string, now: number, done = false): 'ok' | 'soon' | 'overdue' {
  if (done) return 'ok';
  const left = Date.parse(dueAt) - now;
  if (left < 0) return 'overdue';
  return left < 30 * 60_000 ? 'soon' : 'ok';
}

export function needsEscalation(amount: Money, authorityLimit: Money): boolean {
  return amount > authorityLimit;
}
