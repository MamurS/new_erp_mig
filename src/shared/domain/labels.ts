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
  operator: 'Оператор ДМС',
  underwriter: 'Андеррайтер',
  doctor_expert: 'Врач-эксперт',
  accountant: 'Бухгалтер',
  admin: 'Администратор',
  hr: 'HR клиента',
  insured: 'Застрахованный',
};

export const PROGRAM_LABEL: Record<ProgramCode, string> = {
  basic: 'Базовая',
  standard: 'Стандарт',
  standard_plus: 'Стандарт+',
  premium: 'Премиум',
};

export const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = {
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
};

export const STAFF_ROLES = ['operator', 'underwriter', 'doctor_expert', 'accountant', 'admin'] as const;
export function isStaffRole(role: Role): role is (typeof STAFF_ROLES)[number] {
  return (STAFF_ROLES as readonly string[]).includes(role);
}
