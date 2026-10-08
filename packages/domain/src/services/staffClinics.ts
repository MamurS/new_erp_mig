/*
 * MIG staff side of clinics (CLINIC_SPEC §5): clinic card, clinic management by the admin,
 * guarantee-letter queue for doctor experts, registry review (operator) and payment (accountant).
 */
import { msg, t } from '@mig/i18n';
import type { Clinic, IntegrationClient, Registry, SessionUser, UUID } from '@mig/contracts';
import type { ClinicCard, ClinicUserView, GuaranteeView, RegistrySummary, RegistryView } from '@mig/contracts/dto';
import { clinicAdminInviteSchema, clinicCreateSchema, clinicModeSchema, guaranteeDecisionSchema, registryLineDecisionSchema } from '@mig/contracts/forms';
import { can } from '../auth/permissions';
import { approvalOutcome, registryStatusAfterReview } from '../clinics';
import { randomId } from '../lib/random';
import { DAY, isoDay, parseIso, tzIso } from '../lib/time';
import type { ClinicUserRow } from '../store/db';
import { linesOf, settleRegistry, subStatus, subTotals } from './assistance';
import { claimFromLine, clinicOf, emitWebhook, pushEvent, recomputeRegistry, refreshStoredGuarantee, toGuaranteeView, toRegistrySummary, toRegistryView } from './clinic';
import { asSystem, audit, conflict, DomainError, forbidden, notFound, requirePermission, requireStaff, validate, type AuthCtx, type BaseCtx } from './kernel';
import { toUserView } from './clinicPortal';
import { loadParams } from './params';
import { revokeKey, toClientView } from './partnerIntegration';

/** The MIG part of a clinic registry: only lines paid by MIG, with their own status and totals. */
function migSubRegistry(r: Registry): Registry {
  const lines = linesOf(r, 'mig');
  return { ...r, lines, status: subStatus(r, lines), totals: subTotals(lines) };
}

async function clinicCard(ctx: BaseCtx, clinic: Clinic): Promise<ClinicCard> {
  const r = ctx.repos;
  const since = ctx.now() - DAY;
  const answered = (await r.appointments.list({ where: { clinicId: clinic.id, respondedBy: 'clinic' } })).filter((a) => a.respondedAt);
  const avg = answered.length ? Math.round(answered.reduce((s, a) => s + (parseIso(a.respondedAt!) - parseIso(a.createdAt)), 0) / answered.length / 60_000) : null;
  const registries = await r.registries.list({ where: { clinicId: clinic.id } });
  const reviewed = registries.flatMap((x) => x.lines.filter((l) => l.status !== 'pending'));
  const rejected = reviewed.filter((l) => l.status === 'rejected' || l.status === 'disputed').length;
  const hooks = await r.webhookDeliveries.list({ where: { clinicId: clinic.id } });
  const P = await loadParams(ctx);
  return {
    clinic,
    contractNumber: P.nextDocNumber('clinicContract', { code: clinic.id.slice(0, 4) }),
    metrics: {
      avgResponseMinutes: avg,
      rejectedLineShare: reviewed.length ? rejected / reviewed.length : null,
      amountToPay: registries.filter((x) => x.status === 'accepted' || x.status === 'partially_accepted').reduce((s, x) => s + x.totals.accepted, 0),
    },
    users: (await r.clinicUsers.list({ where: { clinicId: clinic.id } })).map(toUserView),
    keys: (await r.integrationClients.list({ where: { clinicId: clinic.id } })).map(toClientView),
    webhooks: {
      endpoints: await r.webhooks.count({ clinicId: clinic.id }),
      retrying: hooks.filter((w) => w.status === 'retrying').length,
      failed24h: hooks.filter((w) => w.status === 'failed' && parseIso(w.lastAttemptAt) >= since).length,
    },
    apiErrors24h: (await r.apiLogs.list({ where: { clinicId: clinic.id, status: { gte: 400 } } })).filter((l) => parseIso(l.at) >= since).length,
  };
}

function canReadRegistries(user: SessionUser): boolean {
  return can(user, 'registries.review') || can(user, 'registries.pay');
}

// ---------------------------------------------------------------- clinics

export async function card(ctx: AuthCtx, id: UUID): Promise<ClinicCard> {
  requirePermission(requireStaff(ctx), 'clinics.read');
  return clinicCard(asSystem(ctx, 'clinic card for MIG staff: users, keys, webhooks, API errors, registries'), await clinicOf(ctx, id));
}

export async function createClinic(ctx: AuthCtx, body: unknown): Promise<Clinic> {
  const user = requireStaff(ctx);
  requirePermission(user, 'clinics.manage');
  const input = validate(clinicCreateSchema, body);
  const clinic: Clinic = {
    id: randomId(),
    ...input,
    onlineBooking: true,
    apiStatus: input.integrationMode === 'portal' ? 'manual' : 'online',
    contractUntil: isoDay(ctx.now() + 365 * DAY),
  };
  await ctx.repos.clinics.insert(clinic);
  await ctx.repos.priceLists.insert({ clinicId: clinic.id, items: ((await ctx.repos.priceLists.first())?.items ?? []).map((i) => ({ ...i })) });
  await audit(ctx, user, 'role_change', { targetType: 'clinic', targetId: clinic.id, targetLabel: clinic.name });
  return clinic;
}

export async function setMode(ctx: AuthCtx, id: UUID, body: unknown): Promise<Clinic> {
  requirePermission(requireStaff(ctx), 'clinics.manage');
  const clinic = await clinicOf(ctx, id);
  clinic.integrationMode = validate(clinicModeSchema, body).integrationMode;
  clinic.apiStatus = clinic.integrationMode === 'portal' ? 'manual' : 'online';
  await ctx.repos.clinics.update(clinic.id, { integrationMode: clinic.integrationMode, apiStatus: clinic.apiStatus });
  await pushEvent(ctx, clinic.id, 'МИГ изменил режим интеграции клиники');
  return clinic;
}

/** The first administrator of a clinic; `initialPassword`: the password of the new account (the demo one in the mock). */
export async function inviteAdmin(ctx: AuthCtx, id: UUID, body: unknown, initialPassword: string): Promise<ClinicUserView> {
  const user = requireStaff(ctx);
  requirePermission(user, 'clinic.users.manage', { sub: 'first_admin' });
  const clinic = await clinicOf(ctx, id);
  if (await ctx.repos.clinicUsers.exists({ clinicId: clinic.id, role: 'clinic_admin', active: true })) throw conflict('srv.clinics.hasAdmin');
  const input = validate(clinicAdminInviteSchema, body);
  if (await ctx.repos.clinicUsers.exists({ email: input.email })) throw new DomainError(409, 'conflict', 'srv.users.emailTaken', { fields: { email: msg('srv.users.emailInUse') } });
  const row: ClinicUserRow = { id: randomId(), ...input, role: 'clinic_admin', password: initialPassword, clinicId: clinic.id, active: true, createdAt: tzIso(ctx.now()) };
  await ctx.repos.clinicUsers.insert(row);
  await audit(ctx, user, 'role_change', { targetType: 'user', targetId: row.id, targetLabel: row.fullName });
  return toUserView(row);
}

export async function revokeClinicKey(ctx: AuthCtx, id: UUID, keyId: UUID): Promise<IntegrationClient> {
  const user = requireStaff(ctx);
  requirePermission(user, 'clinic.integration.manage', { sub: 'revoke_keys' });
  const clinic = await clinicOf(ctx, id);
  const k = await ctx.repos.integrationClients.first({ where: { id: keyId, clinicId: clinic.id } });
  if (!k) throw notFound();
  return toClientView(await revokeKey(ctx, k, user));
}

// ---------------------------------------------------------------- guarantee letters

/** By default MIG sees what it decides: escalations and clients without an assistance (§7, §9.1). */
export async function listGuarantees(ctx: AuthCtx, qs: URLSearchParams): Promise<GuaranteeView[]> {
  requirePermission(requireStaff(ctx), 'guarantees.read');
  const status = qs.get('status');
  const clinicId = qs.get('clinicId');
  const all = qs.get('scope') === 'all';
  const rows = await ctx.repos.guarantees.list();
  for (const g of rows) await refreshStoredGuarantee(ctx, g);
  const list = rows
    .filter((g) => all || !g.assistanceId || g.escalated)
    .filter((g) => (!status || status.split(',').includes(g.status)) && (!clinicId || g.clinicId === clinicId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const P = await loadParams(ctx);
  const out: GuaranteeView[] = [];
  for (const g of list) out.push(await toGuaranteeView(ctx, g, P));
  return out;
}

export async function getGuarantee(ctx: AuthCtx, id: UUID): Promise<GuaranteeView> {
  requirePermission(requireStaff(ctx), 'guarantees.read');
  const g = await ctx.repos.guarantees.get(id);
  if (!g) throw notFound();
  return toGuaranteeView(ctx, g);
}

export async function decideGuarantee(ctx: AuthCtx, id: UUID, body: unknown): Promise<GuaranteeView> {
  const user = requireStaff(ctx);
  requirePermission(user, 'guarantees.decide');
  const r = ctx.repos;
  const g = await r.guarantees.get(id);
  if (!g) throw notFound();
  if (!can(user, 'assist.guarantees.decide', { assistanceId: g.assistanceId ?? null, escalated: g.escalated === true })) {
    throw new DomainError(403, 'forbidden', 'srv.guarantee.assistanceDecides', { params: { name: g.assistanceName ?? t('srv.guarantee.assistanceDefault') } });
  }
  if (g.status !== 'requested') throw conflict(g.status === 'info_requested' ? 'srv.guarantee.awaitingDocs' : 'srv.decision.alreadyMade');
  const input = validate(guaranteeDecisionSchema, body);
  const at = tzIso(ctx.now());
  g.decidedBy = 'mig';
  if (input.action === 'approve') {
    const outcome = approvalOutcome(g, input.amount, user.id, (await loadParams(ctx)).dmsParam('guaranteeDualApprovalThreshold'));
    if (outcome === 'same_doctor') {
      await r.guarantees.update(g.id, { decidedBy: g.decidedBy });
      throw new DomainError(409, 'conflict', 'srv.guarantee.fourEyes');
    }
    g.approvals.push({ byId: user.id, byName: user.displayName, at });
    g.approvedAmount = input.amount;
    g.validUntil = input.validUntil;
    if (outcome === 'approved') {
      g.status = 'approved';
      g.reason = undefined;
      g.decidedAt = at;
      await r.guarantees.put(g);
      await emitWebhook(ctx, g.clinicId, 'guarantee.decided', g.id);
      await pushEvent(ctx, g.clinicId, `Гарантийное письмо ${g.number} одобрено`);
    } else await r.guarantees.put(g);
    await audit(ctx, user, 'guarantee_decided', { targetType: 'guarantee', targetId: g.id, targetLabel: g.number, reason: outcome === 'approved' ? 'Одобрено' : 'Первое одобрение из двух' });
  } else if (input.action === 'reject') {
    g.status = 'rejected';
    g.reason = input.reason;
    g.decidedAt = at;
    await r.guarantees.put(g);
    await emitWebhook(ctx, g.clinicId, 'guarantee.decided', g.id);
    await pushEvent(ctx, g.clinicId, `Гарантийное письмо ${g.number} отклонено`);
    await audit(ctx, user, 'guarantee_decided', { targetType: 'guarantee', targetId: g.id, targetLabel: g.number, reason: 'Отклонено' });
  } else {
    g.status = 'info_requested';
    g.reason = input.reason;
    await r.guarantees.put(g);
    await emitWebhook(ctx, g.clinicId, 'guarantee.documents_requested', g.id);
    await pushEvent(ctx, g.clinicId, `По ${g.number} нужны документы`);
    await audit(ctx, user, 'guarantee_decided', { targetType: 'guarantee', targetId: g.id, targetLabel: g.number, reason: 'Запрошены документы' });
  }
  return toGuaranteeView(ctx, g);
}

// ---------------------------------------------------------------- registries

/** MIG works only with its sub-registry: lines of clients without an assistance (§9.2). */
export async function listRegistries(ctx: AuthCtx, qs: URLSearchParams): Promise<RegistrySummary[]> {
  if (!canReadRegistries(requireStaff(ctx))) throw forbidden();
  const status = qs.get('status');
  const clinicId = qs.get('clinicId');
  const list = (await ctx.repos.registries.list({ where: { status: { ne: 'draft' } } }))
    .filter((r) => linesOf(r, 'mig').length > 0)
    .map(migSubRegistry)
    .filter((r) => (!status || status.split(',').includes(r.status)) && (!clinicId || r.clinicId === clinicId))
    .sort((a, b) => ((a.submittedAt ?? '') < (b.submittedAt ?? '') ? 1 : -1));
  const out: RegistrySummary[] = [];
  for (const r of list) out.push(await toRegistrySummary(ctx, r));
  return out;
}

export async function getRegistry(ctx: AuthCtx, id: UUID): Promise<RegistryView> {
  if (!canReadRegistries(requireStaff(ctx))) throw forbidden();
  const r = await ctx.repos.registries.get(id);
  if (!r || r.status === 'draft' || !linesOf(r, 'mig').length) throw notFound();
  return toRegistryView(ctx, migSubRegistry(r));
}

export async function decideLine(ctx: AuthCtx, id: UUID, lineId: UUID, body: unknown): Promise<RegistryView> {
  const user = requireStaff(ctx);
  requirePermission(user, 'registries.review');
  const repos = ctx.repos;
  const r = await repos.registries.get(id);
  if (!r || r.status === 'draft') throw notFound();
  if (r.status === 'paid') throw conflict('srv.registry.alreadyPaid');
  const line = r.lines.find((l) => l.id === lineId);
  // Lines of an assistance's sub-registry are reviewed by that assistance.
  if (!line || (line.payer ?? 'mig') !== 'mig') throw notFound();
  if (line.status !== 'pending' && line.status !== 'disputed') throw conflict('srv.lines.alreadyDecided');
  const input = validate(registryLineDecisionSchema, body);
  const wasPending = r.lines.some((l) => l.status === 'pending');
  if (input.decision === 'accept') {
    line.status = 'accepted';
    line.rejectionReason = undefined;
    await claimFromLine(ctx, r, line, user.displayName);
    const g = line.guaranteeNumber ? await repos.guarantees.first({ where: { number: line.guaranteeNumber, clinicId: r.clinicId } }) : null;
    if (g && g.status === 'approved') await repos.guarantees.update(g.id, { status: 'used' });
  } else {
    line.status = 'rejected';
    line.rejectionReason = input.reason;
  }
  r.status = registryStatusAfterReview(r.lines);
  recomputeRegistry(r);
  await repos.registries.put(r);
  await audit(ctx, user, 'registry_line_decided', { targetType: 'registry', targetId: r.id, targetLabel: `Реестр ${r.period}`, reason: input.decision === 'accept' ? 'Строка принята' : 'Строка отклонена' });
  if (wasPending && r.status !== 'in_review') {
    await emitWebhook(ctx, r.clinicId, 'registry.reviewed', r.id);
    await pushEvent(ctx, r.clinicId, `Реестр за ${r.period} проверен: ${r.status === 'accepted' ? 'принят' : 'принят частично'}`);
  }
  return toRegistryView(ctx, migSubRegistry(r));
}

export async function payRegistry(ctx: AuthCtx, id: UUID): Promise<RegistryView> {
  const user = requireStaff(ctx);
  requirePermission(user, 'registries.pay');
  const repos = ctx.repos;
  const r = await repos.registries.get(id);
  if (!r || r.status === 'draft') throw notFound();
  const mine = linesOf(r, 'mig');
  if (!mine.length) throw notFound();
  if (mine.some((l) => l.status === 'pending')) throw conflict('srv.registry.payReviewedOnly');
  if (mine.some((l) => l.status === 'disputed')) throw conflict('srv.registry.answerDisputes');
  const toPay = mine.filter((l) => l.status === 'accepted' && !l.payment);
  if (!toPay.length) throw conflict('srv.registry.migLinesPaid');
  const now = ctx.now();
  const paidAt = tzIso(now);
  const orderNumber = (await loadParams(ctx)).nextDocNumber('paymentOrder', { n: Number(String(now).slice(-6)) });
  for (const l of toPay) l.payment = { paidAt: paidAt.slice(0, 10), amount: l.amount, orderNumber };
  settleRegistry(r, now);
  recomputeRegistry(r);
  await repos.registries.put(r);
  for (const c of await repos.claims.list({ where: { registryLineId: { in: toPay.map((l) => l.id) } } })) {
    c.history.push({ at: paidAt, actorName: user.displayName, from: c.status, to: 'paid' });
    await repos.claims.update(c.id, { history: c.history, status: 'paid', updatedAt: paidAt });
  }
  await audit(ctx, user, 'registry_paid', { targetType: 'registry', targetId: r.id, targetLabel: `Реестр ${r.period}` });
  await emitWebhook(ctx, r.clinicId, 'registry.paid', r.id);
  await pushEvent(ctx, r.clinicId, `МИГ оплатил свои строки реестра за ${r.period}`);
  return toRegistryView(ctx, migSubRegistry(r));
}
