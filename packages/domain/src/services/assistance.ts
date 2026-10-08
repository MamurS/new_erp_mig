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
  LimitCategory,
  Payer,
  PriceListItem,
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
  GUARANTEE_DECISION_HOURS,
  LIMIT_OF_SERVICE,
  payerOn,
  qaSample,
  rebillChecks,
} from '../assistance';
import { registryStatusAfterReview } from '../clinics';
import { randomId } from '../lib/random';
import { DAY, isoDay, parseIso, tzIso } from '../lib/time';
import type { ClaimRow, InsuredRow } from '../store/db';
import { conflict, DomainError, notFound, type BaseCtx } from './kernel';
import { loadParams, type ParamsView } from './params';
import { CATEGORY_TO_CLAIM_OF_SERVICE, clinicOf, emitWebhook, nextClaimNumber, priceListOf, refreshStoredGuarantee } from './clinic';
import { limitsFor } from './views';

export const todayIso = (ctx: Pick<BaseCtx, 'now'>) => isoDay(ctx.now());

/** Assignments of one policy (every rule of ../assistance.ts looks at one policy at a time). */
const assignmentsOf = (ctx: BaseCtx, policyId: UUID): Promise<AssistanceAssignment[]> => ctx.repos.assignments.list({ where: { policyId } });

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
  return assistanceOn(await assignmentsOf(ctx, policyId), policyId, todayIso(ctx));
}

/** Keeps the cached `assistanceId` of policies and clients in line with the assignments for today. */
export async function syncAssistance(ctx: BaseCtx): Promise<void> {
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

/** People whose policy is assigned to the assistance today. */
export async function rosterOf(ctx: BaseCtx, assistanceId: UUID): Promise<InsuredRow[]> {
  const today = todayIso(ctx);
  const assignments = await ctx.repos.assignments.list();
  const policies = (await ctx.repos.policies.list()).filter((p) => assistanceOn(assignments, p.id, today) === assistanceId).map((p) => p.id);
  if (!policies.length) return [];
  return ctx.repos.insured.list({ where: { policyId: { in: policies } } });
}

// ---------------------------------------------------------------- payers & price lists

export async function insuredOfVisit(ctx: BaseCtx, visitId: UUID | undefined): Promise<InsuredRow | undefined> {
  const v = visitId ? await ctx.repos.visits.get(visitId) : null;
  return v ? ((await ctx.repos.insured.get(v.insuredId)) ?? undefined) : undefined;
}

/** Payer of a registry line: the assistance of the policy on the service date, otherwise MIG (§5.3). */
export async function payerOfLine(ctx: BaseCtx, line: Pick<RegistryLine, 'visitId' | 'serviceDate'>): Promise<Payer> {
  const who = await insuredOfVisit(ctx, line.visitId);
  return who ? payerOn(await assignmentsOf(ctx, who.policyId), who.policyId, line.serviceDate) : 'mig';
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

const PAID_LIKE_REBILL = new Set(['approved', 'to_pay', 'paid']);
const PAID_LIKE_STATUSES = ['approved', 'to_pay', 'paid'] as const;

/**
 * Parts of the limit that are not claims yet: approved guarantee letters (reserve) and registry lines
 * accepted by an assistance that are not in an accepted rebill yet (used). One pass, so a line accepted
 * together with its letter moves the amount from the reserve to the used part atomically (§13.6).
 */
export async function limitExtras(ctx: BaseCtx, i: InsuredRow, fromMs: number): Promise<{ reserved: Record<LimitCategory, number>; used: Record<LimitCategory, number> }> {
  const r = ctx.repos;
  const zero = (): Record<LimitCategory, number> => ({ outpatient: 0, dental: 0, medicines: 0, inpatient: 0 });
  const reserved = zero();
  const used = zero();
  const lists = new Map<UUID, PriceListItem[]>();
  const categoryOf = async (clinicId: UUID, code: string): Promise<LimitCategory> => {
    let list = lists.get(clinicId);
    if (!list) lists.set(clinicId, (list = await priceListOf(ctx, clinicId)));
    const svc = list.find((p) => p.code === code);
    return LIMIT_OF_SERVICE[svc?.category ?? 'outpatient'];
  };
  for (const g of await r.guarantees.list({ where: { insuredId: i.id } })) {
    await refreshStoredGuarantee(ctx, g);
    if (g.status !== 'approved') continue;
    reserved[await categoryOf(g.clinicId, g.serviceCode)] += g.approvedAmount ?? g.estimatedCost;
  }
  const visits = new Set((await r.visits.list({ where: { insuredId: i.id } })).map((v) => v.id));
  if (!visits.size) return { reserved, used };
  const claimed = new Set((await r.claims.list({ where: { insuredId: i.id, registryLineId: { isNull: false }, status: { in: PAID_LIKE_STATUSES } } })).filter((c) => c.registryLineId).map((c) => c.registryLineId));
  for (const reg of await r.registries.list()) {
    for (const l of reg.lines) {
      if (!l.visitId || !visits.has(l.visitId) || l.status !== 'accepted' || (l.payer ?? 'mig') === 'mig' || claimed.has(l.id)) continue;
      if (parseIso(l.serviceDate) < fromMs - 7 * DAY) continue;
      used[await categoryOf(reg.clinicId, l.serviceCode)] += l.amount;
    }
  }
  return { reserved, used };
}

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
  const found = await findRegistryLine(ctx, line.registryLineId);
  if (!found) return [{ code: 'not_paid_to_clinic', message: msg('srv.rebill.registryLineNotFound') }];
  const { r, l } = found;
  const who = await insuredOfVisit(ctx, l.visitId);
  const policy = who ? await ctx.repos.policies.get(who.policyId) : null;
  const svc = (await priceListOf(ctx, r.clinicId)).find((p) => p.code === l.serviceCode);
  const contract = (await priceListOf(ctx, r.clinicId, rebill.assistanceId)).find((p) => p.code === l.serviceCode);
  const g = l.guaranteeNumber ? await ctx.repos.guarantees.first({ where: { number: l.guaranteeNumber, clinicId: r.clinicId } }) : null;
  let limitLeft = Number.MAX_SAFE_INTEGER;
  if (who) {
    const cat = LIMIT_OF_SERVICE[svc?.category ?? 'outpatient'];
    const usage = (await limitsFor(ctx, who)).find((x) => x.category === cat);
    // The line itself is already counted as used once it is accepted.
    if (usage) limitLeft = usage.limit - usage.used + (l.status === 'accepted' ? l.amount : 0);
  }
  const policyActive = !!policy && !!who && policy.startDate <= l.serviceDate && l.serviceDate <= policy.endDate && who.insuredFrom <= l.serviceDate && (!who.excludedFrom || l.serviceDate < who.excludedFrom);
  const others = await ctx.repos.rebills.list({ where: { id: { ne: rebill.id } } });
  const checks = rebillChecks({
    accepted: l.status === 'accepted',
    paidToClinic: !!l.payment,
    policyActive,
    assigned: !!policy && payerOn(await assignmentsOf(ctx, policy.id), policy.id, l.serviceDate) === rebill.assistanceId,
    amount: l.amount,
    limitLeft,
    requiresGuarantee: !!svc?.requiresGuarantee,
    guaranteeApproved: g && (g.status === 'approved' || g.status === 'used') ? (g.approvedAmount ?? g.estimatedCost) : null,
    duplicate: others.some((b) => b.lines.some((x) => x.registryLineId === l.id && x.status !== 'rejected')),
    price: l.price,
    contractPrice: contract?.price ?? null,
  });
  // The AI precheck (AI_COVERAGE_SPEC §4.4) adds its flag next to the automatic checks.
  const ai = await ctx.repos.aiRebillFlags.get(l.id);
  return ai ? [...checks, { code: 'ai_disagrees', message: ai }] : checks;
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
  const { from, to } = monthBounds(period);
  const today = todayIso(ctx);
  const assignments = await ctx.repos.assignments.list();
  const policies = new Set((await ctx.repos.policies.list()).filter((p) => assistanceOn(assignments, p.id, to < today ? to : today) === a.id).map((p) => p.id));
  const insuredCount = policies.size ? (await ctx.repos.insured.list({ where: { policyId: { in: [...policies] }, insuredFrom: { lte: to } } })).filter((i) => !i.excludedFrom || i.excludedFrom > from).length : 0;
  const casesCount = (await ctx.repos.cases.list({ where: { assistanceId: a.id } })).filter((c) => c.createdAt.slice(0, 7) === period).length;
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
  const r = ctx.repos;
  const P = await loadParams(ctx);
  const now = tzIso(ctx.now());
  for (const line of b.lines) {
    if (line.status !== 'accepted' || (await r.claims.exists({ registryLineId: line.registryLineId }))) continue;
    const found = await findRegistryLine(ctx, line.registryLineId);
    const who = found ? await insuredOfVisit(ctx, found.l.visitId) : undefined;
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
    if (letter) {
      for (const c of await r.cases.list()) if (c.links.guaranteeId === letter.id) await r.cases.update(c.id, { links: { ...c.links, claimId: claim.id } });
    }
    // The claim enters the client's loss ratio like any other paid-out claim.
    const client = await r.clients.get(who.clientId);
    if (client && client.premium > 0) await r.clients.update(client.id, { lossRatio: Math.round(((client.lossRatio ?? 0) + line.amount / client.premium) * 1000) / 1000 });
  }
}

// ---------------------------------------------------------------- KPI & quality control

export async function kpiOf(ctx: BaseCtx, a: AssistanceCompany, now = ctx.now()): Promise<AssistanceKpi> {
  const r = ctx.repos;
  const roster = await rosterOf(ctx, a.id);
  const people = new Set(roster.map((i) => i.id));
  const answered = (await r.appointments.list({ where: { respondedAt: { isNull: false } } })).filter((x) => people.has(x.insuredId) && x.respondedAt);
  const avg = answered.length ? Math.round(answered.reduce((s, x) => s + (parseIso(x.respondedAt!) - parseIso(x.createdAt)), 0) / answered.length / 60_000) : 0;
  const decided = (await r.guarantees.list({ where: { assistanceId: a.id, decidedBy: 'assistance' } })).filter((g) => g.decidedAt);
  const onTime = decided.filter((g) => parseIso(g.decidedAt!) - parseIso(g.createdAt) <= GUARANTEE_DECISION_HOURS * 3600_000).length;
  const reviewed = (await r.qaSamples.list({ where: { assistanceId: a.id } })).filter((s) => s.verdict);
  const agreed = reviewed.filter((s) => s.verdict === 'agree').length;
  const complaints = (await r.cases.list({ where: { assistanceId: a.id, type: 'complaint' } })).filter((c) => parseIso(c.createdAt) >= now - 30 * DAY).length;
  // Loss ratio of the portfolio: every paid-out claim of its people plus lines accepted but not rebilled yet.
  const policyIds = new Set(roster.map((i) => i.policyId));
  const premium = (await r.policies.list()).filter((p) => policyIds.has(p.id)).reduce((s, p) => s + p.premium, 0);
  const allClaims = await r.claims.list();
  const paid = allClaims.filter((c) => people.has(c.insuredId) && PAID_LIKE_REBILL.has(c.status)).reduce((s, c) => s + (c.amountApproved ?? c.amountClaimed), 0);
  const claimedLines = new Set(allClaims.map((c) => c.registryLineId).filter(Boolean));
  const inLines = (await r.registries.list()).flatMap((x) => x.lines).filter((l) => l.payer === a.id && l.status === 'accepted' && !claimedLines.has(l.id));
  const losses = paid + inLines.reduce((s, l) => s + l.amount, 0);
  return {
    appointmentResponseMinutesAvg: avg,
    guaranteesOnTimeShare: decided.length ? onTime / decided.length : 1,
    qaAgreementShare: reviewed.length ? agreed / reviewed.length : 1,
    complaintsPer1000: roster.length ? Math.round((complaints / roster.length) * 1000 * 10) / 10 : 0,
    lossRatio: premium > 0 ? Math.round((losses / premium) * 1000) / 1000 : null,
  };
}

/** Adds this month's 5% sample of the assistance's decisions to the MIG queue (deterministic, idempotent). */
export async function ensureQaSample(ctx: BaseCtx, now = ctx.now()): Promise<void> {
  const r = ctx.repos;
  const P = await loadParams(ctx);
  const month = isoDay(now).slice(0, 7);
  const known = new Set((await r.qaSamples.list()).map((s) => s.subject.id));
  const registries = await r.registries.list();
  for (const a of await r.assistances.list()) {
    const decisions: { id: UUID; type: 'guarantee' | 'registry_line'; label: string; at: string }[] = [
      ...(await r.guarantees.list({ where: { assistanceId: a.id, decidedBy: 'assistance' } }))
        .filter((g) => (g.decidedAt ?? g.createdAt).startsWith(month))
        .map((g) => ({ id: g.id, type: 'guarantee' as const, label: g.number, at: g.decidedAt ?? g.createdAt })),
      ...registries
        .filter((x) => (x.submittedAt ?? '').startsWith(month))
        .flatMap((x) => x.lines.filter((l) => l.payer === a.id && l.status === 'accepted').map((l) => ({ id: l.id, type: 'registry_line' as const, label: `${x.period}: ${l.serviceName}`, at: x.submittedAt! }))),
    ];
    for (const x of qaSample(decisions, month, P.dmsParam('qaSampleShare'))) {
      if (known.has(x.id)) continue;
      await r.qaSamples.insert({ id: randomId(), assistanceId: a.id, subject: { type: x.type, id: x.id, label: x.label }, createdAt: tzIso(now) }, { at: 'start' });
    }
  }
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
