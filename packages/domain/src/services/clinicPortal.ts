/*
 * Clinic cabinet (/api/clinic/...), CLINIC_SPEC §4. Every service resolves the clinic from the session,
 * never from the request; objects of other clinics answer 404 (CLINIC_SPEC §9.9). The rules shared with
 * the integration API and the staff portal are in ./clinic.
 */
import Papa from 'papaparse';
import type { z } from 'zod';
import { msg, tm } from '@mig/i18n';
import type { Appointment, Clinic, CoverageCheckResult, PriceListItem, Registry, RegistryLine, Slot, UUID } from '@mig/contracts';
import type {
  ClinicDocuments,
  ClinicOverview,
  ClinicUserView,
  ClinicVisitView,
  GuaranteeView,
  RegistryImportResult,
  RegistrySummary,
  RegistryView,
} from '@mig/contracts/dto';
import { clinicUserInviteSchema, clinicUserPatchSchema, guaranteeAnswerSchema, registryBuildSchema } from '@mig/contracts/forms';
import {
  coverageCheckRequest,
  declineRequest,
  disputeRequest,
  guaranteeCreateRequest,
  registryLineInput,
  rescheduleRequest,
} from '@mig/contracts/integration';
import { assistanceOn } from '../assistance';
import type { Action } from '../auth/permissions';
import { GUARANTEE_FILE_MAX_BYTES, guaranteeNumber, REGISTRY_CSV_MAX_BYTES, REGISTRY_CSV_MAX_ROWS } from '../clinics';
import { detectMime } from '../lib/mime';
import { randomId } from '../lib/random';
import { hashString, mulberry32 } from '../lib/rng';
import { at, DAY, isoDay, parseIso, startOfDay, tzIso } from '../lib/time';
import type { ClinicUserRow, GuaranteeRow } from '../store/db';
import { assistanceName, notifyAssistance, payerOfLine } from './assistance';
import {
  actorOf,
  appointmentOfClinic,
  buildLine,
  checkPatient,
  clinicOf,
  coverageFor,
  isOverdueRequest,
  lineProblems,
  priceListOf,
  pushEvent,
  recomputeRegistry,
  registryOfClinic,
  requireVisit,
  respondToAppointment,
  submitRegistry,
  toGuaranteeView,
  toRegistrySummary,
  toRegistryView,
  visitOfClinic,
  type ClinicActor,
} from './clinic';
import { audit, conflict, DomainError, forbidden, notFound, requirePermission, validate, type AuthCtx, type BaseCtx } from './kernel';
import { isUuid } from './list';
import { loadParams } from './params';
import type { PartnerScope } from './partnerIntegration';

/** The clinic user of the session with the permission (403 otherwise), as the actor of clinic actions. */
export function requireClinic(ctx: AuthCtx, action: Action): ClinicActor {
  const { user } = ctx;
  if (user.role !== 'clinic_registrar' && user.role !== 'clinic_admin') throw forbidden();
  requirePermission(user, action, { clinicId: user.clinicId });
  return actorOf(user);
}

const toUserView = (u: ClinicUserRow): ClinicUserView => ({ id: u.id, email: u.email, fullName: u.fullName, role: u.role, active: u.active, lastLoginAt: u.lastLoginAt });

/** Free half-hour slots of a clinic on a day (deterministic per clinic and date; MIS slots aside). */
export function clinicSlots(clinic: Clinic, date: string, now: number): Slot[] {
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

// ---------------------------------------------------------------- shared with the integration API and assistance

/** A file of a multipart request, read by the adapter. */
export interface UploadedFile {
  size: number;
  bytes: Uint8Array;
}

type AttachmentMime = 'image/jpeg' | 'image/png' | 'application/pdf';

/** PDF, JPEG, PNG up to 10 MB, checked by magic bytes (images arrive already re-encoded by the browser). */
function checkAttachment(file: UploadedFile): AttachmentMime {
  if (file.size === 0 || file.size > GUARANTEE_FILE_MAX_BYTES) throw new DomainError(422, 'validation', 'srv.file.tooLarge10mb', { fields: { files: msg('srv.file.tooLarge10mb') } });
  const mime = detectMime(file.bytes);
  if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'application/pdf') {
    throw new DomainError(422, 'validation', 'srv.file.onlyPdfJpegPng', { fields: { files: msg('srv.file.unsupported') } });
  }
  return mime;
}

/** Attaches documents to a letter: `g.attachments` is changed and saved (also the files accepted before a bad one). */
export async function attachGuaranteeFiles(ctx: BaseCtx, g: GuaranteeRow, files: readonly UploadedFile[]): Promise<void> {
  if (g.attachments.length + files.length > 10) throw new DomainError(422, 'validation', 'srv.file.max10', { fields: { files: msg('srv.file.max10') } });
  const before = g.attachments.length;
  try {
    for (const file of files) {
      const mime = checkAttachment(file);
      const id = randomId();
      const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg';
      const fileName = `document-${g.attachments.length + 1}.${ext}`;
      await ctx.repos.files.insert({ id, mime, bytes: file.bytes, guaranteeId: g.id, clinicId: g.clinicId, fileName });
      g.attachments.push({ id, kind: 'referral', fileName, mime, sizeBytes: file.bytes.length, url: `/api/files/${id}` });
    }
  } finally {
    if (g.attachments.length !== before) await ctx.repos.guarantees.update(g.id, { attachments: g.attachments });
  }
}

/** A guarantee letter request of a clinic (cabinet, MIS or the assistance call centre on its behalf). */
export async function createGuarantee(ctx: BaseCtx, actor: ClinicActor, input: z.infer<typeof guaranteeCreateRequest>, byName: string): Promise<GuaranteeRow> {
  const r = ctx.repos;
  const v = await requireVisit(ctx, actor.clinicId, input.visitId);
  const svc = (await priceListOf(ctx, actor.clinicId)).find((p) => p.code === input.serviceCode);
  if (!svc) throw new DomainError(422, 'validation', 'srv.registry.serviceNotInPrice', { fields: { serviceCode: msg('srv.registry.chooseService') } });
  const who = (await r.insured.get(v.insuredId))!;
  // The letter goes to the assistance of the insured person on the date of the request (ASSISTANCE_SPEC §5.2).
  const assistanceId = assistanceOn(await r.assignments.list({ where: { policyId: who.policyId } }), who.policyId, isoDay(ctx.now()));
  const seq = await r.seq.next('guarantee');
  const P = await loadParams(ctx);
  const g: GuaranteeRow = {
    id: randomId(),
    number: guaranteeNumber(new Date(ctx.now()).getFullYear(), seq, P.numbering()),
    clinicId: actor.clinicId,
    visitId: v.id,
    insuredId: who.id,
    insuredName: who.fullName,
    serviceCode: svc.code,
    serviceName: svc.name,
    icd10: input.icd10,
    estimatedCost: input.estimatedCost,
    status: 'requested',
    approvals: [],
    comment: input.comment || undefined,
    attachments: [],
    createdAt: tzIso(ctx.now()),
    policyId: who.policyId,
    assistanceId,
    ...(assistanceId ? { assistanceName: (await assistanceName(ctx, assistanceId)) ?? undefined } : {}),
  };
  await r.guarantees.insert(g, { at: 'start' });
  await audit(ctx, actor, 'guarantee_requested', { targetType: 'guarantee', targetId: g.id, targetLabel: g.number });
  await notifyAssistance(ctx, assistanceId, 'guarantee.requested', g.id);
  await pushEvent(ctx, actor.clinicId, `Запрошено гарантийное письмо ${g.number} (${byName})`);
  return g;
}

function monthStartIso(now: number): string {
  return isoDay(now).slice(0, 7);
}

// ---------------------------------------------------------------- endpoints: overview, patients, visits

export async function overview(ctx: AuthCtx): Promise<ClinicOverview> {
  const actor = requireClinic(ctx, 'clinic.check_patient');
  const r = ctx.repos;
  const clinic = await clinicOf(ctx, actor.clinicId);
  const now = ctx.now();
  const today = isoDay(now);
  const P = await loadParams(ctx);
  const mine = await r.appointments.list({ where: { clinicId: clinic.id } });
  const unanswered = mine.filter((a) => a.status === 'requested' && !a.proposedStartsAt);
  let overdue = 0;
  for (const a of unanswered) if (await isOverdueRequest(ctx, a, now, P)) overdue++;
  const current = (await r.registries.list({ where: { clinicId: clinic.id, period: monthStartIso(now) } })).sort((a, b) => (a.status === 'draft' ? -1 : b.status === 'draft' ? 1 : 0))[0];
  return {
    clinicName: clinic.name,
    clinicLegalForm: clinic.legalForm,
    integrationMode: clinic.integrationMode,
    appointmentsToday: mine.filter((a) => isoDay(parseIso(a.startsAt)) === today && (a.status === 'confirmed' || a.status === 'requested')).length,
    unanswered: unanswered.length,
    unansweredOverdue: overdue,
    guaranteesPending: await r.guarantees.count({ clinicId: clinic.id, status: { in: ['requested', 'info_requested'] } }),
    currentRegistry: current ? { id: current.id, period: current.period, status: current.status, claimed: current.totals.claimed } : null,
    events: (await r.clinicEvents.list({ where: { clinicId: clinic.id }, limit: 12 })).map(({ clinicId: _c, ...e }) => e),
  };
}

export async function check(ctx: AuthCtx, body: unknown): Promise<CoverageCheckResult> {
  const actor = requireClinic(ctx, 'clinic.check_patient');
  const input = validate(coverageCheckRequest, body);
  const result = await checkPatient(ctx, input, actor, 'portal');
  await pushEvent(ctx, actor.clinicId, 'Проверен пациент, открыт визит');
  return result;
}

export async function visits(ctx: AuthCtx, qs: URLSearchParams): Promise<ClinicVisitView[]> {
  const actor = requireClinic(ctx, 'clinic.check_patient');
  const scope = qs.get('scope');
  const periodParam = qs.get('period');
  const now = ctx.now();
  let list = await ctx.repos.visits.list({ where: { clinicId: actor.clinicId } });
  if (scope === 'active') list = list.filter((v) => parseIso(v.expiresAt) > now);
  else if (periodParam && /^\d{4}-\d{2}$/.test(periodParam)) list = list.filter((v) => v.openedAt.startsWith(periodParam));
  else list = list.filter((v) => isoDay(parseIso(v.openedAt)) === isoDay(now));
  const people = new Map((await ctx.repos.insured.getMany([...new Set(list.map((v) => v.insuredId))])).map((i) => [i.id, i]));
  return list
    .sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))
    .map((v) => ({ id: v.id, insuredName: people.get(v.insuredId)?.fullName ?? '—', method: v.method, openedAt: v.openedAt, expiresAt: v.expiresAt }));
}

export async function visitCoverage(ctx: AuthCtx, id: UUID): Promise<CoverageCheckResult> {
  const actor = requireClinic(ctx, 'clinic.check_patient');
  return coverageFor(ctx, await requireVisit(ctx, actor.clinicId, id));
}

// ---------------------------------------------------------------- appointments

export async function appointments(ctx: AuthCtx, qs: URLSearchParams): Promise<(Appointment & { overdue: boolean })[]> {
  const actor = requireClinic(ctx, 'clinic.appointments.manage');
  const view = qs.get('view') ?? 'requests';
  let list = await ctx.repos.appointments.list({ where: { clinicId: actor.clinicId } });
  if (view === 'requests') {
    list = list.filter((a) => a.status === 'requested').sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  } else {
    const from = qs.get('from') ?? isoDay(ctx.now());
    const days = Math.min(14, Math.max(1, Number(qs.get('days')) || 1));
    const fromMs = parseIso(from);
    list = list
      .filter((a) => (a.status === 'confirmed' || a.status === 'requested' || a.status === 'completed') && parseIso(a.startsAt) >= fromMs && parseIso(a.startsAt) < fromMs + days * DAY)
      .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
  }
  const P = await loadParams(ctx);
  const now = ctx.now();
  const out: (Appointment & { overdue: boolean })[] = [];
  for (const a of list) out.push({ ...a, overdue: await isOverdueRequest(ctx, a, now, P) });
  return out;
}

export async function slots(ctx: AuthCtx, qs: URLSearchParams): Promise<Slot[]> {
  const actor = requireClinic(ctx, 'clinic.appointments.manage');
  const clinic = await clinicOf(ctx, actor.clinicId);
  const date = qs.get('date') ?? isoDay(ctx.now());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const taken = new Set((await ctx.repos.appointments.list({ where: { clinicId: clinic.id, status: { notIn: ['cancelled', 'declined'] } } })).map((a) => a.startsAt));
  return clinicSlots(clinic, date, ctx.now()).filter((s) => !taken.has(s.startsAt));
}

export type AppointmentAnswer = 'confirm' | 'reschedule' | 'decline';

const ANSWER_EVENT: Record<AppointmentAnswer, string> = {
  confirm: 'Запись подтверждена',
  reschedule: 'Пациенту предложено другое время',
  decline: 'Заявка на запись отклонена',
};

/** «Подтвердить» / «Предложить другое время» / «Отклонить» a request of a patient. */
export async function answerAppointment(ctx: AuthCtx, kind: AppointmentAnswer, id: UUID, body: unknown): Promise<Appointment> {
  const actor = requireClinic(ctx, 'clinic.appointments.manage');
  const a = await appointmentOfClinic(ctx, actor.clinicId, id);
  if (kind === 'confirm') respondToAppointment(a, 'clinic', { kind }, ctx.now());
  else if (kind === 'reschedule') {
    const { startsAt } = validate(rescheduleRequest, body);
    respondToAppointment(a, 'clinic', { kind, startsAt }, ctx.now());
  } else {
    const { reason } = validate(declineRequest, body);
    respondToAppointment(a, 'clinic', { kind, reason }, ctx.now());
  }
  await ctx.repos.appointments.put(a);
  await pushEvent(ctx, actor.clinicId, ANSWER_EVENT[kind]);
  return a;
}

// ---------------------------------------------------------------- guarantees

export async function listGuarantees(ctx: AuthCtx, status: string | null): Promise<GuaranteeView[]> {
  const actor = requireClinic(ctx, 'guarantees.read');
  const P = await loadParams(ctx);
  const list = (await ctx.repos.guarantees.list({ where: { clinicId: actor.clinicId } }))
    .filter((g) => !status || status.split(',').includes(g.status))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const out: GuaranteeView[] = [];
  for (const g of list) out.push(await toGuaranteeView(ctx, g, P));
  return out;
}

export async function getGuarantee(ctx: AuthCtx, id: UUID): Promise<GuaranteeView> {
  const actor = requireClinic(ctx, 'guarantees.read');
  const g = await ctx.repos.guarantees.first({ where: { id, clinicId: actor.clinicId } });
  if (!g) throw notFound();
  return toGuaranteeView(ctx, g);
}

export async function requestGuarantee(ctx: AuthCtx, body: unknown): Promise<GuaranteeView> {
  const actor = requireClinic(ctx, 'guarantees.request');
  const input = validate(guaranteeCreateRequest, body);
  return toGuaranteeView(ctx, await createGuarantee(ctx, actor, input, ctx.user.displayName));
}

/** Documents for a letter; an answer to «нужны документы» needs a comment and sends the letter back to review. */
export async function guaranteeDocuments(ctx: AuthCtx, id: UUID, form: { comment: string | null; files: readonly UploadedFile[] }): Promise<GuaranteeView> {
  const actor = requireClinic(ctx, 'guarantees.request');
  const g = await ctx.repos.guarantees.first({ where: { id, clinicId: actor.clinicId } });
  if (!g) throw notFound();
  if (g.status !== 'requested' && g.status !== 'info_requested') throw conflict('srv.guarantee.alreadyDecided');
  await attachGuaranteeFiles(ctx, g, form.files);
  if (g.status === 'info_requested') {
    const { comment } = validate(guaranteeAnswerSchema, { comment: form.comment ?? '' });
    g.infoComment = comment;
    g.status = 'requested';
    await ctx.repos.guarantees.update(g.id, { infoComment: g.infoComment, status: g.status });
    await pushEvent(ctx, actor.clinicId, `По ${g.number} отправлены документы`);
  }
  return toGuaranteeView(ctx, g);
}

/** The price list; with a visit, the prices of the patient's payer — «clinic + assistance» or MIG (ASSISTANCE_SPEC §5.3). */
export async function priceList(ctx: AuthCtx, visitId: string | null): Promise<PriceListItem[]> {
  const actor = requireClinic(ctx, 'clinic.check_patient');
  if (!visitId) return priceListOf(ctx, actor.clinicId);
  if (!isUuid(visitId)) throw notFound();
  const v = await visitOfClinic(ctx, actor.clinicId, visitId);
  return priceListOf(ctx, actor.clinicId, await payerOfLine(ctx, { visitId: v.id, serviceDate: isoDay(ctx.now()) }));
}

// ---------------------------------------------------------------- registries (clinic_admin)

export async function listRegistries(ctx: AuthCtx): Promise<RegistrySummary[]> {
  const actor = requireClinic(ctx, 'registries.submit');
  const list = (await ctx.repos.registries.list({ where: { clinicId: actor.clinicId } })).sort((a, b) =>
    a.period === b.period ? ((a.submittedAt ?? '9') < (b.submittedAt ?? '9') ? 1 : -1) : a.period < b.period ? 1 : -1,
  );
  const out: RegistrySummary[] = [];
  for (const r of list) out.push(await toRegistrySummary(ctx, r));
  return out;
}

export async function getRegistry(ctx: AuthCtx, id: UUID): Promise<RegistryView> {
  const actor = requireClinic(ctx, 'registries.submit');
  return toRegistryView(ctx, await registryOfClinic(ctx, actor.clinicId, id));
}

/** «Сформировать»: the draft of the month gets a line per visit not yet in a registry (+ the approved letter). */
export async function buildRegistry(ctx: AuthCtx, body: unknown): Promise<RegistryView> {
  const actor = requireClinic(ctx, 'registries.submit');
  const { period } = validate(registryBuildSchema, body);
  const repos = ctx.repos;
  let r = await repos.registries.first({ where: { clinicId: actor.clinicId, period, status: 'draft' } });
  if (!r) {
    r = { id: randomId(), clinicId: actor.clinicId, period, status: 'draft', source: 'portal', lines: [], totals: { claimed: 0, accepted: 0, rejected: 0, paid: 0 } };
    await repos.registries.insert(r);
  }
  const inRegistries = new Set((await repos.registries.list({ where: { clinicId: actor.clinicId } })).flatMap((x) => x.lines.map((l) => l.visitId)));
  const list = (await repos.visits.list({ where: { clinicId: actor.clinicId } })).filter((v) => v.openedAt.startsWith(period) && !inRegistries.has(v.id));
  for (const v of list) {
    const approved = await repos.guarantees.first({ where: { visitId: v.id, status: 'approved' } });
    r.lines.push(await buildLine(ctx, actor.clinicId, { visitId: v.id, serviceDate: isoDay(parseIso(v.openedAt)), serviceCode: 'TH-101', icd10: 'Z00.0', quantity: 1 }));
    if (approved) {
      r.lines.push(
        await buildLine(ctx, actor.clinicId, {
          visitId: v.id,
          serviceDate: isoDay(parseIso(v.openedAt)),
          serviceCode: approved.serviceCode,
          icd10: approved.icd10,
          quantity: 1,
          price: Math.min(approved.approvedAmount ?? approved.estimatedCost, (await priceListOf(ctx, actor.clinicId)).find((p) => p.code === approved.serviceCode)?.price ?? 0),
          guaranteeNumber: approved.number,
        }),
      );
    }
  }
  recomputeRegistry(r);
  await repos.registries.put(r);
  return toRegistryView(ctx, r);
}

/** A CSV file of the registry form, read by the adapter. */
export interface RegistryCsvInput {
  period: string | null;
  file: { size: number; text: string } | null;
}

/** CSV import: a dry run with the errors per row; `commit` creates a draft of the valid rows. */
export async function importRegistry(ctx: AuthCtx, form: RegistryCsvInput, commit: boolean): Promise<RegistryImportResult> {
  const actor = requireClinic(ctx, 'registries.submit');
  const { period } = validate(registryBuildSchema, { period: form.period });
  const file = form.file;
  if (!file) throw new DomainError(422, 'validation', 'srv.file.chooseCsv', { fields: { file: msg('srv.file.chooseCsv') } });
  if (file.size > REGISTRY_CSV_MAX_BYTES) throw new DomainError(422, 'validation', 'srv.file.tooLarge5mb', { fields: { file: msg('srv.file.tooLarge5mb') } });
  const parsed = Papa.parse<Record<string, string>>(file.text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
  if (parsed.data.length > REGISTRY_CSV_MAX_ROWS) throw new DomainError(422, 'validation', 'srv.registry.maxRows', { params: { max: REGISTRY_CSV_MAX_ROWS }, fields: { file: msg('srv.registry.tooManyRows') } });
  const required = ['visit_id', 'service_date', 'service_code', 'icd10', 'quantity', 'price'];
  const missing = required.filter((c) => !(parsed.meta.fields ?? []).includes(c));
  if (missing.length) throw new DomainError(422, 'validation', 'srv.registry.missingColumns', { params: { columns: missing.join(', ') }, fields: { file: msg('srv.registry.useTemplate') } });
  const errors: RegistryImportResult['errors'] = [];
  const lines: RegistryLine[] = [];
  for (const [k, row] of parsed.data.entries()) {
    const rowNo = k + 2;
    const candidate = {
      visitId: (row.visit_id ?? '').trim(),
      serviceDate: (row.service_date ?? '').trim(),
      serviceCode: (row.service_code ?? '').trim(),
      icd10: (row.icd10 ?? '').trim(),
      quantity: Number((row.quantity ?? '').trim()),
      price: Number((row.price ?? '').replace(/\s/g, '')),
      ...(row.guarantee_number?.trim() ? { guaranteeNumber: row.guarantee_number.trim() } : {}),
    };
    const r = registryLineInput.safeParse(candidate);
    if (!r.success) {
      errors.push({ row: rowNo, message: r.error.issues.map((i) => `${i.path.join('.')}: ${tm(i.message)}`).join('; ') });
      continue;
    }
    if (!r.data.serviceDate.startsWith(period)) {
      errors.push({ row: rowNo, message: msg('srv.registry.outOfPeriod', { period }) });
      continue;
    }
    let line: RegistryLine;
    try {
      line = await buildLine(ctx, actor.clinicId, r.data);
    } catch {
      errors.push({ row: rowNo, message: msg('srv.registry.visitNotInClinic') });
      continue;
    }
    const problems = await lineProblems(ctx, actor.clinicId, line);
    if (problems.length) errors.push({ row: rowNo, message: problems.length === 1 ? problems[0]! : problems.map((p) => tm(p)).join('; ') });
    else lines.push(line);
  }
  const out: RegistryImportResult = { total: parsed.data.length, valid: lines.length, errors };
  if (commit) {
    if (!lines.length) throw new DomainError(422, 'validation', 'srv.registry.noValidRows');
    const reg: Registry = { id: randomId(), clinicId: actor.clinicId, period, status: 'draft', source: 'csv', lines, totals: { claimed: 0, accepted: 0, rejected: 0, paid: 0 } };
    recomputeRegistry(reg);
    await ctx.repos.registries.insert(reg);
    out.registryId = reg.id;
  }
  return out;
}

export async function addRegistryLine(ctx: AuthCtx, id: UUID, body: unknown): Promise<RegistryView> {
  const actor = requireClinic(ctx, 'registries.submit');
  const r = await registryOfClinic(ctx, actor.clinicId, id);
  if (r.status !== 'draft') throw conflict('srv.registry.draftOnly');
  r.lines.push(await buildLine(ctx, actor.clinicId, validate(registryLineInput, body)));
  recomputeRegistry(r);
  await ctx.repos.registries.put(r);
  return toRegistryView(ctx, r);
}

export async function removeRegistryLine(ctx: AuthCtx, id: UUID, lineId: UUID): Promise<RegistryView> {
  const actor = requireClinic(ctx, 'registries.submit');
  const r = await registryOfClinic(ctx, actor.clinicId, id);
  if (r.status !== 'draft') throw conflict('srv.registry.draftOnly');
  if (!r.lines.some((l) => l.id === lineId)) throw notFound();
  r.lines = r.lines.filter((l) => l.id !== lineId);
  recomputeRegistry(r);
  await ctx.repos.registries.put(r);
  return toRegistryView(ctx, r);
}

export async function sendRegistry(ctx: AuthCtx, id: UUID): Promise<RegistryView> {
  const actor = requireClinic(ctx, 'registries.submit');
  const r = await registryOfClinic(ctx, actor.clinicId, id);
  await submitRegistry(ctx, r, actor);
  return toRegistryView(ctx, r);
}

/** Disputes a rejected line of an unpaid registry; `r` is changed and saved. */
export async function disputeLine(ctx: BaseCtx, r: Registry, lineId: UUID, body: unknown): Promise<RegistryLine> {
  const line = r.lines.find((l) => l.id === lineId);
  if (!line) throw notFound();
  if (line.status !== 'rejected' || r.status === 'paid') throw conflict('srv.registry.disputeRejectedUnpaid');
  line.disputeComment = validate(disputeRequest, body).comment;
  line.status = 'disputed';
  await ctx.repos.registries.put(r);
  return line;
}

export async function disputeRegistryLine(ctx: AuthCtx, id: UUID, lineId: UUID, body: unknown): Promise<RegistryView> {
  const actor = requireClinic(ctx, 'registries.submit');
  const r = await registryOfClinic(ctx, actor.clinicId, id);
  await disputeLine(ctx, r, lineId, body);
  await pushEvent(ctx, actor.clinicId, `Оспорена строка реестра за ${r.period}`);
  return toRegistryView(ctx, r);
}

// ---------------------------------------------------------------- documents

export async function documents(ctx: AuthCtx): Promise<ClinicDocuments> {
  const actor = requireClinic(ctx, 'clinic.check_patient');
  const clinic = await clinicOf(ctx, actor.clinicId);
  const P = await loadParams(ctx);
  return {
    contract: { number: P.nextDocNumber('clinicContract', { code: clinic.id.slice(0, 4) }), signedAt: isoDay(parseIso(clinic.contractUntil) - 365 * DAY), validUntil: clinic.contractUntil },
    acts: (await ctx.repos.registries.list({ where: { clinicId: clinic.id, status: { notIn: ['draft', 'submitted'] } } }))
      .sort((a, b) => (a.period < b.period ? 1 : -1))
      .map((r) => ({ registryId: r.id, period: r.period, claimed: r.totals.claimed, accepted: r.totals.accepted, paid: r.totals.paid, paidAt: r.paidAt })),
  };
}

// ---------------------------------------------------------------- users (clinic_admin)

export async function listUsers(ctx: AuthCtx): Promise<ClinicUserView[]> {
  const actor = requireClinic(ctx, 'clinic.users.manage');
  return (await ctx.repos.clinicUsers.list({ where: { clinicId: actor.clinicId } })).map(toUserView);
}

/** An e-mail is unique across all accounts that sign in with it. */
const emailTaken = () => new DomainError(409, 'conflict', 'srv.users.emailTaken', { fields: { email: msg('srv.users.emailInUse') } });

/** Invites a user of the clinic; `initialPassword`: the password of the new account (the demo one in the mock). */
export async function inviteUser(ctx: AuthCtx, body: unknown, initialPassword: string): Promise<ClinicUserView> {
  const actor = requireClinic(ctx, 'clinic.users.manage');
  const input = validate(clinicUserInviteSchema, body);
  const r = ctx.repos;
  if ((await r.clinicUsers.exists({ email: input.email })) || (await r.staff.exists({ email: input.email })) || (await r.hrUsers.exists({ email: input.email }))) throw emailTaken();
  const row: ClinicUserRow = { id: randomId(), ...input, password: initialPassword, clinicId: actor.clinicId, active: true, createdAt: tzIso(ctx.now()) };
  await r.clinicUsers.insert(row);
  await audit(ctx, actor, 'role_change', { targetType: 'user', targetId: row.id, targetLabel: row.fullName });
  return toUserView(row);
}

export async function patchUser(ctx: AuthCtx, id: UUID, body: unknown): Promise<ClinicUserView> {
  const actor = requireClinic(ctx, 'clinic.users.manage');
  const u = await ctx.repos.clinicUsers.first({ where: { id, clinicId: actor.clinicId } });
  if (!u) throw notFound();
  const patch = validate(clinicUserPatchSchema, body);
  if (u.id === actor.id && (patch.active === false || patch.role === 'clinic_registrar')) throw conflict('srv.clinicUsers.selfChange');
  if (patch.role) u.role = patch.role;
  if (patch.active !== undefined) {
    u.active = patch.active;
    if (!patch.active) await ctx.repos.sessions.removeWhere({ userId: u.id });
  }
  await ctx.repos.clinicUsers.update(u.id, { role: u.role, active: u.active });
  await audit(ctx, actor, patch.active === false ? 'user_deactivate' : 'role_change', { targetType: 'user', targetId: u.id, targetLabel: u.fullName });
  return toUserView(u);
}

// ---------------------------------------------------------------- integration (clinic_admin)

/** The clinic as a partner of the integration framework (keys, webhooks, logs: ./partnerIntegration). */
export async function integrationScope(ctx: AuthCtx): Promise<PartnerScope> {
  const actor = requireClinic(ctx, 'clinic.integration.manage');
  return { actor, partnerId: actor.clinicId, partnerType: 'clinic', mode: (await clinicOf(ctx, actor.clinicId)).integrationMode };
}
