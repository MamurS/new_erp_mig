/*
 * Clients and policies of the staff portal: the client list with views and the premium total, the card
 * (claims by month and category, activity), loss statistics for the underwriter, the client's insured,
 * documents and history; the policy list and card.
 */
import { clientCreateSchema, clientPatchSchema } from '@mig/contracts/forms';
import type { ClientDetail, ClientListResponse, ClientLossStats, InsuredListItem, PolicyDetail } from '@mig/contracts/dto';
import type { AuditEntry, Client, ClientDocument, Policy } from '@mig/contracts';
import { can } from '../auth/permissions';
import { CLAIM_CATEGORY_LABEL } from '../claims';
import { formatMoney } from '../lib/format';
import { randomId } from '../lib/random';
import { parseIso, tzIso } from '../lib/time';
import { legalFormProblem } from '../minGroup';
import { PROGRAMS } from '../programs';
import type { ClaimRow, ClientRow, InsuredRow } from '../store/db';
import type { ComputedFields } from '../store/computed';
import type { Where } from '../store/query';

type ClientQ = ClientRow & ComputedFields['clients'];
type PolicyQ = Policy & ComputedFields['policies'];
import type { ClaimFigure } from '../store/facts';
import { DomainError, notFound, requirePermission, validate, type AuthCtx, type BaseCtx } from './kernel';
import { allOf, legalFormWhere, pageOf, q, searchWhere, sortParam } from './list';
import { loadParams } from './params';
import { clientLegalFormOf, toClient, toInsuredListItems } from './views';
import { hasLiveKp, renewalsWithoutOffer } from './dashboard';

export async function findClient(ctx: BaseCtx, id: string): Promise<ClientRow> {
  const c = await ctx.repos.clients.get(id);
  if (!c) throw notFound();
  return c;
}

/** The last 12 months (`YYYY-MM`), the oldest first. */
function lastMonths(now: number): string[] {
  const out: string[] = [];
  for (let k = 11; k >= 0; k--) {
    const dt = new Date(now);
    dt.setDate(1);
    dt.setMonth(dt.getMonth() - k);
    out.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function byCategory<C extends Pick<ClaimRow, 'category'>>(claims: readonly C[], amountOf: (x: C) => number): { category: string; count: number; amount: number }[] {
  const byCat = new Map<string, { count: number; amount: number }>();
  for (const x of claims) {
    const e = byCat.get(x.category) ?? { count: 0, amount: 0 };
    e.count += 1;
    e.amount += amountOf(x);
    byCat.set(x.category, e);
  }
  return [...byCat.entries()].map(([category, v]) => ({ category: CLAIM_CATEGORY_LABEL[category as keyof typeof CLAIM_CATEGORY_LABEL] ?? category, ...v }));
}

// ---------------------------------------------------------------- endpoints

export async function listClients(ctx: AuthCtx, qs: URLSearchParams): Promise<ClientListResponse> {
  const { user } = ctx;
  requirePermission(user, 'clients.read');
  const P = await loadParams(ctx);
  const now = ctx.now();
  const term = q(qs);
  const status = qs.get('status');
  const program = qs.get('program');
  const managerId = qs.get('managerId');
  const view = qs.get('view');
  const y = new Date(now).getFullYear();
  const warn = P.dmsParam('lossRatioWarn');
  // `(lossRatio ?? 0) >= warn`: a client without a ratio counts as 0.
  const loss: Where<ClientQ> = warn <= 0 ? { $or: [{ lossRatio: { gte: warn } }, { lossRatio: { isNull: true } }] } : { lossRatio: { gte: warn } };
  const where = allOf<ClientQ>(
    term && { $or: [{ name: { search: term } }, { inn: { contains: term.trim() } }] },
    status && { status: { in: status.split(',') as ClientRow['status'][] } },
    program && { program: { in: program.split(',') as NonNullable<ClientRow['program']>[] } },
    managerId && { managerId },
    legalFormWhere<ClientQ>(qs, 'legalForm'),
    view === 'mine' && { managerId: user.id },
    view === 'q4' && { renewalDate: { gte: `${y}-10-01`, lte: `${y}-12-31` } },
    view === 'loss' && loss,
    view === 'renewals' && { id: { in: (await renewalsWithoutOffer(ctx, now)).map((c) => c.id) } },
  );
  const orderBy = sortParam<ClientQ>(
    qs,
    {
      name: { field: 'name', collate: 'legal' },
      legalForm: { field: 'legalFormOrd' },
      program: { field: 'program', collate: 'ru', ifNull: '' },
      insuredCount: { field: 'insuredCount' },
      premium: { field: 'premium' },
      renewalDate: { field: 'renewalDate' },
      lossRatio: { field: 'lossRatio' },
      managerName: { field: 'managerName', collate: 'ru' },
      status: { field: 'status', collate: 'ru' },
    },
    'name:asc',
  );
  const page = await pageOf(ctx.repos.clients, qs, { where, orderBy });
  const items: Client[] = [];
  for (const c of page.items) items.push(await toClient(ctx, c));
  return { ...page, items, totalPremium: await ctx.repos.clients.sum('premium', where) };
}

export async function createClient(ctx: AuthCtx, body: unknown): Promise<Client> {
  const { user } = ctx;
  requirePermission(user, 'clients.write');
  const input = validate(clientCreateSchema, body);
  // DMS only for companies: a form outside `allowedLegalForms` is not saved.
  const formProblem = legalFormProblem(input.legalForm, (await loadParams(ctx)).groupRules());
  if (formProblem) throw new DomainError(422, 'validation', 'errors.validation', { fields: { legalForm: formProblem } });
  const row: ClientRow = {
    id: randomId(),
    legalForm: input.legalForm,
    name: input.name,
    inn: input.inn,
    status: input.status,
    managerId: user.id,
    managerName: user.displayName,
    hrContact: { name: '—', phone: '+998000000000', email: 'hr@example.uz' },
    assistanceId: null,
    premium: 0,
    lossRatio: null,
    createdAt: tzIso(ctx.now()),
  };
  await ctx.repos.clients.insert(row, { at: 'start' });
  return toClient(ctx, row);
}

export async function lossStats(ctx: AuthCtx, id: string): Promise<ClientLossStats> {
  requirePermission(ctx.user, 'clients.read');
  const c = await findClient(ctx, id);
  const P = await loadParams(ctx);
  // Only the anonymous figures of the client's claims (app.fact_client_claim_figures): the reader may not read claims.
  const claims = (await ctx.repos.facts.clientClaimFigures(c.id)).filter((x) => x.status !== 'rejected');
  const amountOf = (x: ClaimFigure) => x.amountApproved ?? x.amountClaimed;
  const byMonth: ClientLossStats['byMonth'] = lastMonths(ctx.now()).map((key) => {
    const inMonth = claims.filter((x) => x.serviceDate.startsWith(key));
    return { month: key, count: inMonth.length, amount: inMonth.reduce((sum, x) => sum + amountOf(x), 0) };
  });
  // Only sums and counts: no claim numbers, insured names or diagnoses (the underwriter's view).
  return {
    clientId: c.id,
    clientName: c.name,
    clientLegalForm: c.legalForm,
    premium: c.premium,
    lossRatio: c.lossRatio,
    lossRatioWarn: P.dmsParam('lossRatioWarn'),
    claimsCount: claims.length,
    claimsAmount: claims.reduce((sum, x) => sum + amountOf(x), 0),
    byCategory: byCategory(claims, amountOf).sort((a, b) => b.amount - a.amount),
    byMonth,
  };
}

export async function clientDetail(ctx: AuthCtx, id: string): Promise<ClientDetail> {
  const { user } = ctx;
  requirePermission(user, 'clients.read');
  const r = ctx.repos;
  const c = await findClient(ctx, id);
  // Figures of the claims, the last invoice and the policy come as narrow facts (store/facts.ts); a claim number
  // only for a role that reads claims, from its own query.
  const claims = await r.facts.clientClaimFigures(c.id);
  const amountOf = (x: ClaimFigure) => x.amountApproved ?? x.amountClaimed;
  const months: ClientDetail['claimsByMonth'] = lastMonths(ctx.now()).map((key) => {
    const inMonth = claims.filter((x) => x.createdAt.startsWith(key));
    return { month: key, count: inMonth.length, amount: inMonth.reduce((s, x) => s + amountOf(x), 0) };
  });
  const activity: ClientDetail['activity'] = [];
  const policy = c.activePolicyId ? await r.facts.policyBrief(c.activePolicyId) : null;
  for (const k of await r.kp.list({ where: { clientId: c.id } })) {
    activity.push({ at: k.createdAt, text: `Подготовлено ${k.number}` });
    if (k.sentAt) activity.push({ at: k.sentAt, text: `${k.number} отправлено клиенту` });
  }
  // A claim number is a single claim: only roles that read claims see it.
  if (claims.length && can(user, 'claims.read')) {
    const lastClaim = [...(await r.claims.list({ where: { clientId: c.id } }))].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    if (lastClaim) activity.push({ at: lastClaim.createdAt, text: `Новый убыток ${lastClaim.number}` });
  }
  const lastInv = [...(await r.facts.clientInvoiceFigures(c.id))].sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1))[0];
  if (lastInv) activity.push({ at: tzIso(parseIso(lastInv.issuedAt)), text: `Выставлен счёт ${lastInv.number} на ${formatMoney(lastInv.amount)}` });
  if (policy) activity.push({ at: tzIso(parseIso(policy.startDate)), text: `Начало действия полиса ${policy.number}` });
  for (const e of c.log ?? []) activity.push(e);
  activity.push({ at: c.createdAt, text: 'Клиент добавлен в систему' });
  return {
    ...(await toClient(ctx, c)),
    claimsByMonth: months,
    claimsByCategory: byCategory(claims, amountOf),
    activity: activity.sort((a, b) => (a.at < b.at ? 1 : -1)),
    hasRenewalOffer: await hasLiveKp(ctx, c.id),
  };
}

export async function patchClient(ctx: AuthCtx, id: string, body: unknown): Promise<Client> {
  requirePermission(ctx.user, 'clients.write');
  await findClient(ctx, id);
  const patch = validate(clientPatchSchema, body);
  return toClient(ctx, await ctx.repos.clients.update(id, patch));
}

export async function clientInsured(ctx: AuthCtx, id: string, qs: URLSearchParams): Promise<{ items: InsuredListItem[]; total: number; page: number; pageSize: number }> {
  const { user } = ctx;
  requirePermission(user, 'clients.read');
  requirePermission(user, 'insured.read');
  const c = await findClient(ctx, id);
  const term = q(qs);
  const page = await pageOf(ctx.repos.insured, qs, {
    where: allOf<InsuredRow>({ clientId: c.id }, term && { fullName: { search: term } }),
    orderBy: sortParam<InsuredRow>(qs, { fullName: { field: 'fullName', collate: 'ru' }, position: { field: 'position', collate: 'ru' } }, 'fullName:asc'),
  });
  return { ...page, items: await toInsuredListItems(ctx, page.items, user) };
}

export async function clientDocuments(ctx: AuthCtx, id: string): Promise<ClientDocument[]> {
  requirePermission(ctx.user, 'clients.read');
  const c = await findClient(ctx, id);
  return (await ctx.repos.documents.list({ where: { clientId: c.id } })).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Audit of the client, its policies, claims and offers, without personal-data and medical openings. */
export async function clientHistory(ctx: AuthCtx, id: string): Promise<AuditEntry[]> {
  requirePermission(ctx.user, 'clients.read');
  const c = await findClient(ctx, id);
  // The reader may not read the audit log: the entries about the client come from app.fact_client_history.
  return ctx.repos.facts.clientHistory(c.id, 50);
}

/** «Письмо HR» (imitation): the text is not stored. */
export async function hrLetter(ctx: AuthCtx, id: string): Promise<{ ok: true }> {
  requirePermission(ctx.user, 'clients.read');
  await findClient(ctx, id);
  return { ok: true as const };
}

// ---------------------------------------------------------------- policies

export async function listPolicies(ctx: AuthCtx, qs: URLSearchParams) {
  const { user } = ctx;
  requirePermission(user, 'policies.read');
  if (user.role === 'hr' || user.role === 'insured') throw notFound();
  const term = q(qs);
  const status = qs.get('status');
  const program = qs.get('program');
  const clientId = qs.get('clientId');
  const page = await pageOf(ctx.repos.policies, qs, {
    where: allOf<PolicyQ>(
      term && searchWhere<PolicyQ>(term, ['number', 'clientName']),
      status && { status: { in: status.split(',') as Policy['status'][] } },
      program && { program: { in: program.split(',') as Policy['program'][] } },
      clientId && { clientId },
      legalFormWhere<PolicyQ>(qs, 'clientLegalForm'),
    ),
    orderBy: sortParam<PolicyQ>(
      qs,
      {
        number: { field: 'number', collate: 'ru' },
        clientName: { field: 'clientName', collate: 'legal' },
        legalForm: { field: 'clientLegalFormOrd' },
        program: { field: 'program', collate: 'ru' },
        startDate: { field: 'startDate' },
        endDate: { field: 'endDate' },
        premium: { field: 'premium' },
        insuredCount: { field: 'insuredCount' },
        status: { field: 'status', collate: 'ru' },
      },
      'endDate:asc',
    ),
  });
  const items: (Policy & { clientLegalForm: Awaited<ReturnType<typeof clientLegalFormOf>> })[] = [];
  for (const p of page.items) items.push({ ...p, clientLegalForm: await clientLegalFormOf(ctx, p.clientId) });
  return { ...page, items };
}

export async function policyDetail(ctx: AuthCtx, id: string): Promise<PolicyDetail> {
  const { user } = ctx;
  requirePermission(user, 'policies.read');
  if (user.role === 'hr' || user.role === 'insured') throw notFound();
  const p = await ctx.repos.policies.get(id);
  if (!p) throw notFound();
  return {
    ...p,
    clientLegalForm: await clientLegalFormOf(ctx, p.clientId),
    programInfo: PROGRAMS[p.program],
    documents: (await ctx.repos.documents.list({ where: { clientId: p.clientId } })).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
  };
}
