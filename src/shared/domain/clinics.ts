/* Clinic business rules (CLINIC_SPEC) shared by the UI and the mock server. */
import type {
  CoverageStatus,
  GuaranteeLetter,
  GuaranteeStatus,
  IntegrationMode,
  IntegrationScope,
  LimitState,
  Money,
  PriceListItem,
  ProgramCode,
  Registry,
  RegistryLine,
  RegistryLineStatus,
  RegistryStatus,
  ServiceCategory,
  UUID,
  WebhookEvent,
} from '@/shared/types';

// ---- tunables (demo values) ----
// Business thresholds (dual approval, response SLA, check limits) are DMS parameters:
// src/shared/config/dmsParameters.ts. The values here are technical.
export const VISIT_TTL_MS = 24 * 3600_000;
export const CARD_TOKEN_TTL_MS = 60_000;
export const API_RATE_PER_MINUTE = 60;
export const ACCESS_TOKEN_TTL_SEC = 15 * 60;
export const IDEMPOTENCY_TTL_MS = 24 * 3600_000;
/** Retry schedule after a failed delivery: 1, 5, 30 minutes, 2 and 12 hours, then `failed`. */
export const WEBHOOK_RETRY_MINUTES = [1, 5, 30, 120, 720] as const;
export const REGISTRY_CSV_MAX_ROWS = 5000;
export const REGISTRY_CSV_MAX_BYTES = 5 * 1024 * 1024;
export const GUARANTEE_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const CARD_QR_PREFIX = 'MIG-DMS:';

// ---- labels ----
export const SERVICE_CATEGORY_LABEL: Record<ServiceCategory, string> = {
  outpatient: 'Амбулаторно',
  dental: 'Стоматология',
  medicines: 'Лекарства',
  inpatient: 'Стационар',
  diagnostics_advanced: 'Сложная диагностика (МРТ, КТ)',
};
export const COVERAGE_LABEL: Record<CoverageStatus, string> = {
  covered: 'Покрывается',
  needs_guarantee: 'Нужно гарантийное письмо',
  not_covered: 'Не покрывается',
};
export const LIMIT_STATE_LABEL: Record<LimitState, string> = { available: 'Доступен', low: 'На исходе', exhausted: 'Исчерпан' };
export const GUARANTEE_STATUS_LABEL: Record<GuaranteeStatus, string> = {
  requested: 'Запрошено',
  info_requested: 'Нужны документы',
  approved: 'Одобрено',
  rejected: 'Отклонено',
  used: 'Использовано',
  expired: 'Истекло',
};
export const GUARANTEE_STATUS_CHIP: Record<GuaranteeStatus, string> = {
  requested: 'sky',
  info_requested: 'warning',
  approved: 'success',
  rejected: 'danger',
  used: 'neutral',
  expired: 'neutral',
};
export const REGISTRY_STATUS_LABEL: Record<RegistryStatus, string> = {
  draft: 'Черновик',
  submitted: 'Отправлен',
  in_review: 'На проверке',
  partially_accepted: 'Принят частично',
  accepted: 'Принят',
  paid: 'Оплачен',
};
export const REGISTRY_STATUS_CHIP: Record<RegistryStatus, string> = {
  draft: 'neutral',
  submitted: 'sky',
  in_review: 'warning',
  partially_accepted: 'peach',
  accepted: 'success',
  paid: 'success',
};
export const REGISTRY_LINE_STATUS_LABEL: Record<RegistryLineStatus, string> = {
  pending: 'Ожидает проверки',
  accepted: 'Принята',
  rejected: 'Отклонена',
  disputed: 'Оспорена',
};
export const INTEGRATION_MODE_LABEL: Record<IntegrationMode, string> = { portal: 'Только кабинет', api: 'API', hybrid: 'API и кабинет' };
export const SCOPE_LABEL: Record<IntegrationScope, string> = {
  'coverage:check': 'Проверка покрытия',
  'appointments:read': 'Записи: чтение',
  'appointments:write': 'Записи: ответы',
  'slots:write': 'Расписание',
  'guarantees:read': 'ГП: чтение',
  'guarantees:write': 'ГП: запросы',
  'registries:read': 'Реестры: чтение',
  'registries:write': 'Реестры: отправка',
  'payments:read': 'Оплаты',
  'roster:read': 'Список застрахованных',
  'cases:write': 'Обращения',
  'guarantees:decide': 'ГП: решения',
  'registries:review': 'Реестры: проверка',
  'payments:write': 'Оплаты клиникам',
  'rebills:write': 'Счета МИГ',
};
export const WEBHOOK_EVENT_LABEL: Record<WebhookEvent, string> = {
  'appointment.requested': 'Новая заявка на запись',
  'appointment.cancelled': 'Запись отменена',
  'guarantee.decided': 'Решение по ГП',
  'guarantee.documents_requested': 'По ГП нужны документы',
  'registry.reviewed': 'Реестр проверен',
  'registry.paid': 'Реестр оплачен',
  'insured.added': 'Застрахованный добавлен',
  'insured.excluded': 'Застрахованный исключён',
  'policy.assigned': 'Полис закреплён',
  'policy.unassigned': 'Полис откреплён',
  'guarantee.requested': 'Запрос ГП',
  'registry.received': 'Получен реестр клиники',
  'rebill.reviewed': 'Счёт МИГ проверен',
  'rebill.paid': 'Счёт МИГ оплачен',
  'qa.disagreement': 'Расхождение контроля качества',
};

// ---- coverage ----
export const SERVICE_CATEGORIES: ServiceCategory[] = ['outpatient', 'diagnostics_advanced', 'dental', 'medicines', 'inpatient'];

/** Programme rules: inpatient and advanced diagnostics need a guarantee letter; the basic programme has no dental. */
export function coverageStatus(program: ProgramCode, category: ServiceCategory): CoverageStatus {
  if (category === 'dental' && program === 'basic') return 'not_covered';
  if (category === 'inpatient' || category === 'diagnostics_advanced') return 'needs_guarantee';
  return 'covered';
}

/** `low` when no more than `lowShare` of the limit is left (DMS parameter `limitLowShare`). Amounts themselves are never shown to the clinic. */
export function limitState(limit: Money, used: Money, lowShare: number): LimitState {
  if (limit <= 0 || used >= limit) return 'exhausted';
  return (limit - used) / limit <= lowShare ? 'low' : 'available';
}

// ---- one-time card code ----
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

export function formatShortCode(code8: string): string {
  return `${code8.slice(0, 4)}-${code8.slice(4, 8)}`;
}

/** Accepts `K7P4-QX2M`, `k7p4qx2m`, `MIG-DMS:<token>` or the raw token; returns what to look up. */
export function parseCardInput(raw: string): { kind: 'short'; code: string } | { kind: 'token'; token: string } | null {
  const v = raw.trim();
  if (v.toUpperCase().startsWith(CARD_QR_PREFIX)) {
    const token = v.slice(CARD_QR_PREFIX.length).trim();
    return /^[A-Za-z0-9_-]{16,128}$/.test(token) ? { kind: 'token', token } : null;
  }
  const compact = v.replace(/[\s-]/g, '').toUpperCase();
  if (compact.length === 8 && [...compact].every((c) => CODE_ALPHABET.includes(c))) return { kind: 'short', code: compact };
  if (/^[A-Za-z0-9_-]{16,128}$/.test(v)) return { kind: 'token', token: v };
  return null;
}

export function shortCodeFrom(randomBytes: Uint8Array): string {
  return [...randomBytes.slice(0, 8)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

// ---- guarantees ----
/** Letters above `threshold` (DMS parameter `guaranteeDualApprovalThreshold`) need a second doctor_expert (four-eyes). */
export function needsSecondApproval(amount: Money, threshold: Money): boolean {
  return amount > threshold;
}

/**
 * What an approval by `doctorId` does to a letter: completes it, records the first of two approvals,
 * or is refused because the same doctor already approved (four-eyes).
 */
export function approvalOutcome(g: Pick<GuaranteeLetter, 'approvals'>, amount: Money, doctorId: UUID, threshold: Money): 'approved' | 'first_of_two' | 'same_doctor' {
  if (g.approvals.some((a) => a.byId === doctorId)) return 'same_doctor';
  if (!needsSecondApproval(amount, threshold)) return 'approved';
  return g.approvals.length >= 1 ? 'approved' : 'first_of_two';
}

// ---- registries ----
export interface LineCheckContext {
  priceItem?: PriceListItem;
  /** Approved/used guarantee with this number for the same visit, if any. */
  guarantee?: Pick<GuaranteeLetter, 'status' | 'approvedAmount' | 'visitId' | 'serviceCode'> | null;
  policyFrom?: string;
  policyTo?: string;
  visitFrom?: string; // ISO date of the visit opening
  visitTo?: string; // ISO date of the visit expiry
}

/** Pre-submit checks of a registry line (CLINIC_SPEC §4.5). Returns human-readable problems. */
export function registryLineProblems(
  line: Pick<RegistryLine, 'serviceDate' | 'price' | 'guaranteeNumber' | 'visitId' | 'quantity'>,
  ctx: LineCheckContext,
): string[] {
  const out: string[] = [];
  if (!ctx.priceItem) out.push('Услуги нет в прайсе договора');
  else if (line.price > ctx.priceItem.price) out.push(`Цена выше прайса договора (${ctx.priceItem.price})`);
  if (ctx.priceItem?.requiresGuarantee) {
    if (!line.guaranteeNumber) out.push('Для услуги нужен номер гарантийного письма');
    else if (!ctx.guarantee || (ctx.guarantee.status !== 'approved' && ctx.guarantee.status !== 'used')) out.push('Гарантийное письмо не найдено или не одобрено');
    else if (ctx.guarantee.visitId !== line.visitId) out.push('Гарантийное письмо выдано по другому визиту');
  }
  if (!line.visitId) out.push('Не указан визит');
  if (ctx.policyFrom && ctx.policyTo && (line.serviceDate < ctx.policyFrom || line.serviceDate > ctx.policyTo)) out.push('Дата услуги вне срока действия полиса');
  if (ctx.visitFrom && ctx.visitTo && (line.serviceDate < ctx.visitFrom || line.serviceDate > ctx.visitTo)) out.push('Дата услуги вне срока визита');
  return out;
}

export function registryTotals(lines: RegistryLine[], paid: boolean): Registry['totals'] {
  const sum = (f: (l: RegistryLine) => boolean) => lines.filter(f).reduce((s, l) => s + l.amount, 0);
  const accepted = sum((l) => l.status === 'accepted');
  return { claimed: sum(() => true), accepted, rejected: sum((l) => l.status === 'rejected'), paid: paid ? accepted : 0 };
}

/** Registry status once lines are being reviewed. */
export function registryStatusAfterReview(lines: RegistryLine[]): RegistryStatus {
  // A disputed line waits for the operator's answer but does not reopen the whole registry.
  if (lines.some((l) => l.status === 'pending')) return 'in_review';
  if (lines.every((l) => l.status === 'accepted')) return 'accepted';
  return 'partially_accepted';
}

/** Guarantee-letter number: 'ГП-2026-000321'. */
export function guaranteeNumber(year: number, seq: number): string {
  return `ГП-${year}-${String(seq).padStart(6, '0')}`;
}
