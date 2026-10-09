/*
 * The staff portal's smaller screens: clinics and their free slots, limit change requests (four-eyes),
 * reports, CSV exports, the audit log and staff users.
 */
import { issueInvitation, withInvitations } from './invitations';
import { msg, translate } from '@mig/i18n';
import type { AuditEntry, Clinic, LimitChangeRequest, Page, Slot, Specialty, StaffUser } from '@mig/contracts';
import type { ClaimsByCategoryRow, LossRatioRow, PremiumByMonthRow } from '@mig/contracts/dto';
import { adminUserPatchSchema, exportSchema, limitRequestSchema, rejectLimitSchema, staffUserInviteSchema } from '@mig/contracts/forms';
import { can } from '../auth/permissions';
import { DEMO_PASSWORD } from '../auth/demo';
import { CLAIM_CATEGORY_LABEL, CLAIM_STATUS_LABEL } from '../claims';
import { legalFormShort } from '../config/legalForms';
import { isStaffRole, PROGRAM_LABEL } from '../labels';
import { FOUR_EYES_LIMIT_HINT } from '../limits';
import { toCsv } from '../lib/csv';
import { randomId } from '../lib/random';
import { hashString, mulberry32 } from '../lib/rng';
import { DAY, isoDay, parseIso, tzIso } from '../lib/time';
import { PROGRAMS } from '../programs';
import type { StaffRow } from '../store/db';
import type { ComputedFields } from '../store/computed';
import type { Where } from '../store/query';
import { audit, conflict, DomainError, errorOf, forbidden, notFound, requirePermission, validate, type AuthCtx, type BaseCtx } from './kernel';
import { allOf, legalFormWhere, NOTHING, pageOf, q, searchWhere, sortParam, sp, tsBound, type Qs } from './list';
import { clinicSlots } from './clinic';
import { toClient, toHrEmployee } from './views';

type ClinicQ = Clinic & ComputedFields['clinics'];

const SPECIALTIES = new Set<Specialty>(['therapist', 'pediatrician', 'dentist', 'cardiologist', 'gynecologist', 'ent', 'neurologist', 'ophthalmologist']);


async function reportLossRatio(ctx: BaseCtx): Promise<LossRatioRow[]> {
  return (await ctx.repos.clients.list({ where: { lossRatio: { isNull: false }, status: { ne: 'expired' } } }))
    .map((c) => ({ clientId: c.id, clientName: c.name, clientLegalForm: c.legalForm, lossRatio: c.lossRatio ?? 0 }))
    .sort((a, b) => b.lossRatio - a.lossRatio);
}

async function reportClaimsByCategory(ctx: BaseCtx, from?: string | null, to?: string | null): Promise<ClaimsByCategoryRow[]> {
  const f = from ? parseIso(from) : 0;
  const t = to ? parseIso(to) + DAY : Number.MAX_SAFE_INTEGER;
  const map = new Map<ClaimsByCategoryRow['category'], ClaimsByCategoryRow>();
  for (const c of await ctx.repos.claims.list()) {
    const ts = parseIso(c.createdAt);
    if (ts < f || ts >= t) continue;
    const row = map.get(c.category) ?? { category: c.category, count: 0, amount: 0 };
    row.count += 1;
    row.amount += c.amountApproved ?? c.amountClaimed;
    map.set(c.category, row);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

async function reportPremiumByMonth(ctx: BaseCtx): Promise<PremiumByMonthRow[]> {
  const now = new Date(ctx.now());
  const rows: PremiumByMonthRow[] = [];
  const inv = await ctx.repos.invoices.list();
  for (let k = 11; k >= 0; k--) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    rows.push({ month: key, premium: inv.filter((i) => i.issuedAt.startsWith(key)).reduce((s, i) => s + i.amount, 0) });
  }
  return rows;
}

function requireStaffReports(ctx: AuthCtx): void {
  requirePermission(ctx.user, 'reports.read');
  if (!isStaffRole(ctx.user.role)) throw notFound();
}

const withoutPassword = ({ password: _p, ...s }: StaffRow): StaffUser => s;

// ---------------------------------------------------------------- endpoints: clinics

/** GET /clinics: search, specialty and legal form filters, sort (in SQL; the list is not paged). */
export async function clinics(ctx: AuthCtx, qs: Qs): Promise<Clinic[]> {
  requirePermission(ctx.user, 'clinics.read');
  const term = q(qs);
  const spec = sp(qs).get('specialty') as Specialty | null;
  return ctx.repos.clinics.list({
    where: allOf<ClinicQ>(term && searchWhere<ClinicQ>(term, ['name', 'district']), spec && SPECIALTIES.has(spec) && { specialties: { includes: spec } }, legalFormWhere<ClinicQ>(qs, 'legalForm')),
    orderBy: sortParam<ClinicQ>(
      qs,
      {
        name: { field: 'name', collate: 'legal' },
        legalForm: { field: 'legalFormOrd' },
        district: { field: 'district', collate: 'ru' },
        contractUntil: { field: 'contractUntil' },
      },
      'name:asc',
    ),
  });
}

/** GET /clinics/nearby: a stable fictional distance per person and clinic. */
export async function nearby(ctx: AuthCtx, qs: Qs): Promise<(Clinic & { distanceKm: number })[]> {
  const { user } = ctx;
  requirePermission(user, 'clinics.read');
  const spec = sp(qs).get('specialty') as Specialty | null;
  let list = await ctx.repos.clinics.list();
  if (spec && SPECIALTIES.has(spec)) list = list.filter((c) => c.specialties.includes(spec));
  return list
    .map((c) => {
      const rng = mulberry32(hashString(`${user.id}:${c.id}`));
      return { ...c, distanceKm: Math.round((0.4 + rng() * 11) * 10) / 10 };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/** GET /clinics/:id/slots?date=: free slots (the clinic MIS's own, when it passed them). */
export async function slots(ctx: AuthCtx, id: string, dateParam: string | null): Promise<Slot[]> {
  requirePermission(ctx.user, 'clinics.read');
  const clinic = await ctx.repos.clinics.get(id);
  if (!clinic) throw notFound();
  const date = dateParam ?? isoDay(ctx.now());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  // Taken by anyone — appointments of other people are hidden from the reader: only their times (app.fact_taken_slots).
  const taken = new Set(await ctx.repos.facts.takenSlots(clinic.id));
  // Slots passed by the clinic MIS (PUT /slots) win; API-mode clinics always count as «from the clinic system».
  const fromMis = (await ctx.repos.misSlots.list({ where: { clinicId: clinic.id } })).filter((s) => isoDay(parseIso(s.startsAt)) === date);
  const list: Slot[] = fromMis.length ? fromMis.map((s) => ({ clinicId: clinic.id, startsAt: s.startsAt, fromClinicSystem: true })) : clinicSlots(clinic, date, ctx.now());
  return list.filter((s) => !taken.has(s.startsAt)).map((s) => (clinic.integrationMode === 'api' ? { ...s, fromClinicSystem: true } : s));
}

// ---------------------------------------------------------------- endpoints: limit change requests

/** GET /limit-requests[?status=a,b]: an operator sees own requests, the newest first. */
export async function limitRequests(ctx: AuthCtx, status: string | null): Promise<LimitChangeRequest[]> {
  const { user } = ctx;
  if (!can(user, 'limits.request_change') && !can(user, 'limits.approve_change')) throw forbidden();
  let list = await ctx.repos.limitRequests.list(user.role === 'operator' ? { where: { requestedById: user.id } } : {});
  if (status) list = list.filter((r) => status.split(',').includes(r.status));
  return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** POST /limit-requests. */
export async function requestLimitChange(ctx: AuthCtx, body: unknown): Promise<LimitChangeRequest> {
  const { user } = ctx;
  requirePermission(user, 'limits.request_change');
  const input = validate(limitRequestSchema, body);
  const policy = await ctx.repos.policies.get(input.policyId);
  if (!policy) throw notFound();
  if (input.insuredId && !(await ctx.repos.insured.exists({ id: input.insuredId, policyId: policy.id }))) throw notFound();
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
    createdAt: tzIso(ctx.now()),
  };
  await ctx.repos.limitRequests.insert(req, { at: 'start' });
  await audit(ctx, user, 'limit_change_request', { targetType: 'policy', targetId: policy.id, targetLabel: policy.number });
  return req;
}

/** POST /limit-requests/:id/approve|reject: by another person (four-eyes). */
export async function decideLimitChange(ctx: AuthCtx, id: string, kind: 'approve' | 'reject', body: unknown): Promise<LimitChangeRequest> {
  const { user } = ctx;
  requirePermission(user, 'limits.approve_change');
  const req = await ctx.repos.limitRequests.get(id);
  if (!req) throw notFound();
  let comment: string | undefined;
  if (kind === 'reject') comment = validate(rejectLimitSchema, body).comment;
  if (req.requestedById === user.id) throw errorOf(409, 'conflict', FOUR_EYES_LIMIT_HINT);
  if (req.status !== 'pending') throw conflict('srv.limits.alreadyReviewed');
  req.status = kind === 'approve' ? 'approved' : 'rejected';
  req.decidedById = user.id;
  req.decidedByName = user.displayName;
  await ctx.repos.limitRequests.put(req);
  await audit(ctx, user, kind === 'approve' ? 'limit_change_approve' : 'limit_change_reject', {
    targetType: 'policy',
    targetId: req.policyId,
    targetLabel: req.policyNumber,
    reason: comment,
  });
  return req;
}

// ---------------------------------------------------------------- endpoints: reports and exports

export async function lossRatio(ctx: AuthCtx): Promise<LossRatioRow[]> {
  requireStaffReports(ctx);
  return reportLossRatio(ctx);
}

export async function claimsByCategory(ctx: AuthCtx, from: string | null, to: string | null): Promise<ClaimsByCategoryRow[]> {
  requireStaffReports(ctx);
  return reportClaimsByCategory(ctx, from, to);
}

export async function premiumByMonth(ctx: AuthCtx): Promise<PremiumByMonthRow[]> {
  requireStaffReports(ctx);
  return reportPremiumByMonth(ctx);
}

/** POST /exports: the CSV text and its kind (the adapter sends it as a file named by the kind). */
export async function exportCsv(ctx: AuthCtx, body: unknown): Promise<{ csv: string; kind: string }> {
  const { user } = ctx;
  const r = ctx.repos;
  requirePermission(user, 'exports.create');
  const { type } = validate(exportSchema, body);
  let csv: string;
  if (user.role === 'hr') {
    if (type !== 'hr_employees') throw forbidden();
    // No PINFL, birth dates, phones or medical data in exports.
    // A row per person: family members with the relation and the employee (FAMILY_SPEC).
    const people = await r.insured.list({ where: { clientId: user.companyId } });
    const nameOf = async (id: string | undefined) => (id ? ((await r.insured.get(id))?.fullName ?? '') : '');
    const rows: unknown[][] = [];
    for (const i of people) {
      const e = await toHrEmployee(ctx, i);
      rows.push([e.fullName, translate('ru', `labels.censusRelation.${i.relation}`), await nameOf(i.principalId), e.position, PROGRAM_LABEL[e.program], e.insuredFrom, e.appStatus, e.status]);
    }
    csv = toCsv(['ФИО', 'Кем приходится', 'Сотрудник', 'Должность', 'Программа', 'Застрахован с', 'Приложение', 'Статус'], rows);
  } else if (type === 'clients') {
    requirePermission(user, 'clients.read');
    const rows: unknown[][] = [];
    for (const c of await r.clients.list()) {
      const x = await toClient(ctx, c);
      rows.push([x.name, legalFormShort(x.legalForm, 'ru'), x.inn, x.status, x.program ? PROGRAM_LABEL[x.program] : '', x.insuredCount, x.premium, x.lossRatio ?? '', x.renewalDate ?? '', x.managerName]);
    }
    csv = toCsv(['Клиент', 'Форма', 'ИНН', 'Статус', 'Программа', 'Застрахованных', 'Премия, UZS', 'Убыточность', 'Продление', 'Менеджер'], rows);
  } else if (type === 'claims_financial') {
    requirePermission(user, 'claims.read');
    csv = toCsv(
      ['Номер', 'Клиент', 'Категория', 'Заявлено, UZS', 'Одобрено, UZS', 'Статус', 'Дата услуги'],
      (await r.claims.list()).map((c) => [c.number, c.clientName, CLAIM_CATEGORY_LABEL[c.category], c.amountClaimed, c.amountApproved ?? '', CLAIM_STATUS_LABEL[c.status], c.serviceDate]),
    );
  } else if (type === 'policies') {
    requirePermission(user, 'policies.read');
    csv = toCsv(
      ['Номер', 'Клиент', 'Программа', 'Начало', 'Окончание', 'Статус', 'Премия, UZS', 'Застрахованных'],
      (await r.policies.list()).map((p) => [p.number, p.clientName, PROGRAM_LABEL[p.program], p.startDate, p.endDate, p.status, p.premium, p.insuredCount]),
    );
  } else if (type === 'loss_ratio') {
    requirePermission(user, 'reports.read');
    csv = toCsv(['Клиент', 'Убыточность, %'], (await reportLossRatio(ctx)).map((x) => [x.clientName, Math.round(x.lossRatio * 100)]));
  } else if (type === 'claims_by_category') {
    requirePermission(user, 'reports.read');
    csv = toCsv(['Категория', 'Количество', 'Сумма, UZS'], (await reportClaimsByCategory(ctx)).map((x) => [CLAIM_CATEGORY_LABEL[x.category], x.count, x.amount]));
  } else if (type === 'premium_by_month') {
    requirePermission(user, 'reports.read');
    csv = toCsv(['Месяц', 'Премия, UZS'], (await reportPremiumByMonth(ctx)).map((x) => [x.month, x.premium]));
  } else {
    throw forbidden();
  }
  await audit(ctx, user, 'export', { targetType: 'export', targetLabel: type });
  return { csv, kind: type };
}

// ---------------------------------------------------------------- endpoints: audit and users

/** GET /audit: filters by action, person, assistance company and dates; the newest first (storage order), paged in SQL. */
export async function auditLog(ctx: AuthCtx, qs: Qs): Promise<Page<AuditEntry>> {
  requirePermission(ctx.user, 'audit.read');
  const s = sp(qs);
  const action = s.get('action');
  const actorId = s.get('actorId');
  // Actions of assistance users, by company (ASSISTANCE_SPEC §3).
  const assistanceId = s.get('assistanceId');
  const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? parseIso(v) : null);
  const from = day(s.get('from'));
  const to = day(s.get('to'));
  // `parseIso(at) >= from` and `parseIso(at) < to + DAY`; an impossible date matches nothing.
  const range = (ms: number | null, op: 'gte' | 'lt'): Where<AuditEntry> | null => (ms === null ? null : Number.isNaN(ms) ? (NOTHING as Where<AuditEntry>) : { at: { [op]: tsBound(ms) } });
  return pageOf(ctx.repos.audit, qs, {
    where: allOf<AuditEntry>(
      action && { action: { in: action.split(',') as AuditEntry['action'][] } },
      actorId && { actorId },
      assistanceId && { assistanceId },
      range(from, 'gte'),
      range(to === null ? null : to + DAY, 'lt'),
    ),
  });
}

/** GET /admin/users. */
export async function staffUsers(ctx: AuthCtx): Promise<StaffUser[]> {
  requirePermission(ctx.user, 'users.manage');
  return withInvitations(ctx, (await ctx.repos.staff.list()).map(withoutPassword));
}

/** POST /admin/users: an invited staff user (the adapter answers 201). */
export async function inviteStaffUser(ctx: AuthCtx, body: unknown): Promise<StaffUser> {
  const { user } = ctx;
  const r = ctx.repos;
  requirePermission(user, 'users.manage');
  const input = validate(staffUserInviteSchema, body);
  if ((await r.staff.exists({ email: input.email })) || (await r.clinicUsers.exists({ email: input.email })) || (await r.hrUsers.exists({ email: input.email }))) {
    throw new DomainError(409, 'conflict', 'srv.users.emailTaken', { fields: { email: msg('srv.users.emailInUse') } });
  }
  const row: StaffRow = { id: randomId(), ...input, active: true, authority: {}, password: DEMO_PASSWORD };
  await r.staff.insert(row);
  await audit(ctx, user, 'role_change', { targetType: 'user', targetId: row.id, targetLabel: `${row.fullName}: ${row.role}` });
  await issueInvitation(ctx, row, user);
  return (await withInvitations(ctx, [withoutPassword(row)]))[0]!;
}

/** PATCH /admin/users/:id: role and activity; a change ends the person's sessions. */
export async function updateStaffUser(ctx: AuthCtx, id: string, body: unknown): Promise<StaffUser> {
  const { user } = ctx;
  const r = ctx.repos;
  requirePermission(user, 'users.manage');
  const target = await r.staff.get(id);
  if (!target) throw notFound();
  const patch = validate(adminUserPatchSchema, body);
  if (target.id === user.id && patch.role && patch.role !== 'admin') throw conflict('srv.staffUsers.selfRole');
  if (target.id === user.id && patch.active === false) throw conflict('srv.staffUsers.selfDeactivate');
  if (patch.role && patch.role !== target.role) {
    await audit(ctx, user, 'role_change', { targetType: 'user', targetId: target.id, targetLabel: `${target.fullName}: ${target.role} → ${patch.role}` });
    target.role = patch.role;
    await r.staff.update(target.id, { role: target.role });
    await r.sessions.removeWhere({ userId: target.id });
  }
  if (patch.active !== undefined && patch.active !== target.active) {
    target.active = patch.active;
    await r.staff.update(target.id, { active: target.active });
    if (!patch.active) {
      await audit(ctx, user, 'user_deactivate', { targetType: 'user', targetId: target.id, targetLabel: target.fullName });
      await r.sessions.removeWhere({ userId: target.id });
    }
  }
  return withoutPassword(target);
}
