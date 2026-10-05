/*
 * The staff work queue: what each item type is called and which rights a role needs to see it.
 * The mock server drops every item the role has no rights for; the dashboard builds its tabs from
 * the same table, so a tab never shows up without the right behind it.
 */
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

export const QUEUE_TYPE_META: Record<QueueType, QueueTypeMeta> = {
  appointment: { label: 'Запись', tab: 'Записи', chip: 'appointment', rights: [{ action: 'appointments.manage' }] },
  clinic_no_response: { label: 'Клиника не ответила', tab: 'Клиника не ответила', chip: 'danger', rights: [{ action: 'appointments.manage' }] },
  claim: { label: 'Убыток', tab: 'Убытки', chip: 'claim', rights: [{ action: 'claims.read' }] },
  renewal: { label: 'Продление', tab: 'Продления', chip: 'renewal', rights: [{ action: 'kp.create' }] },
  guarantee: { label: 'ГП', tab: 'ГП', chip: 'sky', rights: [{ action: 'guarantees.decide' }] },
  escalation: { label: 'Эскалация ГП', tab: 'Эскалации ГП', chip: 'warning', rights: [{ action: 'guarantees.decide' }] },
  registry: { label: 'Реестр', tab: 'Реестры', chip: 'peach', rights: [{ action: 'registries.review' }, { action: 'registries.pay' }] },
  policy_change: { label: 'Состав полиса', tab: 'Состав', chip: 'accent', rights: [{ action: 'policy_changes.decide' }] },
  rebill: { label: 'Счёт ассистанса', tab: 'Счета ассистансов', chip: 'peach', rights: [{ action: 'rebills.review' }, { action: 'rebills.pay' }] },
  assistance_sla: { label: 'SLA ассистанса нарушен', tab: 'SLA ассистансов', chip: 'danger', rights: [{ action: 'assist.cases.manage', ctx: { sub: 'complaint' } }] },
  complaint: { label: 'Жалоба', tab: 'Жалобы', chip: 'danger', rights: [{ action: 'assist.cases.manage', ctx: { sub: 'complaint' } }] },
  deal: { label: 'Сделка', tab: 'Сделки', chip: 'accent', rights: [{ action: 'deals.manage' }] },
  quote: { label: 'Котировка', tab: 'Котировки', chip: 'warning', rights: [{ action: 'quotes.approve' }, { action: 'quotes.calculate' }] },
  contract: { label: 'Договор', tab: 'Договоры', chip: 'sky', rights: [{ action: 'contracts.legal_approve' }, { action: 'quotes.approve' }, { action: 'deals.manage' }] },
  endorsement: { label: 'Доп. соглашение', tab: 'Доп. соглашения', chip: 'sky', rights: [{ action: 'contracts.legal_approve' }, { action: 'quotes.approve' }] },
  invoice: { label: 'Взнос', tab: 'Взносы', chip: 'peach', rights: [{ action: 'payments.record' }, { action: 'deals.manage' }] },
  appeal: { label: 'Апелляция', tab: 'Апелляции', chip: 'danger', rights: [{ action: 'claims.decide' }] },
  lead: { label: 'Лид', tab: 'Лиды', chip: 'accent', rights: [{ action: 'leads.manage' }] },
  kp: { label: 'КП без ответа', tab: 'КП', chip: 'warning', rights: [{ action: 'deals.manage' }] },
  limit_request: { label: 'Изменение лимита', tab: 'Лимиты', chip: 'sun', rights: [{ action: 'limits.approve_change' }] },
  loss_ratio: { label: 'Убыточность', tab: 'Убыточность', chip: 'danger', rights: [{ action: 'quotes.approve' }] },
  fraud_flag: { label: 'Флаг проверки', tab: 'Флаги', chip: 'danger', rights: [{ action: 'claims.decide' }] },
  opinion: { label: 'Заключение', tab: 'Заключения', chip: 'claim', rights: [{ action: 'claims.medical_opinion' }] },
  qa_sample: { label: 'Контрольная выборка', tab: 'Выборка', chip: 'sky', rights: [{ action: 'qa.review' }] },
  bank_payment: { label: 'Ручная разноска', tab: 'Разноска', chip: 'warning', rights: [{ action: 'payments.record' }] },
  payout: { label: 'Выплата', tab: 'Выплаты', chip: 'success', rights: [{ action: 'registries.pay' }] },
  scan: { label: 'Скан на проверке', tab: 'Сканы', chip: 'sky', rights: [{ action: 'contracts.verify_scan' }] },
  param_change: { label: 'Параметр ДМС', tab: 'Параметры', chip: 'accent', rights: [{ action: 'dms_params.approve' }] },
  authority_change: { label: 'Полномочия', tab: 'Полномочия', chip: 'warning', rights: [{ action: 'staff.authority.manage' }] },
  ai_change: { label: 'Настройки ИИ', tab: 'ИИ', chip: 'sky', rights: [{ action: 'ai.admin' }] },
  integration_error: { label: 'Ошибка интеграции', tab: 'Интеграции', chip: 'danger', rights: [{ action: 'audit.read' }] },
};

/** Whether items of this type may be shown to the user at all (the server checks each item). */
export function canSeeQueueType(user: MinimalUser | null | undefined, type: QueueType): boolean {
  return QUEUE_TYPE_META[type].rights.some((r) => can(user, r.action, r.ctx));
}
