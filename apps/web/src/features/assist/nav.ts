/* Sections of the assistance portal and who sees them (ASSISTANCE_SPEC §6). */
import { Building2, CalendarClock, FileCheck, Headphones, LayoutDashboard, MessagesSquare, PlugZap, Receipt, ClipboardList, Search, Users, type LucideIcon } from 'lucide-react';
import type { AssistanceRole } from '@mig/contracts';
import { defineLabels, t, type I18nKey } from '@/i18n';

export type AssistNavGroup = 'work' | 'refs' | 'finance' | 'admin';
export const ASSIST_NAV_GROUPS: AssistNavGroup[] = ['work', 'refs', 'finance', 'admin'];
export const ASSIST_NAV_GROUP_LABEL = defineLabels('assist.nav.group', ASSIST_NAV_GROUPS);

export interface AssistSection {
  path: string;
  label: string;
  icon: LucideIcon;
  roles: AssistanceRole[];
  group: AssistNavGroup;
}

const ALL: AssistanceRole[] = ['asst_operator', 'asst_doctor', 'asst_billing', 'asst_admin'];

/** The label is read in the current language each time. */
function section(path: string, labelKey: I18nKey, icon: LucideIcon, roles: AssistanceRole[], group: AssistNavGroup): AssistSection {
  return {
    path,
    get label() {
      return t(labelKey);
    },
    icon,
    roles,
    group,
  };
}

export const ASSIST_SECTIONS: AssistSection[] = [
  section('/assist', 'assist.nav.dashboard', LayoutDashboard, ALL, 'work'),
  section('/assist/insured', 'assist.nav.insured', Search, ['asst_operator', 'asst_doctor'], 'refs'),
  section('/assist/cases', 'assist.nav.cases', Headphones, ['asst_operator', 'asst_doctor'], 'work'),
  section('/assist/appointments', 'assist.nav.appointments', CalendarClock, ['asst_operator'], 'work'),
  section('/assist/chat', 'assist.nav.chat', MessagesSquare, ['asst_operator'], 'work'),
  section('/assist/guarantees', 'assist.nav.guarantees', FileCheck, ['asst_doctor', 'asst_operator'], 'work'),
  section('/assist/registries', 'assist.nav.registries', ClipboardList, ['asst_doctor', 'asst_billing'], 'finance'),
  section('/assist/rebills', 'assist.nav.rebills', Receipt, ['asst_billing'], 'finance'),
  section('/assist/clinics', 'assist.nav.clinics', Building2, ALL, 'refs'),
  section('/assist/users', 'assist.nav.users', Users, ['asst_admin'], 'admin'),
  section('/assist/integration', 'assist.nav.integration', PlugZap, ['asst_admin'], 'admin'),
];

export function assistRoles(path: string): AssistanceRole[] {
  return ASSIST_SECTIONS.find((s) => s.path === path)?.roles ?? [];
}
