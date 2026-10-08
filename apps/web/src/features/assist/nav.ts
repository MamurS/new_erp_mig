/* Sections of the assistance portal and who sees them (ASSISTANCE_SPEC §6). */
import { Building2, CalendarClock, FileCheck, Headphones, LayoutDashboard, MessagesSquare, PlugZap, Receipt, ClipboardList, Search, Users, type LucideIcon } from 'lucide-react';
import type { AssistanceRole } from '@mig/contracts';
import { defineLabels, t, type I18nKey } from '@/i18n';
import { ASSIST_SECTION_ROLES } from '@mig/domain/help/routeMap';

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

/** The label is read in the current language each time; the roles come from the shared screen map. */
function section(path: string, labelKey: I18nKey, icon: LucideIcon, group: AssistNavGroup): AssistSection {
  const roles = ASSIST_SECTION_ROLES[path];
  if (!roles) throw new Error(`No roles for ${path} in ASSIST_SECTION_ROLES`);
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
  section('/assist', 'assist.nav.dashboard', LayoutDashboard, 'work'),
  section('/assist/insured', 'assist.nav.insured', Search, 'refs'),
  section('/assist/cases', 'assist.nav.cases', Headphones, 'work'),
  section('/assist/appointments', 'assist.nav.appointments', CalendarClock, 'work'),
  section('/assist/chat', 'assist.nav.chat', MessagesSquare, 'work'),
  section('/assist/guarantees', 'assist.nav.guarantees', FileCheck, 'work'),
  section('/assist/registries', 'assist.nav.registries', ClipboardList, 'finance'),
  section('/assist/rebills', 'assist.nav.rebills', Receipt, 'finance'),
  section('/assist/clinics', 'assist.nav.clinics', Building2, 'refs'),
  section('/assist/users', 'assist.nav.users', Users, 'admin'),
  section('/assist/integration', 'assist.nav.integration', PlugZap, 'admin'),
];

export function assistRoles(path: string): AssistanceRole[] {
  return ASSIST_SECTIONS.find((s) => s.path === path)?.roles ?? [];
}
