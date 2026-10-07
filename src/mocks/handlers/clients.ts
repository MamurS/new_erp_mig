import { matchesSearch } from '@/shared/lib/searchNormalize';
import { http } from 'msw';
import { clientCreateSchema, clientPatchSchema } from '@/shared/schemas/forms';
import type { ClientDetail, ClientListResponse, ClientLossStats, PolicyDetail } from '@/shared/types/dto';
import type { AuditEntry, Policy } from '@/shared/types';
import { can } from '@/shared/auth/permissions';
import { CLAIM_CATEGORY_LABEL } from '@/shared/domain/claims';
import { formatMoney } from '@/shared/lib/format';
import { db, hasLiveKp, type ClientRow } from '../db';
import { API, body, byLegalForm, byLegalName, filterLegalForm, notFound, paginate, param, q, requirePermission, requireSession, route, sortBy } from '../http';
import { randomId } from '../rng';
import { parseIso, tzIso } from '../time';
import { clientLegalFormOf, toClient, toInsuredListItem } from '../views';
import { PROGRAMS } from '../programs';
import { renewalsWithoutOffer } from './dashboard';
import { dmsParam } from '../params';

function findClient(id: string): ClientRow {
  const c = db().clients.find((x) => x.id === id);
  if (!c) throw notFound();
  return c;
}

export const clientHandlers = [
  http.get(
    `${API}/clients`,
    route(({ request, url }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'clients.read');
      const d = db();
      const now = Date.now();
      let list = d.clients;
      const term = q(url);
      if (term) list = list.filter((c) => matchesSearch(term, c.name) || c.inn.includes(term.trim()));
      const status = url.searchParams.get('status');
      if (status) list = list.filter((c) => status.split(',').includes(c.status));
      const program = url.searchParams.get('program');
      if (program) list = list.filter((c) => c.program && program.split(',').includes(c.program));
      const managerId = url.searchParams.get('managerId');
      if (managerId) list = list.filter((c) => c.managerId === managerId);
      list = filterLegalForm(list, url, (c) => c.legalForm);
      const view = url.searchParams.get('view');
      if (view === 'mine') list = list.filter((c) => c.managerId === user.id);
      if (view === 'q4') {
        const y = new Date(now).getFullYear();
        list = list.filter((c) => c.renewalDate && c.renewalDate >= `${y}-10-01` && c.renewalDate <= `${y}-12-31`);
      }
      if (view === 'loss') list = list.filter((c) => (c.lossRatio ?? 0) >= dmsParam('lossRatioWarn'));
      if (view === 'renewals') {
        const ids = new Set(renewalsWithoutOffer(d, now).map((c) => c.id));
        list = list.filter((c) => ids.has(c.id));
      }
      const mapped = list.map((c) => toClient(d, c));
      const sorted = sortBy(
        mapped,
        url,
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
      const res: ClientListResponse = { ...paginate(sorted, url), totalPremium: mapped.reduce((s, c) => s + c.premium, 0) };
      return res;
    }),
  ),
  http.post(
    `${API}/clients`,
    route(async ({ request }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'clients.write');
      const input = await body(request, clientCreateSchema);
      const d = db();
      const row: ClientRow = {
        id: randomId(),
        legalForm: input.legalForm,
        name: input.name,
        inn: input.inn,
        status: input.status,
        managerId: user.id,
        managerName: user.displayName,
        hrContact: { name: '—', phone: '+998000000000', email: 'hr@example.uz' },
        premium: 0,
        lossRatio: null,
        createdAt: tzIso(Date.now()),
      };
      d.clients.unshift(row);
      return toClient(d, row);
    }),
  ),
  http.get(
    `${API}/clients/:id/loss-stats`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'clients.read');
      const d = db();
      const c = findClient(param(ctx, 'id'));
      const claims = d.claims.filter((x) => x.clientId === c.id && x.status !== 'rejected');
      const amountOf = (x: (typeof claims)[number]) => x.amountApproved ?? x.amountClaimed;
      const now = Date.now();
      const byMonth: ClientLossStats['byMonth'] = [];
      for (let k = 11; k >= 0; k--) {
        const dt = new Date(now);
        dt.setDate(1);
        dt.setMonth(dt.getMonth() - k);
        const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
        const inMonth = claims.filter((x) => x.serviceDate.startsWith(key));
        byMonth.push({ month: key, count: inMonth.length, amount: inMonth.reduce((sum, x) => sum + amountOf(x), 0) });
      }
      const byCat = new Map<string, { count: number; amount: number }>();
      for (const x of claims) {
        const e = byCat.get(x.category) ?? { count: 0, amount: 0 };
        e.count += 1;
        e.amount += amountOf(x);
        byCat.set(x.category, e);
      }
      // Only sums and counts: no claim numbers, insured names or diagnoses (the underwriter's view).
      const out: ClientLossStats = {
        clientId: c.id,
        clientName: c.name,
        clientLegalForm: c.legalForm,
        premium: c.premium,
        lossRatio: c.lossRatio,
        lossRatioWarn: dmsParam('lossRatioWarn'),
        claimsCount: claims.length,
        claimsAmount: claims.reduce((sum, x) => sum + amountOf(x), 0),
        byCategory: [...byCat.entries()].map(([category, v]) => ({ category: CLAIM_CATEGORY_LABEL[category as keyof typeof CLAIM_CATEGORY_LABEL] ?? category, ...v })).sort((a, b) => b.amount - a.amount),
        byMonth,
      };
      return out;
    }),
  ),
  http.get(
    `${API}/clients/:id`,
    route(({ request, ...ctx }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'clients.read');
      const d = db();
      const c = findClient(param({ request, ...ctx }, 'id'));
      const claims = d.claims.filter((x) => x.clientId === c.id);
      const now = Date.now();
      const months: ClientDetail['claimsByMonth'] = [];
      for (let k = 11; k >= 0; k--) {
        const dt = new Date(now);
        dt.setDate(1);
        dt.setMonth(dt.getMonth() - k);
        const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
        const inMonth = claims.filter((x) => x.createdAt.startsWith(key));
        months.push({ month: key, count: inMonth.length, amount: inMonth.reduce((s, x) => s + (x.amountApproved ?? x.amountClaimed), 0) });
      }
      const byCat = new Map<string, { count: number; amount: number }>();
      for (const x of claims) {
        const e = byCat.get(x.category) ?? { count: 0, amount: 0 };
        e.count += 1;
        e.amount += x.amountApproved ?? x.amountClaimed;
        byCat.set(x.category, e);
      }
      const activity: ClientDetail['activity'] = [];
      const policy = d.policies.find((p) => p.id === c.activePolicyId);
      for (const k of d.kp.filter((x) => x.clientId === c.id)) {
        activity.push({ at: k.createdAt, text: `Подготовлено ${k.number}` });
        if (k.sentAt) activity.push({ at: k.sentAt, text: `${k.number} отправлено клиенту` });
      }
      const lastClaim = [...claims].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
      // A claim number is a single claim: only roles that read claims see it.
      if (lastClaim && can(user, 'claims.read')) activity.push({ at: lastClaim.createdAt, text: `Новый убыток ${lastClaim.number}` });
      const lastInv = d.invoices.filter((i) => i.clientId === c.id).sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1))[0];
      if (lastInv) activity.push({ at: tzIso(parseIso(lastInv.issuedAt)), text: `Выставлен счёт ${lastInv.number} на ${formatMoney(lastInv.amount)}` });
      if (policy) activity.push({ at: tzIso(parseIso(policy.startDate)), text: `Начало действия полиса ${policy.number}` });
      for (const e of c.log ?? []) activity.push(e);
      activity.push({ at: c.createdAt, text: 'Клиент добавлен в систему' });
      const detail: ClientDetail = {
        ...toClient(d, c),
        claimsByMonth: months,
        claimsByCategory: [...byCat.entries()].map(([category, v]) => ({
          category: CLAIM_CATEGORY_LABEL[category as keyof typeof CLAIM_CATEGORY_LABEL] ?? category,
          ...v,
        })),
        activity: activity.sort((a, b) => (a.at < b.at ? 1 : -1)),
        hasRenewalOffer: hasLiveKp(d, c.id),
      };
      return detail;
    }),
  ),
  http.patch(
    `${API}/clients/:id`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'clients.write');
      const c = findClient(param(ctx, 'id'));
      const patch = await body(ctx.request, clientPatchSchema);
      Object.assign(c, patch);
      return toClient(db(), c);
    }),
  ),
  http.get(
    `${API}/clients/:id/insured`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'clients.read');
      requirePermission(user, 'insured.read');
      const c = findClient(param(ctx, 'id'));
      const term = q(ctx.url);
      let list = db().insured.filter((i) => i.clientId === c.id);
      if (term) list = list.filter((i) => matchesSearch(term, i.fullName));
      return paginate(sortBy(list, ctx.url, { fullName: (i) => i.fullName, position: (i) => i.position }, 'fullName:asc').map((i) => toInsuredListItem(db(), i, user)), ctx.url);
    }),
  ),
  http.get(
    `${API}/clients/:id/documents`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'clients.read');
      const c = findClient(param(ctx, 'id'));
      return db()
        .documents.filter((x) => x.clientId === c.id)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    }),
  ),
  http.get(
    `${API}/clients/:id/history`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'clients.read');
      const c = findClient(param(ctx, 'id'));
      const d = db();
      const policyIds = new Set(d.policies.filter((p) => p.clientId === c.id).map((p) => p.id));
      const claimIds = new Set(d.claims.filter((x) => x.clientId === c.id).map((x) => x.id));
      const kpIds = new Set(d.kp.filter((x) => x.clientId === c.id).map((x) => x.id));
      const list: AuditEntry[] = d.audit
        .filter(
          (e) =>
            e.targetId &&
            (e.targetId === c.id || policyIds.has(e.targetId) || claimIds.has(e.targetId) || kpIds.has(e.targetId)) &&
            e.action !== 'reveal_pii' &&
            e.action !== 'open_medical',
        )
        .map(({ reason: _r, ...e }) => e);
      return list.slice(0, 50);
    }),
  ),
  http.post(
    `${API}/clients/:id/hr-letter`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'clients.read');
      findClient(param(ctx, 'id'));
      await ctx.request.text();
      return { ok: true as const };
    }),
  ),
  // ---- policies ----
  http.get(
    `${API}/policies`,
    route(({ request, url }) => {
      const { user } = requireSession(request);
      requirePermission(user, 'policies.read');
      if (user.role === 'hr' || user.role === 'insured') throw notFound();
      let list: Policy[] = db().policies;
      const term = q(url);
      if (term) list = list.filter((p) => matchesSearch(term, p.number, p.clientName));
      const status = url.searchParams.get('status');
      if (status) list = list.filter((p) => status.split(',').includes(p.status));
      const program = url.searchParams.get('program');
      if (program) list = list.filter((p) => program.split(',').includes(p.program));
      const clientId = url.searchParams.get('clientId');
      if (clientId) list = list.filter((p) => p.clientId === clientId);
      const d = db();
      const withForm = filterLegalForm(
        list.map((p) => ({ ...p, clientLegalForm: clientLegalFormOf(d, p.clientId) })),
        url,
        (p) => p.clientLegalForm,
      );
      return paginate(
        sortBy(
          withForm,
          url,
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
        url,
      );
    }),
  ),
  http.get(
    `${API}/policies/:id`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'policies.read');
      if (user.role === 'hr' || user.role === 'insured') throw notFound();
      const d = db();
      const p = d.policies.find((x) => x.id === param(ctx, 'id'));
      if (!p) throw notFound();
      const detail: PolicyDetail = {
        ...p,
        clientLegalForm: clientLegalFormOf(d, p.clientId),
        programInfo: PROGRAMS[p.program],
        documents: d.documents.filter((x) => x.clientId === p.clientId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
      };
      return detail;
    }),
  ),
];
