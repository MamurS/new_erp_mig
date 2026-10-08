import { matchesSearch } from '@/shared/lib/searchNormalize';
import { http, HttpResponse } from 'msw';
import { z } from 'zod';
import { declineAppointmentSchema, staffClaimSchema, transitionSchema } from '@mig/contracts/forms';
import { msg } from '@mig/i18n';
import { ATTACHMENT_MAX_FILES } from '@/shared/lib/attachments';
import { claimTransitions } from '@mig/domain/claims';
import { can } from '@mig/domain/auth/permissions';
import { isStaffRole } from '@mig/domain/labels';
import type { Appointment, SessionUser } from '@mig/contracts';
import { currentAssistance } from '../assistance-core';
import { db, type ClaimRow } from '../db';
import { API, audit, body, conflict, forbidden, HttpError, httpErrorOf, notFound, paginate, param, q, requirePermission, requireSession, route, sortBy, validate } from '../http';
import { readAttachment, readForm } from '../uploads';
import { randomId } from '@mig/seed/rng';
import { DAY, isoDay, parseIso, startOfDay, tzIso } from '@mig/seed/time';
import { toClaimDetail, toClaimListItem } from '../views';
import { isOverdue } from './dashboard';
import { findInsured } from './insured';
import { renderReceiptPng } from '../receipt';
import { currentReserve, refreshFlags } from '../settlement-core';
import { nextDocNumber } from '../params';

function findClaim(id: string): ClaimRow {
  const c = db().claims.find((x) => x.id === id);
  if (!c) throw notFound();
  return c;
}

let seq = 9000;
export function nextClaimNumber(): string {
  seq += 1;
  return nextDocNumber('claim', { year: new Date().getFullYear(), n: seq });
}

export const claimHandlers = [
  http.get(
    `${API}/claims`,
    route(({ request, url }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'claims.read');
      if (!isStaffRole(user.role)) throw notFound();
      const now = Date.now();
      let list = db().claims;
      const status = url.searchParams.get('status');
      if (status === 'active') list = list.filter((c) => ['new', 'review', 'medical_review'].includes(c.status));
      else if (status) list = list.filter((c) => status.split(',').includes(c.status));
      const category = url.searchParams.get('category');
      if (category) list = list.filter((c) => category.split(',').includes(c.category));
      if (url.searchParams.get('overdue') === '1') list = list.filter((c) => isOverdue(c, now));
      const clientId = url.searchParams.get('clientId');
      if (clientId) list = list.filter((c) => c.clientId === clientId);
      // Tabs of the claims officer's workplace (LIFECYCLE_SPEC §13).
      const tab = url.searchParams.get('tab');
      if (tab === 'new') list = list.filter((c) => c.status === 'new' && c.handledBy !== 'assistance');
      else if (tab === 'review') list = list.filter((c) => c.status === 'review' && !c.pendingDecision);
      else if (tab === 'opinion') list = list.filter((c) => c.status === 'medical_review');
      else if (tab === 'above') list = list.filter((c) => !!c.pendingDecision);
      else if (tab === 'appeals') list = list.filter((c) => c.appeal?.status === 'open');
      if (url.searchParams.get('flagged') === '1') list = list.filter((c) => c.flags?.some((f) => !f.dismissed));
      const term = q(url);
      if (term)
        list = list.filter(
          (c) => matchesSearch(term, c.number, c.insuredName, c.clientName, c.externalNumber),
        );
      const sorted = sortBy(
        list,
        url,
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
      const page = paginate(sorted, url);
      return { ...page, items: page.items.map(toClaimListItem) };
    }),
  ),
  http.get(
    `${API}/claims/:id`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'claims.read');
      if (!isStaffRole(user.role)) throw notFound();
      return toClaimDetail(db(), findClaim(param(ctx, 'id')), user);
    }),
  ),
  http.post(
    `${API}/claims/:id/transition`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'claims.read');
      if (!isStaffRole(user.role)) throw notFound();
      const claim = findClaim(param(ctx, 'id'));
      const input = await body(ctx.request, transitionSchema);
      if (!can(user, 'claims.transition')) throw forbidden();
      const t = claimTransitions(user, claim);
      const blocked = t.blocked.find((b) => b.to === input.to);
      if (blocked) throw httpErrorOf(409, 'conflict', blocked.reason);
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
      const now = tzIso(Date.now());
      claim.history.push({ at: now, actorName: user.displayName, from: claim.status, to: input.to, comment: input.comment || undefined });
      claim.status = input.to;
      claim.updatedAt = now;
      audit(user, 'claim_transition', { targetType: 'claim', targetId: claim.id, targetLabel: `${claim.number}: → ${input.to}` });
      return toClaimDetail(db(), claim, user);
    }),
  ),
  http.post(
    `${API}/claims`,
    route(async ({ request }) => {
      const { user } = requireSession(request);
      // Staff registration only: the insured person files through /me/claims.
      requirePermission(user, 'claims.create');
      if (!isStaffRole(user.role)) throw forbidden();
      const form = await readForm(request);
      const input = validate(staffClaimSchema, {
        insuredId: form.get('insuredId'),
        intakeChannel: form.get('intakeChannel'),
        category: form.get('category'),
        amount: Number(form.get('amount')),
        serviceDate: form.get('serviceDate'),
        providerName: form.get('providerName'),
      });
      const files = form.getAll('files').filter((f): f is File => f instanceof File);
      if (files.length > ATTACHMENT_MAX_FILES) throw new HttpError(422, 'validation', 'srv.file.max10', { fields: { files: msg('srv.file.max10') } });
      const d = db();
      const i = findInsured(input.insuredId);
      const claimId = randomId();
      const attachments: ClaimRow['attachments'] = [];
      for (const [idx, f] of files.entries()) {
        const { bytes, mime } = await readAttachment(f);
        const fileId = randomId();
        const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg';
        // Neutral names without personal data; the insured person never gets these files (no insuredId).
        const fileName = `document-${idx + 1}.${ext}`;
        d.files.push({ id: fileId, mime, bytes, claimId, fileName });
        attachments.push({ id: fileId, kind: 'other', fileName, mime, sizeBytes: bytes.length, url: `/api/files/${fileId}` });
      }
      const now = Date.now();
      const claim: ClaimRow = {
        id: claimId,
        number: nextClaimNumber(),
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
      d.claims.unshift(claim);
      refreshFlags(d, claim);
      // The reserve is set at once to the claimed amount: the registration step of the reserve history (settlement-core).
      audit(user, 'claim_created', { targetType: 'claim', targetId: claim.id, targetLabel: claim.number });
      audit(user, 'claim_reserve_changed', { targetType: 'claim', targetId: claim.id, targetLabel: `${claim.number}: 0 → ${currentReserve(claim)}`, reason: 'Регистрация: заявленная сумма' });
      return { id: claim.id };
    }),
  ),
  // ---- files ----
  http.get(
    `${API}/files/:id`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      const d = db();
      const f = d.files.find((x) => x.id === param(ctx, 'id'));
      if (!f) throw notFound();
      if (f.guaranteeId) {
        // Guarantee-letter attachments: the clinic that uploaded them and MIG staff with guarantees.read.
        if (!can(user, 'guarantees.read', { clinicId: f.clinicId })) throw notFound();
        if (!f.bytes) throw notFound();
        return new HttpResponse(f.bytes, {
          headers: {
            'Content-Type': f.mime,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            // PDFs are never rendered inline in the app: download only (CLINIC_SPEC §9.7).
            ...(f.mime === 'application/pdf' ? { 'Content-Disposition': `attachment; filename="${f.fileName ?? 'document.pdf'}"` } : {}),
          },
        });
      }
      if (user.role === 'insured') {
        if (!f.insuredId || f.insuredId !== user.insuredId) throw notFound();
      } else if (!can(user, 'claims.read') || !isStaffRole(user.role)) {
        throw forbidden();
      }
      const bytes = f.bytes ?? (await renderReceiptPng(f.seedText ?? ['Файл недоступен после перезагрузки']));
      return new HttpResponse(bytes, {
        headers: {
          'Content-Type': f.bytes ? f.mime : 'image/png',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          // PDFs are never rendered inline: download only, under a neutral name.
          ...(f.bytes && f.mime === 'application/pdf' ? { 'Content-Disposition': `attachment; filename="${f.fileName ?? 'document.pdf'}"` } : {}),
        },
      });
    }),
  ),
  // ---- appointments (staff) ----
  http.get(
    `${API}/appointments`,
    route(({ request, url }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'appointments.read');
      if (!isStaffRole(user.role)) throw notFound();
      let list: Appointment[] = db().appointments;
      const status = url.searchParams.get('status');
      if (status) list = list.filter((a) => status.split(',').includes(a.status));
      const date = url.searchParams.get('date');
      if (date) {
        const day = date === 'today' ? isoDay(Date.now()) : date;
        list = list.filter((a) => isoDay(parseIso(a.startsAt)) === day);
      }
      const clinicId = url.searchParams.get('clinicId');
      if (clinicId) list = list.filter((a) => a.clinicId === clinicId);
      const insuredId = url.searchParams.get('insuredId');
      if (insuredId) list = list.filter((a) => a.insuredId === insuredId);
      const term = q(url);
      if (term) list = list.filter((a) => matchesSearch(term, a.insuredName, a.clinicName));
      const sorted = sortBy(
        list,
        url,
        {
          startsAt: (a) => parseIso(a.startsAt),
          insuredName: (a) => a.insuredName,
          clinicName: (a) => a.clinicName,
          specialty: (a) => a.specialty,
          status: (a) => a.status,
        },
        'startsAt:asc',
      );
      if (url.searchParams.get('pageSize') === 'all') return { items: sorted, total: sorted.length, page: 1, pageSize: sorted.length };
      return paginate(sorted, url);
    }),
  ),
  http.post(
    `${API}/appointments/:id/confirm`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'appointments.manage');
      if (!isStaffRole(user.role)) throw notFound();
      const a = db().appointments.find((x) => x.id === param(ctx, 'id'));
      if (!a) throw notFound();
      requireMigAppointment(user, a.insuredId);
      if (a.status !== 'requested') throw conflict('srv.appointment.alreadyHandled');
      // The operator answers as a fallback when the clinic does not (CLINIC_SPEC §4.3).
      a.status = 'confirmed';
      a.respondedBy = 'operator';
      a.respondedAt = tzIso(Date.now());
      a.proposedStartsAt = undefined;
      return a;
    }),
  ),
  http.post(
    `${API}/appointments/:id/decline`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'appointments.manage');
      if (!isStaffRole(user.role)) throw notFound();
      const a = db().appointments.find((x) => x.id === param(ctx, 'id'));
      if (!a) throw notFound();
      requireMigAppointment(user, a.insuredId);
      const { reason } = await body(ctx.request, declineAppointmentSchema);
      if (a.status !== 'requested' && a.status !== 'confirmed') throw conflict('srv.appointment.alreadyHandled');
      a.status = 'declined';
      a.declineReason = reason;
      a.respondedBy = 'operator';
      a.respondedAt = tzIso(Date.now());
      a.proposedStartsAt = undefined;
      return a;
    }),
  ),
  http.post(
    `${API}/appointments`,
    route(async ({ request }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'appointments.manage');
      if (user.role !== 'operator') throw forbidden();
      const input = await body(
        request,
        z.object({
          insuredId: z.string().uuid(),
          clinicId: z.string().uuid(),
          specialty: z.enum(['therapist', 'pediatrician', 'dentist', 'cardiologist', 'gynecologist', 'ent', 'neurologist', 'ophthalmologist']),
          startsAt: z.string().trim().min(10).max(40),
        }),
      );
      const i = findInsured(input.insuredId);
      const clinic = db().clinics.find((c) => c.id === input.clinicId);
      if (!clinic) throw notFound();
      const starts = parseIso(input.startsAt);
      if (Number.isNaN(starts) || starts < startOfDay(Date.now())) throw conflict('srv.time.chooseFuture');
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
        createdAt: tzIso(Date.now()),
      };
      db().appointments.push(a);
      return a;
    }),
  ),
];

/** The MIG curator answers only for clients without an assistance (ASSISTANCE_SPEC §9.3). */
function requireMigAppointment(user: SessionUser, insuredId: string): void {
  const i = db().insured.find((x) => x.id === insuredId);
  const assistanceId = i ? currentAssistance(db(), i.policyId) : null;
  if (!can(user, 'assist.appointments.manage', { assistanceId })) {
    throw new HttpError(403, 'forbidden', 'srv.appointment.byAssistance');
  }
}
