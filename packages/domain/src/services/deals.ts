/*
 * Sales pipeline (LIFECYCLE_SPEC §2–6): the staff directory and four-eyes changes of authority, leads,
 * deals, census, quotes, the offer of an approved quote and the client's answer to an offer.
 */
import { issueInvitation } from './invitations';
import { msg } from '@mig/i18n';
import type { AuthorityChange, Deal, KpDocument, KpParams, Quote, SessionUser, StaffAuthority } from '@mig/contracts';
import type { DealCard, DealView, QuoteView, StaffDirectoryItem } from '@mig/contracts/dto';
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
} from '@mig/contracts/forms';
import { can } from '../auth/permissions';
import { CENSUS_MAX_BYTES, parseCensusCsv, type CensusParseResult } from '../census';
import { DEMO_PASSWORD } from '../auth/demo';
import { addDays, dealNumber, defaultStartDate, originalReminderDue } from '../contracts';
import { KP_TEMPLATE_VERSION, kpNumber, kpTotalPremium } from '../kp';
import { isStaffRole } from '../labels';
import { countsOf, groupSize, legalFormProblem } from '../minGroup';
import { dealChecklist } from '../nextStep';
import { defaultEndDate } from '../policies';
import { PROGRAMS } from '../programs';
import { calculateQuote, canApproveQuote, quoteAuthorityProblem } from '../tariff';
import { randomId } from '../lib/random';
import { DAY, isoDay, tzIso } from '../lib/time';
import type { StaffRow } from '../store/db';
import { allOf, byLegalForm, byLegalName, filterLegalForm, sortBy } from './list';
import { audit, conflict, DomainError, errorOf, forbidden, notFound, requirePermission, SYSTEM_ACTOR, todayIso, validate, type AuthCtx, type BaseCtx } from './kernel';
import { loadParams, type ParamsView } from './params';
import { checklistInput, clientRow, dealContract, dealEvent, dealKp, dealOf, latestQuote, moveDeal, staffName, toContractSummary, toDealView } from './lifecycle';
import { completeTasks, notify } from './tasks';
import { toClient } from './views';
import { openRenewalDeal } from './system/consequences';

/** MIG staff only. */
function requireMig(ctx: AuthCtx): SessionUser {
  if (!isStaffRole(ctx.user.role)) throw forbidden();
  return ctx.user;
}

async function staffRow(ctx: BaseCtx, id: string): Promise<StaffRow> {
  const s = await ctx.repos.staff.get(id);
  if (!s) throw notFound();
  return s;
}

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

async function census(ctx: BaseCtx, dealId: string) {
  return (await ctx.repos.censuses.list({ where: { dealId } })).at(-1) ?? null;
}

/** The census group of a deal against the minimal group size («Клиенты» parameters). */
async function quoteGroup(ctx: BaseCtx, dealId: string, P: ParamsView): Promise<QuoteView['group']> {
  const rules = P.groupRules();
  const counts = countsOf((await census(ctx, dealId))?.rows ?? []);
  const size = groupSize(counts, rules);
  return { size, min: rules.min, countsFamily: rules.countsFamily, below: size < rules.min };
}

async function quoteView(ctx: BaseCtx, q: Quote, user: SessionUser): Promise<QuoteView> {
  const P = await loadParams(ctx);
  const deal = await dealOf(ctx, q.dealId);
  const author = await ctx.repos.staff.get(q.createdById);
  const approver = await ctx.repos.staff.get(user.id);
  const dv = await toDealView(ctx, deal);
  const group = await quoteGroup(ctx, deal.id, P);
  return {
    ...q,
    dealNumber: deal.number,
    clientName: dv.clientName,
    clientLegalForm: dv.clientLegalForm,
    census: await census(ctx, deal.id),
    startDate: deal.expectedStart ?? todayIso(ctx),
    authorityProblem: quoteAuthorityProblem(q, author?.authority, group),
    canApprove: q.status === 'pending_approval' && !!approver && canApproveQuote(approver, q, group),
    group,
    canEdit: can(user, 'quotes.calculate') && (q.status === 'draft' || q.status === 'rejected'),
  };
}

async function quoteOf(ctx: BaseCtx, id: string): Promise<Quote> {
  const q = await ctx.repos.quotes.get(id);
  if (!q) throw notFound();
  return q;
}

/** Recalculates `q` in place (the caller saves it). */
async function recalc(ctx: BaseCtx, q: Quote, program: Quote['program'], adjustments: Quote['adjustments'], pricingBasis: Quote['pricingBasis']): Promise<void> {
  const deal = await dealOf(ctx, q.dealId);
  const c = await census(ctx, deal.id);
  if (!c) throw conflict('srv.deal.uploadCensusFirst');
  const P = await loadParams(ctx);
  const calc = calculateQuote({ program, rows: c.rows, startDate: deal.expectedStart ?? todayIso(ctx), adjustments }, P.paramValues());
  Object.assign(q, {
    program,
    adjustments,
    rates: calc.rates,
    groupDiscountPct: calc.groupDiscountPct,
    premiumEmployee: calc.premiumEmployee,
    premiumFamily: calc.premiumFamily,
    total: calc.total,
    discountFromTariffPct: calc.discountFromTariffPct,
    // The band table is derived from the same tariff and factors; it becomes the contract's appendix.
    pricingBasis,
    ageBandRates: calc.ageBandRates,
    updatedAt: tzIso(ctx.now()),
  });
}

async function dealCard(ctx: BaseCtx, dealId: string): Promise<DealCard> {
  const deal = await dealOf(ctx, dealId);
  const P = await loadParams(ctx);
  const client = await clientRow(ctx, deal.clientId);
  const contract = await dealContract(ctx, deal.id);
  const reminders: string[] = [];
  const days = P.dmsParam('paperOriginalReminderDays');
  if (contract && originalReminderDue(contract.signing, ctx.now(), days)) reminders.push(msg('srv.deal.reminderOriginal', { number: contract.number, days }));
  const overdue = contract ? await ctx.repos.invoices.count({ contractId: contract.id, status: 'overdue' }) : 0;
  if (overdue) reminders.push(msg('srv.deal.reminderOverdue', { count: overdue }));
  return {
    ...(await toDealView(ctx, deal)),
    client: await toClient(ctx, client),
    census: await census(ctx, deal.id),
    quote: (await latestQuote(ctx, deal.id)) ?? null,
    kp: (await dealKp(ctx, deal.id)) ?? null,
    contract: contract ? toContractSummary(contract) : null,
    events: await ctx.repos.dealEvents.list({ where: { dealId: deal.id }, limit: 100 }),
    reminders,
    checklist: dealChecklist(await checklistInput(ctx, deal)),
    hasHr: await ctx.repos.hrUsers.exists({ companyId: deal.clientId }),
  };
}

/**
 * Creates a renewal deal for a client whose offer goes out (KP_SPEC renewal → deal of type `renewal`).
 * Sets `kp.dealId` and saves it.
 */
export async function ensureRenewalDeal(ctx: BaseCtx, kp: KpDocument, actor: SessionUser): Promise<void> {
  if (kp.dealId) return;
  const client = await ctx.repos.clients.get(kp.clientId);
  if (!client?.activePolicyId) return;
  const open = (await ctx.repos.deals.list({ where: { clientId: client.id, type: 'renewal', stage: { notIn: ['lost', 'active'] } } }))[0];
  if (open) {
    kp.dealId = open.id;
    await ctx.repos.kp.update(kp.id, { dealId: kp.dealId });
    await moveDeal(ctx, open.id, 'kp_sent', actor.displayName, `Отправлено КП ${kp.number}`);
    return;
  }
  const P = await loadParams(ctx);
  const seq = await ctx.repos.seq.next('deal');
  const now = tzIso(ctx.now());
  const deal: Deal = {
    id: randomId(),
    number: dealNumber(new Date(ctx.now()).getFullYear(), seq, P.numbering()),
    clientId: client.id,
    type: 'renewal',
    stage: 'kp_sent',
    ownerId: (await ctx.repos.staff.first({ where: { role: 'sales_manager', active: true } }))?.id ?? actor.id,
    underwriterId: actor.role === 'underwriter' ? actor.id : undefined,
    expectedStart: kp.params.coverageStart,
    previousPolicyId: client.activePolicyId,
    createdAt: now,
    updatedAt: now,
  };
  await ctx.repos.deals.insert(deal, { at: 'start' });
  kp.dealId = deal.id;
  await ctx.repos.kp.update(kp.id, { dealId: kp.dealId });
  await dealEvent(ctx, deal.id, actor.displayName, `Сделка на продление создана из КП ${kp.number}`);
}

/** The manager of a renewal: the client's manager while an active sales manager, else the first active one. */
async function renewalOwner(ctx: BaseCtx, client: { managerId?: string }): Promise<StaffRow | null> {
  const manager = client.managerId ? await ctx.repos.staff.get(client.managerId) : null;
  if (manager?.active && manager.role === 'sales_manager') return manager;
  return ctx.repos.staff.first({ where: { role: 'sales_manager', active: true } });
}

/**
 * The background job `renewal-deals`: `renewalLeadDays` before the client's current policy ends, its renewal deal
 * (type `renewal`, stage `lead`) is opened for the client's manager — once per policy. A renewal offer sent later
 * joins that deal (ensureRenewalDeal finds the open renewal deal of the client), and a policy whose renewal deal was
 * already opened from an offer gets no second one. Returns how many deals were opened.
 */
export async function openRenewalDeals(ctx: BaseCtx): Promise<number> {
  const P = await loadParams(ctx);
  const today = todayIso(ctx);
  const until = addDays(today, P.dmsParam('renewalLeadDays'));
  let opened = 0;
  for (const policy of await ctx.repos.policies.list({ where: { status: 'active', endDate: { gte: today, lte: until } } })) {
    const client = await ctx.repos.clients.get(policy.clientId);
    // Only the client's current policy is renewed (an older one was replaced by a renewal already).
    if (!client || client.activePolicyId !== policy.id) continue;
    if (await ctx.repos.deals.exists({ previousPolicyId: policy.id })) continue;
    if (await ctx.repos.deals.exists({ clientId: client.id, type: 'renewal', stage: { notIn: ['lost', 'active'] } })) continue;
    const owner = await renewalOwner(ctx, client);
    if (!owner || !(await ctx.repos.jobMarks.claim('renewal-deals', policy.id, policy.endDate))) continue;
    const seq = await ctx.repos.seq.next('deal');
    const now = tzIso(ctx.now());
    const deal: Deal = {
      id: randomId(),
      number: dealNumber(new Date(ctx.now()).getFullYear(), seq, P.numbering()),
      clientId: client.id,
      type: 'renewal',
      stage: 'lead',
      ownerId: owner.id,
      expectedStart: addDays(policy.endDate, 1),
      previousPolicyId: policy.id,
      createdAt: now,
      updatedAt: now,
    };
    await ctx.repos.deals.insert(deal, { at: 'start' });
    const ends = policy.endDate.split('-').reverse().join('.');
    await dealEvent(ctx, deal.id, SYSTEM_ACTOR.displayName, `Сделка на продление открыта автоматически: полис ${policy.number} действует до ${ends}`);
    await audit(ctx, SYSTEM_ACTOR, 'lead_created', { targetType: 'deal', targetId: deal.id, targetLabel: `${deal.number}: ${client.name} (продление)` });
    await notify(ctx, owner.id, msg('next.notify.renewalDeal', { number: deal.number, client: client.name, date: ends }), `/staff/deals/${deal.id}`);
    opened += 1;
  }
  return opened;
}

// ---------------------------------------------------------------- staff directory and authority (§2)

export async function staffDirectory(ctx: AuthCtx): Promise<StaffDirectoryItem[]> {
  requireMig(ctx);
  return (await ctx.repos.staff.list({ where: { active: true } })).map((s) => ({ id: s.id, fullName: s.fullName, role: s.role, authority: s.authority, canSign: s.signatory?.canSign === true }));
}

export async function listAuthorityChanges(ctx: AuthCtx): Promise<AuthorityChange[]> {
  const user = requireMig(ctx);
  if (!can(user, 'staff.authority.manage') && !can(user, 'staff.authority.manage', { sub: 'approve' })) throw forbidden();
  return ctx.repos.authorityChanges.list({ limit: 50 });
}

export async function proposeAuthority(ctx: AuthCtx, staffId: string, body: unknown): Promise<AuthorityChange> {
  const user = requireMig(ctx);
  requirePermission(user, 'staff.authority.manage');
  const target = await staffRow(ctx, staffId);
  const input = validate(authorityChangeSchema, body);
  if (await ctx.repos.authorityChanges.exists({ staffId: target.id, status: 'pending' })) throw conflict('srv.authority.alreadyPending');
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
    proposedAt: tzIso(ctx.now()),
  };
  await ctx.repos.authorityChanges.insert(change, { at: 'start' });
  await audit(ctx, user, 'authority_proposed', {
    targetType: 'user',
    targetId: target.id,
    targetLabel: `${target.fullName}: ${authorityText(change.from.authority, change.from.signatory)} → ${authorityText(to.authority, to.signatory)}`,
    reason: input.reason,
  });
  return change;
}

/** Approval or rejection of a proposed change (four eyes); a rejection carries a reason in `body`. */
export async function decideAuthority(ctx: AuthCtx, id: string, kind: 'approve' | 'reject', body?: unknown): Promise<AuthorityChange> {
  const user = requireMig(ctx);
  const c = await ctx.repos.authorityChanges.get(id);
  if (!c) throw notFound();
  if (!can(user, 'staff.authority.manage', { sub: 'approve', createdById: c.proposedById })) throw forbidden();
  if (c.status !== 'pending') throw conflict('srv.change.alreadyReviewed');
  if (kind === 'approve' && (c.proposedById === user.id || c.staffId === user.id)) {
    throw new DomainError(403, 'forbidden', 'srv.authority.fourEyes');
  }
  const target = await staffRow(ctx, c.staffId);
  const at = tzIso(ctx.now());
  if (kind === 'approve') {
    // Sessions carry authority and the signatory flag: the user gets the new rights at the next request.
    await ctx.repos.staff.update(target.id, { authority: c.to.authority, signatory: c.to.signatory ?? undefined });
    Object.assign(c, { status: 'applied', decidedByName: user.displayName, decidedAt: at });
    await ctx.repos.authorityChanges.put(c);
    await audit(ctx, user, 'authority_changed', {
      targetType: 'user',
      targetId: target.id,
      targetLabel: `${target.fullName}: ${authorityText(c.from.authority, c.from.signatory)} → ${authorityText(c.to.authority, c.to.signatory)}`,
      reason: `Предложил ${c.proposedByName}: ${c.reason}`,
    });
  } else {
    const { reason } = validate(authorityRejectSchema, body);
    Object.assign(c, { status: 'rejected', decidedByName: user.displayName, decidedAt: at, rejectReason: reason });
    await ctx.repos.authorityChanges.put(c);
    await audit(ctx, user, 'authority_rejected', { targetType: 'user', targetId: target.id, targetLabel: target.fullName, reason });
  }
  return c;
}

// ---------------------------------------------------------------- leads (§3)

export async function listLeads(ctx: AuthCtx) {
  const user = requireMig(ctx);
  if (!can(user, 'leads.manage') && !can(user, 'leads.manage', { sub: 'read' })) throw forbidden();
  const out = [];
  for (const c of await ctx.repos.clients.list({ where: { status: 'lead' } })) out.push(await toClient(ctx, c));
  return out;
}

export async function createLead(ctx: AuthCtx, body: unknown): Promise<DealView> {
  const user = requireMig(ctx);
  requirePermission(user, 'leads.manage');
  const input = validate(leadCreateSchema, body);
  const P = await loadParams(ctx);
  // DMS only for companies: a form outside `allowedLegalForms` is not saved.
  const formProblem = legalFormProblem(input.legalForm, P.groupRules());
  if (formProblem) throw new DomainError(422, 'validation', 'errors.validation', { fields: { legalForm: formProblem } });
  if (await ctx.repos.clients.exists({ inn: input.inn })) throw new DomainError(409, 'conflict', 'srv.clients.innTaken', { fields: { inn: msg('srv.clients.innInDb') } });
  const now = tzIso(ctx.now());
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
  await ctx.repos.clients.insert(client, { at: 'start' });
  const seq = await ctx.repos.seq.next('deal');
  const deal: Deal = {
    id: randomId(),
    number: dealNumber(new Date(ctx.now()).getFullYear(), seq, P.numbering()),
    clientId: client.id,
    type: 'new',
    stage: 'lead',
    ownerId: user.id,
    expectedStart: input.expectedStart,
    createdAt: now,
    updatedAt: now,
  };
  await ctx.repos.deals.insert(deal, { at: 'start' });
  await dealEvent(ctx, deal.id, user.displayName, `Лид создан: ${client.name}, около ${input.estimatedHeadcount} сотрудников`);
  await audit(ctx, user, 'lead_created', { targetType: 'deal', targetId: deal.id, targetLabel: `${deal.number}: ${client.name}` });
  return toDealView(ctx, deal);
}

// ---------------------------------------------------------------- deals (§3)

export async function listDeals(ctx: AuthCtx, qs: URLSearchParams): Promise<DealView[]> {
  const user = requireMig(ctx);
  readDeals(user);
  const owner = qs.get('ownerId');
  const type = qs.get('type');
  const list = await ctx.repos.deals.list({ where: allOf<Deal>(owner && { ownerId: owner }, (type === 'new' || type === 'renewal') && { type }) });
  // The view of each deal (client, owner, the premium of its quote or contract) and the sort by it: deals are about
  // one per client and year.
  const all: DealView[] = [];
  for (const x of list) all.push(await toDealView(ctx, x));
  const views = filterLegalForm(all, qs, (x) => x.clientLegalForm);
  return sortBy(views, qs, {
    number: (x) => x.number,
    clientName: byLegalName((x) => x.clientName),
    legalForm: byLegalForm((x) => x.clientLegalForm),
    stage: (x) => x.stage,
    ownerName: (x) => x.ownerName,
    premium: (x) => x.premium,
    expectedStart: (x) => x.expectedStart,
  });
}

export async function getDeal(ctx: AuthCtx, id: string): Promise<DealCard> {
  const user = requireMig(ctx);
  readDeals(user);
  const deal = await dealOf(ctx, id);
  return dealCard(ctx, deal.id);
}

export async function patchDeal(ctx: AuthCtx, id: string, body: unknown): Promise<DealCard> {
  const user = requireMig(ctx);
  requirePermission(user, 'deals.manage');
  const deal = await dealOf(ctx, id);
  const input = validate(dealPatchSchema, body);
  if (input.underwriterId && (await ctx.repos.staff.get(input.underwriterId))?.role !== 'underwriter') {
    throw new DomainError(422, 'validation', 'srv.deal.chooseUnderwriter', { fields: { underwriterId: msg('srv.deal.chooseUnderwriter') } });
  }
  if (input.expectedStart) await ctx.repos.deals.update(deal.id, { expectedStart: input.expectedStart });
  if (input.underwriterId) {
    await ctx.repos.deals.update(deal.id, { underwriterId: input.underwriterId });
    await dealEvent(ctx, deal.id, user.displayName, `Андеррайтер: ${await staffName(ctx, input.underwriterId)}`);
  }
  await ctx.repos.deals.update(deal.id, { updatedAt: tzIso(ctx.now()) });
  return dealCard(ctx, deal.id);
}

/** «Сделка проиграна» with a reason. */
export async function loseDeal(ctx: AuthCtx, id: string, body: unknown): Promise<DealCard> {
  const user = requireMig(ctx);
  requirePermission(user, 'deals.manage');
  const deal = await dealOf(ctx, id);
  if (deal.stage === 'active' || deal.stage === 'lost') throw conflict('srv.deal.alreadyClosed');
  const { reason } = validate(dealLostSchema, body);
  await ctx.repos.deals.update(deal.id, { stage: 'lost', lostReason: reason, updatedAt: tzIso(ctx.now()) });
  await dealEvent(ctx, deal.id, user.displayName, `Сделка проиграна: ${reason}`);
  await audit(ctx, user, 'deal_lost', { targetType: 'deal', targetId: deal.id, targetLabel: deal.number, reason });
  return dealCard(ctx, deal.id);
}

// ---------------------------------------------------------------- census (§4)

/** `text`: the CSV file as uploaded. */
export async function uploadCensus(
  ctx: AuthCtx,
  id: string,
  text: string,
): Promise<{ census: { id: string; dealId: string; rows: CensusParseResult['rows']; uploadedAt: string }; errors: CensusParseResult['errors']; dropped: CensusParseResult['dropped'] }> {
  const user = requireMig(ctx);
  requirePermission(user, 'census.upload');
  const deal = await dealOf(ctx, id);
  if (deal.stage === 'lost' || deal.stage === 'active') throw conflict('srv.deal.closed');
  if (text.length > CENSUS_MAX_BYTES) throw new DomainError(413, 'validation', 'srv.file.tooLarge1mb');
  const parsed = parseCensusCsv(text, todayIso(ctx));
  if (!parsed.rows.length) throw parsed.errors[0] ? errorOf(422, 'validation', parsed.errors[0].message) : new DomainError(422, 'validation', 'srv.census.noRows');
  // Names, PINFL and phones are not accepted at this stage: such columns were dropped by the parser.
  const c = { id: randomId(), dealId: deal.id, rows: parsed.rows, uploadedAt: tzIso(ctx.now()) };
  await ctx.repos.censuses.insert(c);
  await moveDeal(ctx, deal.id, 'census', user.displayName, `Загружены данные для оценки: ${parsed.rows.length} человек${parsed.dropped.length ? `, отброшены столбцы с ПДн: ${parsed.dropped.length}` : ''}`);
  await audit(ctx, user, 'census_uploaded', { targetType: 'deal', targetId: deal.id, targetLabel: `${deal.number}: ${parsed.rows.length} строк` });
  await completeTasks(ctx, 'census_upload', { dealId: deal.id, clientId: deal.clientId }, user.displayName);
  return { census: c, errors: parsed.errors, dropped: parsed.dropped };
}

// ---------------------------------------------------------------- quotes (§5)

export async function createQuote(ctx: AuthCtx, body: unknown): Promise<QuoteView> {
  const user = requireMig(ctx);
  requirePermission(user, 'quotes.calculate');
  const input = validate(quoteCreateSchema, body);
  const deal = await dealOf(ctx, input.dealId);
  if (deal.stage === 'lost' || deal.stage === 'active') throw conflict('srv.deal.closed');
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
    pricingBasis: input.pricingBasis,
    ageBandRates: [],
    status: 'draft',
    approvals: [],
    createdById: user.id,
    createdByName: user.displayName,
  };
  await recalc(ctx, q, input.program, input.adjustments, input.pricingBasis);
  await ctx.repos.quotes.insert(q);
  if (!deal.underwriterId) await ctx.repos.deals.update(deal.id, { underwriterId: user.id });
  await moveDeal(ctx, deal.id, 'quote', user.displayName, `Котировка: программа ${PROGRAMS[q.program].name}, премия ${q.total}`);
  await audit(ctx, user, 'quote_saved', { targetType: 'quote', targetId: q.id, targetLabel: deal.number });
  await completeTasks(ctx, 'quote_calculate', { dealId: deal.id, clientId: deal.clientId }, user.displayName);
  return quoteView(ctx, q, user);
}

export async function getQuote(ctx: AuthCtx, id: string): Promise<QuoteView> {
  const user = requireMig(ctx);
  if (!can(user, 'quotes.calculate') && !can(user, 'deals.manage')) throw forbidden();
  return quoteView(ctx, await quoteOf(ctx, id), user);
}

export async function patchQuote(ctx: AuthCtx, id: string, body: unknown): Promise<QuoteView> {
  const user = requireMig(ctx);
  requirePermission(user, 'quotes.calculate');
  const q = await quoteOf(ctx, id);
  if (q.status !== 'draft' && q.status !== 'rejected') throw conflict('srv.quote.locked');
  const input = validate(quotePatchSchema, body);
  await recalc(ctx, q, input.program, input.adjustments, input.pricingBasis ?? q.pricingBasis);
  q.status = 'draft';
  await ctx.repos.quotes.put(q);
  await audit(ctx, user, 'quote_saved', { targetType: 'quote', targetId: q.id, targetLabel: (await dealOf(ctx, q.dealId)).number });
  return quoteView(ctx, q, user);
}

export async function submitQuote(ctx: AuthCtx, id: string): Promise<QuoteView> {
  const user = requireMig(ctx);
  requirePermission(user, 'quotes.calculate');
  const q = await quoteOf(ctx, id);
  if (q.status !== 'draft' && q.status !== 'rejected') throw conflict('srv.quote.alreadySent');
  const deal = await dealOf(ctx, q.dealId);
  const author = await ctx.repos.staff.get(user.id);
  const group = await quoteGroup(ctx, deal.id, await loadParams(ctx));
  const problem = quoteAuthorityProblem(q, author?.authority, group) ?? (group.below ? msg('dom.quote.belowMinGroup', { n: group.size, min: group.min }) : null);
  const at = tzIso(ctx.now());
  // Below the minimal group a quote is never approved by its author: an exception needs a second person.
  if (!problem && can(user, 'quotes.approve')) {
    q.status = 'approved';
    q.approvals = [{ byId: user.id, byName: user.displayName, at, comment: 'В пределах полномочий' }];
    await ctx.repos.quotes.put(q);
    await dealEvent(ctx, deal.id, user.displayName, 'Котировка утверждена в пределах полномочий андеррайтера');
    await audit(ctx, user, 'quote_approved', { targetType: 'quote', targetId: q.id, targetLabel: deal.number });
  } else {
    q.status = 'pending_approval';
    await ctx.repos.quotes.put(q);
    await dealEvent(ctx, deal.id, user.displayName, `Котировка на согласовании: ${problem ?? 'нужно согласование'}`);
    await audit(ctx, user, 'quote_submitted', { targetType: 'quote', targetId: q.id, targetLabel: deal.number, reason: problem ?? undefined });
  }
  return quoteView(ctx, q, user);
}

export async function approveQuote(ctx: AuthCtx, id: string, body: unknown): Promise<QuoteView> {
  const user = requireMig(ctx);
  requirePermission(user, 'quotes.approve');
  const q = await quoteOf(ctx, id);
  if (q.status !== 'pending_approval') throw conflict('srv.quote.notPending');
  const approver = (await ctx.repos.staff.get(user.id))!;
  if (q.createdById === user.id) throw new DomainError(403, 'forbidden', 'srv.quote.fourEyes');
  const group = await quoteGroup(ctx, q.dealId, await loadParams(ctx));
  if (!canApproveQuote(approver, q, group)) throw new DomainError(403, 'forbidden', group.below && !approver.authority?.allowBelowMinGroup ? 'srv.quote.belowMinGroup' : 'srv.quote.overAuthority');
  const { comment } = validate(quoteApproveSchema, body);
  // An exception below the minimal group: the comment is mandatory and stays on the quote.
  if (group.below && !comment) throw new DomainError(422, 'validation', 'srv.quote.belowMinComment', { fields: { comment: msg('srv.quote.belowMinComment') } });
  q.status = 'approved';
  const approvedAt = tzIso(ctx.now());
  q.approvals.push({ byId: user.id, byName: user.displayName, at: approvedAt, ...(comment ? { comment } : {}) });
  if (group.below && comment) q.belowMinException = { byName: user.displayName, at: approvedAt, comment };
  await ctx.repos.quotes.put(q);
  const deal = await dealOf(ctx, q.dealId);
  await dealEvent(ctx, deal.id, user.displayName, 'Котировка утверждена');
  await audit(ctx, user, 'quote_approved', { targetType: 'quote', targetId: q.id, targetLabel: deal.number, reason: comment });
  await completeTasks(ctx, 'quote_approve', { dealId: deal.id, clientId: deal.clientId }, user.displayName);
  return quoteView(ctx, q, user);
}

export async function rejectQuote(ctx: AuthCtx, id: string, body: unknown): Promise<QuoteView> {
  const user = requireMig(ctx);
  requirePermission(user, 'quotes.approve');
  const q = await quoteOf(ctx, id);
  if (q.status !== 'pending_approval') throw conflict('srv.quote.notPending');
  if (q.createdById === user.id) throw forbidden();
  const { reason } = validate(quoteRejectSchema, body);
  q.status = 'rejected';
  q.rejectReason = reason;
  await ctx.repos.quotes.put(q);
  const deal = await dealOf(ctx, q.dealId);
  await dealEvent(ctx, deal.id, user.displayName, `Котировка отклонена: ${reason}`);
  await audit(ctx, user, 'quote_rejected', { targetType: 'quote', targetId: q.id, targetLabel: deal.number, reason });
  return quoteView(ctx, q, user);
}

// ---------------------------------------------------------------- the offer from an approved quote (§6)

export async function sendDealKp(ctx: AuthCtx, id: string): Promise<KpDocument> {
  const user = requireMig(ctx);
  requirePermission(user, 'kp.send');
  const deal = await dealOf(ctx, id);
  const q = await latestQuote(ctx, deal.id);
  if (!q || q.status !== 'approved') throw conflict('srv.kp.needsApprovedQuote');
  const client = await clientRow(ctx, deal.clientId);
  const P = await loadParams(ctx);
  const today = todayIso(ctx);
  const start = deal.expectedStart && deal.expectedStart >= today ? deal.expectedStart : defaultStartDate(today);
  const c = await census(ctx, deal.id);
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
    validUntil: isoDay(ctx.now() + P.dmsParam('kpValidityDays') * DAY),
    paymentTerms: 'single',
    assistanceId: (await ctx.repos.assistances.first())?.id ?? null,
  };
  await ctx.repos.kp.updateWhere({ dealId: deal.id, status: 'sent' }, { status: 'revoked' });
  const seq = await ctx.repos.seq.next('kp');
  const now = ctx.now();
  const kp: KpDocument = {
    id: randomId(),
    number: kpNumber(new Date(now).getFullYear(), seq, P.numbering()),
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
    createdByEmail: (await ctx.repos.staff.get(user.id))?.email ?? '',
    createdAt: tzIso(now),
    sentAt: tzIso(now),
    dealId: deal.id,
    quoteId: q.id,
  };
  await ctx.repos.kp.insert(kp, { at: 'start' });
  if (client.status === 'lead') await ctx.repos.clients.update(client.id, { status: 'negotiation' });
  // The client's contact gets the HR cabinet to answer the offer and sign the contract (demo password).
  if (!(await ctx.repos.hrUsers.exists({ companyId: client.id }))) {
    const hr = { id: randomId(), email: client.hrContact.email, password: DEMO_PASSWORD, fullName: client.hrContact.name, companyId: client.id };
    await ctx.repos.hrUsers.insert(hr);
    await issueInvitation(ctx, hr, user);
    await dealEvent(ctx, deal.id, user.displayName, `Контакту клиента открыт кабинет HR (${client.hrContact.email})`);
  }
  await moveDeal(ctx, deal.id, 'kp_sent', user.displayName, `КП ${kp.number} отправлено клиенту`);
  await audit(ctx, user, 'kp_sent', { targetType: 'kp', targetId: kp.id, targetLabel: kp.number });
  await completeTasks(ctx, 'kp_send', { dealId: deal.id, clientId: deal.clientId }, user.displayName);
  return kp;
}

/** The client's answer to a sent offer: HR in its cabinet, or the sales manager by the client's e-mail. */
export async function respondKp(ctx: AuthCtx, id: string, kind: 'accept' | 'decline', body?: unknown): Promise<KpDocument> {
  const { user } = ctx;
  const kp = await ctx.repos.kp.get(id);
  if (!kp) throw notFound();
  // HR answers for its own company; the sales manager marks the answer received by e-mail.
  if (user.role === 'hr') {
    if (!can(user, 'kp.respond', { companyId: kp.clientId })) throw notFound();
  } else if (!can(user, 'kp.respond', { sub: 'manual' })) throw forbidden();
  if (kp.status !== 'sent') throw conflict('srv.kp.answerSentOnly');
  const reason = kind === 'decline' ? validate(kpDeclineSchema, body).reason : undefined;
  kp.status = kind === 'accept' ? 'accepted' : 'declined';
  kp.response = { at: tzIso(ctx.now()), byName: user.displayName, via: user.role === 'hr' ? 'hr' : 'manager', ...(reason ? { reason } : {}) };
  await ctx.repos.kp.update(kp.id, { status: kp.status, response: kp.response });
  await openRenewalDeal(ctx, kp, user);
  if (kind === 'accept' && kp.dealId) await completeTasks(ctx, 'kp_respond', { dealId: kp.dealId, clientId: kp.clientId }, user.displayName);
  if (kind === 'accept') await moveDeal(ctx, kp.dealId, 'kp_accepted', user.displayName, `КП ${kp.number} принято клиентом${user.role === 'hr' ? ' в кабинете' : ' (отметка менеджера)'}`);
  else if (kp.dealId) await dealEvent(ctx, kp.dealId, user.displayName, `КП ${kp.number} отклонено: ${reason}`);
  await audit(ctx, user, kind === 'accept' ? 'kp_accepted' : 'kp_declined', { targetType: 'kp', targetId: kp.id, targetLabel: kp.number, reason });
  return kp;
}
