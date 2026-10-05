import { BadgeCheck, Banknote, BarChart3, Building2, CalendarClock, ClipboardList, FileCheck, FilePen, FileSignature, FileText, Handshake, Hospital, Kanban, LayoutDashboard, Landmark, PiggyBank, Receipt, ReceiptText, ScrollText, Settings2, SlidersHorizontal, Sparkles, type LucideIcon, UserPlus, Users } from 'lucide-react';
import { defineLabels, t, type I18nKey } from '@/i18n';
import type { StaffRole } from '@/shared/types';
import type { QueueType } from '@/shared/types/dto';

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

const ALL: StaffRole[] = ['operator', 'underwriter', 'doctor_expert', 'accountant', 'admin', 'sales_manager', 'legal', 'claims_officer'];

function section(path: string, labelKey: string, icon: LucideIcon, roles: StaffRole[], inNav: boolean, group: StaffNavGroup): StaffSection {
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
  section('/staff', 'dashboard', LayoutDashboard, ALL, true, 'work'),
  section('/staff/deals', 'deals', Kanban, ['sales_manager', 'underwriter'], true, 'sales'),
  section('/staff/quotes', 'quotes', Kanban, ['sales_manager', 'underwriter'], false, 'sales'),
  section('/staff/clients', 'clients', Building2, ['operator', 'underwriter', 'accountant', 'admin', 'sales_manager', 'legal'], true, 'sales'),
  section('/staff/contracts', 'contracts', FileSignature, ['operator', 'underwriter', 'accountant', 'sales_manager', 'legal'], true, 'sales'),
  section('/staff/endorsements', 'endorsements', FilePen, ['underwriter', 'sales_manager', 'legal', 'accountant'], true, 'sales'),
  section('/staff/invoices', 'invoices', Landmark, ['underwriter', 'accountant', 'sales_manager'], true, 'finance'),
  section('/staff/invoices/queue', 'paymentQueue', Banknote, ['accountant'], true, 'finance'),
  section('/staff/policies', 'policies', FileText, ['operator', 'underwriter', 'accountant', 'sales_manager'], true, 'sales'),
  section('/staff/claims', 'claims', Receipt, ['operator', 'doctor_expert', 'accountant', 'claims_officer'], true, 'claims'),
  section('/staff/appointments', 'appointments', CalendarClock, ['operator', 'doctor_expert'], true, 'work'),
  section('/staff/clinics', 'clinics', Hospital, ['operator', 'underwriter', 'doctor_expert', 'admin'], true, 'partners'),
  section('/staff/guarantees', 'guarantees', FileCheck, ['operator', 'doctor_expert'], true, 'claims'),
  section('/staff/registries', 'registries', ClipboardList, ['operator', 'accountant'], true, 'partners'),
  section('/staff/assistance', 'assistance', Handshake, ALL, true, 'partners'),
  section('/staff/rebills', 'rebills', ReceiptText, ['claims_officer', 'accountant'], true, 'finance'),
  section('/staff/qa', 'qa', BadgeCheck, ['doctor_expert'], true, 'work'),
  section('/staff/policy-changes', 'policyChanges', UserPlus, ['operator', 'underwriter', 'accountant'], true, 'work'),
  section('/staff/limit-requests', 'limitRequests', SlidersHorizontal, ['operator', 'underwriter'], true, 'work'),
  section('/staff/reports', 'reports', BarChart3, ['underwriter', 'accountant'], true, 'reports'),
  section('/staff/reports/reserves', 'reserves', PiggyBank, ['claims_officer', 'underwriter', 'accountant'], true, 'claims'),
  section('/staff/audit', 'audit', ScrollText, ['admin'], true, 'admin'),
  section('/staff/admin/users', 'users', Users, ['admin'], true, 'admin'),
  section('/staff/admin/parameters', 'parameters', Settings2, ALL, true, 'admin'),
  section('/staff/admin/ai', 'ai', Sparkles, ['admin'], true, 'admin'),
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
