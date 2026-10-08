/*
 * Next steps of an empty section (docs/DECISIONS.md «Пустые состояния со следующим шагом»):
 * - who does what (a task action → the responsible role and the right that lets a person do it);
 * - «Что нужно для следующего этапа» of a deal: the checklist of the current stage; the move to the next
 *   stage is blocked while a required item is not done (the mock server checks the same items);
 * - what the empty «Застрахованные» tab of a client explains (by the stage of the client's deal);
 * - where a task leads in the receiver's portal.
 * Pure functions: used by the UI and by the mock server.
 */
import { msg } from '@mig/i18n';
import type { Contract, DealStage, KpStatus, QuoteStatus, Role, Signing } from '@mig/contracts';
import type { ClientPipeline, DealChecklistItem, TaskAction } from '@mig/contracts/dto';
import type { Action } from './auth/permissions';

export const TASK_ACTIONS = [
  'census_upload',
  'quote_calculate',
  'quote_approve',
  'kp_send',
  'kp_respond',
  'contract_draft',
  'contract_requisites',
  'insured_list',
  'legal_review',
  'sign_mig',
  'sign_client',
  'invoice_pay',
  'below_min_group',
  'other',
] as const satisfies readonly TaskAction[];

/** Who is responsible for an action by default. */
export const ACTION_ROLE: Record<TaskAction, Role> = {
  census_upload: 'sales_manager',
  quote_calculate: 'underwriter',
  quote_approve: 'underwriter',
  kp_send: 'sales_manager',
  kp_respond: 'hr',
  contract_draft: 'sales_manager',
  contract_requisites: 'sales_manager',
  insured_list: 'sales_manager',
  legal_review: 'legal',
  sign_mig: 'sales_manager',
  sign_client: 'hr',
  invoice_pay: 'hr',
  below_min_group: 'underwriter',
  other: 'sales_manager',
};

/** The right that lets a person do the action themselves (otherwise: «Попросить …»). */
export const ACTION_RIGHT: Record<TaskAction, Action | null> = {
  census_upload: 'census.upload',
  quote_calculate: 'quotes.calculate',
  quote_approve: 'quotes.approve',
  kp_send: 'kp.send',
  kp_respond: 'kp.respond',
  contract_draft: 'contracts.draft',
  contract_requisites: 'contracts.draft',
  insured_list: 'contracts.draft',
  legal_review: 'contracts.legal_approve',
  sign_mig: 'contracts.sign_mig',
  sign_client: 'contracts.sign_client',
  invoice_pay: 'payments.record',
  below_min_group: null,
  other: null,
};

/** Packed title of a task («Загрузите данные для оценки по сделке …»). */
export function taskTitle(action: TaskAction, p: { deal?: string; contract?: string; client: string }): string {
  const what = p.contract ?? p.deal ?? p.client;
  return msg(`next.task.${action}`, { what, client: p.client });
}

export interface TaskRefs {
  dealId?: string;
  contractId?: string;
  clientId: string;
}

/** Where a task leads in the receiver's portal: the place with the form already open. */
export function taskLink(action: TaskAction, toRole: Role, r: TaskRefs): string {
  if (toRole === 'hr') {
    if (action === 'sign_client' && r.contractId) return `/hr/contracts/${r.contractId}`;
    if (action === 'kp_respond') return '/hr/documents';
    return '/hr';
  }
  return staffActionPath(action, r);
}

/** The staff screen of an action (with its form open where there is one). */
export function staffActionPath(action: TaskAction, r: TaskRefs): string {
  switch (action) {
    case 'census_upload':
      return r.dealId ? `/staff/deals/${r.dealId}/census?upload=1` : `/staff/clients/${r.clientId}`;
    case 'insured_list':
      return r.contractId ? `/staff/contracts/${r.contractId}?upload=annex2` : r.dealId ? `/staff/deals/${r.dealId}` : `/staff/clients/${r.clientId}`;
    case 'contract_requisites':
    case 'legal_review':
    case 'sign_mig':
      return r.contractId ? `/staff/contracts/${r.contractId}` : r.dealId ? `/staff/deals/${r.dealId}` : `/staff/clients/${r.clientId}`;
    case 'below_min_group':
      return `/staff/clients/${r.clientId}`;
    case 'invoice_pay':
      return r.contractId ? `/staff/contracts/${r.contractId}` : '/staff/invoices?status=unpaid,overdue';
    default:
      return r.dealId ? `/staff/deals/${r.dealId}` : `/staff/clients/${r.clientId}`;
  }
}

// ---------------------------------------------------------------- deal checklist

export interface ChecklistContract {
  status: Contract['status'];
  insuredCount: number;
  clientInn: string;
  clientSignatory: { name: string; position: string; basis: string };
  migSignatoryId: string;
  clauseChanges: number;
  financeDiffers: boolean;
  financeApproved: boolean;
  signing: Pick<Signing, 'mig' | 'client'>;
}

export interface ChecklistInput {
  stage: DealStage;
  census: boolean;
  quote?: { status: QuoteStatus };
  kp?: { status: KpStatus };
  contract?: ChecklistContract;
  invoicePaid: boolean;
}

type CheckKey = 'census' | 'quoteCalculated' | 'quoteApproved' | 'kpAnswer' | 'contractDraft' | 'requisites' | 'annex2' | 'signatories' | 'financeApproval' | 'legal' | 'signClient' | 'signMig' | 'payment';

const item = (key: CheckKey, done: boolean, role: Role, action: TaskAction | undefined, required = true, hint?: string): DealChecklistItem => ({
  key,
  label: msg(`next.check.${key}`),
  done,
  required,
  role,
  ...(action ? { action } : {}),
  ...(hint ? { hint } : {}),
});

/** What the deal's current stage requires before the next one. */
export function dealChecklist(x: ChecklistInput): DealChecklistItem[] {
  const c = x.contract;
  switch (x.stage) {
    case 'lead':
    case 'census':
      return [item('census', x.census, 'sales_manager', 'census_upload')];
    case 'quote':
      return [item('quoteCalculated', !!x.quote, 'underwriter', 'quote_calculate'), item('quoteApproved', x.quote?.status === 'approved', 'underwriter', 'quote_approve')];
    case 'kp_sent':
      return [item('kpAnswer', x.kp?.status === 'accepted', 'hr', 'kp_respond')];
    case 'kp_accepted':
      return [item('contractDraft', !!c, 'sales_manager', 'contract_draft')];
    case 'contract_draft': {
      if (!c) return [item('contractDraft', false, 'sales_manager', 'contract_draft')];
      const s = c.clientSignatory;
      return [
        item('requisites', /^\d{9}$/.test(c.clientInn) && !!s.basis.trim(), 'sales_manager', 'contract_requisites'),
        item('annex2', c.insuredCount > 0, 'sales_manager', 'insured_list'),
        item('signatories', !!c.migSignatoryId && !!s.name.trim() && !!s.position.trim(), 'sales_manager', 'contract_requisites'),
        // Required only when the terms differ from the approved quote.
        item('financeApproval', !c.financeDiffers || c.financeApproved, 'underwriter', 'quote_approve', c.financeDiffers, msg(c.financeDiffers ? 'next.hint.financeDiffers' : 'next.hint.financeSame')),
        // The lawyer reviews after the contract is sent for approval, and only when a clause was changed.
        item('legal', c.clauseChanges === 0, 'legal', 'legal_review', false, msg(c.clauseChanges ? 'next.hint.clausesChanged' : 'next.hint.noClauseChanges', { n: c.clauseChanges })),
      ];
    }
    case 'contract_review':
      return [item('legal', c?.status === 'approved', 'legal', 'legal_review', true, c ? msg('next.hint.clausesChanged', { n: c.clauseChanges }) : undefined)];
    case 'contract_sent':
    case 'signing':
      return [item('signClient', !!c?.signing.client, 'hr', 'sign_client'), item('signMig', !!c?.signing.mig, 'sales_manager', 'sign_mig')];
    case 'awaiting_payment':
      return [item('payment', x.invoicePaid, 'hr', 'invoice_pay')];
    default:
      return [];
  }
}

/** Required items that are not done: the move to the next stage is blocked by them. */
export function missingItems(items: readonly DealChecklistItem[]): DealChecklistItem[] {
  return items.filter((i) => i.required && !i.done);
}

// ---------------------------------------------------------------- the empty «Застрахованные» tab

export type InsuredTabState = 'list' | 'no_deal' | 'pre_contract' | 'contract' | 'awaiting_payment';

const PRE_CONTRACT: DealStage[] = ['lead', 'census', 'quote', 'kp_sent', 'kp_accepted'];
const CONTRACT: DealStage[] = ['contract_draft', 'contract_review', 'contract_sent', 'signing'];

export function insuredTabState(p: ClientPipeline): InsuredTabState {
  if (p.hasPolicy) return 'list';
  if (!p.dealId || !p.stage || p.stage === 'lost') return 'no_deal';
  if (PRE_CONTRACT.includes(p.stage)) return 'pre_contract';
  if (CONTRACT.includes(p.stage)) return 'contract';
  if (p.stage === 'awaiting_payment') return 'awaiting_payment';
  return 'list';
}
