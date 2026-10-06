/*
 * «+ Создать» in the top bar of every portal: one config of what can be created and where each process starts.
 * Visibility comes only from the permission matrix (`can`), so the menu, the pages and the mock server agree.
 *
 * Rules:
 * - An item is shown (enabled) when the role passes `can(user, perm)` for one of its variants on its own portal;
 *   the first matching variant gives the start of the process.
 * - Items created automatically are shown disabled with an explanation, only to roles that work with that
 *   document (any non-✗ cell for one of `relevant`) and only when the role can create something at all.
 * - A role that can create nothing gets no button.
 */
import type { I18nKey } from '@/i18n';
import type { Role } from '@/shared/types';
import { can, ruleFor, type Action, type MinimalUser } from '@/shared/auth/permissions';
import { portalOf, type Portal } from '@/shared/auth/home';

/** Something the layout does itself instead of navigating (e.g. open the staff search to pick an insured person). */
export type CreateCommand = 'pick-insured-for-claim';

export type CreateItemId = 'client' | 'deal' | 'membership' | 'claim' | 'case' | 'guarantee' | 'user' | 'clinic' | 'assistance';
export type AutoItemId = 'policy' | 'endorsement' | 'kp_contract';

interface Variant {
  portal: Portal;
  perm: Action;
  label: I18nKey;
  /** Start of the process; `?create=…` opens the dialog of a list page. */
  to?: string;
  command?: CreateCommand;
  hint?: I18nKey;
}

interface CreateDef {
  id: CreateItemId;
  variants: Variant[];
}

interface AutoDef {
  id: AutoItemId;
  label: I18nKey;
  reason: I18nKey;
  /** Roles with any right on one of these actions work with the document and see the explanation. */
  relevant: Action[];
}

export const CREATE_ITEMS: readonly CreateDef[] = [
  {
    id: 'client',
    variants: [
      { portal: 'staff', perm: 'leads.manage', label: 'create.item.lead', to: '/staff/deals?create=lead' },
      { portal: 'staff', perm: 'clients.write', label: 'create.item.client', to: '/staff/clients?create=client' },
    ],
  },
  { id: 'deal', variants: [{ portal: 'staff', perm: 'deals.manage', label: 'create.item.deal', to: '/staff/deals?create=lead', hint: 'create.hint.deal' }] },
  {
    id: 'membership',
    variants: [
      { portal: 'staff', perm: 'endorsements.manage', label: 'create.item.membership', to: '/staff/endorsements?create=request' },
      { portal: 'hr', perm: 'hr.employees.manage', label: 'create.item.membership', to: '/hr/employees/new', hint: 'create.hint.membershipHr' },
    ],
  },
  { id: 'claim', variants: [{ portal: 'staff', perm: 'claims.create', label: 'create.item.claim', command: 'pick-insured-for-claim', hint: 'create.hint.claim' }] },
  { id: 'case', variants: [{ portal: 'assist', perm: 'assist.cases.manage', label: 'create.item.case', to: '/assist/insured', hint: 'create.hint.case' }] },
  { id: 'guarantee', variants: [{ portal: 'clinic', perm: 'guarantees.request', label: 'create.item.guarantee', to: '/clinic/check', hint: 'create.hint.guarantee' }] },
  {
    id: 'user',
    variants: [
      { portal: 'staff', perm: 'users.manage', label: 'create.item.user', to: '/staff/admin/users?create=user' },
      { portal: 'clinic', perm: 'clinic.users.manage', label: 'create.item.user', to: '/clinic/users?create=user' },
      { portal: 'assist', perm: 'assist.users.manage', label: 'create.item.user', to: '/assist/users?create=user' },
    ],
  },
  { id: 'clinic', variants: [{ portal: 'staff', perm: 'clinics.manage', label: 'create.item.clinic', to: '/staff/clinics?create=clinic' }] },
  { id: 'assistance', variants: [{ portal: 'staff', perm: 'assistance.manage', label: 'create.item.assistance', to: '/staff/assistance?create=assistance' }] },
];

export const AUTO_ITEMS: readonly AutoDef[] = [
  { id: 'policy', label: 'create.auto.policy', reason: 'create.auto.policyReason', relevant: ['policies.write', 'contracts.draft', 'contracts.sign_client'] },
  { id: 'endorsement', label: 'create.auto.endorsement', reason: 'create.auto.endorsementReason', relevant: ['endorsements.manage', 'policy_changes.request'] },
  { id: 'kp_contract', label: 'create.auto.kpContract', reason: 'create.auto.kpContractReason', relevant: ['deals.manage', 'kp.create'] },
];

export interface CreateMenuItem {
  id: CreateItemId;
  label: I18nKey;
  to?: string;
  command?: CreateCommand;
  hint?: I18nKey;
}

export interface AutoMenuItem {
  id: AutoItemId;
  label: I18nKey;
  reason: I18nKey;
}

export interface CreateMenu {
  items: CreateMenuItem[];
  auto: AutoMenuItem[];
}

const touches = (role: Role, actions: Action[]) => actions.some((a) => ruleFor(role, a) !== false);

/** What the user may create (in matrix order) and which automatic documents to explain. Empty → no button. */
export function createMenuFor(user: MinimalUser | null | undefined): CreateMenu {
  if (!user) return { items: [], auto: [] };
  const portal = portalOf(user.role);
  const items: CreateMenuItem[] = [];
  for (const def of CREATE_ITEMS) {
    const v = def.variants.find((x) => x.portal === portal && can(user, x.perm));
    if (!v) continue;
    items.push({ id: def.id, label: v.label, ...(v.to ? { to: v.to } : {}), ...(v.command ? { command: v.command } : {}), ...(v.hint ? { hint: v.hint } : {}) });
  }
  if (items.length === 0) return { items, auto: [] };
  const auto = AUTO_ITEMS.filter((a) => touches(user.role, a.relevant)).map(({ id, label, reason }) => ({ id, label, reason }));
  return { items, auto };
}

/** The hotkey must not fire while the user types or works in a dialog. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== 'string') return false;
  const node = el as HTMLElement;
  const tag = node.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return node.isContentEditable || node.closest('[contenteditable=""],[contenteditable="true"]') !== null;
}

export function shouldOpenOnKey(e: Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat' | 'target' | 'defaultPrevented'>, doc: Pick<Document, 'querySelector'>): boolean {
  // Physical key: «C» on a Latin layout is «С» on a Russian one.
  if (e.code !== 'KeyC' && e.key.toLowerCase() !== 'c') return false;
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || e.defaultPrevented) return false;
  if (isTypingTarget(e.target)) return false;
  return doc.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"]') === null;
}
