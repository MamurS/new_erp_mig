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
import { matchesSearch } from '../lib/searchNormalize';
import { randomId } from '../lib/random';
import { DAY, isoDay, parseIso, startOfDay, tzIso } from '../lib/time';
import { ATTACHMENT_MAX_FILES, type UploadedFile } from '../lib/uploads';
import type { ClaimRow, FileRow } from '../store/db';
import { audit, conflict, DomainError, errorOf, forbidden, notFound, requirePermission, validate, type AuthCtx, type BaseCtx } from './kernel';
import { isUuid, paginate, q, sortBy } from './list';
import { loadParams } from './params';
import { findInsured } from './insured';
import { toClaimDetail, toClaimListItem } from './views';
import { currentReserve, refreshFlags } from './settlement';
import { currentAssistance } from './assistance';
import { FILED_CLAIM_SEQ_FLOOR, nextClaimNumber } from './clinic';
import { isOverdue } from './dashboard';
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
  let list = await ctx.repos.claims.list();
  const status = qs.get('status');
  if (status === 'active') list = list.filter((c) => ['new', 'review', 'medical_review'].includes(c.status));
  else if (status) list = list.filter((c) => status.split(',').includes(c.status));
  const category = qs.get('category');
  if (category) list = list.filter((c) => category.split(',').includes(c.category));
  if (qs.get('overdue') === '1') list = list.filter((c) => isOverdue(c, now));
  const clientId = qs.get('clientId');
  if (clientId) list = list.filter((c) => c.clientId === clientId);
  // Tabs of the claims officer's workplace (LIFECYCLE_SPEC §13).
  const tab = qs.get('tab');
  if (tab === 'new') list = list.filter((c) => c.status === 'new' && c.handledBy !== 'assistance');
  else if (tab === 'review') list = list.filter((c) => c.status === 'review' && !c.pendingDecision);
  else if (tab === 'opinion') list = list.filter((c) => c.status === 'medical_review');
  else if (tab === 'above') list = list.filter((c) => !!c.pendingDecision);
  else if (tab === 'appeals') list = list.filter((c) => c.appeal?.status === 'open');
  if (qs.get('flagged') === '1') list = list.filter((c) => c.flags?.some((f) => !f.dismissed));
  const term = q(qs);
  if (term) list = list.filter((c) => matchesSearch(term, c.number, c.insuredName, c.clientName, c.externalNumber));
  const sorted = sortBy(
    list,
    qs,
    {
      number: (c) => c.number,
      insuredName: (c) => c.insuredName,
      clientName: (c) => c.clientName,
      category: (c) => c.category,
      amountClaimed: (c) => c.amountClaimed,
      status: (c) => c.status,
      slaDueAt: (c) => parseIso(c.slaDueAt),
      createdAt: (c) => parseIso(c.createdAt),
      reserve: (c) => currentReserve(c),
    },
    'createdAt:desc',
  );
  const page = paginate(sorted, qs);
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
  let list: Appointment[] = await ctx.repos.appointments.list();
  const status = qs.get('status');
  if (status) list = list.filter((a) => status.split(',').includes(a.status));
  const date = qs.get('date');
  if (date) {
    const day = date === 'today' ? isoDay(ctx.now()) : date;
    list = list.filter((a) => isoDay(parseIso(a.startsAt)) === day);
  }
  const clinicId = qs.get('clinicId');
  if (clinicId) list = list.filter((a) => a.clinicId === clinicId);
  const insuredId = qs.get('insuredId');
  if (insuredId) list = list.filter((a) => a.insuredId === insuredId);
  const term = q(qs);
  if (term) list = list.filter((a) => matchesSearch(term, a.insuredName, a.clinicName));
  const sorted = sortBy(
    list,
    qs,
    {
      startsAt: (a) => parseIso(a.startsAt),
      insuredName: (a) => a.insuredName,
      clinicName: (a) => a.clinicName,
      specialty: (a) => a.specialty,
      status: (a) => a.status,
    },
    'startsAt:asc',
  );
  if (qs.get('pageSize') === 'all') return { items: sorted, total: sorted.length, page: 1, pageSize: sorted.length };
  return paginate(sorted, qs);
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
