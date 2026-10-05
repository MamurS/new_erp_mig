/*
 * Clinic "server" logic shared by the clinic cabinet (/api/clinic/...), the integration API
 * (/api/integration/v1/...) and the staff portal. Both clinic channels go through the same functions,
 * so the rules (visit-only access, limits, checks) are identical (CLINIC_SPEC §1, §3).
 */
import { msg, tm } from '@/i18n/core';
import type {
  Appointment,
  ClaimCategory,
  CoverageCheckResult,
  GuaranteeLetter,
  Payer,
  PriceListItem,
  Registry,
  RegistryLine,
  Role,
  ServiceCategory,
  SessionUser,
  Specialty,
  UUID,
  Visit,
  WebhookEvent,
} from '@/shared/types';
import type { GuaranteeView, RegistrySummary, RegistryView } from '@/shared/types/dto';
import {
  coverageStatus,
  limitState,
  needsSecondApproval,
  parseCardInput,
  registryLineProblems,
  registryTotals,
  SERVICE_CATEGORIES,
  VISIT_TTL_MS,
  WEBHOOK_RETRY_MINUTES,
} from '@/shared/domain/clinics';
import { signWebhook } from '@/shared/integration/webhook';
import { db, type ClaimRow, type Db, type InsuredRow, type GuaranteeRow, type WebhookDeliveryRow, type WebhookEndpointRow } from './db';
import { dmsParam } from './params';
import { audit, conflict, HttpError, insuredLabel, notFound } from './http';
import { PROGRAMS } from './programs';
import { randomId } from './rng';
import { DAY, isoDay, parseIso, tzIso } from './time';
import { limitsFor } from './views';
import { payerName, payerOfLine } from './assistance-core';
import { assistanceOn } from '@/shared/domain/assistance';

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

export function clinicOf(d: Db, clinicId: UUID) {
  const c = d.clinics.find((x) => x.id === clinicId);
  if (!c) throw notFound();
  return c;
}

export function pushEvent(d: Db, clinicId: UUID, text: string): void {
  d.clinicEvents.unshift({ id: randomId(), clinicId, at: tzIso(Date.now()), text });
  d.clinicEvents = d.clinicEvents.slice(0, 500);
}

/** Price list of the pair «clinic + payer» (ASSISTANCE_SPEC §5.3). Without a separate contract the MIG list applies. */
export function priceListOf(d: Db, clinicId: UUID, payer: Payer = 'mig'): PriceListItem[] {
  if (payer !== 'mig') {
    const contract = d.clinicContracts.find((c) => c.clinicId === clinicId && c.payer === payer);
    if (contract) return contract.priceList;
  }
  return d.priceLists.find((p) => p.clinicId === clinicId)?.items ?? [];
}

// ---------------------------------------------------------------- visits & coverage

const tooManyChecks = () => new HttpError(429, 'rate_limited', 'srv.clinic.tooManyChecks');
const lockedChecks = () => new HttpError(429, 'rate_limited', 'srv.clinic.checksLocked', { params: { minutes: dmsParam('pinflLockMinutes') } });
const staleCode = () => new HttpError(410, 'conflict', 'srv.clinic.codeStale');
const noPolicy = () => new HttpError(404, 'not_found', 'srv.clinic.noPolicy');

export type CheckInput = { qrToken: string } | { policyNumber: string; pinfl: string };

function birthYearOf(birthDate: string): number {
  return Number(birthDate.slice(0, 4));
}

export function coverageFor(d: Db, visit: Visit): CoverageCheckResult {
  const i = d.insured.find((x) => x.id === visit.insuredId)!;
  const p = d.policies.find((x) => x.id === i.policyId);
  const program = p?.program ?? 'standard';
  const limits = limitsFor(d, i);
  const stateOf = (c: ServiceCategory) => {
    const l = limits.find((x) => x.category === (c === 'diagnostics_advanced' ? 'outpatient' : c));
    return l ? limitState(l.limit, l.used, dmsParam('limitLowShare')) : 'exhausted';
  };
  return {
    visitId: visit.id,
    person: { fullName: i.fullName, birthYear: birthYearOf(i.birthDate) },
    policy: {
      number: p?.number ?? '—',
      programName: PROGRAMS[program].name,
      validTo: p?.endDate ?? isoDay(Date.now()),
      active: !!p && p.status === 'active' && i.status === 'active' && p.endDate >= isoDay(Date.now()),
    },
    categories: SERVICE_CATEGORIES.map((category) => ({ category, status: coverageStatus(program, category), limitState: stateOf(category) })),
  };
}

/**
 * Checks a patient and opens a visit (CLINIC_SPEC §3). Policy+PINFL checks per user or key are limited
 * by the DMS parameters `pinflChecksPerHour`, `pinflFailsBeforeLock` and `pinflLockMinutes`. Every check is audited.
 */
export function checkPatient(input: CheckInput, actor: ClinicActor, channel: 'portal' | 'api'): CoverageCheckResult {
  const d = db();
  const now = Date.now();
  d.checkLocks = d.checkLocks.filter((l) => l.until > now);
  if (d.checkLocks.some((l) => l.userId === actor.id)) throw lockedChecks();
  d.checkAttempts = d.checkAttempts.filter((a) => now - a.at < 3600_000);
  const mine = d.checkAttempts.filter((a) => a.userId === actor.id);

  const fail = (reason: string, error: HttpError, countsForLock: boolean): never => {
    if (countsForLock) {
      d.checkAttempts.push({ userId: actor.id, at: now, ok: false });
      const recent = d.checkAttempts.filter((a) => a.userId === actor.id);
      let streak = 0;
      for (let k = recent.length - 1; k >= 0 && !recent[k]!.ok; k--) streak++;
      if (streak >= dmsParam('pinflFailsBeforeLock')) d.checkLocks.push({ userId: actor.id, until: now + dmsParam('pinflLockMinutes') * 60_000 });
    }
    audit(actor, 'clinic_check_failed', { targetType: 'clinic', targetId: actor.clinicId, reason });
    throw error;
  };

  let insuredId: UUID;
  let method: Visit['method'];
  if ('qrToken' in input) {
    const parsed = parseCardInput(input.qrToken);
    const row = parsed ? d.cardTokens.find((t) => (parsed.kind === 'short' ? t.shortCode === parsed.code : t.token === parsed.token)) : undefined;
    if (!row || row.usedAt || row.expiresAt < now) return fail(row?.usedAt ? 'Повторное использование кода карты' : 'Код карты устарел или не найден', staleCode(), false);
    row.usedAt = now; // one-time
    insuredId = row.insuredId;
    method = channel === 'api' ? 'api' : 'qr';
  } else {
    if (mine.length >= dmsParam('pinflChecksPerHour')) throw tooManyChecks();
    const policy = d.policies.find((p) => p.number === input.policyNumber);
    const person = policy && d.insured.find((i) => i.policyId === policy.id && i.pinfl === input.pinfl && i.status === 'active');
    if (!person) return fail('Полис и ПИНФЛ не совпали', noPolicy(), true);
    d.checkAttempts.push({ userId: actor.id, at: now, ok: true });
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
  d.visits.push(visit);
  audit(actor, 'clinic_check_patient', { targetType: 'visit', targetId: visit.id, targetLabel: insuredLabel(insuredId) });
  return coverageFor(d, visit);
}

/** The only way to a patient for a clinic: an open visit of this clinic. Anything else is 404. */
export function requireVisit(d: Db, clinicId: UUID, visitId: UUID, now = Date.now()): Visit {
  const v = d.visits.find((x) => x.id === visitId && x.clinicId === clinicId);
  if (!v || parseIso(v.expiresAt) < now) throw notFound();
  return v;
}

export function visitOfClinic(d: Db, clinicId: UUID, visitId: UUID): Visit {
  const v = d.visits.find((x) => x.id === visitId && x.clinicId === clinicId);
  if (!v) throw notFound();
  return v;
}

// ---------------------------------------------------------------- appointments

export function appointmentOfClinic(d: Db, clinicId: UUID, id: UUID): Appointment {
  const a = d.appointments.find((x) => x.id === id && x.clinicId === clinicId);
  if (!a) throw notFound();
  return a;
}

export function respondToAppointment(
  a: Appointment,
  by: 'clinic' | 'operator',
  action: { kind: 'confirm' } | { kind: 'reschedule'; startsAt: string } | { kind: 'decline'; reason: string },
): Appointment {
  if (a.status !== 'requested') throw conflict('srv.clinic.requestAnswered');
  const now = tzIso(Date.now());
  if (action.kind === 'confirm') {
    a.status = 'confirmed';
    a.proposedStartsAt = undefined;
  } else if (action.kind === 'reschedule') {
    if (parseIso(action.startsAt) <= Date.now()) throw new HttpError(422, 'validation', 'srv.time.chooseFuture', { fields: { startsAt: msg('srv.time.chooseFuture') } });
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
export async function createAppointment(d: Db, who: InsuredRow, input: { clinicId: UUID; specialty: Specialty; startsAt: string }): Promise<Appointment> {
  const clinic = d.clinics.find((c) => c.id === input.clinicId);
  if (!clinic || !clinic.specialties.includes(input.specialty)) throw notFound();
  const starts = parseIso(input.startsAt);
  if (Number.isNaN(starts) || starts < Date.now()) throw conflict('srv.clinic.slotPast');
  const iso = tzIso(starts);
  if (d.appointments.some((a) => a.clinicId === clinic.id && a.startsAt === iso && a.status !== 'cancelled' && a.status !== 'declined')) {
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
    createdAt: tzIso(Date.now()),
    ...(clinic.integrationMode === 'api' ? { fromClinicSystem: true } : {}),
  };
  d.appointments.push(a);
  await emitWebhook(d, clinic.id, 'appointment.requested', a.id);
  const assistanceId = assistanceOn(d.assignments, who.policyId, isoDay(Date.now()));
  if (assistanceId) await emitWebhook(d, assistanceId, 'appointment.requested', a.id);
  pushEvent(d, clinic.id, 'Новая заявка на запись');
  return a;
}

/** Response time of a clinic to a request, minutes: its individual norm or the DMS parameter. */
export function clinicResponseMinutes(d: Db, clinicId: UUID): number {
  return d.clinics.find((c) => c.id === clinicId)?.responseSlaMinutes ?? dmsParam('clinicResponseMinutes');
}

/** Requests without an answer longer than the clinic's response time (they go to the MIG operator). */
export function isOverdueRequest(d: Db, a: Appointment, now = Date.now()): boolean {
  if (a.status !== 'requested' || a.proposedStartsAt) return false;
  return now - parseIso(a.createdAt) > clinicResponseMinutes(d, a.clinicId) * 60_000;
}

// ---------------------------------------------------------------- guarantees

export function refreshGuarantee(g: GuaranteeRow, now = Date.now()): GuaranteeRow {
  if (g.status === 'approved' && g.validUntil && g.validUntil < isoDay(now)) g.status = 'expired';
  return g;
}

export function toGuaranteeView(d: Db, g: GuaranteeRow): GuaranteeView {
  refreshGuarantee(g);
  const { insuredId: _i, ...rest } = g;
  const amount = g.approvedAmount ?? g.estimatedCost;
  const required = needsSecondApproval(amount, dmsParam('guaranteeDualApprovalThreshold')) ? 2 : 1;
  return {
    ...rest,
    clinicName: d.clinics.find((c) => c.id === g.clinicId)?.name ?? '—',
    approvalsNeeded: g.status === 'requested' ? Math.max(0, required - g.approvals.length) : 0,
  };
}

export function toGuaranteeLetter(g: GuaranteeRow): GuaranteeLetter {
  refreshGuarantee(g);
  const { insuredId: _i, infoComment: _c, ...rest } = g;
  return rest;
}

// ---------------------------------------------------------------- registries

export function registryOfClinic(d: Db, clinicId: UUID, id: UUID): Registry {
  const r = d.registries.find((x) => x.id === id && x.clinicId === clinicId);
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

export function buildLine(d: Db, clinicId: UUID, input: LineInput): RegistryLine {
  const v = visitOfClinic(d, clinicId, input.visitId);
  const who = d.insured.find((i) => i.id === v.insuredId)!;
  const payer = payerOfLine(d, { visitId: v.id, serviceDate: input.serviceDate });
  const svc = priceListOf(d, clinicId, payer).find((p) => p.code === input.serviceCode);
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

export function lineProblems(d: Db, clinicId: UUID, line: RegistryLine): string[] {
  const v = line.visitId ? d.visits.find((x) => x.id === line.visitId && x.clinicId === clinicId) : undefined;
  const who = v && d.insured.find((i) => i.id === v.insuredId);
  const policy = who && d.policies.find((p) => p.id === who.policyId);
  const g = line.guaranteeNumber ? d.guarantees.find((x) => x.number === line.guaranteeNumber && x.clinicId === clinicId) : undefined;
  const problems = registryLineProblems(line, {
    priceItem: priceListOf(d, clinicId, line.payer ?? payerOfLine(d, line)).find((p) => p.code === line.serviceCode),
    guarantee: g ? refreshGuarantee(g) : null,
    policyFrom: policy?.startDate,
    policyTo: policy?.endDate,
    visitFrom: v ? isoDay(parseIso(v.openedAt)) : undefined,
    visitTo: v ? isoDay(parseIso(v.expiresAt)) : undefined,
  });
  if (line.visitId && !v) problems.push('Визит не найден');
  return problems;
}

export function registryProblems(d: Db, r: Registry): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (r.status !== 'draft') return out;
  for (const l of r.lines) {
    const p = lineProblems(d, r.clinicId, l);
    if (p.length) out[l.id] = p;
  }
  return out;
}

export function toRegistryView(d: Db, r: Registry): RegistryView {
  const guaranteeChecks: RegistryView['guaranteeChecks'] = {};
  for (const l of r.lines) {
    if (!l.guaranteeNumber) continue;
    const g = d.guarantees.find((x) => x.number === l.guaranteeNumber && x.clinicId === r.clinicId);
    const approved = g?.approvedAmount ?? null;
    guaranteeChecks[l.id] = { approvedAmount: approved, ok: approved !== null && l.amount <= approved };
  }
  const payerNames: Record<string, string> = {};
  for (const l of r.lines) payerNames[l.payer ?? 'mig'] = payerName(d, l.payer);
  return { ...r, clinicName: clinicOf(d, r.clinicId).name, problems: registryProblems(d, r), guaranteeChecks, payerNames };
}

export function toRegistrySummary(d: Db, r: Registry): RegistrySummary {
  const { lines, ...rest } = r;
  return {
    ...rest,
    clinicName: clinicOf(d, r.clinicId).name,
    lineCount: lines.length,
    pendingCount: lines.filter((l) => l.status === 'pending').length,
    disputedCount: lines.filter((l) => l.status === 'disputed').length,
  };
}

export function recomputeRegistry(r: Registry): void {
  r.totals = registryTotals(r.lines, r.status === 'paid');
  // Sub-registries are paid separately by their payers (ASSISTANCE_SPEC §5.4).
  if (r.status !== 'paid') r.totals.paid = r.lines.filter((l) => l.status === 'accepted' && l.payment).reduce((s, l) => s + l.amount, 0);
}

export function submitRegistry(d: Db, r: Registry, actor: { id: UUID; displayName: string; role: Role }): void {
  if (r.status !== 'draft') throw conflict('srv.registry.alreadySent');
  if (r.lines.length === 0) throw new HttpError(422, 'validation', 'srv.registry.empty');
  const problems = registryProblems(d, r);
  const bad = Object.keys(problems);
  if (bad.length) {
    const fields: Record<string, string> = {};
    for (const id of bad) fields[`lines.${r.lines.findIndex((l) => l.id === id)}`] = problems[id]!.map((p) => tm(p)).join('; ');
    throw new HttpError(422, 'validation', 'srv.registry.fixLines', { params: { count: bad.length }, fields });
  }
  // One registry a month; the system splits it into sub-registries of payers (ASSISTANCE_SPEC §5.3).
  for (const l of r.lines) l.payer = payerOfLine(d, l);
  r.status = 'submitted';
  r.submittedAt = tzIso(Date.now());
  recomputeRegistry(r);
  audit(actor, 'registry_submitted', { targetType: 'registry', targetId: r.id, targetLabel: `Реестр ${r.period}` });
  pushEvent(d, r.clinicId, `Реестр за ${r.period} отправлен на проверку`);
  for (const payer of new Set(r.lines.map((l) => l.payer ?? 'mig'))) {
    if (payer !== 'mig') void emitWebhook(d, payer, 'registry.received', r.id);
  }
}

export const CATEGORY_TO_CLAIM_OF_SERVICE: Record<ServiceCategory, ClaimCategory> = {
  outpatient: 'doctor_visit',
  diagnostics_advanced: 'diagnostics',
  dental: 'dental',
  medicines: 'medicines',
  inpatient: 'inpatient',
};

export function nextClaimNumber(d: Db): string {
  const year = new Date().getFullYear();
  const max = d.claims.reduce((m, c) => Math.max(m, Number(/-(\d+)$/.exec(c.number)?.[1] ?? 0)), 0);
  return `У-${year}-${String(max + 1).padStart(6, '0')}`;
}

/** An accepted registry line becomes a claim with the `clinic_invoice` source (CLINIC_SPEC §7). */
export function claimFromLine(d: Db, r: Registry, line: RegistryLine, actorName: string): void {
  if (d.claims.some((c) => c.registryLineId === line.id)) return;
  const v = line.visitId ? d.visits.find((x) => x.id === line.visitId) : undefined;
  const who = v && d.insured.find((i) => i.id === v.insuredId);
  if (!who) return;
  const svc = priceListOf(d, r.clinicId).find((p) => p.code === line.serviceCode);
  const now = tzIso(Date.now());
  const claim: ClaimRow = {
    id: randomId(),
    number: nextClaimNumber(d),
    insuredId: who.id,
    insuredName: who.fullName,
    clientId: who.clientId,
    clientName: who.clientName,
    category: CATEGORY_TO_CLAIM_OF_SERVICE[svc?.category ?? 'outpatient'],
    source: 'clinic_invoice',
    amountClaimed: line.amount,
    amountApproved: line.amount,
    providerName: clinicOf(d, r.clinicId).name,
    serviceDate: line.serviceDate,
    status: 'approved',
    slaDueAt: tzIso(Date.now() + 5 * DAY),
    createdAt: now,
    updatedAt: now,
    attachments: [],
    history: [
      { at: now, actorName: 'Клиника (реестр)', to: 'new' },
      { at: now, actorName, from: 'new', to: 'approved', comment: `Строка реестра за ${r.period}` },
    ],
    registryLineId: line.id,
  };
  d.claims.unshift(claim);
}

// ---------------------------------------------------------------- webhooks

/** The mock never calls the network (CSP): a receiver URL containing «fail» answers 500, others 200. */
function simulatedResponse(url: string): number {
  return url.includes('fail') ? 500 : 200;
}

export async function attemptDelivery(delivery: WebhookDeliveryRow, endpoint: WebhookEndpointRow): Promise<WebhookDeliveryRow> {
  const nowMs = Date.now();
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
export async function emitWebhook(d: Db, clinicId: UUID, event: WebhookEvent, objectId: UUID, only?: WebhookEndpointRow): Promise<WebhookDeliveryRow[]> {
  const endpoints = only ? [only] : d.webhooks.filter((w) => w.clinicId === clinicId && w.active && w.events.includes(event));
  const out: WebhookDeliveryRow[] = [];
  for (const ep of endpoints) {
    const body = JSON.stringify({ id: randomId(), type: event, createdAt: tzIso(Date.now()), objectId });
    const delivery: WebhookDeliveryRow = {
      id: randomId(),
      endpointId: ep.id,
      clinicId,
      event,
      status: 'retrying',
      attempts: 0,
      lastAttemptAt: tzIso(Date.now()),
      objectId,
      body,
      signature: '',
    };
    d.webhookDeliveries.unshift(delivery);
    out.push(await attemptDelivery(delivery, ep));
  }
  d.webhookDeliveries = d.webhookDeliveries.slice(0, 1000);
  return out;
}
