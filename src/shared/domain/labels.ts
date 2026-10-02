import type {
  AppointmentStatus,
  AuditAction,
  ClientStatus,
  LimitCategory,
  PolicyStatus,
  ProgramCode,
  Role,
  Specialty,
} from '@/shared/types';

export const ROLE_LABEL: Record<Role, string> = {
  operator: 'Куратор ДМС',
  underwriter: 'Андеррайтер',
  doctor_expert: 'Врач-эксперт',
  accountant: 'Бухгалтер',
  admin: 'Администратор',
  sales_manager: 'Менеджер по продажам',
  legal: 'Юрист',
  claims_officer: 'Специалист по убыткам',
  hr: 'HR клиента',
  insured: 'Застрахованный',
  clinic_registrar: 'Регистратор клиники',
  clinic_admin: 'Администратор клиники',
  asst_operator: 'Оператор ассистанса',
  asst_doctor: 'Врач ассистанса',
  asst_billing: 'Финансист ассистанса',
  asst_admin: 'Администратор ассистанса',
};

export const PROGRAM_LABEL: Record<ProgramCode, string> = {
  basic: 'Базовая',
  standard: 'Стандарт',
  standard_plus: 'Стандарт+',
  premium: 'Премиум',
};

export const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = {
  lead: 'Лид',
  draft: 'Черновик',
  negotiation: 'Переговоры',
  active: 'Активен',
  renewal: 'Продление',
  expired: 'Истёк',
};

export const POLICY_STATUS_LABEL: Record<PolicyStatus, string> = {
  draft: 'Черновик',
  active: 'Действует',
  expired: 'Истёк',
  cancelled: 'Расторгнут',
};

export const LIMIT_CATEGORY_LABEL: Record<LimitCategory, string> = {
  outpatient: 'Амбулаторно',
  dental: 'Стоматология',
  medicines: 'Лекарства',
  inpatient: 'Стационар',
};

export const SPECIALTY_LABEL: Record<Specialty, string> = {
  therapist: 'Терапевт',
  pediatrician: 'Педиатр',
  dentist: 'Стоматолог',
  cardiologist: 'Кардиолог',
  gynecologist: 'Гинеколог',
  ent: 'ЛОР',
  neurologist: 'Невролог',
  ophthalmologist: 'Офтальмолог',
};

export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  requested: 'Ожидает подтверждения',
  confirmed: 'Подтверждена',
  declined: 'Отклонена',
  completed: 'Состоялась',
  cancelled: 'Отменена',
};

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  login: 'Вход',
  logout: 'Выход',
  login_failed: 'Неудачный вход',
  reveal_pii: 'Просмотр ПДн',
  open_medical: 'Доступ к медкарте',
  limit_change_request: 'Запрос изменения лимита',
  limit_change_approve: 'Подтверждение лимита',
  limit_change_reject: 'Отклонение лимита',
  claim_transition: 'Смена статуса убытка',
  export: 'Выгрузка',
  role_change: 'Смена роли',
  user_deactivate: 'Деактивация пользователя',
  hr_add_employee: 'HR: добавлен сотрудник',
  hr_exclude_employee: 'HR: исключён сотрудник',
  hr_import: 'HR: импорт списка',
  kp_created: 'КП создано',
  kp_sent: 'КП отправлено клиенту',
  kp_revoked: 'КП отозвано',
  kp_downloaded: 'КП скачано',
  clinic_check_patient: 'Клиника: проверка пациента',
  clinic_check_failed: 'Клиника: неудачная проверка',
  guarantee_requested: 'Запрошено гарантийное письмо',
  guarantee_decided: 'Решение по гарантийному письму',
  registry_submitted: 'Отправлен реестр клиники',
  registry_line_decided: 'Решение по строке реестра',
  registry_paid: 'Реестр оплачен',
  integration_key_created: 'Создан ключ API клиники',
  integration_key_revoked: 'Отозван ключ API клиники',
  webhook_created: 'Создан вебхук клиники',
  policy_issued: 'Оформлен полис',
  policy_change_requested: 'HR: заявка на изменение состава',
  policy_change_decided: 'Решение по изменению состава',
  assistance_assigned: 'Назначен ассистанс',
  case_created: 'Ассистанс: обращение',
  guarantee_escalated: 'Ассистанс: эскалация ГП',
  clinic_payment_recorded: 'Ассистанс: оплата клинике',
  rebill_submitted: 'Ассистанс: счёт МИГ отправлен',
  rebill_line_decided: 'Решение по строке счёта ассистанса',
  rebill_paid: 'Счёт ассистанса оплачен',
  qa_reviewed: 'Контроль качества',
  complaint_resolved: 'Жалоба закрыта МИГ',
  dms_param_proposed: 'Предложено изменение параметра ДМС',
  dms_param_changed: 'Параметр ДМС изменён',
  dms_param_rejected: 'Изменение параметра ДМС отклонено',
  authority_proposed: 'Предложено изменение полномочий',
  authority_changed: 'Полномочия сотрудника изменены',
  authority_rejected: 'Изменение полномочий отклонено',
  lead_created: 'Создан лид',
  deal_stage_changed: 'Этап сделки',
  deal_lost: 'Сделка проиграна',
  census_uploaded: 'Загружены данные для оценки',
  quote_saved: 'Котировка сохранена',
  quote_submitted: 'Котировка на утверждение',
  quote_approved: 'Котировка утверждена',
  quote_rejected: 'Котировка отклонена',
  kp_accepted: 'КП принято клиентом',
  kp_declined: 'КП отклонено клиентом',
  contract_created: 'Договор создан',
  contract_updated: 'Договор изменён',
  contract_legal_submitted: 'Договор на согласовании юриста',
  contract_legal_approved: 'Юрист согласовал',
  contract_legal_returned: 'Юрист вернул на доработку',
  contract_finance_approved: 'Финансовые условия утверждены',
  contract_sent: 'Документ отправлен клиенту',
  contract_signed: 'Подпись стороны',
  contract_scan_uploaded: 'Загружен скан',
  contract_scan_verified: 'Скан проверен',
  contract_original: 'Отметка об оригинале',
  contract_activated: 'Договор вступил в силу',
  contract_terminated: 'Договор расторгнут',
  payment_recorded: 'Оплата отмечена',
  payments_imported: 'Выписка из 1С загружена',
  payment_allocated: 'Платёж разнесён вручную',
  change_request_created: 'Заявка на изменение',
  endorsement_created: 'Сформировано доп. соглашение',
  endorsement_signed: 'Доп. соглашение подписано',
  claim_opinion_requested: 'Запрошено заключение врача',
  claim_opinion_given: 'Заключение врача',
  claim_decided: 'Решение по убытку',
  claim_decision_escalated: 'Решение передано на согласование',
  claim_decision_rejected: 'Согласование решения отклонено',
  claim_reserve_changed: 'Изменён резерв',
  claim_flag_dismissed: 'Снят флаг мошенничества',
  claim_appealed: 'Апелляция по убытку',
  claim_appeal_resolved: 'Апелляция рассмотрена',
  ai_settings_proposed: 'Предложено изменение настроек ИИ',
  ai_settings_changed: 'Настройки ИИ изменены',
  ai_settings_rejected: 'Изменение настроек ИИ отклонено',
  ai_kill_switch: 'ИИ отключён везде',
  ai_feedback: 'Оценка подсказки ИИ',
};

export const STAFF_ROLES = ['operator', 'underwriter', 'doctor_expert', 'accountant', 'admin', 'sales_manager', 'legal', 'claims_officer'] as const;
export const CLINIC_ROLES = ['clinic_registrar', 'clinic_admin'] as const;
export const ASSISTANCE_ROLES = ['asst_operator', 'asst_doctor', 'asst_billing', 'asst_admin'] as const;
export function isAssistRole(role: Role): role is (typeof ASSISTANCE_ROLES)[number] {
  return (ASSISTANCE_ROLES as readonly string[]).includes(role);
}
export function isClinicRole(role: Role): role is (typeof CLINIC_ROLES)[number] {
  return (CLINIC_ROLES as readonly string[]).includes(role);
}

export function isStaffRole(role: Role): role is (typeof STAFF_ROLES)[number] {
  return (STAFF_ROLES as readonly string[]).includes(role);
}
