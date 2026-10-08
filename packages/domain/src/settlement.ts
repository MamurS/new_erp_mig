/*
 * Claims settlement by claims_officer (LIFECYCLE_SPEC §13): authority routing, decision rules,
 * reserves and fraud flags. Flags are hints for a person, never an automatic refusal.
 */
import { defineLabels, msg, type I18nKey } from '@mig/i18n';
import type { Claim, ClaimDecisionKind, FraudFlagCode, ISODate, Money, ReceiptFiscal, ReserveChange, StaffAuthority } from '@mig/contracts';

export const DECISION_KIND_LABEL = defineLabels<ClaimDecisionKind>('labels.decisionKind', ['approve', 'partial', 'reject']);

export const FLAG_LABEL = defineLabels<FraudFlagCode>('labels.fraudFlag', ['duplicate_receipt', 'frequent_claims', 'outside_coverage', 'before_exclusion', 'above_price']);

/** Amount the decision commits the company to: what is paid, or for a refusal what is refused. */
export function authorityAmount(kind: ClaimDecisionKind, amount: Money, claimed: Money): Money {
  return kind === 'reject' ? claimed : amount;
}

export function decisionNeedsApproval(kind: ClaimDecisionKind, amount: Money, claimed: Money, authority: StaffAuthority | undefined): boolean {
  return authorityAmount(kind, amount, claimed) > (authority?.claimDecisionMax ?? 0);
}

/** Another claims officer whose authority covers the amount. */
export function canApproveDecision(approver: { id: string; role: string; authority?: StaffAuthority }, pending: { byId: string; required: Money }): boolean {
  return approver.role === 'claims_officer' && approver.id !== pending.byId && (approver.authority?.claimDecisionMax ?? 0) >= pending.required;
}

/** Problems of a decision before it is saved; refusal and partial approval need a clause and a reason. */
export function decisionProblem(kind: ClaimDecisionKind, amount: Money, claimed: Money, clauseRef: string | undefined, reason: string, knownClause: (ref: string) => boolean): string | null {
  if (kind !== 'approve' && (!clauseRef || !knownClause(clauseRef))) return msg('dom.decision.clauseRequired');
  if (kind !== 'approve' && reason.trim().length < 5) return msg('dom.decision.reasonRequired');
  if (kind === 'partial' && (amount <= 0 || amount >= claimed)) return msg('dom.decision.partialAmount');
  if (kind === 'approve' && amount !== claimed) return msg('dom.decision.fullAmount');
  if (kind === 'reject' && amount !== 0) return msg('dom.decision.rejectZero');
  return null;
}

export const OPEN_CLAIM = new Set(['new', 'review', 'medical_review', 'approved', 'to_pay']);

/** Reserve when a claim is registered: the claimed amount or the approved guarantee letter amount. */
export function initialReserve(claimed: Money, guaranteeApproved?: Money): Money {
  return guaranteeApproved ?? claimed;
}

/** Reserve after an event: a decision sets it to the approved amount; payment, refusal or closing clear it. */
export function reserveAfter(event: { type: 'decision'; amount: Money } | { type: 'paid' } | { type: 'rejected' } | { type: 'closed' }): Money {
  return event.type === 'decision' ? event.amount : 0;
}

/** Reserve of a claim at the end of a day, from its change history (0 before it was registered). */
export function reserveOn(history: readonly ReserveChange[], date: ISODate): Money {
  const end = Date.parse(`${date}T23:59:59+05:00`);
  let value = 0;
  for (const h of [...history].sort((a, b) => (a.at < b.at ? -1 : 1))) {
    if (Date.parse(h.at) > end) break;
    value = h.to;
  }
  return value;
}

// ---------------------------------------------------------------- fraud flags

type ReceiptSide = Pick<Claim, 'id' | 'insuredId' | 'amountClaimed' | 'serviceDate' | 'providerName'> & {
  number?: string;
  source?: Claim['source'];
  receiptHash?: string;
  receiptFiscal?: ReceiptFiscal;
};

export interface FlagContext {
  claim: ReceiptSide & Pick<Claim, 'createdAt'> & { expectedPrice?: Money };
  /** Every other claim of every insured person: the same receipt may come from a colleague or a relative. */
  others: readonly ReceiptSide[];
  coverageFrom: ISODate;
  coverageTo: ISODate;
  excludedFrom?: ISODate;
  params: { maxPerMonth: number; priceExcessShare: number; daysBeforeExclusion: number };
}

const day = (d: string) => Math.round(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / 86_400_000);
const point = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** A claim with a receipt behind it: invoices of clinics are compared by registries, not here. */
const hasReceipt = (c: ReceiptSide) => !!c.receiptFiscal || !!c.receiptHash || c.source === 'app';

/**
 * How two receipts are the same one: by the fiscal sign when both have it; otherwise by amount, date
 * and point of sale (the seller's INN, or the provider's name when a receipt has no fiscal data).
 */
export function sameReceipt(a: ReceiptSide, b: ReceiptSide): 'fiscal' | 'details' | null {
  if (!hasReceipt(a) || !hasReceipt(b)) return null;
  const fa = a.receiptFiscal;
  const fb = b.receiptFiscal;
  if (fa?.fiscalNumber && fb?.fiscalNumber) return fa.fiscalNumber === fb.fiscalNumber ? 'fiscal' : null;
  const amount = (c: ReceiptSide) => c.receiptFiscal?.amount ?? c.amountClaimed;
  const date = (c: ReceiptSide) => c.receiptFiscal?.issuedAt.slice(0, 10) ?? c.serviceDate;
  const samePoint = fa && fb ? fa.sellerInn === fb.sellerInn : point(a.providerName) === point(b.providerName);
  return amount(a) === amount(b) && date(a) === date(b) && samePoint ? 'details' : null;
}

/** All flags of a claim with explanations (no personal data in the messages). */
export function detectFlags(ctx: FlagContext): { code: FraudFlagCode; message: string }[] {
  const c = ctx.claim;
  const out: { code: FraudFlagCode; message: string }[] = [];
  const twins = ctx.others
    .filter((o) => o.id !== c.id)
    .map((o) => ({ o, by: sameReceipt(c, o), image: !!c.receiptHash && o.receiptHash === c.receiptHash }))
    .filter((x) => x.by || x.image);
  const first = twins.find((x) => x.by === 'fiscal') ?? twins.find((x) => x.by) ?? twins[0];
  if (first) {
    // One whole sentence per case: dom.flags.dup.<fiscal|details|image>[Other][Image][Count].
    const head = first.by === 'fiscal' ? 'fiscal' : first.by === 'details' ? 'details' : 'image';
    const other = first.o.insuredId !== c.insuredId ? 'Other' : '';
    const extra = `${first.by && first.image ? 'Image' : ''}${twins.length > 1 ? 'Count' : ''}`;
    const params = { number: first.o.number ? ` ${first.o.number}` : '', count: twins.length };
    out.push({ code: 'duplicate_receipt', message: msg(`dom.flags.dup.${head}${other}${extra}` as I18nKey, params) });
  }
  const month = c.serviceDate.slice(0, 7);
  const inMonth = ctx.others.filter((o) => o.insuredId === c.insuredId && o.serviceDate.slice(0, 7) === month).length + 1;
  if (inMonth > ctx.params.maxPerMonth) out.push({ code: 'frequent_claims', message: msg('dom.flags.frequent', { n: inMonth, max: ctx.params.maxPerMonth }) });
  if (c.serviceDate < ctx.coverageFrom || c.serviceDate > ctx.coverageTo || (ctx.excludedFrom && c.serviceDate >= ctx.excludedFrom)) {
    out.push({ code: 'outside_coverage', message: c.serviceDate < ctx.coverageFrom ? msg('dom.flags.beforeCoverage') : msg('dom.flags.afterCoverage') });
  }
  if (ctx.excludedFrom && c.serviceDate < ctx.excludedFrom && day(ctx.excludedFrom) - day(c.serviceDate) <= ctx.params.daysBeforeExclusion) {
    out.push({ code: 'before_exclusion', message: msg('dom.flags.beforeExclusion', { days: day(ctx.excludedFrom) - day(c.serviceDate) }) });
  }
  if (c.expectedPrice && c.amountClaimed > c.expectedPrice * (1 + ctx.params.priceExcessShare)) {
    out.push({ code: 'above_price', message: msg('dom.flags.abovePrice', { pct: Math.round((c.amountClaimed / c.expectedPrice - 1) * 100) }) });
  }
  return out;
}
