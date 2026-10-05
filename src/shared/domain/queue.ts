/*
 * The staff work queue: what each item type is called and which rights a role needs to see it.
 * The mock server drops every item the role has no rights for; the dashboard builds its tabs from
 * the same table, so a tab never shows up without the right behind it.
 */
import { tKey } from '@/i18n';
import type { QueueType } from '@/shared/types/dto';
import { can, type Action, type MinimalUser, type PermissionContext } from '@/shared/auth/permissions';

export const QUEUE_TYPES = [
  'appointment',
  'clinic_no_response',
  'claim',
  'renewal',
  'guarantee',
  'escalation',
  'registry',
  'policy_change',
  'rebill',
  'assistance_sla',
  'complaint',
  'deal',
  'quote',
  'contract',
  'endorsement',
  'invoice',
  'appeal',
  'lead',
  'kp',
  'limit_request',
  'loss_ratio',
  'fraud_flag',
  'opinion',
  'qa_sample',
  'bank_payment',
  'payout',
  'scan',
  'param_change',
  'authority_change',
  'ai_change',
  'integration_error',
] as const satisfies readonly QueueType[];

type Right = { action: Action; ctx?: PermissionContext };

export interface QueueTypeMeta {
  /** Chip in the «Тип» column. */
  label: string;
  /** Tab of the queue. */
  tab: string;
  chip: string;
  /** Any of these rights lets the role see items of this type. */
  rights: Right[];
}

/** Label and tab are read in the current language (labels.queue.*, labels.queueTab.*). */
function meta(type: QueueType, chip: string, rights: Right[]): QueueTypeMeta {
  return {
    get label() {
      return tKey(`labels.queue.${type}`);
    },
    get tab() {
      return tKey(`labels.queueTab.${type}`);
    },
    chip,
    rights,
  };
}

export const QUEUE_TYPE_META: Record<QueueType, QueueTypeMeta> = {
  appointment: meta('appointment', 'appointment', [{ action: 'appointments.manage' }]),
  clinic_no_response: meta('clinic_no_response', 'danger', [{ action: 'appointments.manage' }]),
  claim: meta('claim', 'claim', [{ action: 'claims.read' }]),
  renewal: meta('renewal', 'renewal', [{ action: 'kp.create' }]),
  guarantee: meta('guarantee', 'sky', [{ action: 'guarantees.decide' }]),
  escalation: meta('escalation', 'warning', [{ action: 'guarantees.decide' }]),
  registry: meta('registry', 'peach', [{ action: 'registries.review' }, { action: 'registries.pay' }]),
  policy_change: meta('policy_change', 'accent', [{ action: 'policy_changes.decide' }]),
  rebill: meta('rebill', 'peach', [{ action: 'rebills.review' }, { action: 'rebills.pay' }]),
  assistance_sla: meta('assistance_sla', 'danger', [{ action: 'assist.cases.manage', ctx: { sub: 'complaint' } }]),
  complaint: meta('complaint', 'danger', [{ action: 'assist.cases.manage', ctx: { sub: 'complaint' } }]),
  deal: meta('deal', 'accent', [{ action: 'deals.manage' }]),
  quote: meta('quote', 'warning', [{ action: 'quotes.approve' }, { action: 'quotes.calculate' }]),
  contract: meta('contract', 'sky', [{ action: 'contracts.legal_approve' }, { action: 'quotes.approve' }, { action: 'deals.manage' }]),
  endorsement: meta('endorsement', 'sky', [{ action: 'contracts.legal_approve' }, { action: 'quotes.approve' }]),
  invoice: meta('invoice', 'peach', [{ action: 'payments.record' }, { action: 'deals.manage' }]),
  appeal: meta('appeal', 'danger', [{ action: 'claims.decide' }]),
  lead: meta('lead', 'accent', [{ action: 'leads.manage' }]),
  kp: meta('kp', 'warning', [{ action: 'deals.manage' }]),
  limit_request: meta('limit_request', 'sun', [{ action: 'limits.approve_change' }]),
  loss_ratio: meta('loss_ratio', 'danger', [{ action: 'quotes.approve' }]),
  fraud_flag: meta('fraud_flag', 'danger', [{ action: 'claims.decide' }]),
  opinion: meta('opinion', 'claim', [{ action: 'claims.medical_opinion' }]),
  qa_sample: meta('qa_sample', 'sky', [{ action: 'qa.review' }]),
  bank_payment: meta('bank_payment', 'warning', [{ action: 'payments.record' }]),
  payout: meta('payout', 'success', [{ action: 'registries.pay' }]),
  scan: meta('scan', 'sky', [{ action: 'contracts.verify_scan' }]),
  param_change: meta('param_change', 'accent', [{ action: 'dms_params.approve' }]),
  authority_change: meta('authority_change', 'warning', [{ action: 'staff.authority.manage' }]),
  ai_change: meta('ai_change', 'sky', [{ action: 'ai.admin' }]),
  integration_error: meta('integration_error', 'danger', [{ action: 'audit.read' }]),
};

/** Whether items of this type may be shown to the user at all (the server checks each item). */
export function canSeeQueueType(user: MinimalUser | null | undefined, type: QueueType): boolean {
  return QUEUE_TYPE_META[type].rights.some((r) => can(user, r.action, r.ctx));
}
