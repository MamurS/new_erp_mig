/*
 * Coverage engine (AI_COVERAGE_SPEC §3.2): a pure function, the backend repeats it one to one.
 * The rules decide; the AI only maps free text to catalog codes and explains the verdict.
 *
 * Order of checks: the policy and the person's coverage on the date → unknown codes → the rule
 * (service rule before group rule; no rule → unknown) → exclusion → waiting period → limit with
 * reserves of approved guarantee letters → guarantee letter. For several codes the strictest verdict wins.
 */
import type { CoverageRule, CoverageVerdict, CoverageVerdictDecision, ISODate, LimitCategory, LimitUsage, Money, ProgramCode, ServiceCatalogItem, UUID } from '@/shared/types';
import { t } from '@/i18n';

export interface CoverageInput {
  policyId: UUID;
  insuredId: UUID;
  serviceCodes: string[];
  icd10?: string[];
  serviceDate: ISODate;
  amount?: Money;
}

export interface CoverageContext {
  program: ProgramCode;
  policy: { id: UUID; status: 'active' | 'draft' | 'expired' | 'terminated' | string; startDate: ISODate; endDate: ISODate };
  insured: { id: UUID; insuredFrom: ISODate; excludedFrom?: ISODate; status: string };
  /** Limits by category with what is used and reserved by approved guarantee letters. */
  limits: readonly LimitUsage[];
  rules: readonly CoverageRule[];
  catalog: (code: string) => ServiceCatalogItem | undefined;
}

/** Strictness of a verdict: the strictest one of several codes is the answer. */
const RANK: Record<CoverageVerdictDecision, number> = { covered: 0, needs_guarantee: 1, unknown: 2, limit_exhausted: 3, excluded: 4, policy_inactive: 5 };

const DAY = 86_400_000;
const addDays = (d: ISODate, n: number): ISODate => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export function ruleFor(rules: readonly CoverageRule[], program: ProgramCode, item: ServiceCatalogItem): CoverageRule | undefined {
  return rules.find((r) => r.program === program && r.serviceCode === item.code) ?? rules.find((r) => r.program === program && !r.serviceCode && r.category === item.category);
}

export function remainingOf(limits: readonly LimitUsage[], category: LimitCategory): Money | null {
  const l = limits.find((x) => x.category === category);
  return l ? Math.max(0, l.limit - l.used - (l.reserved ?? 0)) : null;
}

function one(code: string, input: CoverageInput, ctx: CoverageContext): CoverageVerdict {
  const item = ctx.catalog(code);
  if (!item) return { decision: 'unknown', clauseIds: [], limit: null, notes: [t('coverage.note.unknownCode', { code })] };
  const rule = ruleFor(ctx.rules, ctx.program, item);
  if (!rule) return { decision: 'unknown', clauseIds: [], limit: null, notes: [t('coverage.note.noRule', { name: item.name })] };
  const notes: string[] = [];
  if (rule.decision === 'excluded') return { decision: 'excluded', clauseIds: rule.clauseIds, limit: null, notes: [t('coverage.note.excluded', { name: item.name })] };
  if (rule.waitingDays) {
    const from = addDays(ctx.insured.insuredFrom, rule.waitingDays);
    if (input.serviceDate < from) {
      return { decision: 'excluded', clauseIds: [...rule.clauseIds, 'program:7.2'], limit: null, notes: [t('coverage.note.waiting', { days: rule.waitingDays, from })] };
    }
  }
  const remaining = remainingOf(ctx.limits, item.limitCategory);
  let limit: CoverageVerdict['limit'] = null;
  if (remaining !== null) {
    limit = { category: item.limitCategory, remaining };
    if (remaining <= 0) return { decision: 'limit_exhausted', clauseIds: ['program:7.1', 'contract:4.6'], limit, notes: [t('coverage.note.limitExhausted')] };
    if (input.amount !== undefined) {
      const payable = Math.min(input.amount, rule.subLimit ?? Infinity);
      limit.afterThis = remaining - Math.min(payable, remaining);
      if (rule.subLimit !== undefined && input.amount > rule.subLimit) notes.push(t('coverage.note.subLimit', { limit: rule.subLimit }));
      if (payable > remaining) notes.push(t('coverage.note.partly', { remaining }));
    }
  }
  const guarantee = rule.decision === 'needs_guarantee' || item.requiresGuarantee;
  return { decision: guarantee ? 'needs_guarantee' : 'covered', clauseIds: rule.clauseIds, limit, notes };
}

export function evaluateCoverage(input: CoverageInput, ctx: CoverageContext): CoverageVerdict {
  const p = ctx.policy;
  const person = ctx.insured;
  const outOfPolicy = p.status !== 'active' || input.serviceDate < p.startDate || input.serviceDate > p.endDate;
  const outOfPerson = input.serviceDate < person.insuredFrom || (!!person.excludedFrom && input.serviceDate >= person.excludedFrom) || person.status === 'excluded' && !person.excludedFrom;
  if (outOfPolicy || outOfPerson) {
    return { decision: 'policy_inactive', clauseIds: ['contract:6.1', 'program:7.3'], limit: null, notes: [outOfPolicy ? t('coverage.note.policyInactive') : t('coverage.note.personInactive')] };
  }
  if (!input.serviceCodes.length) return { decision: 'unknown', clauseIds: [], limit: null, notes: [t('coverage.note.unrecognized')] };
  const verdicts = input.serviceCodes.map((c) => one(c, input, ctx));
  const worst = verdicts.reduce((a, b) => (RANK[b.decision] > RANK[a.decision] ? b : a));
  return {
    decision: worst.decision,
    clauseIds: [...new Set(verdicts.flatMap((v) => v.clauseIds))],
    limit: worst.limit ?? verdicts.find((v) => v.limit)?.limit ?? null,
    notes: [...new Set(verdicts.flatMap((v) => v.notes))],
  };
}

/** «доступен / на исходе / исчерпан» for clinics: they never see the sums (CLINIC_SPEC §3). */
export function limitStatus(limit: CoverageVerdict['limit'], limits: readonly LimitUsage[], lowShare: number): 'available' | 'low' | 'exhausted' | null {
  if (!limit) return null;
  if (limit.remaining <= 0) return 'exhausted';
  const total = limits.find((l) => l.category === limit.category)?.limit ?? 0;
  return total > 0 && limit.remaining <= total * lowShare ? 'low' : 'available';
}
