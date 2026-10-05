import { http, HttpResponse } from 'msw';
import { adminUserPatchSchema, exportSchema, limitRequestSchema, rejectLimitSchema } from '@/shared/schemas/forms';
import type { AuditEntry, Clinic, LimitChangeRequest, Slot, Specialty } from '@/shared/types';
import type { ClaimsByCategoryRow, LossRatioRow, PremiumByMonthRow } from '@/shared/types/dto';
import { can } from '@/shared/auth/permissions';
import { isStaffRole, PROGRAM_LABEL } from '@/shared/domain/labels';
import { CLAIM_CATEGORY_LABEL, CLAIM_STATUS_LABEL } from '@/shared/domain/claims';
import { FOUR_EYES_LIMIT_HINT } from '@/shared/domain/limits';
import { exportFileName, toCsv } from '@/shared/lib/csv';
import { db } from '../db';
import { API, audit, body, byLegalForm, byLegalName, conflict, filterLegalForm, forbidden, httpErrorOf, notFound, paginate, param, q, requirePermission, requireSession, route, sortBy } from '../http';
import { legalFormShort } from '@/shared/config/legalForms';
import { hashString, mulberry32, randomId } from '../rng';
import { at, DAY, isoDay, parseIso, startOfDay, tzIso } from '../time';
import { PROGRAMS } from '../programs';
import { toClient, toHrEmployee } from '../views';

const SPECIALTIES = new Set<Specialty>(['therapist', 'pediatrician', 'dentist', 'cardiologist', 'gynecologist', 'ent', 'neurologist', 'ophthalmologist']);

export function clinicSlots(clinic: Clinic, date: string, now = Date.now()): Slot[] {
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

function reportLossRatio(): LossRatioRow[] {
  return db()
    .clients.filter((c) => c.lossRatio !== null && c.status !== 'expired')
    .map((c) => ({ clientId: c.id, clientName: c.name, clientLegalForm: c.legalForm, lossRatio: c.lossRatio ?? 0 }))
    .sort((a, b) => b.lossRatio - a.lossRatio);
}

function reportClaimsByCategory(from?: string | null, to?: string | null): ClaimsByCategoryRow[] {
  const f = from ? parseIso(from) : 0;
  const t = to ? parseIso(to) + DAY : Number.MAX_SAFE_INTEGER;
  const map = new Map<ClaimsByCategoryRow['category'], ClaimsByCategoryRow>();
  for (const c of db().claims) {
    const ts = parseIso(c.createdAt);
    if (ts < f || ts >= t) continue;
    const row = map.get(c.category) ?? { category: c.category, count: 0, amount: 0 };
    row.count += 1;
    row.amount += c.amountApproved ?? c.amountClaimed;
    map.set(c.category, row);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

function reportPremiumByMonth(): PremiumByMonthRow[] {
  const now = new Date();
  const rows: PremiumByMonthRow[] = [];
  const inv = db().invoices;
  for (let k = 11; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    rows.push({ month: key, premium: inv.filter((i) => i.issuedAt.startsWith(key)).reduce((s, i) => s + i.amount, 0) });
  }
  return rows;
}

function csvResponse(csv: string, kind: string): Response {
  return new HttpResponse(`\ufeff${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exportFileName(kind)}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export const staffMiscHandlers = [
  // ---- clinics ----
  http.get(
    `${API}/clinics`,
    route(({ request, url }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'clinics.read');
      let list = db().clinics;
      const term = q(url);
      if (term) list = list.filter((c) => c.name.toLowerCase().includes(term) || c.district.toLowerCase().includes(term));
      const spec = url.searchParams.get('specialty') as Specialty | null;
      if (spec && SPECIALTIES.has(spec)) list = list.filter((c) => c.specialties.includes(spec));
      list = filterLegalForm(list, url, (c) => c.legalForm);
      return sortBy(
        list,
        url,
        {
          name: byLegalName((c) => c.name),
          legalForm: byLegalForm((c) => c.legalForm),
          district: (c) => c.district,
          contractUntil: (c) => c.contractUntil,
        },
        'name:asc',
      );
    }),
  ),
  http.get(
    `${API}/clinics/nearby`,
    route(({ request, url }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'clinics.read');
      const spec = url.searchParams.get('specialty') as Specialty | null;
      let list = db().clinics;
      if (spec && SPECIALTIES.has(spec)) list = list.filter((c) => c.specialties.includes(spec));
      return list
        .map((c) => {
          const rng = mulberry32(hashString(`${user.id}:${c.id}`));
          return { ...c, distanceKm: Math.round((0.4 + rng() * 11) * 10) / 10 };
        })
        .sort((a, b) => a.distanceKm - b.distanceKm);
    }),
  ),
  http.get(
    `${API}/clinics/:id/slots`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'clinics.read');
      const clinic = db().clinics.find((c) => c.id === param(ctx, 'id'));
      if (!clinic) throw notFound();
      const date = ctx.url.searchParams.get('date') ?? isoDay(Date.now());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
      const d = db();
      const taken = new Set(d.appointments.filter((a) => a.clinicId === clinic.id && a.status !== 'cancelled' && a.status !== 'declined').map((a) => a.startsAt));
      // Slots passed by the clinic MIS (PUT /slots) win; API-mode clinics always count as «from the clinic system».
      const fromMis = d.misSlots.filter((s) => s.clinicId === clinic.id && isoDay(parseIso(s.startsAt)) === date);
      const list: Slot[] = fromMis.length ? fromMis.map((s) => ({ clinicId: clinic.id, startsAt: s.startsAt, fromClinicSystem: true })) : clinicSlots(clinic, date);
      return list
        .filter((s) => !taken.has(s.startsAt))
        .map((s) => (clinic.integrationMode === 'api' ? { ...s, fromClinicSystem: true } : s));
    }),
  ),
  // ---- limit change requests ----
  http.get(
    `${API}/limit-requests`,
    route(({ request, url }) => {
      const { user } = requireSession(request);
      if (!can(user, 'limits.request_change') && !can(user, 'limits.approve_change')) throw forbidden();
      let list = db().limitRequests;
      if (user.role === 'operator') list = list.filter((r) => r.requestedById === user.id);
      const status = url.searchParams.get('status');
      if (status) list = list.filter((r) => status.split(',').includes(r.status));
      return [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    }),
  ),
  http.post(
    `${API}/limit-requests`,
    route(async ({ request }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'limits.request_change');
      const input = await body(request, limitRequestSchema);
      const d = db();
      const policy = d.policies.find((p) => p.id === input.policyId);
      if (!policy) throw notFound();
      if (input.insuredId && !d.insured.some((i) => i.id === input.insuredId && i.policyId === policy.id)) throw notFound();
      const from = PROGRAMS[policy.program].limits[input.category];
      if (input.to === from) throw conflict('srv.limits.sameValue');
      const req: LimitChangeRequest = {
        id: randomId(),
        policyId: policy.id,
        policyNumber: policy.number,
        insuredId: input.insuredId,
        category: input.category,
        from,
        to: input.to,
        justification: input.justification,
        requestedById: user.id,
        requestedByName: user.displayName,
        status: 'pending',
        createdAt: tzIso(Date.now()),
      };
      d.limitRequests.unshift(req);
      audit(user, 'limit_change_request', { targetType: 'policy', targetId: policy.id, targetLabel: policy.number });
      return req;
    }),
  ),
  ...(['approve', 'reject'] as const).map((kind) =>
    http.post(
      `${API}/limit-requests/:id/${kind}`,
      route(async (ctx) => {
        const { user } = requireSession(ctx.request);
        requirePermission(user, 'limits.approve_change');
        const req = db().limitRequests.find((r) => r.id === param(ctx, 'id'));
        if (!req) throw notFound();
        let comment: string | undefined;
        if (kind === 'reject') comment = (await body(ctx.request, rejectLimitSchema)).comment;
        if (req.requestedById === user.id) throw httpErrorOf(409, 'conflict', FOUR_EYES_LIMIT_HINT);
        if (req.status !== 'pending') throw conflict('srv.limits.alreadyReviewed');
        req.status = kind === 'approve' ? 'approved' : 'rejected';
        req.decidedById = user.id;
        req.decidedByName = user.displayName;
        audit(user, kind === 'approve' ? 'limit_change_approve' : 'limit_change_reject', {
          targetType: 'policy',
          targetId: req.policyId,
          targetLabel: req.policyNumber,
          reason: comment,
        });
        return req;
      }),
    ),
  ),
  // ---- reports ----
  http.get(
    `${API}/reports/loss-ratio-by-client`,
    route(({ request }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'reports.read');
      if (!isStaffRole(user.role)) throw notFound();
      return reportLossRatio();
    }),
  ),
  http.get(
    `${API}/reports/claims-by-category`,
    route(({ request, url }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'reports.read');
      if (!isStaffRole(user.role)) throw notFound();
      return reportClaimsByCategory(url.searchParams.get('from'), url.searchParams.get('to'));
    }),
  ),
  http.get(
    `${API}/reports/premium-by-month`,
    route(({ request }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'reports.read');
      if (!isStaffRole(user.role)) throw notFound();
      return reportPremiumByMonth();
    }),
  ),
  // ---- exports ----
  http.post(
    `${API}/exports`,
    route(async ({ request }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'exports.create');
      const { type } = await body(request, exportSchema);
      const d = db();
      let csv: string;
      if (user.role === 'hr') {
        if (type !== 'hr_employees') throw forbidden();
        // No PINFL, birth dates, phones or medical data in exports.
        const rows = d.insured.filter((i) => i.clientId === user.companyId).map((i) => toHrEmployee(d, i));
        csv = toCsv(
          ['ФИО', 'Должность', 'Программа', 'Застрахован с', 'Членов семьи', 'Приложение', 'Статус'],
          rows.map((r) => [r.fullName, r.position, PROGRAM_LABEL[r.program], r.insuredFrom, r.familyMembersCount, r.appStatus, r.status]),
        );
      } else if (type === 'clients') {
        requirePermission(user, 'clients.read');
        csv = toCsv(
          ['Клиент', 'Форма', 'ИНН', 'Статус', 'Программа', 'Застрахованных', 'Премия, UZS', 'Убыточность', 'Продление', 'Менеджер'],
          d.clients.map((c) => {
            const x = toClient(d, c);
            return [x.name, legalFormShort(x.legalForm, 'ru'), x.inn, x.status, x.program ? PROGRAM_LABEL[x.program] : '', x.insuredCount, x.premium, x.lossRatio ?? '', x.renewalDate ?? '', x.managerName];
          }),
        );
      } else if (type === 'claims_financial') {
        requirePermission(user, 'claims.read');
        csv = toCsv(
          ['Номер', 'Клиент', 'Категория', 'Заявлено, UZS', 'Одобрено, UZS', 'Статус', 'Дата услуги'],
          d.claims.map((c) => [c.number, c.clientName, CLAIM_CATEGORY_LABEL[c.category], c.amountClaimed, c.amountApproved ?? '', CLAIM_STATUS_LABEL[c.status], c.serviceDate]),
        );
      } else if (type === 'policies') {
        requirePermission(user, 'policies.read');
        csv = toCsv(
          ['Номер', 'Клиент', 'Программа', 'Начало', 'Окончание', 'Статус', 'Премия, UZS', 'Застрахованных'],
          d.policies.map((p) => [p.number, p.clientName, PROGRAM_LABEL[p.program], p.startDate, p.endDate, p.status, p.premium, p.insuredCount]),
        );
      } else if (type === 'loss_ratio') {
        requirePermission(user, 'reports.read');
        csv = toCsv(['Клиент', 'Убыточность, %'], reportLossRatio().map((r) => [r.clientName, Math.round(r.lossRatio * 100)]));
      } else if (type === 'claims_by_category') {
        requirePermission(user, 'reports.read');
        csv = toCsv(['Категория', 'Количество', 'Сумма, UZS'], reportClaimsByCategory().map((r) => [CLAIM_CATEGORY_LABEL[r.category], r.count, r.amount]));
      } else if (type === 'premium_by_month') {
        requirePermission(user, 'reports.read');
        csv = toCsv(['Месяц', 'Премия, UZS'], reportPremiumByMonth().map((r) => [r.month, r.premium]));
      } else {
        throw forbidden();
      }
      audit(user, 'export', { targetType: 'export', targetLabel: type });
      return csvResponse(csv, type);
    }),
  ),
  // ---- audit ----
  http.get(
    `${API}/audit`,
    route(({ request, url }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'audit.read');
      let list: AuditEntry[] = db().audit;
      const action = url.searchParams.get('action');
      if (action) list = list.filter((e) => action.split(',').includes(e.action));
      const actorId = url.searchParams.get('actorId');
      if (actorId) list = list.filter((e) => e.actorId === actorId);
      // Actions of assistance users, by company (ASSISTANCE_SPEC §3).
      const assistanceId = url.searchParams.get('assistanceId');
      if (assistanceId) list = list.filter((e) => e.assistanceId === assistanceId);
      const from = url.searchParams.get('from');
      if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) list = list.filter((e) => parseIso(e.at) >= parseIso(from));
      const to = url.searchParams.get('to');
      if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) list = list.filter((e) => parseIso(e.at) < parseIso(to) + DAY);
      return paginate(list, url);
    }),
  ),
  // ---- admin ----
  http.get(
    `${API}/admin/users`,
    route(({ request }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'users.manage');
      return db().staff.map(({ password: _p, ...s }) => s);
    }),
  ),
  http.patch(
    `${API}/admin/users/:id`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'users.manage');
      const d = db();
      const target = d.staff.find((s) => s.id === param(ctx, 'id'));
      if (!target) throw notFound();
      const patch = await body(ctx.request, adminUserPatchSchema);
      if (target.id === user.id && patch.role && patch.role !== 'admin') throw conflict('srv.staffUsers.selfRole');
      if (target.id === user.id && patch.active === false) throw conflict('srv.staffUsers.selfDeactivate');
      if (patch.role && patch.role !== target.role) {
        audit(user, 'role_change', { targetType: 'user', targetId: target.id, targetLabel: `${target.fullName}: ${target.role} → ${patch.role}` });
        target.role = patch.role;
        d.sessions = d.sessions.filter((s) => s.userId !== target.id);
      }
      if (patch.active !== undefined && patch.active !== target.active) {
        target.active = patch.active;
        if (!patch.active) {
          audit(user, 'user_deactivate', { targetType: 'user', targetId: target.id, targetLabel: target.fullName });
          d.sessions = d.sessions.filter((s) => s.userId !== target.id);
        }
      }
      const { password: _p, ...out } = target;
      return out;
    }),
  ),
];
