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
import { matchesSearch } from '../lib/searchNormalize';
import { randomId } from '../lib/random';
import { parseIso, tzIso } from '../lib/time';
import { legalFormProblem } from '../minGroup';
import { PROGRAMS } from '../programs';
import type { ClaimRow, ClientRow } from '../store/db';
import { DomainError, notFound, requirePermission, systemRepos, validate, type AuthCtx, type BaseCtx } from './kernel';
import { byLegalForm, byLegalName, filterLegalForm, paginate, q, sortBy } from './list';
import { loadParams } from './params';
import { clientLegalFormOf, toClient, toInsuredListItem } from './views';
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

function byCategory(claims: readonly ClaimRow[], amountOf: (x: ClaimRow) => number): { category: string; count: number; amount: number }[] {
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
  let list = await ctx.repos.clients.list();
  const term = q(qs);
  if (term) list = list.filter((c) => matchesSearch(term, c.name) || c.inn.includes(term.trim()));
  const status = qs.get('status');
  if (status) list = list.filter((c) => status.split(',').includes(c.status));
  const program = qs.get('program');
  if (program) list = list.filter((c) => c.program && program.split(',').includes(c.program));
  const managerId = qs.get('managerId');
  if (managerId) list = list.filter((c) => c.managerId === managerId);
  list = filterLegalForm(list, qs, (c) => c.legalForm);
  const view = qs.get('view');
  if (view === 'mine') list = list.filter((c) => c.managerId === user.id);
  if (view === 'q4') {
    const y = new Date(now).getFullYear();
    list = list.filter((c) => c.renewalDate && c.renewalDate >= `${y}-10-01` && c.renewalDate <= `${y}-12-31`);
  }
  if (view === 'loss') list = list.filter((c) => (c.lossRatio ?? 0) >= P.dmsParam('lossRatioWarn'));
  if (view === 'renewals') {
    const ids = new Set((await renewalsWithoutOffer(ctx, now)).map((c) => c.id));
    list = list.filter((c) => ids.has(c.id));
  }
  const mapped: Client[] = [];
  for (const c of list) mapped.push(await toClient(ctx, c));
  const sorted = sortBy(
    mapped,
    qs,
    {
      name: byLegalName((c) => c.name),
      legalForm: byLegalForm((c) => c.legalForm),
      program: (c) => c.program ?? '',
      insuredCount: (c) => c.insuredCount,
      premium: (c) => c.premium,
      renewalDate: (c) => (c.renewalDate ? parseIso(c.renewalDate) : null),
      lossRatio: (c) => c.lossRatio,
      managerName: (c) => c.managerName,
      status: (c) => c.status,
    },
    'name:asc',
  );
  return { ...paginate(sorted, qs), totalPremium: mapped.reduce((s, c) => s + c.premium, 0) };
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
  const claims = await systemRepos(ctx, 'loss statistics of a client: counts and sums only').claims.list({ where: { clientId: c.id, status: { ne: 'rejected' } } });
  const amountOf = (x: ClaimRow) => x.amountApproved ?? x.amountClaimed;
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
  const sys = systemRepos(ctx, 'client card: claims by month and category, the last invoice (aggregates; a claim number only with claims.read)');
  const claims = await sys.claims.list({ where: { clientId: c.id } });
  const amountOf = (x: ClaimRow) => x.amountApproved ?? x.amountClaimed;
  const months: ClientDetail['claimsByMonth'] = lastMonths(ctx.now()).map((key) => {
    const inMonth = claims.filter((x) => x.createdAt.startsWith(key));
    return { month: key, count: inMonth.length, amount: inMonth.reduce((s, x) => s + amountOf(x), 0) };
  });
  const activity: ClientDetail['activity'] = [];
  const policy = c.activePolicyId ? await sys.policies.get(c.activePolicyId) : null;
  for (const k of await r.kp.list({ where: { clientId: c.id } })) {
    activity.push({ at: k.createdAt, text: `Подготовлено ${k.number}` });
    if (k.sentAt) activity.push({ at: k.sentAt, text: `${k.number} отправлено клиенту` });
  }
  const lastClaim = [...claims].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  // A claim number is a single claim: only roles that read claims see it.
  if (lastClaim && can(user, 'claims.read')) activity.push({ at: lastClaim.createdAt, text: `Новый убыток ${lastClaim.number}` });
  const lastInv = (await sys.invoices.list({ where: { clientId: c.id } })).sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1))[0];
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
  let list = await ctx.repos.insured.list({ where: { clientId: c.id } });
  if (term) list = list.filter((i) => matchesSearch(term, i.fullName));
  const sorted = sortBy(list, qs, { fullName: (i) => i.fullName, position: (i) => i.position }, 'fullName:asc');
  const items: InsuredListItem[] = [];
  for (const i of sorted) items.push(await toInsuredListItem(ctx, i, user));
  return paginate(items, qs);
}

export async function clientDocuments(ctx: AuthCtx, id: string): Promise<ClientDocument[]> {
  requirePermission(ctx.user, 'clients.read');
  const c = await findClient(ctx, id);
  return (await ctx.repos.documents.list({ where: { clientId: c.id } })).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Audit of the client, its policies, claims and offers, without personal-data and medical openings. */
export async function clientHistory(ctx: AuthCtx, id: string): Promise<AuditEntry[]> {
  requirePermission(ctx.user, 'clients.read');
  const r = systemRepos(ctx, 'client history: audit entries about the client, its policies, claims and offers (without personal-data and medical openings)');
  const c = await findClient(ctx, id);
  const ids = [
    c.id,
    ...(await r.policies.list({ where: { clientId: c.id } })).map((p) => p.id),
    ...(await r.claims.list({ where: { clientId: c.id } })).map((x) => x.id),
    ...(await r.kp.list({ where: { clientId: c.id } })).map((x) => x.id),
  ];
  const list = await r.audit.list({ where: { targetId: { in: ids }, action: { notIn: ['reveal_pii', 'open_medical'] } }, limit: 50 });
  return list.map(({ reason: _r, ...e }) => e);
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
  let list: Policy[] = await ctx.repos.policies.list();
  const term = q(qs);
  if (term) list = list.filter((p) => matchesSearch(term, p.number, p.clientName));
  const status = qs.get('status');
  if (status) list = list.filter((p) => status.split(',').includes(p.status));
  const program = qs.get('program');
  if (program) list = list.filter((p) => program.split(',').includes(p.program));
  const clientId = qs.get('clientId');
  if (clientId) list = list.filter((p) => p.clientId === clientId);
  const rows: (Policy & { clientLegalForm: Awaited<ReturnType<typeof clientLegalFormOf>> })[] = [];
  for (const p of list) rows.push({ ...p, clientLegalForm: await clientLegalFormOf(ctx, p.clientId) });
  const withForm = filterLegalForm(rows, qs, (p) => p.clientLegalForm);
  return paginate(
    sortBy(
      withForm,
      qs,
      {
        number: (p) => p.number,
        clientName: byLegalName((p) => p.clientName),
        legalForm: byLegalForm((p) => p.clientLegalForm),
        program: (p) => p.program,
        startDate: (p) => p.startDate,
        endDate: (p) => p.endDate,
        premium: (p) => p.premium,
        insuredCount: (p) => p.insuredCount,
        status: (p) => p.status,
      },
      'endDate:asc',
    ),
    qs,
  );
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
    documents: (await systemRepos(ctx, 'policy card: documents of the policy\'s client').documents.list({ where: { clientId: p.clientId } })).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
  };
}
