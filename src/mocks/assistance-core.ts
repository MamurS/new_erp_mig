/*
 * Assistance "server" logic shared by the /assist portal, the staff portal, the clinic cabinet and the
 * integration API (ASSISTANCE_SPEC). Scope by the date of the event, payers of registry lines, limits
 * with guarantee reserves, rebills with automatic checks, KPI and the quality-control sample.
 */
import type {
  AssistanceCompany,
  AssistanceKpi,
  LimitCategory,
  Payer,
  Rebill,
  RebillLine,
  Registry,
  RegistryLine,
  UUID,
  WebhookEvent,
} from '@/shared/types';
import {
  assistanceOn,
  assistanceScope,
  feeFor,
  GUARANTEE_DECISION_HOURS,
  LIMIT_OF_SERVICE,
  payerOn,
  qaSample,
  rebillChecks,
} from '@/shared/domain/assistance';
import { registryStatusAfterReview } from '@/shared/domain/clinics';
import { CATEGORY_TO_CLAIM_OF_SERVICE, clinicOf, emitWebhook, nextClaimNumber, priceListOf, refreshGuarantee } from './clinic-core';
import type { ClaimRow, Db, InsuredRow } from './db';
import { conflict, HttpError, notFound } from './http';
import { randomId } from './rng';
import { dmsParam } from './params';
import { DAY, isoDay, parseIso, tzIso } from './time';
import { limitsFor } from './views';

export const todayIso = () => isoDay(Date.now());

export function assistanceOf(d: Db, id: UUID): AssistanceCompany {
  const a = d.assistances.find((x) => x.id === id);
  if (!a) throw notFound();
  return a;
}

export const assistanceName = (d: Db, id: UUID | null | undefined): string | null => (id ? (d.assistances.find((a) => a.id === id)?.name ?? null) : null);

/** Assistance company serving the policy today (null — MIG). */
export const currentAssistance = (d: Db, policyId: UUID): UUID | null => assistanceOn(d.assignments, policyId, todayIso());

/** Keeps the cached `assistanceId` of policies and clients in line with the assignments for today. */
export function syncAssistance(d: Db): void {
  const today = todayIso();
  for (const p of d.policies) p.assistanceId = assistanceOn(d.assignments, p.id, p.status === 'expired' && p.endDate < today ? p.endDate : today);
  for (const c of d.clients) {
    const p = d.policies.find((x) => x.id === c.activePolicyId);
    c.assistanceId = p?.assistanceId ?? null;
  }
}

/**
 * The only way to an insured person's record for an assistance company (§3, §13.1–13.2): the policy must be
 * assigned to it on the date of the event. A former assistance keeps read-only access for 12 months;
 * anything else is 404. `write` on a read-only record is 403.
 */
export function requireAssistanceScope(d: Db, assistanceId: UUID, policyId: UUID, eventDate: string, mode: 'read' | 'write' = 'read'): 'full' | 'read' {
  const s = assistanceScope(d.assignments, assistanceId, policyId, eventDate, todayIso());
  if (s === 'none') throw notFound();
  if (mode === 'write' && s !== 'full') throw new HttpError(403, 'forbidden', 'srv.assist.readOnly');
  return s;
}

/** Access to a person's card: current assignment, or read-only for a former assistance within 12 months. */
export function insuredAccess(d: Db, assistanceId: UUID, i: InsuredRow): 'full' | 'read' | 'none' {
  const today = todayIso();
  const now = assistanceScope(d.assignments, assistanceId, i.policyId, today, today);
  if (now !== 'none') return now;
  const past = d.assignments.filter((a) => a.policyId === i.policyId && a.assistanceId === assistanceId && a.to);
  for (const a of past) {
    const s = assistanceScope(d.assignments, assistanceId, i.policyId, a.to!, today);
    if (s !== 'none') return 'read';
  }
  return 'none';
}

export function requireInsuredOf(d: Db, assistanceId: UUID, insuredId: UUID): { i: InsuredRow; access: 'full' | 'read' } {
  const i = d.insured.find((x) => x.id === insuredId);
  if (!i) throw notFound();
  const access = insuredAccess(d, assistanceId, i);
  if (access === 'none') throw notFound();
  return { i, access };
}

/** People whose policy is assigned to the assistance today. */
export function rosterOf(d: Db, assistanceId: UUID): InsuredRow[] {
  const today = todayIso();
  const policies = new Set(d.policies.filter((p) => assistanceOn(d.assignments, p.id, today) === assistanceId).map((p) => p.id));
  return d.insured.filter((i) => policies.has(i.policyId));
}

// ---------------------------------------------------------------- payers & price lists

export function insuredOfVisit(d: Db, visitId: UUID | undefined): InsuredRow | undefined {
  const v = visitId ? d.visits.find((x) => x.id === visitId) : undefined;
  return v ? d.insured.find((i) => i.id === v.insuredId) : undefined;
}

/** Payer of a registry line: the assistance of the policy on the service date, otherwise MIG (§5.3). */
export function payerOfLine(d: Db, line: Pick<RegistryLine, 'visitId' | 'serviceDate'>): Payer {
  const who = insuredOfVisit(d, line.visitId);
  return who ? payerOn(d.assignments, who.policyId, line.serviceDate) : 'mig';
}

export const payerName = (d: Db, payer: Payer | undefined): string => (!payer || payer === 'mig' ? 'МИГ' : (assistanceName(d, payer) ?? 'Ассистанс'));

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

/** Registry status after a payer paid its lines: paid once every accepted line is paid and nothing waits. */
export function settleRegistry(r: Registry): void {
  if (r.lines.some((l) => l.status === 'pending' || l.status === 'disputed')) return;
  if (r.lines.filter((l) => l.status === 'accepted').every((l) => l.payment)) {
    r.status = 'paid';
    r.paidAt ??= tzIso(Date.now());
  }
}

// ---------------------------------------------------------------- limits

const PAID_LIKE_REBILL = new Set(['approved', 'to_pay', 'paid']);

/**
 * Parts of the limit that are not claims yet: approved guarantee letters (reserve) and registry lines
 * accepted by an assistance that are not in an accepted rebill yet (used). One pass, so a line accepted
 * together with its letter moves the amount from the reserve to the used part atomically (§13.6).
 */
export function limitExtras(d: Db, i: InsuredRow, fromMs: number): { reserved: Record<LimitCategory, number>; used: Record<LimitCategory, number> } {
  const zero = (): Record<LimitCategory, number> => ({ outpatient: 0, dental: 0, medicines: 0, inpatient: 0 });
  const reserved = zero();
  const used = zero();
  const categoryOf = (clinicId: UUID, code: string): LimitCategory => {
    const svc = priceListOf(d, clinicId).find((p) => p.code === code);
    return LIMIT_OF_SERVICE[svc?.category ?? 'outpatient'];
  };
  for (const g of d.guarantees) {
    if (g.insuredId !== i.id) continue;
    refreshGuarantee(g);
    if (g.status !== 'approved') continue;
    reserved[categoryOf(g.clinicId, g.serviceCode)] += g.approvedAmount ?? g.estimatedCost;
  }
  const visits = new Set(d.visits.filter((v) => v.insuredId === i.id).map((v) => v.id));
  if (!visits.size) return { reserved, used };
  const claimed = new Set(d.claims.filter((c) => c.registryLineId && c.insuredId === i.id && PAID_LIKE_REBILL.has(c.status)).map((c) => c.registryLineId));
  for (const r of d.registries) {
    for (const l of r.lines) {
      if (!l.visitId || !visits.has(l.visitId) || l.status !== 'accepted' || (l.payer ?? 'mig') === 'mig' || claimed.has(l.id)) continue;
      if (parseIso(l.serviceDate) < fromMs - 7 * DAY) continue;
      used[categoryOf(r.clinicId, l.serviceCode)] += l.amount;
    }
  }
  return { reserved, used };
}

// ---------------------------------------------------------------- rebills

/** Lines of the assistance that were paid to clinics in the period (the base of a rebill, §5.5). */
export function rebillCandidates(d: Db, assistanceId: UUID, period: string): { r: Registry; l: RegistryLine }[] {
  const inOther = new Set(d.rebills.filter((b) => b.assistanceId === assistanceId && b.status !== 'draft').flatMap((b) => b.lines.map((l) => l.registryLineId)));
  const out: { r: Registry; l: RegistryLine }[] = [];
  for (const r of d.registries) {
    for (const l of r.lines) {
      if (l.payer === assistanceId && l.status === 'accepted' && l.payment?.paidAt.startsWith(period) && !inOther.has(l.id)) out.push({ r, l });
    }
  }
  return out;
}

export function findRegistryLine(d: Db, lineId: UUID): { r: Registry; l: RegistryLine } | null {
  for (const r of d.registries) {
    const l = r.lines.find((x) => x.id === lineId);
    if (l) return { r, l };
  }
  return null;
}

/** Automatic checks of one rebill line against the data of MIG (§5.5). */
export function checksFor(d: Db, rebill: Pick<Rebill, 'id' | 'assistanceId'>, line: Pick<RebillLine, 'registryLineId'>): RebillLine['checks'] {
  const found = findRegistryLine(d, line.registryLineId);
  if (!found) return [{ code: 'not_paid_to_clinic', message: 'Строка реестра не найдена' }];
  const { r, l } = found;
  const who = insuredOfVisit(d, l.visitId);
  const policy = who && d.policies.find((p) => p.id === who.policyId);
  const svc = priceListOf(d, r.clinicId).find((p) => p.code === l.serviceCode);
  const contract = priceListOf(d, r.clinicId, rebill.assistanceId).find((p) => p.code === l.serviceCode);
  const g = l.guaranteeNumber ? d.guarantees.find((x) => x.number === l.guaranteeNumber && x.clinicId === r.clinicId) : undefined;
  let limitLeft = Number.MAX_SAFE_INTEGER;
  if (who) {
    const cat = LIMIT_OF_SERVICE[svc?.category ?? 'outpatient'];
    const usage = limitsFor(d, who).find((x) => x.category === cat);
    // The line itself is already counted as used once it is accepted.
    if (usage) limitLeft = usage.limit - usage.used + (l.status === 'accepted' ? l.amount : 0);
  }
  const policyActive = !!policy && !!who && policy.startDate <= l.serviceDate && l.serviceDate <= policy.endDate && who.insuredFrom <= l.serviceDate && (!who.excludedFrom || l.serviceDate < who.excludedFrom);
  const checks = rebillChecks({
    accepted: l.status === 'accepted',
    paidToClinic: !!l.payment,
    policyActive,
    assigned: !!policy && payerOn(d.assignments, policy.id, l.serviceDate) === rebill.assistanceId,
    amount: l.amount,
    limitLeft,
    requiresGuarantee: !!svc?.requiresGuarantee,
    guaranteeApproved: g && (g.status === 'approved' || g.status === 'used') ? (g.approvedAmount ?? g.estimatedCost) : null,
    duplicate: d.rebills.some((b) => b.id !== rebill.id && b.lines.some((x) => x.registryLineId === l.id && x.status !== 'rejected')),
    price: l.price,
    contractPrice: contract?.price ?? null,
  });
  // The AI precheck (AI_COVERAGE_SPEC §4.4) adds its flag next to the automatic checks.
  const ai = d.ai.rebillFlags[l.id];
  return ai ? [...checks, { code: 'ai_disagrees', message: ai }] : checks;
}

export function toRebillLine(d: Db, r: Registry, l: RegistryLine): RebillLine {
  return {
    id: randomId(),
    registryLineId: l.id,
    clinicName: clinicOf(d, r.clinicId).name,
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
export function feeOf(d: Db, a: AssistanceCompany, period: string, claimsAmount: number): Rebill['fee'] {
  const { from, to } = monthBounds(period);
  const policies = new Set(d.policies.filter((p) => assistanceOn(d.assignments, p.id, to < todayIso() ? to : todayIso()) === a.id).map((p) => p.id));
  const insuredCount = d.insured.filter((i) => policies.has(i.policyId) && i.insuredFrom <= to && (!i.excludedFrom || i.excludedFrom > from)).length;
  const casesCount = d.cases.filter((c) => c.assistanceId === a.id && c.createdAt.slice(0, 7) === period).length;
  return feeFor(a.contract.feeModel, a.contract.feeValue, { insuredCount, claimsAmount, casesCount });
}

export function recomputeRebill(d: Db, b: Rebill): void {
  const a = assistanceOf(d, b.assistanceId);
  const claims = b.lines.reduce((s, l) => s + l.amount, 0);
  if (b.status === 'draft' || b.status === 'submitted' || b.status === 'in_review') {
    for (const l of b.lines) if (l.status === 'pending' || l.status === 'disputed') l.checks = checksFor(d, b, l);
  }
  if (b.status === 'draft') b.fee = feeOf(d, a, b.period, claims);
  const sum = (s: RebillLine['status']) => b.lines.filter((l) => l.status === s).reduce((x, l) => x + l.amount, 0);
  b.totals = { claims, fee: b.fee.amount, total: claims + b.fee.amount, accepted: sum('accepted'), rejected: sum('rejected') };
}

/** Creates or refreshes the draft rebill of the period from the lines paid to clinics in it. */
export function upsertDraftRebill(d: Db, assistanceId: UUID, period: string, lineIds?: UUID[]): Rebill {
  const a = assistanceOf(d, assistanceId);
  const existing = d.rebills.find((b) => b.assistanceId === assistanceId && b.period === period);
  if (existing && existing.status !== 'draft') throw conflict('srv.rebill.periodSent', { period });
  let picked: { r: Registry; l: RegistryLine }[];
  if (lineIds) {
    picked = lineIds.map((id) => {
      const f = findRegistryLine(d, id);
      // Lines of other payers do not exist for this assistance (anti-enumeration).
      if (!f || f.l.payer !== assistanceId) throw new HttpError(422, 'validation', 'srv.rebill.lineNotFound', { fields: { lineIds: id } });
      return f;
    });
  } else {
    picked = rebillCandidates(d, assistanceId, period);
  }
  const lines = picked.map(({ r, l }) => toRebillLine(d, r, l));
  const b: Rebill = existing ?? {
    id: randomId(),
    number: `СЧА-${period}-${a.name.replace(/[^А-ЯЁA-Z]/g, '').slice(0, 3) || 'A'}`,
    assistanceId,
    period,
    lines: [],
    fee: feeFor(a.contract.feeModel, a.contract.feeValue, { insuredCount: 0, claimsAmount: 0, casesCount: 0 }),
    totals: { claims: 0, fee: 0, total: 0, accepted: 0, rejected: 0 },
    status: 'draft',
  };
  b.lines = lines;
  if (!existing) d.rebills.unshift(b);
  recomputeRebill(d, b);
  return b;
}

export function rebillStatusAfterReview(lines: RebillLine[]): Rebill['status'] {
  if (lines.some((l) => l.status === 'pending' || l.status === 'disputed')) return 'in_review';
  return lines.every((l) => l.status === 'accepted') ? 'accepted' : 'partially_accepted';
}

/** Accepted lines of an accepted rebill become MIG claims with the `assistance` source (§5.5). */
export function claimsFromRebill(d: Db, b: Rebill, actorName: string): void {
  const now = tzIso(Date.now());
  for (const line of b.lines) {
    if (line.status !== 'accepted' || d.claims.some((c) => c.registryLineId === line.registryLineId)) continue;
    const found = findRegistryLine(d, line.registryLineId);
    const who = found && insuredOfVisit(d, found.l.visitId);
    if (!found || !who) continue;
    const svc = priceListOf(d, found.r.clinicId).find((p) => p.code === found.l.serviceCode);
    const claim: ClaimRow = {
      id: randomId(),
      number: nextClaimNumber(d),
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
      slaDueAt: tzIso(Date.now() + 5 * DAY),
      createdAt: now,
      updatedAt: now,
      attachments: [],
      history: [
        { at: now, actorName: assistanceName(d, b.assistanceId) ?? 'Ассистанс', to: 'new' },
        { at: now, actorName, from: 'new', to: 'approved', comment: `Счёт ассистанса ${b.number}` },
      ],
      registryLineId: line.registryLineId,
    };
    d.claims.unshift(claim);
    // A case that led to the letter of this line now points to the claim as well.
    const letter = found.l.guaranteeNumber ? d.guarantees.find((g) => g.number === found.l.guaranteeNumber && g.clinicId === found.r.clinicId) : undefined;
    if (letter) for (const c of d.cases) if (c.links.guaranteeId === letter.id) c.links.claimId = claim.id;
    // The claim enters the client's loss ratio like any other paid-out claim.
    const client = d.clients.find((c) => c.id === who.clientId);
    if (client && client.premium > 0) client.lossRatio = Math.round(((client.lossRatio ?? 0) + line.amount / client.premium) * 1000) / 1000;
  }
}

// ---------------------------------------------------------------- KPI & quality control

export function kpiOf(d: Db, a: AssistanceCompany, now = Date.now()): AssistanceKpi {
  const roster = rosterOf(d, a.id);
  const people = new Set(roster.map((i) => i.id));
  const answered = d.appointments.filter((x) => people.has(x.insuredId) && x.respondedAt);
  const avg = answered.length ? Math.round(answered.reduce((s, x) => s + (parseIso(x.respondedAt!) - parseIso(x.createdAt)), 0) / answered.length / 60_000) : 0;
  const decided = d.guarantees.filter((g) => g.assistanceId === a.id && g.decidedBy === 'assistance' && g.decidedAt);
  const onTime = decided.filter((g) => parseIso(g.decidedAt!) - parseIso(g.createdAt) <= GUARANTEE_DECISION_HOURS * 3600_000).length;
  const reviewed = d.qaSamples.filter((s) => s.assistanceId === a.id && s.verdict);
  const agreed = reviewed.filter((s) => s.verdict === 'agree').length;
  const complaints = d.cases.filter((c) => c.assistanceId === a.id && c.type === 'complaint' && parseIso(c.createdAt) >= now - 30 * DAY).length;
  // Loss ratio of the portfolio: every paid-out claim of its people plus lines accepted but not rebilled yet.
  const policyIds = new Set(roster.map((i) => i.policyId));
  const premium = d.policies.filter((p) => policyIds.has(p.id)).reduce((s, p) => s + p.premium, 0);
  const paid = d.claims.filter((c) => people.has(c.insuredId) && PAID_LIKE_REBILL.has(c.status)).reduce((s, c) => s + (c.amountApproved ?? c.amountClaimed), 0);
  const claimedLines = new Set(d.claims.map((c) => c.registryLineId).filter(Boolean));
  const inLines = d.registries.flatMap((r) => r.lines).filter((l) => l.payer === a.id && l.status === 'accepted' && !claimedLines.has(l.id));
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
export function ensureQaSample(d: Db, now = Date.now()): void {
  const month = isoDay(now).slice(0, 7);
  const known = new Set(d.qaSamples.map((s) => s.subject.id));
  for (const a of d.assistances) {
    const decisions: { id: UUID; type: 'guarantee' | 'registry_line'; label: string; at: string }[] = [
      ...d.guarantees.filter((g) => g.assistanceId === a.id && g.decidedBy === 'assistance' && (g.decidedAt ?? g.createdAt).startsWith(month)).map((g) => ({ id: g.id, type: 'guarantee' as const, label: `ГП ${g.number}`, at: g.decidedAt ?? g.createdAt })),
      ...d.registries
        .filter((r) => (r.submittedAt ?? '').startsWith(month))
        .flatMap((r) => r.lines.filter((l) => l.payer === a.id && l.status === 'accepted').map((l) => ({ id: l.id, type: 'registry_line' as const, label: `${r.period}: ${l.serviceName}`, at: r.submittedAt! }))),
    ];
    for (const x of qaSample(decisions, month, dmsParam('qaSampleShare'))) {
      if (known.has(x.id)) continue;
      d.qaSamples.unshift({ id: randomId(), assistanceId: a.id, subject: { type: x.type, id: x.id, label: x.label }, createdAt: tzIso(now) });
    }
  }
}

// ---------------------------------------------------------------- webhooks

/** Thin webhook to the assistance's endpoints (the `clinicId` column holds the partner id). */
export async function notifyAssistance(d: Db, assistanceId: UUID | null | undefined, event: WebhookEvent, objectId: UUID): Promise<void> {
  if (!assistanceId) return;
  await emitWebhook(d, assistanceId, event, objectId);
}

export const monthOf = (iso: string) => iso.slice(0, 7);

/** Authority of the assistance on guarantee letters: the individual contract value or the DMS parameter. */
export function authorityLimitOf(a: Pick<AssistanceCompany, 'contract'>): number {
  return a.contract.guaranteeAuthorityLimit ?? dmsParam('assistanceGuaranteeAuthority');
}
