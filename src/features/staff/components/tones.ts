import type { AppointmentStatus, ClaimStatus, ClientStatus, PolicyStatus } from '@/shared/types';
import type { Tone } from '@/shared/ui/chips';

export const CLAIM_TONE: Record<ClaimStatus, Tone> = {
  new: 'info',
  review: 'default',
  medical_review: 'warning',
  approved: 'success',
  rejected: 'danger',
  to_pay: 'accent',
  paid: 'success',
};

export const CLIENT_TONE: Record<ClientStatus, Tone> = {
  draft: 'muted',
  negotiation: 'info',
  active: 'success',
  renewal: 'warning',
  expired: 'danger',
};

export const POLICY_TONE: Record<PolicyStatus, Tone> = {
  draft: 'muted',
  active: 'success',
  expired: 'danger',
  cancelled: 'default',
};

export const APPT_TONE: Record<AppointmentStatus, Tone> = {
  requested: 'warning',
  confirmed: 'success',
  declined: 'danger',
  completed: 'default',
  cancelled: 'muted',
};
