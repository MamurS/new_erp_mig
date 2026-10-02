/*
 * Claims settlement by claims_officer (LIFECYCLE_SPEC §13): authority routing, decision rules,
 * reserves and fraud flags. Flags are hints for a person, never an automatic refusal.
 */
import type { Claim, ClaimDecisionKind, FraudFlagCode, ISODate, Money, ReserveChange, StaffAuthority } from '@/shared/types';

export const DECISION_KIND_LABEL: Record<ClaimDecisionKind, string> = { approve: 'Одобрено полностью', partial: 'Одобрено частично', reject: 'Отказано' };

export const FLAG_LABEL: Record<FraudFlagCode, string> = {
  duplicate_receipt: 'Повтор чека',
  frequent_claims: 'Частые обращения',
  outside_coverage: 'Вне периода покрытия',
  before_exclusion: 'Перед исключением',
  above_price: 'Сумма выше прайса',
};

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
  if (kind !== 'approve' && (!clauseRef || !knownClause(clauseRef))) return 'Укажите пункт договора или правил, на основании которого принято решение';
  if (kind !== 'approve' && reason.trim().length < 5) return 'Опишите причину простым языком';
  if (kind === 'partial' && (amount <= 0 || amount >= claimed)) return 'Частичное одобрение: сумма больше нуля и меньше заявленной';
  if (kind === 'approve' && amount !== claimed) return 'Полное одобрение — на заявленную сумму';
  if (kind === 'reject' && amount !== 0) return 'При отказе сумма к выплате — 0';
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

export interface FlagContext {
  claim: Pick<Claim, 'id' | 'insuredId' | 'amountClaimed' | 'serviceDate' | 'providerName' | 'createdAt'> & { receiptHash?: string; expectedPrice?: Money };
  /** Other claims of the same insured person (and receipts of anyone for the hash check). */
  others: readonly (Pick<Claim, 'id' | 'insuredId' | 'amountClaimed' | 'serviceDate' | 'providerName'> & { receiptHash?: string })[];
  coverageFrom: ISODate;
  coverageTo: ISODate;
  excludedFrom?: ISODate;
  params: { maxPerMonth: number; priceExcessShare: number; daysBeforeExclusion: number };
}

const day = (d: string) => Math.round(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / 86_400_000);

/** All flags of a claim with explanations (no personal data in the messages). */
export function detectFlags(ctx: FlagContext): { code: FraudFlagCode; message: string }[] {
  const c = ctx.claim;
  const out: { code: FraudFlagCode; message: string }[] = [];
  const same = ctx.others.find(
    (o) =>
      o.id !== c.id &&
      ((o.insuredId === c.insuredId && o.amountClaimed === c.amountClaimed && o.serviceDate === c.serviceDate && o.providerName.trim().toLowerCase() === c.providerName.trim().toLowerCase()) ||
        (!!c.receiptHash && o.receiptHash === c.receiptHash)),
  );
  if (same) {
    out.push({
      code: 'duplicate_receipt',
      message: same.receiptHash && same.receiptHash === c.receiptHash ? 'Изображение чека совпадает с чеком другого обращения' : 'Та же сумма, дата и аптека или клиника, что в другом обращении',
    });
  }
  const month = c.serviceDate.slice(0, 7);
  const inMonth = ctx.others.filter((o) => o.insuredId === c.insuredId && o.serviceDate.slice(0, 7) === month).length + 1;
  if (inMonth > ctx.params.maxPerMonth) out.push({ code: 'frequent_claims', message: `Обращений за месяц: ${inMonth}, порог — ${ctx.params.maxPerMonth}` });
  if (c.serviceDate < ctx.coverageFrom || c.serviceDate > ctx.coverageTo || (ctx.excludedFrom && c.serviceDate >= ctx.excludedFrom)) {
    out.push({ code: 'outside_coverage', message: c.serviceDate < ctx.coverageFrom ? 'Дата услуги до начала покрытия' : 'Дата услуги после окончания покрытия или исключения' });
  }
  if (ctx.excludedFrom && c.serviceDate < ctx.excludedFrom && day(ctx.excludedFrom) - day(c.serviceDate) <= ctx.params.daysBeforeExclusion) {
    out.push({ code: 'before_exclusion', message: `Услуга за ${day(ctx.excludedFrom) - day(c.serviceDate)} дн. до исключения из списка` });
  }
  if (c.expectedPrice && c.amountClaimed > c.expectedPrice * (1 + ctx.params.priceExcessShare)) {
    out.push({ code: 'above_price', message: `Сумма выше прайса на ${Math.round((c.amountClaimed / c.expectedPrice - 1) * 100)}%` });
  }
  return out;
}
