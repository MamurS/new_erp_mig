/*
 * Contract rules (LIFECYCLE_SPEC §7–9): payment schedule, signing by each side with any method,
 * the paper original, and the moment the contract comes into force. Pure functions.
 */
import { defineLabels } from '@/i18n';
import { DEFAULT_NUMBERING, docNumber, parseDocNumber, type NumberingTemplates } from './numbering';
import type {
  ActivationRule,
  ContractStatus,
  DealStage,
  EndorsementStatus,
  Invoice,
  ISODate,
  ISODateTime,
  Money,
  PaymentFrequency,
  SideSignature,
  Signing,
  SignMethod,
} from '@/shared/types';

export type Side = 'mig' | 'client';

export const SIGN_METHOD_LABEL = defineLabels<SignMethod>('labels.signMethod', ['eimzo', 'edo', 'paper', 'scan']);
export const PAYMENT_FREQUENCY_LABEL = defineLabels<PaymentFrequency>('labels.paymentFrequency', ['single', 'quarterly', 'monthly']);
export const ACTIVATION_RULE_LABEL = defineLabels<ActivationRule>('labels.activationRule', ['on_start_date', 'after_first_payment']);
// eslint-disable-next-line mig/no-cyrillic-ui -- operator names are data values of the API
export const EDO_PROVIDERS = ['Didox', 'Faktura.uz', 'Soliq ЭДО'] as const;

export const CONTRACT_STATUS_LABEL = defineLabels<ContractStatus>('labels.contractStatus', ['draft', 'legal_review', 'approved', 'sent', 'signing', 'signed', 'active', 'terminated', 'expired']);
export const CONTRACT_STATUS_CHIP: Record<ContractStatus, string> = {
  draft: 'neutral',
  legal_review: 'warning',
  approved: 'accent',
  sent: 'accent',
  signing: 'warning',
  signed: 'success',
  active: 'success',
  terminated: 'danger',
  expired: 'neutral',
};
export const ENDORSEMENT_STATUS_LABEL = defineLabels<EndorsementStatus>('labels.endorsementStatus', ['draft', 'legal_review', 'approved', 'sent', 'signing', 'signed']);

export const DEAL_STAGES: readonly DealStage[] = ['lead', 'census', 'quote', 'kp_sent', 'kp_accepted', 'contract_draft', 'contract_review', 'contract_sent', 'signing', 'awaiting_payment', 'active'];
export const DEAL_STAGE_LABEL = defineLabels<DealStage>('labels.dealStage', ['lead', 'census', 'quote', 'kp_sent', 'kp_accepted', 'contract_draft', 'contract_review', 'contract_sent', 'signing', 'awaiting_payment', 'active', 'lost']);

const DAY = 86_400_000;
const dayNumber = (d: ISODate) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY);
const fromDayNumber = (n: number): ISODate => new Date(n * DAY).toISOString().slice(0, 10);

export function addMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromDayNumber(dayNumber(date) + days);
}

/** Installments: equal parts (the last one takes the rounding remainder), due on the start date and every period after. */
export function buildPaymentSchedule(total: Money, startDate: ISODate, frequency: PaymentFrequency): { dueDate: ISODate; amount: Money }[] {
  const parts = frequency === 'single' ? 1 : frequency === 'quarterly' ? 4 : 12;
  const step = frequency === 'quarterly' ? 3 : 1;
  const base = Math.floor(total / parts / 1000) * 1000;
  return Array.from({ length: parts }, (_, i) => ({
    dueDate: addMonths(startDate, i * step),
    amount: i === parts - 1 ? total - base * (parts - 1) : base,
  }));
}

export function emptySigning(): Signing {
  return { paperOriginal: { required: false } };
}

/** Records a counted signature of a side. Paper and scan switch on the paper original requirement. */
export function addSignature(s: Signing, side: Side, sig: SideSignature): Signing {
  if (s[side]) throw new Error(`${side} already signed`);
  const paper = sig.method === 'paper' || sig.method === 'scan';
  return {
    ...s,
    [side]: sig,
    paperOriginal: { ...s.paperOriginal, required: s.paperOriginal.required || paper },
    edoPending: side === 'client' && sig.method === 'edo' ? undefined : s.edoPending,
  };
}

/** A scan counts only after a MIG employee verified it (LIFECYCLE_SPEC §8.4). */
export function addPendingScan(s: Signing, side: Side, fileId: string, at: ISODateTime, byName: string): Signing {
  // A scan means a paper document exists: its original is required from now on.
  return { ...s, paperOriginal: { ...s.paperOriginal, required: true }, pendingScans: [...(s.pendingScans ?? []).filter((p) => p.side !== side), { side, fileId, uploadedAt: at, uploadedByName: byName }] };
}

export function verifyScan(s: Signing, side: Side, verifier: { id: string; name: string }, at: ISODateTime, signerName: string): Signing {
  const pending = s.pendingScans?.find((p) => p.side === side);
  if (!pending) throw new Error('no scan');
  const next = addSignature(s, side, { method: 'scan', signedAt: at, signerName, scanFileId: pending.fileId, scanVerifiedById: verifier.id, scanVerifiedByName: verifier.name });
  return { ...next, pendingScans: (next.pendingScans ?? []).filter((p) => p.side !== side) };
}

export function isFullySigned(s: Signing): boolean {
  return !!s.mig && !!s.client;
}

export function fullySignedAt(s: Signing): ISODateTime | null {
  if (!s.mig || !s.client) return null;
  return s.mig.signedAt > s.client.signedAt ? s.mig.signedAt : s.client.signedAt;
}

/** The client's paper original is still missing longer than `days` after signing: remind the manager (it never blocks the contract). */
export function originalReminderDue(s: Signing, now: number, days: number): boolean {
  const at = fullySignedAt(s);
  if (!at || !s.paperOriginal.required || s.paperOriginal.clientOriginalReceivedAt) return false;
  return now - Date.parse(at) > days * DAY;
}

/**
 * Date the contract comes into force: the start date, or for `after_first_payment` not earlier than
 * the day the first installment is paid in full. null — not yet.
 */
export function activationDate(
  rule: ActivationRule,
  startDate: ISODate,
  schedule: readonly { dueDate: ISODate; amount: Money }[],
  payments: readonly { amount: Money; paidAt: ISODate }[],
): ISODate | null {
  if (rule === 'on_start_date') return startDate;
  const first = schedule[0]?.amount ?? 0;
  let paid = 0;
  for (const p of [...payments].sort((a, b) => (a.paidAt < b.paidAt ? -1 : 1))) {
    paid += p.amount;
    if (paid >= first) return p.paidAt > startDate ? p.paidAt : startDate;
  }
  return null;
}

/** 'DMS-D-2026-000123' with the default template. */
export function contractNumber(year: number, seq: number, templates: Partial<NumberingTemplates> = DEFAULT_NUMBERING): string {
  return docNumber('contract', { year, n: seq }, templates);
}

/** 'SD-2026-000045' with the default template. */
export function dealNumber(year: number, seq: number, templates: Partial<NumberingTemplates> = DEFAULT_NUMBERING): string {
  return docNumber('deal', { year, n: seq }, templates);
}

/**
 * 'SERT-2026-000123-0001': year and sequence of the contract (read back with the contract template
 * in force) and the person's index in it.
 */
export function certificateNumber(contractNo: string, index: number, templates: Partial<NumberingTemplates> = DEFAULT_NUMBERING): string {
  const c = parseDocNumber(templates.contract ?? DEFAULT_NUMBERING.contract, contractNo);
  return docNumber('certificate', { year: c?.year ?? Number(/\d{4}/.exec(contractNo)?.[0] ?? 0), n: c?.n ?? Number(/(\d+)$/.exec(contractNo)?.[1] ?? 0), m: index }, templates);
}

/** 'DS-3/DMS-D-2026-000123': n-th endorsement to the contract. */
export function endorsementNumber(n: number, contractNo: string, templates: Partial<NumberingTemplates> = DEFAULT_NUMBERING): string {
  return docNumber('endorsement', { n, ref: contractNo }, templates);
}

/** Which side still has to act and how, for the signing panel. */
export function signingSummary(s: Signing): { side: Side; state: 'signed' | 'scan_pending' | 'edo_pending' | 'waiting' }[] {
  return (['mig', 'client'] as const).map((side) => ({
    side,
    state: s[side] ? 'signed' : s.pendingScans?.some((p) => p.side === side) ? 'scan_pending' : side === 'client' && s.edoPending ? 'edo_pending' : 'waiting',
  }));
}

export const INVOICE_STATUS_LABEL = defineLabels<Invoice['status']>('labels.invoiceStatus', ['unpaid', 'paid', 'overdue']);
export const INVOICE_STATUS_CHIP: Record<Invoice['status'], string> = { unpaid: 'warning', paid: 'success', overdue: 'danger' };

/** Default start of coverage for a new deal: the first day of the month after next (time for the paperwork). */
export function defaultStartDate(today: ISODate): ISODate {
  return addMonths(`${today.slice(0, 7)}-01`, 2);
}
