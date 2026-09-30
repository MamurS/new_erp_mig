/* Sections of the assistance portal and who sees them (ASSISTANCE_SPEC §6). */
import { Building2, CalendarClock, FileCheck, Headphones, LayoutDashboard, MessagesSquare, PlugZap, Receipt, ClipboardList, Search, Users, type LucideIcon } from 'lucide-react';
import type { AssistanceRole } from '@/shared/types';

export interface AssistSection {
  path: string;
  label: string;
  icon: LucideIcon;
  roles: AssistanceRole[];
}

const ALL: AssistanceRole[] = ['asst_operator', 'asst_doctor', 'asst_billing', 'asst_admin'];

export const ASSIST_SECTIONS: AssistSection[] = [
  { path: '/assist', label: 'Рабочий стол', icon: LayoutDashboard, roles: ALL },
  { path: '/assist/insured', label: 'Застрахованные', icon: Search, roles: ['asst_operator', 'asst_doctor'] },
  { path: '/assist/cases', label: 'Обращения', icon: Headphones, roles: ['asst_operator', 'asst_doctor'] },
  { path: '/assist/appointments', label: 'Записи', icon: CalendarClock, roles: ['asst_operator'] },
  { path: '/assist/chat', label: 'Чаты', icon: MessagesSquare, roles: ['asst_operator'] },
  { path: '/assist/guarantees', label: 'Гарантийные письма', icon: FileCheck, roles: ['asst_doctor', 'asst_operator'] },
  { path: '/assist/registries', label: 'Реестры клиник', icon: ClipboardList, roles: ['asst_doctor', 'asst_billing'] },
  { path: '/assist/rebills', label: 'Счета МИГ', icon: Receipt, roles: ['asst_billing'] },
  { path: '/assist/clinics', label: 'Клиники и прайсы', icon: Building2, roles: ALL },
  { path: '/assist/users', label: 'Пользователи', icon: Users, roles: ['asst_admin'] },
  { path: '/assist/integration', label: 'Интеграция', icon: PlugZap, roles: ['asst_admin'] },
];

export function assistRoles(path: string): AssistanceRole[] {
  return ASSIST_SECTIONS.find((s) => s.path === path)?.roles ?? [];
}
