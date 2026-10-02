import { BadgeCheck, BarChart3, Building2, CalendarClock, ClipboardList, FileCheck, FileText, Handshake, Hospital, LayoutDashboard, Receipt, ReceiptText, ScrollText, Settings2, SlidersHorizontal, type LucideIcon, UserPlus, Users } from 'lucide-react';
import type { StaffRole } from '@/shared/types';

export interface StaffSection {
  path: string;
  label: string;
  icon: LucideIcon;
  roles: StaffRole[];
  /** Hidden from the rail (detail pages). */
  inNav: boolean;
}

const ALL: StaffRole[] = ['operator', 'underwriter', 'doctor_expert', 'accountant', 'admin'];

/** Route access matrix for the staff portal (SPEC §3). */
export const STAFF_SECTIONS: StaffSection[] = [
  { path: '/staff', label: 'Рабочий стол', icon: LayoutDashboard, roles: ALL, inNav: true },
  { path: '/staff/clients', label: 'Клиенты', icon: Building2, roles: ['operator', 'underwriter', 'accountant', 'admin'], inNav: true },
  { path: '/staff/policies', label: 'Полисы', icon: FileText, roles: ['operator', 'underwriter', 'accountant'], inNav: true },
  { path: '/staff/claims', label: 'Убытки', icon: Receipt, roles: ['operator', 'doctor_expert', 'accountant'], inNav: true },
  { path: '/staff/appointments', label: 'Записи к врачу', icon: CalendarClock, roles: ['operator', 'doctor_expert'], inNav: true },
  { path: '/staff/clinics', label: 'Клиники', icon: Hospital, roles: ['operator', 'underwriter', 'doctor_expert', 'admin'], inNav: true },
  { path: '/staff/guarantees', label: 'Гарантийные письма', icon: FileCheck, roles: ['operator', 'doctor_expert'], inNav: true },
  { path: '/staff/registries', label: 'Реестры клиник', icon: ClipboardList, roles: ['operator', 'accountant'], inNav: true },
  { path: '/staff/assistance', label: 'Ассистансы', icon: Handshake, roles: ALL, inNav: true },
  { path: '/staff/rebills', label: 'Счета ассистансов', icon: ReceiptText, roles: ['operator', 'accountant'], inNav: true },
  { path: '/staff/qa', label: 'Контроль качества', icon: BadgeCheck, roles: ['doctor_expert'], inNav: true },
  { path: '/staff/policy-changes', label: 'Изменения состава', icon: UserPlus, roles: ['operator', 'underwriter', 'accountant'], inNav: true },
  { path: '/staff/limit-requests', label: 'Изменения лимитов', icon: SlidersHorizontal, roles: ['operator', 'underwriter'], inNav: true },
  { path: '/staff/reports', label: 'Отчёты', icon: BarChart3, roles: ['underwriter', 'accountant'], inNav: true },
  { path: '/staff/audit', label: 'Журнал аудита', icon: ScrollText, roles: ['admin'], inNav: true },
  { path: '/staff/admin/users', label: 'Пользователи и роли', icon: Users, roles: ['admin'], inNav: true },
  { path: '/staff/admin/parameters', label: 'Параметры ДМС', icon: Settings2, roles: ALL, inNav: true },
];

export const INSURED_CARD_ROLES: StaffRole[] = ['operator', 'underwriter', 'doctor_expert'];

export function sectionRoles(path: string): StaffRole[] {
  return STAFF_SECTIONS.find((s) => s.path === path)?.roles ?? [];
}
