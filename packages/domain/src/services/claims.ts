/*
 * Claims of the staff portal: the list with the claims officer's tabs, the card, status transitions,
 * registration by an operator with attachments, files of claims and guarantee letters; appointments
 * handled by the MIG operator.
 */
import { z } from 'zod';
import { msg } from '@mig/i18n';
import type { Appointment, SessionUser } from '@mig/contracts';
import type { ClaimDetail } from '@mig/contracts/dto';
import { declineAppointmentSchema, staffClaimSchema, transitionSchema } from '@mig/contracts/forms';
import { can } from '../auth/permissions';
import { claimTransitions } from '../claims';
import { isStaffRole } from '../labels';
import { randomId } from '../lib/random';
import { DAY, isoDay, parseIso, startOfDay, tzIso } from '../lib/time';
import { ATTACHMENT_MAX_FILES, type UploadedFile } from '../lib/uploads';
import type { ClaimRow, FileRow } from '../store/db';
import type { ComputedFields } from '../store/computed';
import type { Where } from '../store/query';

type ClaimQ = ClaimRow & ComputedFields['claims'];
/** dashboard.ts ACTIVE_CLAIM: claims still being handled. */
const ACTIVE_STATUSES = ['new', 'review', 'medical_review'] as const;
import { audit, conflict, DomainError, errorOf, forbidden, notFound, requirePermission, validate, type AuthCtx, type BaseCtx } from './kernel';
import { allOf, dayRange, isUuid, NOTHING, pageOf, q, searchWhere, sortParam, tsBound } from './list';
import { loadParams } from './params';
import { findInsured } from './insured';
import { toClaimDetail, toClaimListItem } from './views';
import { currentReserve, refreshFlags } from './settlement';
import { currentAssistance } from './assistance';
import { FILED_CLAIM_SEQ_FLOOR, nextClaimNumber } from './clinic';
import { checkAttachment } from './uploads';

async function findClaim(ctx: BaseCtx, id: string): Promise<ClaimRow> {
  const c = await ctx.repos.claims.get(id);
  if (!c) throw notFound();
  return c;
}

function requireStaffClaims(user: SessionUser): void {
  requirePermission(user, 'claims.read');
  if (!isStaffRole(user.role)) throw notFound();
}

// ---------------------------------------------------------------- endpoints

export async function listClaims(ctx: AuthCtx, qs: URLSearchParams) {
  requireStaffClaims(ctx.user);
  const now = ctx.now();
  const status = qs.get('status');
  const category = qs.get('category');
  const clientId = qs.get('clientId');
  const tab = qs.get('tab');
  const term = q(qs);
  const where = allOf<ClaimQ>(
    status === 'active' ? { status: { in: [...ACTIVE_STATUSES] } } : status && { status: { in: status.split(',') as ClaimRow['status'][] } },
    category && { category: { in: category.split(',') as ClaimRow['category'][] } },
    // dashboard.ts isOverdue: active and past the SLA.
    qs.get('overdue') === '1' && { status: { in: [...ACTIVE_STATUSES] }, slaDueAt: { lt: tsBound(now) } },
    clientId && { clientId },
    // Tabs of the claims officer's workplace (LIFECYCLE_SPEC §13).
    tab === 'new' && { status: 'new', handledBy: { ne: 'assistance' } },
    tab === 'review' && { status: 'review', hasPendingDecision: false },
    tab === 'opinion' && { status: 'medical_review' },
    tab === 'above' && { hasPendingDecision: true },
    tab === 'appeals' && { appealOpen: true },
    qs.get('flagged') === '1' && { flagged: true },
    term && searchWhere<ClaimQ>(term, ['number', 'insuredName', 'clientName', 'externalNumber']),
  );
  const orderBy = sortParam<ClaimQ>(
    qs,
    {
      number: { field: 'number', collate: 'ru' },
      insuredName: { field: 'insuredName', collate: 'ru' },
      clientName: { field: 'clientName', collate: 'ru' },
      category: { field: 'category', collate: 'ru' },
      amountClaimed: { field: 'amountClaimed' },
      status: { field: 'status', collate: 'ru' },
      slaDueAt: { field: 'slaDueAt' },
      createdAt: { field: 'createdAt' },
      reserve: { field: 'reserve' },
    },
    'createdAt:desc',
  );
  const page = await pageOf(ctx.repos.claims, qs, { where, orderBy });
  return { ...page, items: page.items.map(toClaimListItem) };
}

export async function claimDetail(ctx: AuthCtx, id: string): Promise<ClaimDetail> {
  requireStaffClaims(ctx.user);
  return toClaimDetail(ctx, await findClaim(ctx, id), ctx.user);
}

export async function transition(ctx: AuthCtx, id: string, body: unknown): Promise<ClaimDetail> {
  const { user } = ctx;
  requireStaffClaims(user);
  const claim = await findClaim(ctx, id);
  const input = validate(transitionSchema, body);
  if (!can(user, 'claims.transition')) throw forbidden();
  const t = claimTransitions(user, claim);
  const blocked = t.blocked.find((b) => b.to === input.to);
  if (blocked) throw errorOf(409, 'conflict', blocked.reason);
  if (!t.allowed.includes(input.to)) throw conflict('srv.claim.transitionUnavailable');
  if (input.to === 'approved') {
    const amount = input.amountApproved ?? claim.amountClaimed;
    if (amount > claim.amountClaimed) {
      throw conflict('srv.claim.amountOverClaimed');
    }
    claim.amountApproved = amount;
    claim.approvedById = user.id;
  }
  if (input.to === 'rejected') claim.publicRejectionReason = input.comment;
  const now = tzIso(ctx.now());
  claim.history.push({ at: now, actorName: user.displayName, from: claim.status, to: input.to, comment: input.comment || undefined });
  claim.status = input.to;
  claim.updatedAt = now;
  await ctx.repos.claims.put(claim);
  await audit(ctx, user, 'claim_transition', { targetType: 'claim', targetId: claim.id, targetLabel: `${claim.number}: → ${input.to}` });
  return toClaimDetail(ctx, claim, user);
}

/** Fields of the staff registration form (multipart) as the adapter read them. */
export interface StaffClaimForm {
  insuredId: string | null;
  intakeChannel: string | null;
  category: string | null;
  amount: string | null;
  serviceDate: string | null;
  providerName: string | null;
}

export async function createClaim(ctx: AuthCtx, form: StaffClaimForm, files: readonly UploadedFile[]): Promise<{ id: string }> {
  const { user } = ctx;
  // Staff registration only: the insured person files through /me/claims.
  requirePermission(user, 'claims.create');
  if (!isStaffRole(user.role)) throw forbidden();
  const input = validate(staffClaimSchema, {
    insuredId: form.insuredId,
    intakeChannel: form.intakeChannel,
    category: form.category,
    amount: Number(form.amount),
    serviceDate: form.serviceDate,
    providerName: form.providerName,
  });
  if (files.length > ATTACHMENT_MAX_FILES) throw new DomainError(422, 'validation', 'srv.file.max10', { fields: { files: msg('srv.file.max10') } });
  const P = await loadParams(ctx);
  const i = await findInsured(ctx, input.insuredId);
  const claimId = randomId();
  const attachments: ClaimRow['attachments'] = [];
  for (const [idx, f] of files.entries()) {
    const { bytes, mime } = await checkAttachment(ctx, f);
    const fileId = randomId();
    const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg';
    // Neutral names without personal data; the insured person never gets these files (no insuredId).
    const fileName = `document-${idx + 1}.${ext}`;
    await ctx.repos.files.insert({ id: fileId, mime, bytes, claimId, fileName });
    attachments.push({ id: fileId, kind: 'other', fileName, mime, sizeBytes: bytes.length, url: `/api/files/${fileId}` });
  }
  const now = ctx.now();
  const claim: ClaimRow = {
    id: claimId,
    number: await nextClaimNumber(ctx, P, { floor: FILED_CLAIM_SEQ_FLOOR }),
    insuredId: i.id,
    insuredName: i.fullName,
    clientId: i.clientId,
    clientName: i.clientName,
    category: input.category,
    source: 'operator',
    intakeChannel: input.intakeChannel,
    amountClaimed: input.amount,
    providerName: input.providerName,
    serviceDate: input.serviceDate,
    status: 'new',
    slaDueAt: tzIso(now + 5 * DAY),
    createdAt: tzIso(now),
    updatedAt: tzIso(now),
    attachments,
    history: [{ at: tzIso(now), actorName: user.displayName, to: 'new', comment: 'Создан сотрудником МИГ' }],
    // Registered by MIG itself: settled by the claims officer, never routed to an assistance.
    handledBy: 'mig',
  };
  await ctx.repos.claims.insert(claim, { at: 'start' });
  await refreshFlags(ctx, claim, P);
  // The reserve is set at once to the claimed amount: the registration step of the reserve history.
  await audit(ctx, user, 'claim_created', { targetType: 'claim', targetId: claim.id, targetLabel: claim.number });
  await audit(ctx, user, 'claim_reserve_changed', { targetType: 'claim', targetId: claim.id, targetLabel: `${claim.number}: 0 → ${currentReserve(claim)}`, reason: 'Регистрация: заявленная сумма' });
  return { id: claim.id };
}

// ---------------------------------------------------------------- files

/**
 * A stored file the person may get. `bytes: null` — a seeded receipt the adapter draws from `seedText`.
 * `download`: a PDF, never shown inline, under `fileName`.
 */
export interface FileContent {
  bytes: Uint8Array | null;
  mime: FileRow['mime'];
  seedText?: string[];
  download?: string;
}

/**
 * The file row a person may get (403 for a role that may not read files of its kind, 404 for a file that is
 * missing or hidden from the person). Used by the download and by the API's signed links.
 */
export async function fileAccess(ctx: AuthCtx, id: string): Promise<FileRow> {
  const { user } = ctx;
  const own = await ctx.repos.files.get(id);
  // A file the person's RLS hides still answers like the mock (403 for a role that may not read files of its
  // kind, 404 otherwise): only its kind is asked (app.fact_file_kind), a hidden file is never returned.
  const kind = own ? (own.guaranteeId ? 'guarantee' : 'other') : isUuid(id) ? await ctx.repos.facts.fileKind(id) : null;
  if (!kind) throw notFound();
  if (kind === 'guarantee') {
    // Guarantee-letter attachments: the clinic that uploaded them and MIG staff with guarantees.read.
    if (!own || !can(user, 'guarantees.read', { clinicId: own.clinicId })) throw notFound();
  } else if (user.role === 'insured') {
    if (!own?.insuredId || own.insuredId !== user.insuredId) throw notFound();
  } else if (!can(user, 'claims.read') || !isStaffRole(user.role)) {
    throw forbidden();
  }
  if (!own) throw notFound();
  return own;
}

export async function getFile(ctx: AuthCtx, id: string): Promise<FileContent> {
  const f = await fileAccess(ctx, id);
  if (f.guaranteeId) {
    if (!f.bytes) throw notFound();
    // PDFs are never rendered inline in the app: download only (CLINIC_SPEC §9.7).
    return { bytes: f.bytes, mime: f.mime, ...(f.mime === 'application/pdf' ? { download: f.fileName ?? 'document.pdf' } : {}) };
  }
  if (!f.bytes) return { bytes: null, mime: 'image/png', seedText: f.seedText ?? ['Файл недоступен после перезагрузки'] };
  // PDFs are never rendered inline: download only, under a neutral name.
  return { bytes: f.bytes, mime: f.mime, ...(f.mime === 'application/pdf' ? { download: f.fileName ?? 'document.pdf' } : {}) };
}

// ---------------------------------------------------------------- appointments (staff)

/** The MIG curator answers only for clients without an assistance (ASSISTANCE_SPEC §9.3). */
async function requireMigAppointment(ctx: BaseCtx, user: SessionUser, insuredId: string): Promise<void> {
  const i = await ctx.repos.insured.get(insuredId);
  const assistanceId = i ? await currentAssistance(ctx, i.policyId) : null;
  if (!can(user, 'assist.appointments.manage', { assistanceId })) {
    throw new DomainError(403, 'forbidden', 'srv.appointment.byAssistance');
  }
}

export async function listAppointments(ctx: AuthCtx, qs: URLSearchParams) {
  const { user } = ctx;
  requirePermission(user, 'appointments.read');
  if (!isStaffRole(user.role)) throw notFound();
  const status = qs.get('status');
  const date = qs.get('date');
  const clinicId = qs.get('clinicId');
  const insuredId = qs.get('insuredId');
  const term = q(qs);
  const where = allOf<Appointment>(
    status && { status: { in: status.split(',') as Appointment['status'][] } },
    date && dayWhere(date === 'today' ? isoDay(ctx.now()) : date),
    clinicId && { clinicId },
    insuredId && { insuredId },
    term && searchWhere<Appointment>(term, ['insuredName', 'clinicName']),
  );
  const orderBy = sortParam<Appointment>(
    qs,
    {
      startsAt: { field: 'startsAt' },
      insuredName: { field: 'insuredName', collate: 'ru' },
      clinicName: { field: 'clinicName', collate: 'ru' },
      specialty: { field: 'specialty', collate: 'ru' },
      status: { field: 'status', collate: 'ru' },
    },
    'startsAt:asc',
  );
  if (qs.get('pageSize') === 'all') {
    const items = await ctx.repos.appointments.list({ where, orderBy });
    return { items, total: items.length, page: 1, pageSize: items.length };
  }
  return pageOf(ctx.repos.appointments, qs, { where, orderBy });
}

/** Appointments starting on the Tashkent day `day` (`isoDay(startsAt) === day`); a value that is not a day matches none. */
function dayWhere(day: string): Where<Appointment> {
  const range = dayRange(day);
  return range ? { startsAt: range } : (NOTHING as Where<Appointment>);
}

async function staffAppointment(ctx: AuthCtx, id: string): Promise<Appointment> {
  const { user } = ctx;
  requirePermission(user, 'appointments.manage');
  if (!isStaffRole(user.role)) throw notFound();
  const a = await ctx.repos.appointments.get(id);
  if (!a) throw notFound();
  await requireMigAppointment(ctx, user, a.insuredId);
  return a;
}

export async function confirmAppointment(ctx: AuthCtx, id: string): Promise<Appointment> {
  const a = await staffAppointment(ctx, id);
  if (a.status !== 'requested') throw conflict('srv.appointment.alreadyHandled');
  // The operator answers as a fallback when the clinic does not (CLINIC_SPEC §4.3).
  return ctx.repos.appointments.update(a.id, { status: 'confirmed', respondedBy: 'operator', respondedAt: tzIso(ctx.now()), proposedStartsAt: undefined });
}

export async function declineAppointment(ctx: AuthCtx, id: string, body: unknown): Promise<Appointment> {
  const a = await staffAppointment(ctx, id);
  const { reason } = validate(declineAppointmentSchema, body);
  if (a.status !== 'requested' && a.status !== 'confirmed') throw conflict('srv.appointment.alreadyHandled');
  return ctx.repos.appointments.update(a.id, { status: 'declined', declineReason: reason, respondedBy: 'operator', respondedAt: tzIso(ctx.now()), proposedStartsAt: undefined });
}

const staffAppointmentSchema = z.object({
  insuredId: z.string().uuid(),
  clinicId: z.string().uuid(),
  specialty: z.enum(['therapist', 'pediatrician', 'dentist', 'cardiologist', 'gynecologist', 'ent', 'neurologist', 'ophthalmologist']),
  startsAt: z.string().trim().min(10).max(40),
});

/** The operator books a visit for a person (confirmed at once). */
export async function createAppointment(ctx: AuthCtx, body: unknown): Promise<Appointment> {
  const { user } = ctx;
  requirePermission(user, 'appointments.manage');
  if (user.role !== 'operator') throw forbidden();
  const input = validate(staffAppointmentSchema, body);
  const i = await findInsured(ctx, input.insuredId);
  const clinic = await ctx.repos.clinics.get(input.clinicId);
  if (!clinic) throw notFound();
  const starts = parseIso(input.startsAt);
  if (Number.isNaN(starts) || starts < startOfDay(ctx.now())) throw conflict('srv.time.chooseFuture');
  const a: Appointment = {
    id: randomId(),
    insuredId: i.id,
    insuredName: i.fullName,
    clientName: i.clientName,
    clinicId: clinic.id,
    clinicName: clinic.name,
    specialty: input.specialty,
    startsAt: tzIso(starts),
    status: 'confirmed',
    createdAt: tzIso(ctx.now()),
  };
  await ctx.repos.appointments.insert(a);
  return a;
}
