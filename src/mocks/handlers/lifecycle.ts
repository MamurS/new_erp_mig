/*
 * Sales part of the lifecycle (LIFECYCLE_SPEC §2–6): staff authority changes (four-eyes), leads, deals,
 * the anonymous census, quotes with authority routing, the offer from an approved quote, the client's answer.
 */
import { http, HttpResponse } from 'msw';
import type { AuthorityChange, Deal, KpDocument, KpParams, Quote, SessionUser, StaffAuthority } from '@/shared/types';
import type { DealCard, QuoteView, StaffDirectoryItem } from '@/shared/types/dto';
import { can } from '@/shared/auth/permissions';
import { isStaffRole } from '@/shared/domain/labels';
import { calculateQuote, canApproveQuote, quoteAuthorityProblem } from '@/shared/domain/tariff';
import { CENSUS_MAX_BYTES, parseCensusCsv } from '@/shared/domain/census';
import { dealNumber, defaultStartDate, originalReminderDue } from '@/shared/domain/contracts';
import { KP_TEMPLATE_VERSION, kpNumber, kpTotalPremium } from '@/shared/domain/kp';
import { defaultEndDate } from '@/shared/domain/policies';
import {
  authorityChangeSchema,
  authorityRejectSchema,
  dealLostSchema,
  dealPatchSchema,
  kpDeclineSchema,
  leadCreateSchema,
  quoteApproveSchema,
  quoteCreateSchema,
  quotePatchSchema,
  quoteRejectSchema,
} from '@/shared/schemas/forms';
import { db, type Db, type StaffRow } from '../db';
import { API, audit, body, conflict, forbidden, HttpError, notFound, param, requirePermission, requireSession, route, type Ctx } from '../http';
import { randomId } from '../rng';
import { DAY, isoDay, tzIso } from '../time';
import { toClient } from '../views';
import { PROGRAMS } from '../programs';
import { DEMO_PASSWORD } from '../credentials';
import { dmsParam, paramValues } from '../params';
import { clientRow, dealContract, dealEvent, dealKp, dealOf, latestQuote, moveDeal, refreshContract, staffName, toContractSummary, toDealView, todayIso } from '../lifecycle-core';

function requireMig(request: Request): SessionUser {
  const { user } = requireSession(request);
  if (!isStaffRole(user.role)) throw forbidden();
  return user;
}

const staffRow = (d: Db, id: string): StaffRow => {
  const s = d.staff.find((x) => x.id === id);
  if (!s) throw notFound();
  return s;
};

const authorityText = (a: StaffAuthority, signatory?: { basis: string }) =>
  [
    a.quoteDiscountMaxPct !== undefined ? `скидка до ${Math.round(a.quoteDiscountMaxPct * 1000) / 10}%` : '',
    a.quotePremiumMax !== undefined ? `премия до ${a.quotePremiumMax}` : '',
    a.claimDecisionMax !== undefined ? `убытки до ${a.claimDecisionMax}` : '',
    signatory ? 'подписант' : '',
  ]
    .filter(Boolean)
    .join(', ') || 'без полномочий';

/** Deals are visible to sales (all: own and shared) and underwriters (read); anyone else gets 403. */
function readDeals(user: SessionUser): void {
  if (!can(user, 'deals.manage') && !can(user, 'deals.manage', { sub: 'read' })) throw forbidden();
}

function census(d: Db, dealId: string) {
  return d.censuses.filter((c) => c.dealId === dealId).at(-1) ?? null;
}

function quoteView(d: Db, q: Quote, user: SessionUser): QuoteView {
  const deal = dealOf(d, q.dealId);
  const author = d.staff.find((s) => s.id === q.createdById);
  const approver = d.staff.find((s) => s.id === user.id);
  return {
    ...q,
    dealNumber: deal.number,
    clientName: toDealView(d, deal).clientName,
    census: census(d, deal.id),
    startDate: deal.expectedStart ?? todayIso(),
    authorityProblem: quoteAuthorityProblem(q, author?.authority),
    canApprove: q.status === 'pending_approval' && !!approver && canApproveQuote(approver, q),
    canEdit: can(user, 'quotes.calculate') && (q.status === 'draft' || q.status === 'rejected'),
  };
}

function quoteOf(d: Db, ctx: Ctx): Quote {
  const q = d.quotes.find((x) => x.id === param(ctx, 'id'));
  if (!q) throw notFound();
  return q;
}

function recalc(d: Db, q: Quote, program: Quote['program'], adjustments: Quote['adjustments']): void {
  const deal = dealOf(d, q.dealId);
  const c = census(d, deal.id);
  if (!c) throw conflict('Сначала загрузите данные для оценки');
  const calc = calculateQuote({ program, rows: c.rows, startDate: deal.expectedStart ?? todayIso(), adjustments }, paramValues());
  Object.assign(q, {
    program,
    adjustments,
    rates: calc.rates,
    groupDiscountPct: calc.groupDiscountPct,
    premiumEmployee: calc.premiumEmployee,
    premiumFamily: calc.premiumFamily,
    total: calc.total,
    discountFromTariffPct: calc.discountFromTariffPct,
    updatedAt: tzIso(Date.now()),
  });
}

function dealCard(d: Db, deal: Deal): DealCard {
  const client = clientRow(d, deal.clientId);
  const contract = dealContract(d, deal.id);
  const reminders: string[] = [];
  if (contract && originalReminderDue(contract.signing, Date.now(), dmsParam('paperOriginalReminderDays'))) reminders.push(`Оригинал договора ${contract.number} от клиента не получен дольше ${dmsParam('paperOriginalReminderDays')} дн.`);
  const overdue = d.invoices.filter((i) => contract && i.contractId === contract.id && i.status === 'overdue');
  if (overdue.length) reminders.push(`Просрочено взносов: ${overdue.length}`);
  return {
    ...toDealView(d, deal),
    client: toClient(d, client),
    census: census(d, deal.id),
    quote: latestQuote(d, deal.id) ?? null,
    kp: dealKp(d, deal.id) ?? null,
    contract: contract ? toContractSummary(contract) : null,
    events: d.dealEvents.filter((e) => e.dealId === deal.id).slice(0, 100),
    reminders,
  };
}

/** Creates a renewal deal for a client whose offer goes out (KP_SPEC renewal → deal of type `renewal`). */
export function ensureRenewalDeal(d: Db, kp: KpDocument, actor: SessionUser): void {
  if (kp.dealId) return;
  const client = d.clients.find((c) => c.id === kp.clientId);
  if (!client?.activePolicyId) return;
  const open = d.deals.find((x) => x.clientId === client.id && x.type === 'renewal' && x.stage !== 'lost' && x.stage !== 'active');
  if (open) {
    kp.dealId = open.id;
    moveDeal(d, open.id, 'kp_sent', actor.displayName, `Отправлено КП ${kp.number}`);
    return;
  }
  d.dealSeq += 1;
  const now = tzIso(Date.now());
  const deal: Deal = {
    id: randomId(),
    number: dealNumber(new Date().getFullYear(), d.dealSeq),
    clientId: client.id,
    type: 'renewal',
    stage: 'kp_sent',
    ownerId: d.staff.find((s) => s.role === 'sales_manager' && s.active)?.id ?? actor.id,
    underwriterId: actor.role === 'underwriter' ? actor.id : undefined,
    expectedStart: kp.params.coverageStart,
    previousPolicyId: client.activePolicyId,
    createdAt: now,
    updatedAt: now,
  };
  d.deals.unshift(deal);
  kp.dealId = deal.id;
  dealEvent(d, deal.id, actor.displayName, `Сделка на продление создана из КП ${kp.number}`);
}

export const lifecycleHandlers = [
  // ---------------- staff directory and authority (LIFECYCLE_SPEC §2) ----------------
  http.get(
    `${API}/staff/directory`,
    route(({ request }) => {
      requireMig(request);
      const out: StaffDirectoryItem[] = db()
        .staff.filter((s) => s.active)
        .map((s) => ({ id: s.id, fullName: s.fullName, role: s.role, authority: s.authority, canSign: s.signatory?.canSign === true }));
      return out;
    }),
  ),
  http.get(
    `${API}/admin/authority-changes`,
    route(({ request }) => {
      const user = requireMig(request);
      if (!can(user, 'staff.authority.manage') && !can(user, 'staff.authority.manage', { sub: 'approve' })) throw forbidden();
      return db().authorityChanges.slice(0, 50);
    }),
  ),
  http.post(
    `${API}/admin/users/:id/authority`,
    route(async (ctx) => {
      const user = requireMig(ctx.request);
      requirePermission(user, 'staff.authority.manage');
      const d = db();
      const target = staffRow(d, param(ctx, 'id'));
      const input = await body(ctx.request, authorityChangeSchema);
      if (d.authorityChanges.some((c) => c.staffId === target.id && c.status === 'pending')) throw conflict('По этому сотруднику уже есть изменение на подтверждении');
      const to = { authority: input.authority, ...(input.signatory ? { signatory: { canSign: true as const, basis: input.signatory.basis } } : {}) };
      const change: AuthorityChange = {
        id: randomId(),
        staffId: target.id,
        staffName: target.fullName,
        from: { authority: target.authority, ...(target.signatory ? { signatory: target.signatory } : {}) },
        to,
        reason: input.reason,
        status: 'pending',
        proposedById: user.id,
        proposedByName: user.displayName,
        proposedAt: tzIso(Date.now()),
      };
      d.authorityChanges.unshift(change);
      audit(user, 'authority_proposed', {
        targetType: 'user',
        targetId: target.id,
        targetLabel: `${target.fullName}: ${authorityText(change.from.authority, change.from.signatory)} → ${authorityText(to.authority, to.signatory)}`,
        reason: input.reason,
      });
      return HttpResponse.json(change, { status: 201 });
    }),
  ),
  ...(['approve', 'reject'] as const).map((kind) =>
    http.post(
      `${API}/admin/authority-changes/:id/${kind}`,
      route(async (ctx) => {
        const user = requireMig(ctx.request);
        const d = db();
        const c = d.authorityChanges.find((x) => x.id === param(ctx, 'id'));
        if (!c) throw notFound();
        if (!can(user, 'staff.authority.manage', { sub: 'approve', createdById: c.proposedById })) throw forbidden();
        if (c.status !== 'pending') throw conflict('Изменение уже рассмотрено');
        if (kind === 'approve' && (c.proposedById === user.id || c.staffId === user.id)) {
          throw new HttpError(403, 'forbidden', 'Подтверждает другой сотрудник, и не тот, чьи полномочия меняются (правило четырёх глаз)');
        }
        const target = staffRow(d, c.staffId);
        const at = tzIso(Date.now());
        if (kind === 'approve') {
          target.authority = c.to.authority;
          if (c.to.signatory) target.signatory = c.to.signatory;
          else delete target.signatory;
          // Sessions carry authority and the signatory flag: the user gets the new rights at the next request.
          Object.assign(c, { status: 'applied', decidedByName: user.displayName, decidedAt: at });
          audit(user, 'authority_changed', {
            targetType: 'user',
            targetId: target.id,
            targetLabel: `${target.fullName}: ${authorityText(c.from.authority, c.from.signatory)} → ${authorityText(c.to.authority, c.to.signatory)}`,
            reason: `Предложил ${c.proposedByName}: ${c.reason}`,
          });
        } else {
          const { reason } = await body(ctx.request, authorityRejectSchema);
          Object.assign(c, { status: 'rejected', decidedByName: user.displayName, decidedAt: at, rejectReason: reason });
          audit(user, 'authority_rejected', { targetType: 'user', targetId: target.id, targetLabel: target.fullName, reason });
        }
        return c;
      }),
    ),
  ),

  // ---------------- leads (§3) ----------------
  http.get(
    `${API}/leads`,
    route(({ request }) => {
      const user = requireMig(request);
      if (!can(user, 'leads.manage') && !can(user, 'leads.manage', { sub: 'read' })) throw forbidden();
      const d = db();
      return d.clients.filter((c) => c.status === 'lead').map((c) => toClient(d, c));
    }),
  ),
  http.post(
    `${API}/leads`,
    route(async ({ request }) => {
      const user = requireMig(request);
      requirePermission(user, 'leads.manage');
      const input = await body(request, leadCreateSchema);
      const d = db();
      if (d.clients.some((c) => c.inn === input.inn)) throw new HttpError(409, 'conflict', 'Клиент с таким ИНН уже есть', { inn: 'ИНН уже есть в базе' });
      const now = tzIso(Date.now());
      const client = {
        id: randomId(),
        legalForm: input.legalForm,
        name: input.name,
        inn: input.inn,
        status: 'lead' as const,
        managerId: user.id,
        managerName: user.displayName,
        hrContact: { name: input.contactName, phone: input.contactPhone, email: input.contactEmail },
        premium: 0,
        lossRatio: null,
        createdAt: now,
        requisites: input.requisites,
        estimatedHeadcount: input.estimatedHeadcount,
        currentInsurer: input.currentInsurer || undefined,
        assistanceId: null,
      };
      d.clients.unshift(client);
      d.dealSeq += 1;
      const deal: Deal = {
        id: randomId(),
        number: dealNumber(new Date().getFullYear(), d.dealSeq),
        clientId: client.id,
        type: 'new',
        stage: 'lead',
        ownerId: user.id,
        expectedStart: input.expectedStart,
        createdAt: now,
        updatedAt: now,
      };
      d.deals.unshift(deal);
      dealEvent(d, deal.id, user.displayName, `Лид создан: ${client.legalForm} «${client.name}», около ${input.estimatedHeadcount} сотрудников`);
      audit(user, 'lead_created', { targetType: 'deal', targetId: deal.id, targetLabel: `${deal.number}: ${client.name}` });
      return HttpResponse.json(toDealView(d, deal), { status: 201 });
    }),
  ),

  // ---------------- deals (§3) ----------------
  http.get(
    `${API}/deals`,
    route(async ({ request, url }) => {
      const user = requireMig(request);
      readDeals(user);
      const d = db();
      for (const c of d.contracts) await refreshContract(d, c);
      let list = d.deals;
      const owner = url.searchParams.get('ownerId');
      if (owner) list = list.filter((x) => x.ownerId === owner);
      const type = url.searchParams.get('type');
      if (type === 'new' || type === 'renewal') list = list.filter((x) => x.type === type);
      return list.map((x) => toDealView(d, x));
    }),
  ),
  http.get(
    `${API}/deals/:id`,
    route(async (ctx) => {
      const user = requireMig(ctx.request);
      readDeals(user);
      const d = db();
      const deal = dealOf(d, param(ctx, 'id'));
      const c = dealContract(d, deal.id);
      if (c) await refreshContract(d, c);
      return dealCard(d, deal);
    }),
  ),
  http.patch(
    `${API}/deals/:id`,
    route(async (ctx) => {
      const user = requireMig(ctx.request);
      requirePermission(user, 'deals.manage');
      const d = db();
      const deal = dealOf(d, param(ctx, 'id'));
      const input = await body(ctx.request, dealPatchSchema);
      if (input.underwriterId && d.staff.find((s) => s.id === input.underwriterId)?.role !== 'underwriter') throw new HttpError(422, 'validation', 'Выберите андеррайтера', { underwriterId: 'Выберите андеррайтера' });
      if (input.expectedStart) deal.expectedStart = input.expectedStart;
      if (input.underwriterId) {
        deal.underwriterId = input.underwriterId;
        dealEvent(d, deal.id, user.displayName, `Андеррайтер: ${staffName(d, input.underwriterId)}`);
      }
      deal.updatedAt = tzIso(Date.now());
      return dealCard(d, deal);
    }),
  ),
  http.post(
    `${API}/deals/:id/stage`,
    route(async (ctx) => {
      const user = requireMig(ctx.request);
      requirePermission(user, 'deals.manage');
      const d = db();
      const deal = dealOf(d, param(ctx, 'id'));
      if (deal.stage === 'active' || deal.stage === 'lost') throw conflict('Сделка уже закрыта');
      const { reason } = await body(ctx.request, dealLostSchema);
      deal.stage = 'lost';
      deal.lostReason = reason;
      deal.updatedAt = tzIso(Date.now());
      dealEvent(d, deal.id, user.displayName, `Сделка проиграна: ${reason}`);
      audit(user, 'deal_lost', { targetType: 'deal', targetId: deal.id, targetLabel: deal.number, reason });
      return dealCard(d, deal);
    }),
  ),

  // ---------------- census (§4) ----------------
  http.post(
    `${API}/deals/:id/census`,
    route(async (ctx) => {
      const user = requireMig(ctx.request);
      requirePermission(user, 'census.upload');
      const d = db();
      const deal = dealOf(d, param(ctx, 'id'));
      if (deal.stage === 'lost' || deal.stage === 'active') throw conflict('Сделка закрыта');
      const text = await ctx.request.text();
      if (text.length > CENSUS_MAX_BYTES) throw new HttpError(413, 'validation', 'Файл больше 1 МБ');
      const parsed = parseCensusCsv(text, todayIso());
      if (!parsed.rows.length) throw new HttpError(422, 'validation', parsed.errors[0]?.message ?? 'В файле нет строк');
      // Names, PINFL and phones are not accepted at this stage: such columns were dropped by the parser.
      const c = { id: randomId(), dealId: deal.id, rows: parsed.rows, uploadedAt: tzIso(Date.now()) };
      d.censuses.push(c);
      moveDeal(d, deal.id, 'census', user.displayName, `Загружены данные для оценки: ${parsed.rows.length} человек${parsed.dropped.length ? `, отброшены столбцы с ПДн: ${parsed.dropped.length}` : ''}`);
      audit(user, 'census_uploaded', { targetType: 'deal', targetId: deal.id, targetLabel: `${deal.number}: ${parsed.rows.length} строк` });
      return { census: c, errors: parsed.errors, dropped: parsed.dropped };
    }),
  ),

  // ---------------- quotes (§5) ----------------
  http.post(
    `${API}/quotes`,
    route(async ({ request }) => {
      const user = requireMig(request);
      requirePermission(user, 'quotes.calculate');
      const input = await body(request, quoteCreateSchema);
      const d = db();
      const deal = dealOf(d, input.dealId);
      if (deal.stage === 'lost' || deal.stage === 'active') throw conflict('Сделка закрыта');
      const q: Quote = {
        id: randomId(),
        dealId: deal.id,
        program: input.program,
        rates: [],
        adjustments: [],
        groupDiscountPct: 0,
        premiumEmployee: 0,
        premiumFamily: 0,
        total: 0,
        discountFromTariffPct: 0,
        status: 'draft',
        approvals: [],
        createdById: user.id,
        createdByName: user.displayName,
      };
      recalc(d, q, input.program, input.adjustments);
      d.quotes.push(q);
      if (!deal.underwriterId) deal.underwriterId = user.id;
      moveDeal(d, deal.id, 'quote', user.displayName, `Котировка: программа ${PROGRAMS[q.program].name}, премия ${q.total}`);
      audit(user, 'quote_saved', { targetType: 'quote', targetId: q.id, targetLabel: deal.number });
      return HttpResponse.json(quoteView(d, q, user), { status: 201 });
    }),
  ),
  http.get(
    `${API}/quotes/:id`,
    route((ctx) => {
      const user = requireMig(ctx.request);
      if (!can(user, 'quotes.calculate') && !can(user, 'deals.manage')) throw forbidden();
      const d = db();
      return quoteView(d, quoteOf(d, ctx), user);
    }),
  ),
  http.patch(
    `${API}/quotes/:id`,
    route(async (ctx) => {
      const user = requireMig(ctx.request);
      requirePermission(user, 'quotes.calculate');
      const d = db();
      const q = quoteOf(d, ctx);
      if (q.status !== 'draft' && q.status !== 'rejected') throw conflict('Котировку на согласовании или утверждённую нельзя изменить');
      const input = await body(ctx.request, quotePatchSchema);
      recalc(d, q, input.program, input.adjustments);
      q.status = 'draft';
      audit(user, 'quote_saved', { targetType: 'quote', targetId: q.id, targetLabel: dealOf(d, q.dealId).number });
      return quoteView(d, q, user);
    }),
  ),
  http.post(
    `${API}/quotes/:id/submit`,
    route((ctx) => {
      const user = requireMig(ctx.request);
      requirePermission(user, 'quotes.calculate');
      const d = db();
      const q = quoteOf(d, ctx);
      if (q.status !== 'draft' && q.status !== 'rejected') throw conflict('Котировка уже отправлена');
      const deal = dealOf(d, q.dealId);
      const author = d.staff.find((s) => s.id === user.id);
      const problem = quoteAuthorityProblem(q, author?.authority);
      const at = tzIso(Date.now());
      if (!problem && can(user, 'quotes.approve')) {
        q.status = 'approved';
        q.approvals = [{ byId: user.id, byName: user.displayName, at, comment: 'В пределах полномочий' }];
        dealEvent(d, deal.id, user.displayName, 'Котировка утверждена в пределах полномочий андеррайтера');
        audit(user, 'quote_approved', { targetType: 'quote', targetId: q.id, targetLabel: deal.number });
      } else {
        q.status = 'pending_approval';
        dealEvent(d, deal.id, user.displayName, `Котировка на согласовании: ${problem ?? 'нужно согласование'}`);
        audit(user, 'quote_submitted', { targetType: 'quote', targetId: q.id, targetLabel: deal.number, reason: problem ?? undefined });
      }
      return quoteView(d, q, user);
    }),
  ),
  http.post(
    `${API}/quotes/:id/approve`,
    route(async (ctx) => {
      const user = requireMig(ctx.request);
      requirePermission(user, 'quotes.approve');
      const d = db();
      const q = quoteOf(d, ctx);
      if (q.status !== 'pending_approval') throw conflict('Котировка не ждёт согласования');
      const approver = d.staff.find((s) => s.id === user.id)!;
      if (q.createdById === user.id) throw new HttpError(403, 'forbidden', 'Котировку утверждает другой андеррайтер (правило четырёх глаз)');
      if (!canApproveQuote(approver, q)) throw new HttpError(403, 'forbidden', 'Котировка выше ваших полномочий: нужен сотрудник с бо́льшими полномочиями');
      const { comment } = await body(ctx.request, quoteApproveSchema);
      q.status = 'approved';
      q.approvals.push({ byId: user.id, byName: user.displayName, at: tzIso(Date.now()), ...(comment ? { comment } : {}) });
      const deal = dealOf(d, q.dealId);
      dealEvent(d, deal.id, user.displayName, 'Котировка утверждена');
      audit(user, 'quote_approved', { targetType: 'quote', targetId: q.id, targetLabel: deal.number, reason: comment });
      return quoteView(d, q, user);
    }),
  ),
  http.post(
    `${API}/quotes/:id/reject`,
    route(async (ctx) => {
      const user = requireMig(ctx.request);
      requirePermission(user, 'quotes.approve');
      const d = db();
      const q = quoteOf(d, ctx);
      if (q.status !== 'pending_approval') throw conflict('Котировка не ждёт согласования');
      if (q.createdById === user.id) throw forbidden();
      const { reason } = await body(ctx.request, quoteRejectSchema);
      q.status = 'rejected';
      q.rejectReason = reason;
      const deal = dealOf(d, q.dealId);
      dealEvent(d, deal.id, user.displayName, `Котировка отклонена: ${reason}`);
      audit(user, 'quote_rejected', { targetType: 'quote', targetId: q.id, targetLabel: deal.number, reason });
      return quoteView(d, q, user);
    }),
  ),

  // ---------------- the offer from an approved quote (§6) ----------------
  http.post(
    `${API}/deals/:id/kp`,
    route((ctx) => {
      const user = requireMig(ctx.request);
      requirePermission(user, 'kp.send');
      const d = db();
      const deal = dealOf(d, param(ctx, 'id'));
      const q = latestQuote(d, deal.id);
      if (!q || q.status !== 'approved') throw conflict('КП можно отправить только по утверждённой котировке');
      const client = clientRow(d, deal.clientId);
      const start = deal.expectedStart && deal.expectedStart >= todayIso() ? deal.expectedStart : defaultStartDate(todayIso());
      const c = census(d, deal.id);
      const employees = c?.rows.filter((r) => r.relation === 'employee').length ?? 0;
      const counts = { employees, family: (c?.rows.length ?? 0) - employees };
      const limits = PROGRAMS[q.program].limits;
      const params: KpParams = {
        templateId: 'gold',
        lang: 'ru',
        variant: 'white',
        sumInsured: limits.outpatient + limits.dental + limits.medicines + limits.inpatient,
        premiumEmployee: q.premiumEmployee,
        premiumFamily: q.premiumFamily,
        employees: counts.employees,
        familyMembers: counts.family,
        coverageStart: start,
        coverageEnd: defaultEndDate(start),
        validUntil: isoDay(Date.now() + dmsParam('kpValidityDays') * DAY),
        paymentTerms: 'single',
        assistanceId: d.assistances[0]?.id ?? null,
      };
      for (const old of d.kp.filter((k) => k.dealId === deal.id && k.status === 'sent')) old.status = 'revoked';
      d.kpSeq += 1;
      const now = Date.now();
      const kp: KpDocument = {
        id: randomId(),
        number: kpNumber(new Date(now).getFullYear(), d.kpSeq),
        clientId: client.id,
        clientName: client.name,
        clientLegalForm: client.legalForm,
        clientInn: client.inn,
        policyId: deal.previousPolicyId,
        params,
        templateVersion: KP_TEMPLATE_VERSION.gold,
        totalPremium: kpTotalPremium(params),
        status: 'sent',
        createdById: user.id,
        createdByName: user.displayName,
        createdByEmail: d.staff.find((s) => s.id === user.id)?.email ?? '',
        createdAt: tzIso(now),
        sentAt: tzIso(now),
        dealId: deal.id,
        quoteId: q.id,
      };
      d.kp.unshift(kp);
      if (client.status === 'lead') client.status = 'negotiation';
      // The client's contact gets the HR cabinet to answer the offer and sign the contract (demo password).
      if (!d.hrUsers.some((h) => h.companyId === client.id)) {
        d.hrUsers.push({ id: randomId(), email: client.hrContact.email, password: DEMO_PASSWORD, fullName: client.hrContact.name, companyId: client.id });
        dealEvent(d, deal.id, user.displayName, `Контакту клиента открыт кабинет HR (${client.hrContact.email})`);
      }
      moveDeal(d, deal.id, 'kp_sent', user.displayName, `КП ${kp.number} отправлено клиенту`);
      audit(user, 'kp_sent', { targetType: 'kp', targetId: kp.id, targetLabel: kp.number });
      return HttpResponse.json(kp, { status: 201 });
    }),
  ),
  ...(['accept', 'decline'] as const).map((kind) =>
    http.post(
      `${API}/kp/:id/${kind}`,
      route(async (ctx) => {
        const { user } = requireSession(ctx.request);
        const d = db();
        const kp = d.kp.find((k) => k.id === param(ctx, 'id'));
        if (!kp) throw notFound();
        // HR answers for its own company; the sales manager marks the answer received by e-mail.
        if (user.role === 'hr') {
          if (!can(user, 'kp.respond', { companyId: kp.clientId })) throw notFound();
        } else if (!can(user, 'kp.respond', { sub: 'manual' })) throw forbidden();
        if (kp.status !== 'sent') throw conflict('Ответить можно только на отправленное КП');
        const reason = kind === 'decline' ? (await body(ctx.request, kpDeclineSchema)).reason : undefined;
        kp.status = kind === 'accept' ? 'accepted' : 'declined';
        kp.response = { at: tzIso(Date.now()), byName: user.displayName, via: user.role === 'hr' ? 'hr' : 'manager', ...(reason ? { reason } : {}) };
        ensureRenewalDeal(d, kp, user);
        if (kind === 'accept') moveDeal(d, kp.dealId, 'kp_accepted', user.displayName, `КП ${kp.number} принято клиентом${user.role === 'hr' ? ' в кабинете' : ' (отметка менеджера)'}`);
        else if (kp.dealId) dealEvent(d, kp.dealId, user.displayName, `КП ${kp.number} отклонено: ${reason}`);
        audit(user, kind === 'accept' ? 'kp_accepted' : 'kp_declined', { targetType: 'kp', targetId: kp.id, targetLabel: kp.number, reason });
        return kp;
      }),
    ),
  ),
];

