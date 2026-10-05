/* Claim business rules shared by UI and mock server (SPEC §4). */
import { defineLabels, msg } from '@/i18n';
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

/** Message keys (tm() shows them); the server returns them as the 409 reason. */
export const MEDICAL_REVIEW_HINT = msg('dom.claims.medicalReview');
export const FOUR_EYES_PAY_HINT = msg('dom.claims.fourEyesPay');

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

export const CLAIM_STATUS_LABEL = defineLabels<ClaimStatus>('labels.claimStatus', ['new', 'review', 'medical_review', 'approved', 'rejected', 'to_pay', 'paid']);

export const TRANSITION_LABEL = defineLabels<ClaimStatus>('labels.claimTransition', ['new', 'review', 'medical_review', 'approved', 'rejected', 'to_pay', 'paid']);

export const TRANSITION_TOAST = defineLabels<ClaimStatus>('labels.claimTransitionToast', ['new', 'review', 'medical_review', 'approved', 'rejected', 'to_pay', 'paid']);

export const CLAIM_CATEGORY_LABEL = defineLabels<ClaimCategory>('labels.claimCategory', ['medicines', 'doctor_visit', 'diagnostics', 'dental', 'inpatient']);
