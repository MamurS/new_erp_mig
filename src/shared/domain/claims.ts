/* Claim business rules shared by UI and mock server (SPEC §4). */
import { roleTransitionsFrom } from '@/shared/auth/permissions';
import type { Claim, ClaimCategory, ClaimStatus, LimitCategory, MyClaim, SessionUser } from '@/shared/types';

export const MEDICAL_REVIEW_AMOUNT = 5_000_000;

export function requiresMedicalReview(claim: Pick<Claim, 'category' | 'amountClaimed'>): boolean {
  return claim.category === 'dental' || claim.category === 'inpatient' || claim.amountClaimed > MEDICAL_REVIEW_AMOUNT;
}

export const CLAIM_TO_LIMIT: Record<ClaimCategory, LimitCategory> = {
  medicines: 'medicines',
  doctor_visit: 'outpatient',
  diagnostics: 'outpatient',
  dental: 'dental',
  inpatient: 'inpatient',
};

export const MEDICAL_REVIEW_HINT =
  'Нужна медэкспертиза: стоматология, стационар или сумма больше 5 000 000 UZS. Сначала передайте убыток врачу-эксперту.';
export const FOUR_EYES_PAY_HINT = 'Оплату проводит другой сотрудник: вы одобряли этот убыток.';

export interface TransitionCheck {
  allowed: ClaimStatus[];
  blocked: { to: ClaimStatus; reason: string }[];
}

export function claimTransitions(
  user: Pick<SessionUser, 'id' | 'role'>,
  claim: Pick<Claim, 'status' | 'category' | 'amountClaimed' | 'approvedById'>,
): TransitionCheck {
  const candidates = roleTransitionsFrom(user.role, claim.status);
  const allowed: ClaimStatus[] = [];
  const blocked: { to: ClaimStatus; reason: string }[] = [];
  for (const to of candidates) {
    if (claim.status === 'review' && to === 'approved' && requiresMedicalReview(claim)) {
      blocked.push({ to, reason: MEDICAL_REVIEW_HINT });
    } else if (to === 'paid' && claim.approvedById && claim.approvedById === user.id) {
      blocked.push({ to, reason: FOUR_EYES_PAY_HINT });
    } else {
      allowed.push(to);
    }
  }
  return { allowed, blocked };
}

export function toMyClaimStatus(status: ClaimStatus): MyClaim['status'] {
  switch (status) {
    case 'new':
      return 'received';
    case 'review':
    case 'medical_review':
      return 'checking';
    case 'approved':
    case 'to_pay':
      return 'approved';
    case 'rejected':
      return 'rejected';
    case 'paid':
      return 'paid';
  }
}

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  new: 'Новый',
  review: 'На проверке',
  medical_review: 'Медэкспертиза',
  approved: 'Одобрен',
  rejected: 'Отклонён',
  to_pay: 'К оплате',
  paid: 'Оплачен',
};

export const TRANSITION_LABEL: Record<ClaimStatus, string> = {
  new: 'Вернуть в новые',
  review: 'Взять в работу',
  medical_review: 'Передать на медэкспертизу',
  approved: 'Одобрить',
  rejected: 'Отклонить',
  to_pay: 'Передать к оплате',
  paid: 'Отметить оплату',
};

export const TRANSITION_TOAST: Record<ClaimStatus, string> = {
  new: 'Убыток возвращён',
  review: 'Убыток взят в работу',
  medical_review: 'Убыток передан на медэкспертизу',
  approved: 'Убыток одобрен',
  rejected: 'Убыток отклонён',
  to_pay: 'Убыток передан к оплате',
  paid: 'Оплата отмечена',
};

export const CLAIM_CATEGORY_LABEL: Record<ClaimCategory, string> = {
  medicines: 'Лекарства',
  doctor_visit: 'Приём врача',
  diagnostics: 'Анализы и диагностика',
  dental: 'Стоматология',
  inpatient: 'Стационар',
};
