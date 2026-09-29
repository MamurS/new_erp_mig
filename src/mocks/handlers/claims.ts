import { http, HttpResponse } from 'msw';
import { z } from 'zod';
import { declineAppointmentSchema, myClaimSchema, transitionSchema } from '@/shared/schemas/forms';
import { claimTransitions } from '@/shared/domain/claims';
import { can } from '@/shared/auth/permissions';
import { isStaffRole } from '@/shared/domain/labels';
import type { Appointment } from '@/shared/types';
import { db, type ClaimRow } from '../db';
import {
  API,
  audit,
  body,
  conflict,
  forbidden,
  notFound,
  paginate,
  param,
  q,
  requirePermission,
  requireSession,
  route,
  sortBy,
} from '../http';
import { randomId } from '../rng';
import { DAY, isoDay, parseIso, startOfDay, tzIso } from '../time';
import { toClaimDetail } from '../views';
import { isOverdue } from './dashboard';
import { findInsured } from './insured';
import { renderReceiptPng } from '../receipt';

function findClaim(id: string): ClaimRow {
  const c = db().claims.find((x) => x.id === id);
  if (!c) throw notFound();
  return c;
}

let seq = 9000;
export function nextClaimNumber(): string {
  seq += 1;
  return `У-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;
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
      const term = q(url);
      if (term)
        list = list.filter(
          (c) => c.number.toLowerCase().includes(term) || c.insuredName.toLowerCase().includes(term) || c.clientName.toLowerCase().includes(term),
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
        },
        'createdAt:desc',
      );
      const page = paginate(sorted, url);
      return { ...page, items: page.items.map(({ publicRejectionReason: _p, ...c }) => c) };
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
      if (blocked) throw conflict(blocked.reason);
      if (!t.allowed.includes(input.to)) throw conflict('Этот переход недоступен из текущего статуса');
      if (input.to === 'approved') {
        const amount = input.amountApproved ?? claim.amountClaimed;
        if (amount > claim.amountClaimed) {
          throw conflict('Сумма одобрения не может превышать заявленную');
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
      requirePermission(user, 'claims.create');
      if (user.role !== 'operator') throw forbidden();
      const input = await body(request, myClaimSchema.extend({ insuredId: z.string().uuid() }));
      const i = findInsured(input.insuredId);
      const now = Date.now();
      const claim: ClaimRow = {
        id: randomId(),
        number: nextClaimNumber(),
        insuredId: i.id,
        insuredName: i.fullName,
        clientId: i.clientId,
        clientName: i.clientName,
        category: input.category,
        source: 'operator',
        amountClaimed: input.amount,
        providerName: input.providerName,
        serviceDate: input.serviceDate,
        status: 'new',
        slaDueAt: tzIso(now + 5 * DAY),
        createdAt: tzIso(now),
        updatedAt: tzIso(now),
        attachments: [],
        history: [{ at: tzIso(now), actorName: user.displayName, to: 'new', comment: 'Создан оператором' }],
      };
      db().claims.unshift(claim);
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
      if (user.role === 'insured') {
        if (!f.insuredId || f.insuredId !== user.insuredId) throw notFound();
      } else if (!can(user, 'claims.read') || !isStaffRole(user.role)) {
        throw forbidden();
      }
      const bytes = f.bytes ?? (await renderReceiptPng(f.seedText ?? ['Файл недоступен после перезагрузки']));
      return new HttpResponse(bytes, {
        headers: { 'Content-Type': f.bytes ? f.mime : 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
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
      if (term) list = list.filter((a) => a.insuredName.toLowerCase().includes(term) || a.clinicName.toLowerCase().includes(term));
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
      if (a.status !== 'requested') throw conflict('Запись уже обработана');
      a.status = 'confirmed';
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
      await body(ctx.request, declineAppointmentSchema);
      if (a.status !== 'requested' && a.status !== 'confirmed') throw conflict('Запись уже обработана');
      a.status = 'declined';
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
      if (Number.isNaN(starts) || starts < startOfDay(Date.now())) throw conflict('Выберите время в будущем');
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
