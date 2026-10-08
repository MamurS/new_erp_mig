import { BadgeCheck, FolderInput, Banknote, BarChart3, Building2, CalendarClock, ClipboardList, FileCheck, FilePen, FileSignature, FileText, Handshake, Hospital, Kanban, LayoutDashboard, Landmark, PiggyBank, Receipt, ReceiptText, ScrollText, Settings2, SlidersHorizontal, Sparkles, type LucideIcon, UserPlus, Users } from 'lucide-react';
import { defineLabels, t, type I18nKey } from '@/i18n';
import type { StaffRole } from '@mig/contracts';
import type { QueueType } from '@mig/contracts/dto';
import { INSURED_CARD_ROLES as CARD_ROLES, STAFF_SECTION_ROLES } from '@mig/domain/help/routeMap';

/** Order of the groups in the side navigation. */
export const STAFF_NAV_GROUPS = ['work', 'sales', 'claims', 'partners', 'finance', 'reports', 'admin'] as const;
export type StaffNavGroup = (typeof STAFF_NAV_GROUPS)[number];
/** Group headings, read in the current language. */
export const STAFF_NAV_GROUP_LABEL = defineLabels('staff.nav.group', STAFF_NAV_GROUPS);

export interface StaffSection {
  path: string;
  /** Read in the current language. */
  readonly label: string;
  icon: LucideIcon;
  roles: StaffRole[];
  /** Hidden from the rail (detail pages). */
  inNav: boolean;
  group: StaffNavGroup;
}

/** Roles of a section come from the shared screen map (packages/domain/src/help/routeMap.ts). */
function section(path: string, labelKey: string, icon: LucideIcon, inNav: boolean, group: StaffNavGroup): StaffSection {
  const roles = STAFF_SECTION_ROLES[path];
  if (!roles) throw new Error(`No roles for ${path} in STAFF_SECTION_ROLES`);
  const key = `staff.nav.${labelKey}` as I18nKey;
  return {
    path,
    get label() {
      return t(key);
    },
    icon,
    roles,
    inNav,
    group,
  };
}

/** Route access matrix for the staff portal (SPEC §3). */
export const STAFF_SECTIONS: StaffSection[] = [
  section('/staff', 'dashboard', LayoutDashboard, true, 'work'),
  section('/staff/deals', 'deals', Kanban, true, 'sales'),
  section('/staff/quotes', 'quotes', Kanban, false, 'sales'),
  section('/staff/clients', 'clients', Building2, true, 'sales'),
  section('/staff/contracts', 'contracts', FileSignature, true, 'sales'),
  section('/staff/endorsements', 'endorsements', FilePen, true, 'sales'),
  section('/staff/invoices', 'invoices', Landmark, true, 'finance'),
  section('/staff/invoices/queue', 'paymentQueue', Banknote, true, 'finance'),
  section('/staff/policies', 'policies', FileText, true, 'sales'),
  section('/staff/claims', 'claims', Receipt, true, 'claims'),
  section('/staff/appointments', 'appointments', CalendarClock, true, 'work'),
  section('/staff/clinics', 'clinics', Hospital, true, 'partners'),
  section('/staff/guarantees', 'guarantees', FileCheck, true, 'claims'),
  section('/staff/registries', 'registries', ClipboardList, true, 'partners'),
  section('/staff/assistance', 'assistance', Handshake, true, 'partners'),
  section('/staff/rebills', 'rebills', ReceiptText, true, 'finance'),
  section('/staff/qa', 'qa', BadgeCheck, true, 'work'),
  section('/staff/policy-changes', 'policyChanges', UserPlus, true, 'work'),
  section('/staff/limit-requests', 'limitRequests', SlidersHorizontal, true, 'work'),
  section('/staff/reports', 'reports', BarChart3, true, 'reports'),
  section('/staff/reports/reserves', 'reserves', PiggyBank, true, 'claims'),
  section('/staff/audit', 'audit', ScrollText, true, 'admin'),
  section('/staff/admin/users', 'users', Users, true, 'admin'),
  section('/staff/admin/parameters', 'parameters', Settings2, true, 'admin'),
  section('/staff/admin/ai', 'ai', Sparkles, true, 'admin'),
  section('/staff/admin/migration', 'migration', FolderInput, true, 'admin'),
];

export const INSURED_CARD_ROLES: StaffRole[] = CARD_ROLES;

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
