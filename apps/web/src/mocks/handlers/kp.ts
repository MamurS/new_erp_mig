/*
 * Commercial offers (KP_SPEC §8). The server stores parameters and the template version, not a PDF:
 * the document is reproduced exactly from them.
 */
import { msg } from '@mig/i18n';
import { http } from 'msw';
import { kpParamsSchema } from '@mig/contracts/forms';
import { currentAssistance } from '../assistance-core';
import type { KpDocument, KpParams, SessionUser } from '@mig/contracts';
import type { KpDefaults } from '@mig/contracts/dto';
import { can } from '@mig/domain/auth/permissions';
import { KP_TEMPLATE_VERSION, kpNumber, kpTotalPremium, renewalPremiumPerPerson } from '@mig/domain/kp';
import { db, type ClientRow } from '../db';
import { API, audit, body, conflict, forbidden, HttpError, notFound, param, requirePermission, requireSession, route, type Ctx } from '../http';
import { randomId } from '@mig/seed/rng';
import { DAY, isoDay, parseIso, startOfDay, tzIso } from '@mig/seed/time';
import { PROGRAMS } from '@mig/seed/programs';
import { dmsParam, numbering } from '../params';
import { ensureRenewalDeal } from './lifecycle';

const DEFAULT_SUM = 200_000_000;
const DEFAULT_PREMIUM = 5_000_000;

function findClient(id: string): ClientRow {
  const c = db().clients.find((x) => x.id === id);
  if (!c) throw notFound();
  return c;
}

/** Staff with `kp.read`, or HR of the client's company for sent offers. Anything else is 404. */
function readableKp(user: SessionUser, ctx: Ctx): KpDocument {
  if (!can(user, 'kp.read')) throw forbidden();
  const kp = db().kp.find((k) => k.id === param(ctx, 'id'));
  if (!kp) throw notFound();
  if (user.role === 'hr' && (!['sent', 'accepted', 'declined'].includes(kp.status) || !can(user, 'kp.read', { companyId: kp.clientId }))) throw notFound();
  return kp;
}

function writableKp(user: SessionUser, ctx: Ctx, action: 'kp.create' | 'kp.send'): KpDocument {
  requirePermission(user, action);
  const kp = db().kp.find((k) => k.id === param(ctx, 'id'));
  if (!kp) throw notFound();
  return kp;
}

function policyFor(client: ClientRow, url: URL) {
  const d = db();
  const requested = url.searchParams.get('policyId');
  const id = requested && /^[0-9a-f-]{36}$/i.test(requested) ? requested : client.activePolicyId;
  return d.policies.find((p) => p.id === id && p.clientId === client.id);
}

function staffEmail(user: SessionUser): string {
  return db().staff.find((s) => s.id === user.id)?.email ?? '';
}

function roundK(n: number): number {
  return Math.max(1000, Math.round(n / 1000) * 1000);
}

export const kpHandlers = [
  http.get(
    `${API}/clients/:id/kp-defaults`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'kp.create');
      const d = db();
      const client = findClient(param(ctx, 'id'));
      const policy = policyFor(client, ctx.url);
      const active = d.insured.filter((i) => i.clientId === client.id && i.status === 'active');
      const perPerson = policy && policy.premium > 0 ? roundK(renewalPremiumPerPerson(policy.premium, policy.insuredCount, active)) : DEFAULT_PREMIUM;
      const program = policy?.program ?? client.program;
      const sum = program ? Object.values(PROGRAMS[program].limits).reduce((s, v) => s + v, 0) : DEFAULT_SUM;
      const today = startOfDay(Date.now());
      const start = policy ? Math.max(parseIso(policy.endDate) + DAY, today) : today + DAY;
      const end = new Date(start);
      end.setFullYear(end.getFullYear() + 1);
      const params: KpParams = {
        templateId: 'gold',
        lang: 'ru',
        variant: 'grey',
        sumInsured: sum,
        premiumEmployee: perPerson,
        premiumFamily: perPerson,
        // A row per person: employees and family members are counted separately (FAMILY_SPEC).
        employees: Math.max(1, active.filter((i) => i.relation === 'employee').length),
        familyMembers: active.filter((i) => i.relation !== 'employee').length,
        coverageStart: isoDay(start),
        coverageEnd: isoDay(end.getTime() - DAY),
        validUntil: isoDay(today + dmsParam('kpValidityDays') * DAY),
        paymentTerms: 'quarterly',
        assistanceId: policy ? currentAssistance(d, policy.id) : null,
      };
      const res: KpDefaults = {
        params,
        letter: {
          clientName: client.name,
          clientLegalForm: client.legalForm,
          clientInn: client.inn,
          policyId: policy?.id,
          createdByName: user.displayName,
          createdByEmail: staffEmail(user),
        },
      };
      return res;
    }),
  ),
  http.get(
    `${API}/clients/:id/kp`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'clients.read');
      requirePermission(user, 'kp.read');
      const client = findClient(param(ctx, 'id'));
      return db()
        .kp.filter((k) => k.clientId === client.id)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    }),
  ),
  http.post(
    `${API}/clients/:id/kp`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      requirePermission(user, 'kp.create');
      const d = db();
      const client = findClient(param(ctx, 'id'));
      const params = await body(ctx.request, kpParamsSchema);
      if (params.assistanceId && !db().assistances.some((a) => a.id === params.assistanceId)) throw new HttpError(422, 'validation', 'srv.kp.assistanceNotFound', { fields: { assistanceId: msg('srv.kp.chooseAssistance') } });
      const now = Date.now();
      d.kpSeq += 1;
      const kp: KpDocument = {
        id: randomId(),
        number: kpNumber(new Date(now).getFullYear(), d.kpSeq, numbering()),
        clientId: client.id,
        clientName: client.name,
        clientLegalForm: client.legalForm,
        clientInn: client.inn,
        policyId: policyFor(client, ctx.url)?.id,
        params,
        templateVersion: KP_TEMPLATE_VERSION[params.templateId],
        totalPremium: kpTotalPremium(params),
        status: 'draft',
        createdById: user.id,
        createdByName: user.displayName,
        createdByEmail: staffEmail(user),
        createdAt: tzIso(now),
      };
      d.kp.unshift(kp);
      audit(user, 'kp_created', { targetType: 'kp', targetId: kp.id, targetLabel: kp.number });
      return kp;
    }),
  ),
  http.get(
    `${API}/kp/:id`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      return readableKp(user, ctx);
    }),
  ),
  http.patch(
    `${API}/kp/:id`,
    route(async (ctx) => {
      const { user } = requireSession(ctx.request);
      const kp = writableKp(user, ctx, 'kp.create');
      if (kp.status !== 'draft') throw conflict('srv.kp.locked');
      const params = await body(ctx.request, kpParamsSchema);
      if (params.assistanceId && !db().assistances.some((a) => a.id === params.assistanceId)) throw new HttpError(422, 'validation', 'srv.kp.assistanceNotFound', { fields: { assistanceId: msg('srv.kp.chooseAssistance') } });
      kp.params = params;
      kp.totalPremium = kpTotalPremium(params);
      return kp;
    }),
  ),
  http.post(
    `${API}/kp/:id/send`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      const kp = writableKp(user, ctx, 'kp.send');
      if (kp.status !== 'draft') throw conflict('srv.kp.sendDraftOnly');
      if (kp.params.validUntil < isoDay(startOfDay(Date.now()))) throw conflict('srv.kp.expired');
      // An offer of a deal goes out only on an approved quote (LIFECYCLE_SPEC §5).
      if (kp.dealId) {
        const q = db().quotes.filter((x) => x.dealId === kp.dealId).at(-1);
        if (!q || q.status !== 'approved') throw conflict('srv.kp.needsApprovedQuote');
      }
      kp.status = 'sent';
      kp.sentAt = tzIso(Date.now());
      // A renewal offer opens (or moves) a renewal deal (LIFECYCLE_SPEC §3).
      ensureRenewalDeal(db(), kp, user);
      audit(user, 'kp_sent', { targetType: 'kp', targetId: kp.id, targetLabel: kp.number });
      return kp;
    }),
  ),
  http.post(
    `${API}/kp/:id/revoke`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      const kp = writableKp(user, ctx, 'kp.send');
      if (kp.status === 'revoked') throw conflict('srv.kp.alreadyRevoked');
      kp.status = 'revoked';
      audit(user, 'kp_revoked', { targetType: 'kp', targetId: kp.id, targetLabel: kp.number });
      return kp;
    }),
  ),
  http.post(
    `${API}/kp/:id/downloaded`,
    route((ctx) => {
      const { user } = requireSession(ctx.request);
      const kp = readableKp(user, ctx);
      audit(user, 'kp_downloaded', { targetType: 'kp', targetId: kp.id, targetLabel: kp.number });
      return undefined;
    }),
  ),
];
