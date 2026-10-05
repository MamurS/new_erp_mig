import { BadgeCheck, Banknote, BarChart3, Building2, CalendarClock, ClipboardList, FileCheck, FilePen, FileSignature, FileText, Handshake, Hospital, Kanban, LayoutDashboard, Landmark, PiggyBank, Receipt, ReceiptText, ScrollText, Settings2, SlidersHorizontal, Sparkles, type LucideIcon, UserPlus, Users } from 'lucide-react';
import type { StaffRole } from '@/shared/types';
import type { QueueType } from '@/shared/types/dto';

export type StaffNavGroup = 'Работа' | 'Продажи и андеррайтинг' | 'Урегулирование' | 'Партнёры' | 'Финансы' | 'Отчёты' | 'Администрирование';

/** Order of the groups in the side navigation. */
export const STAFF_NAV_GROUPS: StaffNavGroup[] = ['Работа', 'Продажи и андеррайтинг', 'Урегулирование', 'Партнёры', 'Финансы', 'Отчёты', 'Администрирование'];

export interface StaffSection {
  path: string;
  label: string;
  icon: LucideIcon;
  roles: StaffRole[];
  /** Hidden from the rail (detail pages). */
  inNav: boolean;
  group: StaffNavGroup;
}

const ALL: StaffRole[] = ['operator', 'underwriter', 'doctor_expert', 'accountant', 'admin', 'sales_manager', 'legal', 'claims_officer'];

/** Route access matrix for the staff portal (SPEC §3). */
export const STAFF_SECTIONS: StaffSection[] = [
  { path: '/staff', label: 'Рабочий стол', icon: LayoutDashboard, roles: ALL, inNav: true, group: 'Работа' },
  { path: '/staff/deals', label: 'Сделки', icon: Kanban, roles: ['sales_manager', 'underwriter'], inNav: true, group: 'Продажи и андеррайтинг' },
  { path: '/staff/quotes', label: 'Котировка', icon: Kanban, roles: ['sales_manager', 'underwriter'], inNav: false, group: 'Продажи и андеррайтинг' },
  { path: '/staff/clients', label: 'Клиенты', icon: Building2, roles: ['operator', 'underwriter', 'accountant', 'admin', 'sales_manager', 'legal'], inNav: true, group: 'Продажи и андеррайтинг' },
  { path: '/staff/contracts', label: 'Договоры', icon: FileSignature, roles: ['operator', 'underwriter', 'accountant', 'sales_manager', 'legal'], inNav: true, group: 'Продажи и андеррайтинг' },
  { path: '/staff/endorsements', label: 'Доп. соглашения', icon: FilePen, roles: ['underwriter', 'sales_manager', 'legal', 'accountant'], inNav: true, group: 'Продажи и андеррайтинг' },
  { path: '/staff/invoices', label: 'Счета и оплаты', icon: Landmark, roles: ['underwriter', 'accountant', 'sales_manager'], inNav: true, group: 'Финансы' },
  { path: '/staff/invoices/queue', label: 'Ручная разноска', icon: Banknote, roles: ['accountant'], inNav: true, group: 'Финансы' },
  { path: '/staff/policies', label: 'Полисы', icon: FileText, roles: ['operator', 'underwriter', 'accountant', 'sales_manager'], inNav: true, group: 'Продажи и андеррайтинг' },
  { path: '/staff/claims', label: 'Убытки', icon: Receipt, roles: ['operator', 'doctor_expert', 'accountant', 'claims_officer'], inNav: true, group: 'Урегулирование' },
  { path: '/staff/appointments', label: 'Записи к врачу', icon: CalendarClock, roles: ['operator', 'doctor_expert'], inNav: true, group: 'Работа' },
  { path: '/staff/clinics', label: 'Клиники', icon: Hospital, roles: ['operator', 'underwriter', 'doctor_expert', 'admin'], inNav: true, group: 'Партнёры' },
  { path: '/staff/guarantees', label: 'Гарантийные письма', icon: FileCheck, roles: ['operator', 'doctor_expert'], inNav: true, group: 'Урегулирование' },
  { path: '/staff/registries', label: 'Реестры клиник', icon: ClipboardList, roles: ['operator', 'accountant'], inNav: true, group: 'Партнёры' },
  { path: '/staff/assistance', label: 'Ассистансы', icon: Handshake, roles: ALL, inNav: true, group: 'Партнёры' },
  { path: '/staff/rebills', label: 'Счета ассистансов', icon: ReceiptText, roles: ['claims_officer', 'accountant'], inNav: true, group: 'Финансы' },
  { path: '/staff/qa', label: 'Контроль качества', icon: BadgeCheck, roles: ['doctor_expert'], inNav: true, group: 'Работа' },
  { path: '/staff/policy-changes', label: 'Изменения состава', icon: UserPlus, roles: ['operator', 'underwriter', 'accountant'], inNav: true, group: 'Работа' },
  { path: '/staff/limit-requests', label: 'Изменения лимитов', icon: SlidersHorizontal, roles: ['operator', 'underwriter'], inNav: true, group: 'Работа' },
  { path: '/staff/reports', label: 'Отчёты', icon: BarChart3, roles: ['underwriter', 'accountant'], inNav: true, group: 'Отчёты' },
  { path: '/staff/reports/reserves', label: 'Резервы', icon: PiggyBank, roles: ['claims_officer', 'underwriter', 'accountant'], inNav: true, group: 'Урегулирование' },
  { path: '/staff/audit', label: 'Журнал аудита', icon: ScrollText, roles: ['admin'], inNav: true, group: 'Администрирование' },
  { path: '/staff/admin/users', label: 'Пользователи и роли', icon: Users, roles: ['admin'], inNav: true, group: 'Администрирование' },
  { path: '/staff/admin/parameters', label: 'Параметры ДМС', icon: Settings2, roles: ALL, inNav: true, group: 'Администрирование' },
  { path: '/staff/admin/ai', label: 'ИИ-проверка покрытия', icon: Sparkles, roles: ['admin'], inNav: true, group: 'Администрирование' },
];

export const INSURED_CARD_ROLES: StaffRole[] = ['operator', 'underwriter', 'doctor_expert', 'claims_officer'];

export function sectionRoles(path: string): StaffRole[] {
  return STAFF_SECTIONS.find((s) => s.path === path)?.roles ?? [];
}

/** Where queue items are worked on: their counts become the counters of these sections. */
export const QUEUE_NAV: Partial<Record<QueueType, string>> = {
  appointment: '/staff/appointments',
  clinic_no_response: '/staff/appointments',
  claim: '/staff/claims',
  appeal: '/staff/claims',
  fraud_flag: '/staff/claims',
  opinion: '/staff/claims',
  guarantee: '/staff/guarantees',
  escalation: '/staff/guarantees',
  registry: '/staff/registries',
  policy_change: '/staff/policy-changes',
  limit_request: '/staff/limit-requests',
  rebill: '/staff/rebills',
  assistance_sla: '/staff/assistance',
  complaint: '/staff/assistance',
  deal: '/staff/deals',
  lead: '/staff/deals',
  kp: '/staff/deals',
  quote: '/staff/deals',
  contract: '/staff/contracts',
  scan: '/staff/contracts',
  endorsement: '/staff/endorsements',
  invoice: '/staff/invoices',
  bank_payment: '/staff/invoices/queue',
  renewal: '/staff/clients',
  loss_ratio: '/staff/clients',
  qa_sample: '/staff/qa',
  param_change: '/staff/admin/parameters',
  authority_change: '/staff/admin/users',
  ai_change: '/staff/admin/ai',
  integration_error: '/staff/clinics',
};
