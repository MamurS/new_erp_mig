/*
 * MIG staff side of clinics (CLINIC_SPEC §5): clinic card, clinic management by the admin,
 * guarantee-letter queue for doctor experts, registry review (operator) and payment (accountant).
 */
import { msg, t } from '@/i18n/core';
import { http } from 'msw';
import type { Clinic, Registry, SessionUser } from '@/shared/types';
import type { ClinicCard, ClinicUserView } from '@/shared/types/dto';
import { can } from '@/shared/auth/permissions';
import { isStaffRole } from '@/shared/domain/labels';
import { approvalOutcome, registryStatusAfterReview } from '@/shared/domain/clinics';
import { dmsParam, nextDocNumber } from '../params';
import { clinicAdminInviteSchema, clinicCreateSchema, clinicModeSchema, guaranteeDecisionSchema, registryLineDecisionSchema } from '@/shared/schemas/forms';
import { db, type ClinicUserRow, type Db } from '../db';
import { API, audit, body, conflict, forbidden, HttpError, notFound, param, requirePermission, requireSession, route } from '../http';
import { randomId } from '../rng';
import { DAY, isoDay, parseIso, tzIso } from '../time';
import { DEMO_PASSWORD } from '../credentials';
import { claimFromLine, clinicOf, emitWebhook, pushEvent, recomputeRegistry, refreshGuarantee, toGuaranteeView, toRegistrySummary, toRegistryView } from '../clinic-core';
import { revokeKey } from './clinic';
import { linesOf, settleRegistry, subStatus, subTotals } from '../assistance-core';

/** The MIG part of a clinic registry: only lines paid by MIG, with their own status and totals. */
function migSubRegistry(_d: Db, r: Registry): Registry {
  const lines = linesOf(r, 'mig');
  return { ...r, lines, status: subStatus(r, lines), totals: subTotals(lines) };
}

function requireStaff(request: Request): SessionUser {
  const { user } = requireSession(request);
  if (!isStaffRole(user.role)) throw forbidden();
  return user;
}

const userView = (u: ClinicUserRow): ClinicUserView => ({ id: u.id, email: u.email, fullName: u.fullName, role: u.role, active: u.active, lastLoginAt: u.lastLoginAt });

function clinicCard(d: Db, clinic: Clinic): ClinicCard {
  const since = Date.now() - DAY;
  const answered = d.appointments.filter((a) => a.clinicId === clinic.id && a.respondedAt && a.respondedBy === 'clinic');
  const avg = answered.length ? Math.round(answered.reduce((s, a) => s + (parseIso(a.respondedAt!) - parseIso(a.createdAt)), 0) / answered.length / 60_000) : null;
  const reviewed = d.registries.filter((r) => r.clinicId === clinic.id).flatMap((r) => r.lines.filter((l) => l.status !== 'pending'));
  const rejected = reviewed.filter((l) => l.status === 'rejected' || l.status === 'disputed').length;
  const hooks = d.webhookDeliveries.filter((w) => w.clinicId === clinic.id);
  return {
    clinic,
    contractNumber: nextDocNumber('clinicContract', { code: clinic.id.slice(0, 4) }),
    metrics: {
      avgResponseMinutes: avg,
      rejectedLineShare: reviewed.length ? rejected / reviewed.length : null,
      amountToPay: d.registries.filter((r) => r.clinicId === clinic.id && (r.status === 'accepted' || r.status === 'partially_accepted')).reduce((s, r) => s + r.totals.accepted, 0),
    },
    users: d.clinicUsers.filter((u) => u.clinicId === clinic.id).map(userView),
    keys: d.integrationClients.filter((k) => k.clinicId === clinic.id).map(({ secretHash: _h, ...k }) => k),
    webhooks: {
      endpoints: d.webhooks.filter((w) => w.clinicId === clinic.id).length,
      retrying: hooks.filter((w) => w.status === 'retrying').length,
      failed24h: hooks.filter((w) => w.status === 'failed' && parseIso(w.lastAttemptAt) >= since).length,
    },
    apiErrors24h: d.apiLogs.filter((l) => l.clinicId === clinic.id && l.status >= 400 && parseIso(l.at) >= since).length,
  };
}

function canReadRegistries(user: SessionUser): boolean {
  return can(user, 'registries.review') || can(user, 'registries.pay');
}

export const staffClinicHandlers = [
  // ---- clinics ----
  http.get(
    `${API}/clinics/:id/card`,
    route((ctx) => {
      const user = requireStaff(ctx.request);
      requirePermission(user, 'clinics.read');
      const d = db();
      return clinicCard(d, clinicOf(d, param(ctx, 'id')));
    }),
  ),
  http.post(
    `${API}/clinics`,
    route(async ({ request }) => {
      const user = requireStaff(request);
      requirePermission(user, 'clinics.manage');
      const input = await body(request, clinicCreateSchema);
      const d = db();
      const clinic: Clinic = {
        id: randomId(),
        ...input,
        onlineBooking: true,
        apiStatus: input.integrationMode === 'portal' ? 'manual' : 'online',
        contractUntil: isoDay(Date.now() + 365 * DAY),
      };
      d.clinics.push(clinic);
      d.priceLists.push({ clinicId: clinic.id, items: (d.priceLists[0]?.items ?? []).map((i) => ({ ...i })) });
      audit(user, 'role_change', { targetType: 'clinic', targetId: clinic.id, targetLabel: clinic.name });
      return clinic;
    }),
  ),
  http.patch(
    `${API}/clinics/:id`,
    route(async (ctx) => {
      const user = requireStaff(ctx.request);
      requirePermission(user, 'clinics.manage');
      const d = db();
      const clinic = clinicOf(d, param(ctx, 'id'));
      clinic.integrationMode = (await body(ctx.request, clinicModeSchema)).integrationMode;
      clinic.apiStatus = clinic.integrationMode === 'portal' ? 'manual' : 'online';
      pushEvent(d, clinic.id, 'МИГ изменил режим интеграции клиники');
      return clinic;
    }),
  ),
  http.post(
    `${API}/clinics/:id/admins`,
    route(async (ctx) => {
      const user = requireStaff(ctx.request);
      requirePermission(user, 'clinic.users.manage', { sub: 'first_admin' });
      const d = db();
      const clinic = clinicOf(d, param(ctx, 'id'));
      if (d.clinicUsers.some((u) => u.clinicId === clinic.id && u.role === 'clinic_admin' && u.active)) {
        throw conflict('srv.clinics.hasAdmin');
      }
      const input = await body(ctx.request, clinicAdminInviteSchema);
      if (d.clinicUsers.some((u) => u.email === input.email)) throw new HttpError(409, 'conflict', 'srv.users.emailTaken', { fields: { email: msg('srv.users.emailInUse') } });
      const row: ClinicUserRow = { id: randomId(), ...input, role: 'clinic_admin', password: DEMO_PASSWORD, clinicId: clinic.id, active: true, createdAt: tzIso(Date.now()) };
      d.clinicUsers.push(row);
      audit(user, 'role_change', { targetType: 'user', targetId: row.id, targetLabel: row.fullName });
      return userView(row);
    }),
  ),
  http.post(
    `${API}/clinics/:id/keys/:keyId/revoke`,
    route((ctx) => {
      const user = requireStaff(ctx.request);
      requirePermission(user, 'clinic.integration.manage', { sub: 'revoke_keys' });
      const d = db();
      const clinic = clinicOf(d, param(ctx, 'id'));
      const k = d.integrationClients.find((x) => x.id === param(ctx, 'keyId') && x.clinicId === clinic.id);
      if (!k) throw notFound();
      revokeKey(d, k, user);
      const { secretHash: _h, ...view } = k;
      return view;
    }),
  ),
  // ---- guarantee letters ----
  http.get(
    `${API}/guarantees`,
    route(({ request, url }) => {
      const user = requireStaff(request);
      requirePermission(user, 'guarantees.read');
      const d = db();
      const status = url.searchParams.get('status');
      const clinicId = url.searchParams.get('clinicId');
      // By default MIG sees what it decides: escalations and clients without an assistance (§7, §9.1).
      const all = url.searchParams.get('scope') === 'all';
      return d.guarantees
        .map((g) => refreshGuarantee(g))
        .filter((g) => all || !g.assistanceId || g.escalated)
        .filter((g) => (!status || status.split(',').includes(g.status)) && (!clinicId || g.clinicId === clinicId))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((g) => toGuaranteeView(d, g));
    }),
  ),
  http.get(
    `${API}/guarantees/:id`,
    route((ctx) => {
      const user = requireStaff(ctx.request);
      requirePermission(user, 'guarantees.read');
      const d = db();
      const g = d.guarantees.find((x) => x.id === param(ctx, 'id'));
      if (!g) throw notFound();
      return toGuaranteeView(d, g);
    }),
  ),
  http.post(
    `${API}/guarantees/:id/decision`,
    route(async (ctx) => {
      const user = requireStaff(ctx.request);
      requirePermission(user, 'guarantees.decide');
      const d = db();
      const g = d.guarantees.find((x) => x.id === param(ctx, 'id'));
      if (!g) throw notFound();
      if (!can(user, 'assist.guarantees.decide', { assistanceId: g.assistanceId ?? null, escalated: g.escalated === true })) {
        throw new HttpError(403, 'forbidden', 'srv.guarantee.assistanceDecides', { params: { name: g.assistanceName ?? t('srv.guarantee.assistanceDefault') } });
      }
      if (g.status !== 'requested') throw conflict(g.status === 'info_requested' ? 'srv.guarantee.awaitingDocs' : 'srv.decision.alreadyMade');
      const input = await body(ctx.request, guaranteeDecisionSchema);
      const at = tzIso(Date.now());
      g.decidedBy = 'mig';
      if (input.action === 'approve') {
        const outcome = approvalOutcome(g, input.amount, user.id, dmsParam('guaranteeDualApprovalThreshold'));
        if (outcome === 'same_doctor') throw new HttpError(409, 'conflict', 'srv.guarantee.fourEyes');
        g.approvals.push({ byId: user.id, byName: user.displayName, at });
        g.approvedAmount = input.amount;
        g.validUntil = input.validUntil;
        if (outcome === 'approved') {
          g.status = 'approved';
          g.reason = undefined;
          g.decidedAt = at;
          await emitWebhook(d, g.clinicId, 'guarantee.decided', g.id);
          pushEvent(d, g.clinicId, `Гарантийное письмо ${g.number} одобрено`);
        }
        audit(user, 'guarantee_decided', { targetType: 'guarantee', targetId: g.id, targetLabel: g.number, reason: outcome === 'approved' ? 'Одобрено' : 'Первое одобрение из двух' });
      } else if (input.action === 'reject') {
        g.status = 'rejected';
        g.reason = input.reason;
        g.decidedAt = at;
        await emitWebhook(d, g.clinicId, 'guarantee.decided', g.id);
        pushEvent(d, g.clinicId, `Гарантийное письмо ${g.number} отклонено`);
        audit(user, 'guarantee_decided', { targetType: 'guarantee', targetId: g.id, targetLabel: g.number, reason: 'Отклонено' });
      } else {
        g.status = 'info_requested';
        g.reason = input.reason;
        await emitWebhook(d, g.clinicId, 'guarantee.documents_requested', g.id);
        pushEvent(d, g.clinicId, `По ${g.number} нужны документы`);
        audit(user, 'guarantee_decided', { targetType: 'guarantee', targetId: g.id, targetLabel: g.number, reason: 'Запрошены документы' });
      }
      return toGuaranteeView(d, g);
    }),
  ),
  // ---- registries ----
  http.get(
    `${API}/registries`,
    route(({ request, url }) => {
      const user = requireStaff(request);
      if (!canReadRegistries(user)) throw forbidden();
      const d = db();
      const status = url.searchParams.get('status');
      const clinicId = url.searchParams.get('clinicId');
      // MIG works only with its sub-registry: lines of clients without an assistance (§9.2).
      return d.registries
        .filter((r) => r.status !== 'draft' && linesOf(r, 'mig').length > 0)
        .map((r) => migSubRegistry(d, r))
        .filter((r) => (!status || status.split(',').includes(r.status)) && (!clinicId || r.clinicId === clinicId))
        .sort((a, b) => ((a.submittedAt ?? '') < (b.submittedAt ?? '') ? 1 : -1))
        .map((r) => toRegistrySummary(d, r));
    }),
  ),
  http.get(
    `${API}/registries/:id`,
    route((ctx) => {
      const user = requireStaff(ctx.request);
      if (!canReadRegistries(user)) throw forbidden();
      const d = db();
      const r = d.registries.find((x) => x.id === param(ctx, 'id') && x.status !== 'draft');
      if (!r || !linesOf(r, 'mig').length) throw notFound();
      return toRegistryView(d, migSubRegistry(d, r));
    }),
  ),
  http.post(
    `${API}/registries/:id/lines/:lineId/decision`,
    route(async (ctx) => {
      const user = requireStaff(ctx.request);
      requirePermission(user, 'registries.review');
      const d = db();
      const r = d.registries.find((x) => x.id === param(ctx, 'id'));
      if (!r || r.status === 'draft') throw notFound();
      if (r.status === 'paid') throw conflict('srv.registry.alreadyPaid');
      const line = r.lines.find((l) => l.id === param(ctx, 'lineId'));
      // Lines of an assistance's sub-registry are reviewed by that assistance.
      if (!line || (line.payer ?? 'mig') !== 'mig') throw notFound();
      if (line.status !== 'pending' && line.status !== 'disputed') throw conflict('srv.lines.alreadyDecided');
      const input = await body(ctx.request, registryLineDecisionSchema);
      const wasPending = r.lines.some((l) => l.status === 'pending');
      if (input.decision === 'accept') {
        line.status = 'accepted';
        line.rejectionReason = undefined;
        claimFromLine(d, r, line, user.displayName);
        const g = line.guaranteeNumber ? d.guarantees.find((x) => x.number === line.guaranteeNumber && x.clinicId === r.clinicId) : undefined;
        if (g && g.status === 'approved') g.status = 'used';
      } else {
        line.status = 'rejected';
        line.rejectionReason = input.reason;
      }
      r.status = registryStatusAfterReview(r.lines);
      recomputeRegistry(r);
      audit(user, 'registry_line_decided', { targetType: 'registry', targetId: r.id, targetLabel: `Реестр ${r.period}`, reason: input.decision === 'accept' ? 'Строка принята' : 'Строка отклонена' });
      if (wasPending && r.status !== 'in_review') {
        await emitWebhook(d, r.clinicId, 'registry.reviewed', r.id);
        pushEvent(d, r.clinicId, `Реестр за ${r.period} проверен: ${r.status === 'accepted' ? 'принят' : 'принят частично'}`);
      }
      return toRegistryView(d, migSubRegistry(d, r));
    }),
  ),
  http.post(
    `${API}/registries/:id/pay`,
    route(async (ctx) => {
      const user = requireStaff(ctx.request);
      requirePermission(user, 'registries.pay');
      const d = db();
      const r = d.registries.find((x) => x.id === param(ctx, 'id'));
      if (!r || r.status === 'draft') throw notFound();
      const mine = linesOf(r, 'mig');
      if (!mine.length) throw notFound();
      if (mine.some((l) => l.status === 'pending')) throw conflict('srv.registry.payReviewedOnly');
      if (mine.some((l) => l.status === 'disputed')) throw conflict('srv.registry.answerDisputes');
      const toPay = mine.filter((l) => l.status === 'accepted' && !l.payment);
      if (!toPay.length) throw conflict('srv.registry.migLinesPaid');
      const paidAt = tzIso(Date.now());
      const orderNumber = nextDocNumber('paymentOrder', { n: Number(String(Date.now()).slice(-6)) });
      for (const l of toPay) l.payment = { paidAt: paidAt.slice(0, 10), amount: l.amount, orderNumber };
      settleRegistry(r);
      recomputeRegistry(r);
      const lineIds = new Set(toPay.map((l) => l.id));
      for (const c of d.claims) {
        if (c.registryLineId && lineIds.has(c.registryLineId)) {
          c.history.push({ at: paidAt, actorName: user.displayName, from: c.status, to: 'paid' });
          c.status = 'paid';
          c.updatedAt = paidAt;
        }
      }
      audit(user, 'registry_paid', { targetType: 'registry', targetId: r.id, targetLabel: `Реестр ${r.period}` });
      await emitWebhook(d, r.clinicId, 'registry.paid', r.id);
      pushEvent(d, r.clinicId, `МИГ оплатил свои строки реестра за ${r.period}`);
      return toRegistryView(d, migSubRegistry(d, r));
    }),
  ),
];
