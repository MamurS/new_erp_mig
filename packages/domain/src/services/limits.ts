/*
 * Limits of a person (docs/PRIVILEGED_AUDIT.md): what they consist of — claims of the family pool, guarantee letters,
 * registry lines accepted by an assistance — lies in rows the caller may not read (an insured person, a clinic, an
 * assistance company see only the sums). The sums come as one narrow fact (`facts.limitSums`, app.fact_limit_sums);
 * the program's limits are added here.
 */
import type { LimitUsage, UUID } from '@mig/contracts';
import { limitModeOf } from '../config/dmsParameters';
import { isoDay } from '../lib/time';
import { PROGRAMS } from '../programs';
import type { CoverageBrief } from '../store/facts';
import { notFound, type BaseCtx } from './kernel';
import { loadParams, type ParamsView } from './params';

const LIMIT_CATEGORIES = ['outpatient', 'dental', 'medicines', 'inpatient'] as const;

/**
 * Limits of a person the caller may check. Parameter `limitMode`: `individual` — the person's own consumption;
 * `family_shared` — one pool per family and category: the consumption of every person of the family on the policy counts.
 */
export async function limitsFor(ctx: BaseCtx, i: { id: UUID }, P?: ParamsView): Promise<LimitUsage[]> {
  const params = P ?? (await loadParams(ctx));
  const sums = await ctx.repos.facts.limitSums(i.id, limitModeOf(params.paramValues()), isoDay(ctx.now()));
  if (!sums) throw notFound();
  const program = PROGRAMS[sums.program ?? 'standard'];
  return LIMIT_CATEGORIES.map((category) => ({
    category,
    limit: program.limits[category],
    used: sums.used[category] ?? 0,
    reserved: sums.reserved[category] ?? 0,
  }));
}

/** The policy and the person's own dates of a person the caller may check (404 when there is no such person). */
export async function coverageBriefOf(ctx: BaseCtx, insuredId: UUID): Promise<CoverageBrief> {
  const brief = await ctx.repos.facts.coverageBrief(insuredId);
  if (!brief) throw notFound();
  return brief;
}
