/*
 * Assistance "server" logic shared by the /assist portal, the staff portal, the clinic cabinet and the
 * integration API (ASSISTANCE_SPEC). Scope by the date of the event, payers of registry lines, limits
 * with guarantee reserves, rebills with automatic checks, KPI and the quality-control sample.
 */
import { msg, t } from '@mig/i18n';
import type {
  AssistanceAssignment,
  AssistanceCompany,
  AssistanceKpi,
  Payer,
  Rebill,
  RebillLine,
  Registry,
  RegistryLine,
  UUID,
  WebhookEvent,
} from '@mig/contracts';
import {
  assistanceOn,
  assistanceScope,
  feeFor,
  LIMIT_OF_SERVICE,
  payerOn,
  rebillChecks } from '../assistance';
import { registryStatusAfterReview } from '../clinics';
import { randomId } from '../lib/random';
import { DAY, tzIso } from '../lib/time';
import type { ClaimRow, InsuredRow } from '../store/db';
import type { Routing, VisitPatient } from '../store/facts';
import type { Query, Where } from '../store/query';
import { allOf } from './list';
import { conflict, DomainError, notFound, todayIso, type BaseCtx } from './kernel';
import { loadParams, type ParamsView } from './params';
import { CATEGORY_TO_CLAIM_OF_SERVICE, clinicOf, emitWebhook, nextClaimNumber, priceListOf } from './clinic';
import { limitsFor } from './views';
import { ensureQaSample } from './system/clocks';


/**
 * Assignments the person reads (`undefined`: of every policy): MIG staff read all of them, an assistance company its
 * own — enough for its scope (assistanceScope looks only at the company's own periods).
 */
export const assignmentsOf = (ctx: BaseCtx, policyId?: UUID): Promise<AssistanceAssignment[]> => ctx.repos.assignments.list(policyId ? { where: { policyId } } : {});

/** Routing of one policy — which company serves it from which date, of every company (app.fact_policy_routing). */
export const routingOf = (ctx: BaseCtx, policyId: UUID): Promise<Routing[]> => ctx.repos.facts.policyRouting(policyId);

export async function assistanceOf(ctx: BaseCtx, id: UUID): Promise<AssistanceCompany> {
  const a = await ctx.repos.assistances.get(id);
  if (!a) throw notFound();
  return a;
}

export async function assistanceName(ctx: BaseCtx, id: UUID | null | undefined): Promise<string | null> {
  return id ? ((await ctx.repos.assistances.get(id))?.name ?? null) : null;
}

/** Assistance company serving the policy today (null — MIG). */
export async function currentAssistance(ctx: BaseCtx, policyId: UUID): Promise<UUID | null> {
  return assistanceOn(await routingOf(ctx, policyId), policyId, todayIso(ctx));
}

/** Keeps the cached `assistanceId` of policies and clients in line with the assignments for today. */
export async function syncAssistance(ctx: BaseCtx): Promise<void> {
  // A cache of the assignments on policies and clients: kept by whoever changes the assignments (the underwriter,
  // who reads and updates both) or by the system's jobs (the portfolio transfer, the contract clock).
  const r = ctx.repos;
  const today = todayIso(ctx);
  const assignments = await r.assignments.list();
  const policies = await r.policies.list();
  for (const p of policies) {
    const next = assistanceOn(assignments, p.id, p.status === 'expired' && p.endDate < today ? p.endDate : today);
    if (p.assistanceId !== next) await r.policies.update(p.id, { assistanceId: next });
    p.assistanceId = next;
  }
  for (const c of await r.clients.list()) {
    const p = policies.find((x) => x.id === c.activePolicyId);
    const next = p?.assistanceId ?? null;
    if (c.assistanceId !== next) await r.clients.update(c.id, { assistanceId: next });
  }
}

/**
 * The only way to an insured person's record for an assistance company (§3, §13.1–13.2): the policy must be
 * assigned to it on the date of the event. A former assistance keeps read-only access for 12 months;
 * anything else is 404. `write` on a read-only record is 403.
 */
export async function requireAssistanceScope(ctx: BaseCtx, assistanceId: UUID, policyId: UUID, eventDate: string, mode: 'read' | 'write' = 'read'): Promise<'full' | 'read'> {
  const s = assistanceScope(await assignmentsOf(ctx, policyId), assistanceId, policyId, eventDate, todayIso(ctx));
  if (s === 'none') throw notFound();
  if (mode === 'write' && s !== 'full') throw new DomainError(403, 'forbidden', 'srv.assist.readOnly');
  return s;
}

/** Access to a person's card: current assignment, or read-only for a former assistance within 12 months. */
export async function insuredAccess(ctx: BaseCtx, assistanceId: UUID, i: InsuredRow): Promise<'full' | 'read' | 'none'> {
  const today = todayIso(ctx);
  const assignments = await assignmentsOf(ctx, i.policyId);
  const now = assistanceScope(assignments, assistanceId, i.policyId, today, today);
  if (now !== 'none') return now;
  const past = assignments.filter((a) => a.policyId === i.policyId && a.assistanceId === assistanceId && a.to);
  for (const a of past) {
    const s = assistanceScope(assignments, assistanceId, i.policyId, a.to!, today);
    if (s !== 'none') return 'read';
  }
  return 'none';
}

export async function requireInsuredOf(ctx: BaseCtx, assistanceId: UUID, insuredId: UUID): Promise<{ i: InsuredRow; access: 'full' | 'read' }> {
  const i = await ctx.repos.insured.get(insuredId);
  if (!i) throw notFound();
  const access = await insuredAccess(ctx, assistanceId, i);
  if (access === 'none') throw notFound();
  return { i, access };
}

/** Policies assigned to the assistance today (the roster's policies). */
export async function rosterPolicyIds(ctx: BaseCtx, assistanceId: UUID): Promise<UUID[]> {
  // The company's own assignments covering today (an assistance company reads only its own), confirmed by the routing
  // of each policy (the latest assignment of any company wins).
  const r = ctx.repos;
  const today = todayIso(ctx);
  const own = await r.assignments.list({ where: { assistanceId } });
  const policies: UUID[] = [];
  for (const policyId of new Set(own.map((a) => a.policyId))) {
    if (assistanceOn(own, policyId, today) !== assistanceId) continue;
    if (assistanceOn(await routingOf(ctx, policyId), policyId, today) === assistanceId) policies.push(policyId);
  }
  return policies;
}

/** People whose policy is assigned to the assistance today, under the reader's RLS (`q`: more conditions, an order, a page). */
export async function rosterOf(ctx: BaseCtx, assistanceId: UUID, q: Query<InsuredRow> = {}): Promise<InsuredRow[]> {
  const policies = await rosterPolicyIds(ctx, assistanceId);
  if (!policies.length) return [];
  return ctx.repos.insured.list({ ...q, where: allOf<InsuredRow>({ policyId: { in: policies } }, q.where as Where<InsuredRow> | undefined) });
}

// ---------------------------------------------------------------- payers & price lists

export async function insuredOfVisit(ctx: BaseCtx, visitId: UUID | undefined): Promise<VisitPatient | undefined> {
  // The payer of a service follows the patient of the visit, also after the visit closed: its name and policy only
  // (app.fact_visit_patient — a clinic sees a patient only while a visit is open).
  return visitId ? ((await ctx.repos.facts.visitPatient(visitId)) ?? undefined) : undefined;
}

/** The whole row of a visit's patient, for the system's own bookkeeping (its context reads every table). */
async function patientRowOf(sys: BaseCtx, visitId: UUID | undefined): Promise<InsuredRow | undefined> {
  const v = visitId ? await sys.repos.visits.get(visitId) : null;
  return v ? ((await sys.repos.insured.get(v.insuredId)) ?? undefined) : undefined;
}

/** Payer of a registry line: the assistance of the policy on the service date, otherwise MIG (§5.3). */
export async function payerOfLine(ctx: BaseCtx, line: Pick<RegistryLine, 'visitId' | 'serviceDate'>): Promise<Payer> {
  const who = await insuredOfVisit(ctx, line.visitId);
  return who ? payerOn(await routingOf(ctx, who.policyId), who.policyId, line.serviceDate) : 'mig';
}

export async function payerName(ctx: BaseCtx, payer: Payer | undefined): Promise<string> {
  return !payer || payer === 'mig' ? 'МИГ' : ((await assistanceName(ctx, payer)) ?? t('srv.dash.assistance'));
}

/** Lines of one payer: a sub-registry. */
export const linesOf = (r: Registry, payer: Payer): RegistryLine[] => r.lines.filter((l) => (l.payer ?? 'mig') === payer);

/** Status of a sub-registry from the payer's point of view. */
export function subStatus(r: Registry, lines: RegistryLine[]): Registry['status'] {
  if (r.status === 'draft' || r.status === 'submitted') return r.status;
  if (!lines.length) return r.status;
  const reviewed = registryStatusAfterReview(lines);
  if (reviewed === 'in_review') return reviewed;
  return lines.filter((l) => l.status === 'accepted').every((l) => l.payment) ? 'paid' : reviewed;
}

export function subTotals(lines: RegistryLine[]): Registry['totals'] {
  const sum = (f: (l: RegistryLine) => boolean) => lines.filter(f).reduce((s, l) => s + l.amount, 0);
  return { claimed: sum(() => true), accepted: sum((l) => l.status === 'accepted'), rejected: sum((l) => l.status === 'rejected'), paid: sum((l) => l.status === 'accepted' && !!l.payment) };
}

/** Registry status after a payer paid its lines: paid once every accepted line is paid and nothing waits (the caller saves `r`). */
export function settleRegistry(r: Registry, now = Date.now()): void {
  if (r.lines.some((l) => l.status === 'pending' || l.status === 'disputed')) return;
  if (r.lines.filter((l) => l.status === 'accepted').every((l) => l.payment)) {
    r.status = 'paid';
    r.paidAt ??= tzIso(now);
  }
}

// ---------------------------------------------------------------- limits


// ---------------------------------------------------------------- rebills

/** Lines of the assistance that were paid to clinics in the period (the base of a rebill, §5.5). */
export async function rebillCandidates(ctx: BaseCtx, assistanceId: UUID, period: string): Promise<{ r: Registry; l: RegistryLine }[]> {
  const inOther = new Set((await ctx.repos.rebills.list({ where: { assistanceId, status: { ne: 'draft' } } })).flatMap((b) => b.lines.map((l) => l.registryLineId)));
  const out: { r: Registry; l: RegistryLine }[] = [];
  for (const r of await ctx.repos.registries.list()) {
    for (const l of r.lines) {
      if (l.payer === assistanceId && l.status === 'accepted' && l.payment?.paidAt.startsWith(period) && !inOther.has(l.id)) out.push({ r, l });
    }
  }
  return out;
}

export async function findRegistryLine(ctx: BaseCtx, lineId: UUID): Promise<{ r: Registry; l: RegistryLine } | null> {
  for (const r of await ctx.repos.registries.list()) {
    const l = r.lines.find((x) => x.id === lineId);
    if (l) return { r, l };
  }
  return null;
}

/** Automatic checks of one rebill line against the data of MIG (§5.5). */
export async function checksFor(ctx: BaseCtx, rebill: Pick<Rebill, 'id' | 'assistanceId'>, line: Pick<RebillLine, 'registryLineId'>): Promise<RebillLine['checks']> {
  // MIG's data behind the line (the patient's and the policy's term, prices, the letter, duplicates, the AI flag) as
  // one narrow fact (app.fact_rebill_line_facts); the limit and the routing as their own facts.
  const f = await ctx.repos.facts.rebillLineFacts(line.registryLineId, rebill.id, rebill.assistanceId);
  if (!f) return [{ code: 'not_paid_to_clinic', message: msg('srv.rebill.registryLineNotFound') }];
  const { line: l, person: who, policy } = f;
  let limitLeft = Number.MAX_SAFE_INTEGER;
  if (who) {
    const cat = LIMIT_OF_SERVICE[f.service?.category ?? 'outpatient'];
    const usage = (await limitsFor(ctx, who)).find((x) => x.category === cat);
    // The line itself is already counted as used once it is accepted.
    if (usage) limitLeft = usage.limit - usage.used + (l.status === 'accepted' ? l.amount : 0);
  }
  const policyActive = !!policy && !!who && policy.startDate <= l.serviceDate && l.serviceDate <= policy.endDate && who.insuredFrom <= l.serviceDate && (!who.excludedFrom || l.serviceDate < who.excludedFrom);
  const checks = rebillChecks({
    accepted: l.status === 'accepted',
    paidToClinic: l.paid,
    policyActive,
    assigned: !!policy && payerOn(await routingOf(ctx, policy.id), policy.id, l.serviceDate) === rebill.assistanceId,
    amount: l.amount,
    limitLeft,
    requiresGuarantee: !!f.service?.requiresGuarantee,
    guaranteeApproved: f.guaranteeApproved,
    duplicate: f.duplicate,
    price: l.price,
    contractPrice: f.contractPrice,
  });
  // The AI precheck (AI_COVERAGE_SPEC §4.4) adds its flag next to the automatic checks.
  return f.aiFlag ? [...checks, { code: 'ai_disagrees', message: f.aiFlag }] : checks;
}

export async function toRebillLine(ctx: BaseCtx, r: Registry, l: RegistryLine): Promise<RebillLine> {
  return {
    id: randomId(),
    registryLineId: l.id,
    clinicName: (await clinicOf(ctx, r.clinicId)).name,
    insuredName: l.insuredName,
    serviceDate: l.serviceDate,
    serviceName: l.serviceName,
    amount: l.amount,
    checks: [],
    status: 'pending',
  };
}

function monthBounds(period: string): { from: string; to: string } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const from = `${period}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from, to };
}

/** Fee of the rebill by the model of the contract, with the formula shown to both sides. */
export async function feeOf(ctx: BaseCtx, a: AssistanceCompany, period: string, claimsAmount: number): Promise<Rebill['fee']> {
  // Counts of insured persons and cases of the company in the month (app.fact_assistance_fee_figures).
  const { from, to } = monthBounds(period);
  const { insuredCount, casesCount } = await ctx.repos.facts.assistanceFeeFigures(a.id, period, from, to, todayIso(ctx));
  return feeFor(a.contract.feeModel, a.contract.feeValue, { insuredCount, claimsAmount, casesCount });
}

/** Checks, fee and totals of a rebill; changes `b` in place (the caller saves it). */
export async function recomputeRebill(ctx: BaseCtx, b: Rebill): Promise<void> {
  const a = await assistanceOf(ctx, b.assistanceId);
  const claims = b.lines.reduce((s, l) => s + l.amount, 0);
  if (b.status === 'draft' || b.status === 'submitted' || b.status === 'in_review') {
    for (const l of b.lines) if (l.status === 'pending' || l.status === 'disputed') l.checks = await checksFor(ctx, b, l);
  }
  if (b.status === 'draft') b.fee = await feeOf(ctx, a, b.period, claims);
  const sum = (s: RebillLine['status']) => b.lines.filter((l) => l.status === s).reduce((x, l) => x + l.amount, 0);
  b.totals = { claims, fee: b.fee.amount, total: claims + b.fee.amount, accepted: sum('accepted'), rejected: sum('rejected') };
}

/** Creates or refreshes the draft rebill of the period from the lines paid to clinics in it (saved). */
export async function upsertDraftRebill(ctx: BaseCtx, assistanceId: UUID, period: string, lineIds?: UUID[]): Promise<Rebill> {
  const a = await assistanceOf(ctx, assistanceId);
  const existing = await ctx.repos.rebills.first({ where: { assistanceId, period } });
  if (existing && existing.status !== 'draft') throw conflict('srv.rebill.periodSent', { period });
  let picked: { r: Registry; l: RegistryLine }[];
  if (lineIds) {
    picked = [];
    for (const id of lineIds) {
      const f = await findRegistryLine(ctx, id);
      // Lines of other payers do not exist for this assistance (anti-enumeration).
      if (!f || f.l.payer !== assistanceId) throw new DomainError(422, 'validation', 'srv.rebill.lineNotFound', { fields: { lineIds: id } });
      picked.push(f);
    }
  } else {
    picked = await rebillCandidates(ctx, assistanceId, period);
  }
  const lines: RebillLine[] = [];
  for (const { r, l } of picked) lines.push(await toRebillLine(ctx, r, l));
  const P = await loadParams(ctx);
  const b: Rebill = existing ?? {
    id: randomId(),
    number: P.nextDocNumber('assistInvoice', { period, code: a.name.replace(/[^A-Z]/g, '').slice(0, 3) || 'A' }),
    assistanceId,
    period,
    lines: [],
    fee: feeFor(a.contract.feeModel, a.contract.feeValue, { insuredCount: 0, claimsAmount: 0, casesCount: 0 }),
    totals: { claims: 0, fee: 0, total: 0, accepted: 0, rejected: 0 },
    status: 'draft',
  };
  b.lines = lines;
  // The rebill's own lines never count as duplicates (checksFor skips it), so it may be saved after the recompute.
  await recomputeRebill(ctx, b);
  if (existing) await ctx.repos.rebills.put(b);
  else await ctx.repos.rebills.insert(b, { at: 'start' });
  return b;
}

export function rebillStatusAfterReview(lines: RebillLine[]): Rebill['status'] {
  if (lines.some((l) => l.status === 'pending' || l.status === 'disputed')) return 'in_review';
  return lines.every((l) => l.status === 'accepted') ? 'accepted' : 'partially_accepted';
}

/** Accepted lines of an accepted rebill become MIG claims with the `assistance` source (§5.5). */
export async function claimsFromRebill(ctx: BaseCtx, b: Rebill, actorName: string): Promise<void> {
  // Accepted lines become claims of MIG, created by the reviewer of the rebill (claims, registries, visits and
  // persons under the reviewer's RLS); the links of the assistance's cases and the client's loss ratio, which the
  // reviewer may not edit, through narrow facts.
  const r = ctx.repos;
  const P = await loadParams(ctx);
  const now = tzIso(ctx.now());
  for (const line of b.lines) {
    if (line.status !== 'accepted' || (await r.claims.exists({ registryLineId: line.registryLineId }))) continue;
    const found = await findRegistryLine(ctx, line.registryLineId);
    const who = found ? await patientRowOf(ctx, found.l.visitId) : undefined;
    if (!found || !who) continue;
    const svc = (await priceListOf(ctx, found.r.clinicId)).find((p) => p.code === found.l.serviceCode);
    const claim: ClaimRow = {
      id: randomId(),
      number: await nextClaimNumber(ctx, P),
      insuredId: who.id,
      insuredName: who.fullName,
      clientId: who.clientId,
      clientName: who.clientName,
      category: CATEGORY_TO_CLAIM_OF_SERVICE[svc?.category ?? 'outpatient'],
      source: 'assistance',
      amountClaimed: line.amount,
      amountApproved: line.amount,
      providerName: line.clinicName,
      serviceDate: line.serviceDate,
      status: 'approved',
      slaDueAt: tzIso(ctx.now() + 5 * DAY),
      createdAt: now,
      updatedAt: now,
      attachments: [],
      history: [
        { at: now, actorName: (await assistanceName(ctx, b.assistanceId)) ?? 'Ассистанс', to: 'new' },
        { at: now, actorName, from: 'new', to: 'approved', comment: `Счёт ассистанса ${b.number}` },
      ],
      registryLineId: line.registryLineId,
    };
    await r.claims.insert(claim, { at: 'start' });
    // A case that led to the letter of this line now points to the claim as well.
    const letter = found.l.guaranteeNumber ? await r.guarantees.first({ where: { number: found.l.guaranteeNumber, clinicId: found.r.clinicId } }) : null;
    if (letter) await r.facts.linkCasesToClaim(letter.id, claim.id);
    // The claim enters the client's loss ratio like any other paid-out claim.
    const client = await r.clients.get(who.clientId);
    if (client && client.premium > 0) await r.facts.setClientLossRatio(client.id, Math.round(((client.lossRatio ?? 0) + line.amount / client.premium) * 1000) / 1000);
  }
}

// ---------------------------------------------------------------- KPI & quality control

export async function kpiOf(ctx: BaseCtx, a: AssistanceCompany, now = ctx.now()): Promise<AssistanceKpi> {
  // Aggregates over the company's portfolio: counts and sums only (app.fact_assistance_kpi_figures).
  const f = await ctx.repos.facts.assistanceKpiFigures(a.id, now, todayIso(ctx));
  return {
    appointmentResponseMinutesAvg: f.answered ? Math.round(f.answeredMs / f.answered / 60_000) : 0,
    guaranteesOnTimeShare: f.decided ? f.onTime / f.decided : 1,
    qaAgreementShare: f.reviewed ? f.agreed / f.reviewed : 1,
    complaintsPer1000: f.rosterSize ? Math.round((f.complaints / f.rosterSize) * 1000 * 10) / 10 : 0,
    lossRatio: f.premium > 0 ? Math.round((f.losses / f.premium) * 1000) / 1000 : null,
  };
}


// ---------------------------------------------------------------- webhooks

/** Thin webhook to the assistance's endpoints (the `clinicId` column holds the partner id). */
export async function notifyAssistance(ctx: BaseCtx, assistanceId: UUID | null | undefined, event: WebhookEvent, objectId: UUID): Promise<void> {
  if (!assistanceId) return;
  await emitWebhook(ctx, assistanceId, event, objectId);
}

export const monthOf = (iso: string) => iso.slice(0, 7);

/** Authority of the assistance on guarantee letters: the individual contract value or the DMS parameter. */
export function authorityLimitOf(a: Pick<AssistanceCompany, 'contract'>, P: ParamsView): number {
  return a.contract.guaranteeAuthorityLimit ?? P.dmsParam('assistanceGuaranteeAuthority');
}

export { ensureQaSample };
