/*
 * Clinic "server" logic shared by the clinic cabinet (/api/clinic/...), the integration API
 * (/api/integration/v1/...) and the staff portal. Both clinic channels go through the same functions,
 * so the rules (visit-only access, limits, checks) are identical (CLINIC_SPEC §1, §3).
 */
import { msg, tm } from '@mig/i18n';
import type {
  Appointment,
  Clinic,
  CoverageCheckResult,
  GuaranteeLetter,
  Payer,
  PriceListItem,
  Registry,
  RegistryLine,
  Role,
  ServiceCategory,
  SessionUser,
  Slot,
  Specialty,
  UUID,
  Visit,
  WebhookEvent,
} from '@mig/contracts';
import type { GuaranteeView, RegistrySummary, RegistryView } from '@mig/contracts/dto';
import { assistanceOn } from '../assistance';
import {
  CATEGORY_TO_CLAIM_OF_SERVICE,
  coverageStatus,
  limitState,
  needsSecondApproval,
  parseCardInput,
  registryLineProblems,
  registryTotals,
  SERVICE_CATEGORIES,
  VISIT_TTL_MS,
  WEBHOOK_RETRY_MINUTES,
} from '../clinics';
import { randomId } from '../lib/random';
import { hashString, mulberry32 } from '../lib/rng';
import { at, DAY, isoDay, parseIso, startOfDay, tzIso } from '../lib/time';
import { signWebhook } from '../lib/webhook';
import { PROGRAMS } from '../programs';
import type { ClaimRow, GuaranteeRow, InsuredRow, WebhookDeliveryRow, WebhookEndpointRow } from '../store/db';
import { asSystem, audit, conflict, DomainError, insuredLabel, notFound, systemRepos, type BaseCtx } from './kernel';
import { loadParams, type ParamsView } from './params';
import { limitsFor } from './views';
import { assignmentsOf, payerName, payerOfLine } from './assistance';

/** Who performs a clinic action: a cabinet user or an API key of the clinic. */
export interface ClinicActor {
  id: UUID;
  clinicId: UUID;
  displayName: string;
  role: Role;
}

export function actorOf(user: SessionUser): ClinicActor {
  if (!user.clinicId) throw notFound();
  return { id: user.id, clinicId: user.clinicId, displayName: user.displayName, role: user.role };
}

export async function clinicOf(ctx: BaseCtx, clinicId: UUID): Promise<Clinic> {
  const c = await ctx.repos.clinics.get(clinicId);
  if (!c) throw notFound();
  return c;
}

/** Keeps the newest `max` rows of a newest-first table (the mock kept its arrays short). */
async function trimNewest(table: { list(q: { offset: number }): Promise<{ id: UUID }[]>; removeWhere(w: { id: { in: UUID[] } }): Promise<number> }, max: number): Promise<void> {
  const extra = await table.list({ offset: max });
  if (extra.length) await table.removeWhere({ id: { in: extra.map((r) => r.id) } });
}

export async function pushEvent(person: BaseCtx, clinicId: UUID, text: string): Promise<void> {
  // The event feed of a clinic cabinet is written by the system, whoever caused the event.
  const ctx = asSystem(person, 'event feed of a clinic cabinet (written as a side effect)');
  await ctx.repos.clinicEvents.insert({ id: randomId(), clinicId, at: tzIso(ctx.now()), text }, { at: 'start' });
  await trimNewest(ctx.repos.clinicEvents, 500);
}

/** Price list of the pair «clinic + payer» (ASSISTANCE_SPEC §5.3). Without a separate contract the MIG list applies. */
export async function priceListOf(ctx: BaseCtx, clinicId: UUID, payer: Payer = 'mig'): Promise<PriceListItem[]> {
  // Prices are reference data of checks, registries and views for every party of the service.
  const r = systemRepos(ctx, 'price list of a clinic for a payer (reference data)');
  if (payer !== 'mig') {
    const contract = await r.clinicContracts.first({ where: { clinicId, payer } });
    if (contract) return contract.priceList;
  }
  return (await r.priceLists.get(clinicId))?.items ?? [];
}

// ---------------------------------------------------------------- visits & coverage

const tooManyChecks = () => new DomainError(429, 'rate_limited', 'srv.clinic.tooManyChecks');
const lockedChecks = (P: ParamsView) => new DomainError(429, 'rate_limited', 'srv.clinic.checksLocked', { params: { minutes: P.dmsParam('pinflLockMinutes') } });
const staleCode = () => new DomainError(410, 'conflict', 'srv.clinic.codeStale');
const noPolicy = () => new DomainError(404, 'not_found', 'srv.clinic.noPolicy');

export type CheckInput = { qrToken: string } | { policyNumber: string; pinfl: string };

function birthYearOf(birthDate: string): number {
  return Number(birthDate.slice(0, 4));
}

export async function coverageFor(person: BaseCtx, visit: Visit, P?: ParamsView): Promise<CoverageCheckResult> {
  // An open visit entitles the clinic to the coverage answer: the policy's term and program, the limit states.
  const ctx = asSystem(person, 'coverage answer of an open visit: the policy, the program and the limit states');
  const params = P ?? (await loadParams(ctx));
  const i = (await ctx.repos.insured.get(visit.insuredId))!;
  const p = await ctx.repos.policies.get(i.policyId);
  const program = p?.program ?? 'standard';
  const limits = await limitsFor(ctx, i, params);
  const stateOf = (c: ServiceCategory) => {
    const l = limits.find((x) => x.category === (c === 'diagnostics_advanced' ? 'outpatient' : c));
    return l ? limitState(l.limit, l.used, params.dmsParam('limitLowShare')) : 'exhausted';
  };
  return {
    visitId: visit.id,
    person: { fullName: i.fullName, birthYear: birthYearOf(i.birthDate) },
    policy: {
      number: p?.number ?? '—',
      programName: PROGRAMS[program].name,
      validTo: p?.endDate ?? isoDay(ctx.now()),
      active: !!p && p.status === 'active' && i.status === 'active' && p.endDate >= isoDay(ctx.now()),
    },
    categories: SERVICE_CATEGORIES.map((category) => ({ category, status: coverageStatus(program, category), limitState: stateOf(category) })),
  };
}

/**
 * Checks a patient and opens a visit (CLINIC_SPEC §3). Policy+PINFL checks per user or key are limited
 * by the DMS parameters `pinflChecksPerHour`, `pinflFailsBeforeLock` and `pinflLockMinutes`. Every check is audited.
 */
export async function checkPatient(ctx: BaseCtx, input: CheckInput, actor: ClinicActor, channel: 'portal' | 'api'): Promise<CoverageCheckResult> {
  const r = ctx.repos;
  const P = await loadParams(ctx);
  const now = ctx.now();
  await r.checkLocks.removeWhere({ until: { lte: now } });
  if (await r.checkLocks.exists({ userId: actor.id })) throw lockedChecks(P);
  await r.checkAttempts.removeWhere({ at: { lte: now - 3600_000 } });
  const mine = await r.checkAttempts.list({ where: { userId: actor.id } });

  const fail = async (reason: string, error: DomainError, countsForLock: boolean): Promise<never> => {
    if (countsForLock) {
      await r.checkAttempts.insert({ userId: actor.id, at: now, ok: false });
      const recent = await r.checkAttempts.list({ where: { userId: actor.id } });
      let streak = 0;
      for (let k = recent.length - 1; k >= 0 && !recent[k]!.ok; k--) streak++;
      if (streak >= P.dmsParam('pinflFailsBeforeLock')) await r.checkLocks.insert({ userId: actor.id, until: now + P.dmsParam('pinflLockMinutes') * 60_000 });
    }
    await audit(ctx, actor, 'clinic_check_failed', { targetType: 'clinic', targetId: actor.clinicId, reason });
    throw error;
  };

  // Before the visit the clinic sees no patient: the card code and the policy/PINFL pair are matched by the
  // system (RLS: access only through a visit).
  const sys = systemRepos(ctx, 'patient check: the card code or policy number + PINFL matched before a visit exists');
  let insuredId: UUID;
  let method: Visit['method'];
  if ('qrToken' in input) {
    const parsed = parseCardInput(input.qrToken);
    const row = parsed ? (parsed.kind === 'short' ? await sys.cardTokens.first({ where: { shortCode: parsed.code } }) : await sys.cardTokens.get(parsed.token)) : null;
    if (!row || row.usedAt || row.expiresAt < now) return fail(row?.usedAt ? 'Повторное использование кода карты' : 'Код карты устарел или не найден', staleCode(), false);
    await sys.cardTokens.update(row.token, { usedAt: now }); // one-time
    insuredId = row.insuredId;
    method = channel === 'api' ? 'api' : 'qr';
  } else {
    if (mine.length >= P.dmsParam('pinflChecksPerHour')) throw tooManyChecks();
    const policy = (await sys.policies.list()).find((p) => p.number.toUpperCase() === input.policyNumber.toUpperCase());
    const person = policy ? await sys.insured.first({ where: { policyId: policy.id, pinfl: input.pinfl, status: 'active' } }) : null;
    if (!person) return fail('Полис и ПИНФЛ не совпали', noPolicy(), true);
    await r.checkAttempts.insert({ userId: actor.id, at: now, ok: true });
    insuredId = person.id;
    method = channel === 'api' ? 'api' : 'policy';
  }

  const visit: Visit = {
    id: randomId(),
    clinicId: actor.clinicId,
    insuredId,
    openedById: actor.id,
    method,
    openedAt: tzIso(now),
    expiresAt: tzIso(now + VISIT_TTL_MS),
  };
  await r.visits.insert(visit);
  await audit(ctx, actor, 'clinic_check_patient', { targetType: 'visit', targetId: visit.id, targetLabel: insuredLabel(insuredId) });
  return coverageFor(ctx, visit, P);
}

/** The only way to a patient for a clinic: an open visit of this clinic. Anything else is 404. */
export async function requireVisit(ctx: BaseCtx, clinicId: UUID, visitId: UUID, now = ctx.now()): Promise<Visit> {
  const v = await ctx.repos.visits.first({ where: { id: visitId, clinicId } });
  if (!v || parseIso(v.expiresAt) < now) throw notFound();
  return v;
}

export async function visitOfClinic(ctx: BaseCtx, clinicId: UUID, visitId: UUID): Promise<Visit> {
  const v = await ctx.repos.visits.first({ where: { id: visitId, clinicId } });
  if (!v) throw notFound();
  return v;
}

// ---------------------------------------------------------------- appointments

export async function appointmentOfClinic(ctx: BaseCtx, clinicId: UUID, id: UUID): Promise<Appointment> {
  const a = await ctx.repos.appointments.first({ where: { id, clinicId } });
  if (!a) throw notFound();
  return a;
}

/** Applies the answer of the clinic (or the operator) to the request; the caller saves the appointment. */
export function respondToAppointment(
  a: Appointment,
  by: 'clinic' | 'operator',
  action: { kind: 'confirm' } | { kind: 'reschedule'; startsAt: string } | { kind: 'decline'; reason: string },
  nowMs = Date.now(),
): Appointment {
  if (a.status !== 'requested') throw conflict('srv.clinic.requestAnswered');
  const now = tzIso(nowMs);
  if (action.kind === 'confirm') {
    a.status = 'confirmed';
    a.proposedStartsAt = undefined;
  } else if (action.kind === 'reschedule') {
    if (parseIso(action.startsAt) <= nowMs) throw new DomainError(422, 'validation', 'srv.time.chooseFuture', { fields: { startsAt: msg('srv.time.chooseFuture') } });
    a.proposedStartsAt = tzIso(parseIso(action.startsAt));
  } else {
    a.status = 'declined';
    a.declineReason = action.reason;
    a.proposedStartsAt = undefined;
  }
  a.respondedBy = by;
  a.respondedAt = now;
  return a;
}

/** A request to a clinic (from the app or the assistance call centre). The clinic answers; the assistance is notified. */
export async function createAppointment(ctx: BaseCtx, who: InsuredRow, input: { clinicId: UUID; specialty: Specialty; startsAt: string }): Promise<Appointment> {
  const r = ctx.repos;
  const clinic = await r.clinics.get(input.clinicId);
  if (!clinic || !clinic.specialties.includes(input.specialty)) throw notFound();
  const starts = parseIso(input.startsAt);
  if (Number.isNaN(starts) || starts < ctx.now()) throw conflict('srv.clinic.slotPast');
  const iso = tzIso(starts);
  if (await r.appointments.exists({ clinicId: clinic.id, startsAt: iso, status: { notIn: ['cancelled', 'declined'] } })) {
    throw conflict('srv.clinic.slotTaken');
  }
  const a: Appointment = {
    id: randomId(),
    insuredId: who.id,
    insuredName: who.fullName,
    clientName: who.clientName,
    clinicId: clinic.id,
    clinicName: clinic.name,
    specialty: input.specialty,
    startsAt: iso,
    status: 'requested',
    createdAt: tzIso(ctx.now()),
    ...(clinic.integrationMode === 'api' ? { fromClinicSystem: true } : {}),
  };
  await r.appointments.insert(a);
  await emitWebhook(ctx, clinic.id, 'appointment.requested', a.id);
  const assistanceId = assistanceOn(await assignmentsOf(ctx, who.policyId), who.policyId, isoDay(ctx.now()));
  if (assistanceId) await emitWebhook(ctx, assistanceId, 'appointment.requested', a.id);
  await pushEvent(ctx, clinic.id, 'Новая заявка на запись');
  return a;
}

/** Response time of a clinic to a request, minutes: its individual norm or the DMS parameter. */
export async function clinicResponseMinutes(ctx: BaseCtx, clinicId: UUID, P?: ParamsView): Promise<number> {
  const own = (await ctx.repos.clinics.get(clinicId))?.responseSlaMinutes;
  return own ?? (P ?? (await loadParams(ctx))).dmsParam('clinicResponseMinutes');
}

/** Requests without an answer longer than the clinic's response time (they go to the MIG operator). */
export async function isOverdueRequest(ctx: BaseCtx, a: Appointment, now = ctx.now(), P?: ParamsView): Promise<boolean> {
  if (a.status !== 'requested' || a.proposedStartsAt) return false;
  return now - parseIso(a.createdAt) > (await clinicResponseMinutes(ctx, a.clinicId, P)) * 60_000;
}

// ---------------------------------------------------------------- guarantees

/** An approved letter past its validity is expired (lazy clock); changes `g` in place. */
export function refreshGuarantee(g: GuaranteeRow, now = Date.now()): GuaranteeRow {
  if (g.status === 'approved' && g.validUntil && g.validUntil < isoDay(now)) g.status = 'expired';
  return g;
}

/** refreshGuarantee of a stored letter: the expiry is saved. */
export async function refreshStoredGuarantee(ctx: BaseCtx, g: GuaranteeRow): Promise<GuaranteeRow> {
  const before = g.status;
  refreshGuarantee(g, ctx.now());
  if (g.status !== before) await systemRepos(ctx, 'guarantee status by time (the lazy server clock, a job run on read)').guarantees.update(g.id, { status: g.status });
  return g;
}

export async function toGuaranteeView(ctx: BaseCtx, g: GuaranteeRow, P?: ParamsView): Promise<GuaranteeView> {
  await refreshStoredGuarantee(ctx, g);
  const { insuredId: _i, ...rest } = g;
  const amount = g.approvedAmount ?? g.estimatedCost;
  const required = needsSecondApproval(amount, (P ?? (await loadParams(ctx))).dmsParam('guaranteeDualApprovalThreshold')) ? 2 : 1;
  const clinic = await ctx.repos.clinics.get(g.clinicId);
  return {
    ...rest,
    clinicName: clinic?.name ?? '—',
    clinicLegalForm: clinic?.legalForm,
    approvalsNeeded: g.status === 'requested' ? Math.max(0, required - g.approvals.length) : 0,
  };
}

export async function toGuaranteeLetter(ctx: BaseCtx, g: GuaranteeRow): Promise<GuaranteeLetter> {
  await refreshStoredGuarantee(ctx, g);
  const { insuredId: _i, infoComment: _c, ...rest } = g;
  return rest;
}

// ---------------------------------------------------------------- registries

export async function registryOfClinic(ctx: BaseCtx, clinicId: UUID, id: UUID): Promise<Registry> {
  const r = await ctx.repos.registries.first({ where: { id, clinicId } });
  if (!r) throw notFound();
  return r;
}

export interface LineInput {
  visitId: UUID;
  serviceDate: string;
  serviceCode: string;
  icd10: string;
  quantity: number;
  price?: number;
  guaranteeNumber?: string;
}

export async function buildLine(ctx: BaseCtx, clinicId: UUID, input: LineInput): Promise<RegistryLine> {
  const v = await visitOfClinic(ctx, clinicId, input.visitId);
  const who = (await ctx.repos.insured.get(v.insuredId))!;
  const payer = await payerOfLine(ctx, { visitId: v.id, serviceDate: input.serviceDate });
  const svc = (await priceListOf(ctx, clinicId, payer)).find((p) => p.code === input.serviceCode);
  const price = input.price ?? svc?.price ?? 0;
  return {
    id: randomId(),
    visitId: v.id,
    insuredName: who.fullName,
    serviceDate: input.serviceDate,
    serviceCode: input.serviceCode,
    serviceName: svc?.name ?? input.serviceCode,
    icd10: input.icd10,
    quantity: input.quantity,
    price,
    amount: price * input.quantity,
    guaranteeNumber: input.guaranteeNumber || undefined,
    status: 'pending',
    payer,
  };
}

export async function lineProblems(ctx: BaseCtx, clinicId: UUID, line: RegistryLine): Promise<string[]> {
  const r = ctx.repos;
  const v = line.visitId ? await r.visits.first({ where: { id: line.visitId, clinicId } }) : null;
  const who = v ? await r.insured.get(v.insuredId) : null;
  const policy = who ? await r.policies.get(who.policyId) : null;
  const g = line.guaranteeNumber ? await r.guarantees.first({ where: { number: line.guaranteeNumber, clinicId } }) : null;
  const problems = registryLineProblems(line, {
    priceItem: (await priceListOf(ctx, clinicId, line.payer ?? (await payerOfLine(ctx, line)))).find((p) => p.code === line.serviceCode),
    guarantee: g ? await refreshStoredGuarantee(ctx, g) : null,
    policyFrom: policy?.startDate,
    policyTo: policy?.endDate,
    visitFrom: v ? isoDay(parseIso(v.openedAt)) : undefined,
    visitTo: v ? isoDay(parseIso(v.expiresAt)) : undefined,
  });
  if (line.visitId && !v) problems.push(msg('srv.registry.visitNotFound'));
  return problems;
}

export async function registryProblems(ctx: BaseCtx, r: Registry): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (r.status !== 'draft') return out;
  for (const l of r.lines) {
    const p = await lineProblems(ctx, r.clinicId, l);
    if (p.length) out[l.id] = p;
  }
  return out;
}

export async function toRegistryView(ctx: BaseCtx, r: Registry): Promise<RegistryView> {
  const guaranteeChecks: RegistryView['guaranteeChecks'] = {};
  for (const l of r.lines) {
    if (!l.guaranteeNumber) continue;
    const g = await ctx.repos.guarantees.first({ where: { number: l.guaranteeNumber, clinicId: r.clinicId } });
    const approved = g?.approvedAmount ?? null;
    guaranteeChecks[l.id] = { approvedAmount: approved, ok: approved !== null && l.amount <= approved };
  }
  const payerNames: Record<string, string> = {};
  for (const l of r.lines) payerNames[l.payer ?? 'mig'] = await payerName(ctx, l.payer);
  return { ...r, clinicName: (await clinicOf(ctx, r.clinicId)).name, problems: await registryProblems(ctx, r), guaranteeChecks, payerNames };
}

export async function toRegistrySummary(ctx: BaseCtx, r: Registry): Promise<RegistrySummary> {
  const { lines, ...rest } = r;
  const clinic = await clinicOf(ctx, r.clinicId);
  return {
    ...rest,
    clinicName: clinic.name,
    clinicLegalForm: clinic.legalForm,
    lineCount: lines.length,
    pendingCount: lines.filter((l) => l.status === 'pending').length,
    disputedCount: lines.filter((l) => l.status === 'disputed').length,
  };
}

/** Totals of a registry; changes `r` in place (the caller saves it). */
export function recomputeRegistry(r: Registry): void {
  r.totals = registryTotals(r.lines, r.status === 'paid');
  // Sub-registries are paid separately by their payers (ASSISTANCE_SPEC §5.4).
  if (r.status !== 'paid') r.totals.paid = r.lines.filter((l) => l.status === 'accepted' && l.payment).reduce((s, l) => s + l.amount, 0);
}

/** Sends a draft registry to the payers; `r` is changed in place and saved. */
export async function submitRegistry(ctx: BaseCtx, r: Registry, actor: { id: UUID; displayName: string; role: Role }): Promise<void> {
  if (r.status !== 'draft') throw conflict('srv.registry.alreadySent');
  if (r.lines.length === 0) throw new DomainError(422, 'validation', 'srv.registry.empty');
  const problems = await registryProblems(ctx, r);
  const bad = Object.keys(problems);
  if (bad.length) {
    const fields: Record<string, string> = {};
    for (const id of bad) fields[`lines.${r.lines.findIndex((l) => l.id === id)}`] = problems[id]!.map((p) => tm(p)).join('; ');
    throw new DomainError(422, 'validation', 'srv.registry.fixLines', { params: { count: bad.length }, fields });
  }
  // One registry a month; the system splits it into sub-registries of payers (ASSISTANCE_SPEC §5.3).
  for (const l of r.lines) l.payer = await payerOfLine(ctx, l);
  r.status = 'submitted';
  r.submittedAt = tzIso(ctx.now());
  recomputeRegistry(r);
  await ctx.repos.registries.put(r);
  await audit(ctx, actor, 'registry_submitted', { targetType: 'registry', targetId: r.id, targetLabel: `Реестр ${r.period}` });
  await pushEvent(ctx, r.clinicId, `Реестр за ${r.period} отправлен на проверку`);
  for (const payer of new Set(r.lines.map((l) => l.payer ?? 'mig'))) {
    if (payer !== 'mig') await emitWebhook(ctx, payer, 'registry.received', r.id);
  }
}

export { CATEGORY_TO_CLAIM_OF_SERVICE };

/** Numbers of claims filed by MIG staff and insured persons start above the seeded ones (9001…). */
export const FILED_CLAIM_SEQ_FLOOR = 9000;

/**
 * The next claim number (template in force): the largest existing sequence + 1. `floor`: the sequence
 * starts above it (FILED_CLAIM_SEQ_FLOOR for claims filed by staff and insured persons).
 */
export async function nextClaimNumber(ctx: BaseCtx, P?: ParamsView, opts: { floor?: number } = {}): Promise<string> {
  const params = P ?? (await loadParams(ctx));
  const year = new Date(ctx.now()).getFullYear();
  const max = params.maxDocSeq('claim', (await ctx.repos.claims.list()).map((c) => c.number), opts);
  return params.nextDocNumber('claim', { year, n: max + 1 });
}

/** An accepted registry line becomes a claim with the `clinic_invoice` source (CLINIC_SPEC §7). */
export async function claimFromLine(ctx: BaseCtx, r: Registry, line: RegistryLine, actorName: string): Promise<void> {
  if (await ctx.repos.claims.exists({ registryLineId: line.id })) return;
  const v = line.visitId ? await ctx.repos.visits.get(line.visitId) : null;
  const who = v ? await ctx.repos.insured.get(v.insuredId) : null;
  if (!who) return;
  const svc = (await priceListOf(ctx, r.clinicId)).find((p) => p.code === line.serviceCode);
  const now = tzIso(ctx.now());
  const claim: ClaimRow = {
    id: randomId(),
    number: await nextClaimNumber(ctx),
    insuredId: who.id,
    insuredName: who.fullName,
    clientId: who.clientId,
    clientName: who.clientName,
    category: CATEGORY_TO_CLAIM_OF_SERVICE[svc?.category ?? 'outpatient'],
    source: 'clinic_invoice',
    amountClaimed: line.amount,
    amountApproved: line.amount,
    providerName: (await clinicOf(ctx, r.clinicId)).name,
    serviceDate: line.serviceDate,
    status: 'approved',
    slaDueAt: tzIso(ctx.now() + 5 * DAY),
    createdAt: now,
    updatedAt: now,
    attachments: [],
    history: [
      { at: now, actorName: 'Клиника (реестр)', to: 'new' },
      { at: now, actorName, from: 'new', to: 'approved', comment: `Строка реестра за ${r.period}` },
    ],
    registryLineId: line.id,
  };
  await ctx.repos.claims.insert(claim, { at: 'start' });
}

// ---------------------------------------------------------------- webhooks

/** The mock never calls the network (CSP): a receiver URL containing «fail» answers 500, others 200. */
function simulatedResponse(url: string): number {
  return url.includes('fail') ? 500 : 200;
}

/** One delivery attempt; changes `delivery` in place (the caller saves it). */
export async function attemptDelivery(delivery: WebhookDeliveryRow, endpoint: WebhookEndpointRow, nowMs = Date.now()): Promise<WebhookDeliveryRow> {
  delivery.signature = await signWebhook(endpoint.signingSecret, delivery.body, Math.floor(nowMs / 1000));
  delivery.attempts += 1;
  delivery.lastAttemptAt = tzIso(nowMs);
  delivery.responseCode = simulatedResponse(endpoint.url);
  if (delivery.responseCode >= 200 && delivery.responseCode < 300) {
    delivery.status = 'delivered';
    delivery.nextAttemptAt = undefined;
  } else {
    const nextDelay = WEBHOOK_RETRY_MINUTES[delivery.attempts - 1];
    if (nextDelay === undefined) {
      delivery.status = 'failed';
      delivery.nextAttemptAt = undefined;
    } else {
      delivery.status = 'retrying';
      delivery.nextAttemptAt = tzIso(nowMs + nextDelay * 60_000);
    }
  }
  return delivery;
}

/** Thin events only: id, type, time and the object id — no personal or medical data. */
export async function emitWebhook(person: BaseCtx, clinicId: UUID, event: WebhookEvent, objectId: UUID, only?: WebhookEndpointRow): Promise<WebhookDeliveryRow[]> {
  // The outbox: the partner's endpoints and the delivery log are the system's, whoever caused the event.
  const ctx = asSystem(person, 'webhook outbox: endpoints of the partner an event concerns, the delivery log');
  const endpoints = only ? [only] : (await ctx.repos.webhooks.list({ where: { clinicId, active: true } })).filter((w) => w.events.includes(event));
  const out: WebhookDeliveryRow[] = [];
  for (const ep of endpoints) {
    const body = JSON.stringify({ id: randomId(), type: event, createdAt: tzIso(ctx.now()), objectId });
    const delivery: WebhookDeliveryRow = {
      id: randomId(),
      endpointId: ep.id,
      clinicId,
      event,
      status: 'retrying',
      attempts: 0,
      lastAttemptAt: tzIso(ctx.now()),
      objectId,
      body,
      signature: '',
    };
    await ctx.repos.webhookDeliveries.insert(delivery, { at: 'start' });
    await attemptDelivery(delivery, ep, ctx.now());
    await ctx.repos.webhookDeliveries.put(delivery);
    out.push(delivery);
  }
  await trimNewest(ctx.repos.webhookDeliveries, 1000);
  return out;
}

/** Free 30-minute slots of a clinic on a day (fictional, deterministic per clinic and date), up to 60 days ahead. */
export function clinicSlots(clinic: Pick<Clinic, 'id'>, date: string, now: number): Slot[] {
  const day = parseIso(date);
  if (Number.isNaN(day) || day < startOfDay(now) || day > now + 60 * DAY) return [];
  const rng = mulberry32(hashString(`${clinic.id}:${date}`));
  const out: Slot[] = [];
  for (let h = 9; h < 18; h++) {
    for (const m of [0, 30]) {
      const ms = at(day, h, m);
      if (ms <= now + 30 * 60_000) continue;
      if (rng() < 0.45) continue;
      out.push({ clinicId: clinic.id, startsAt: tzIso(ms) });
    }
  }
  return out;
}
