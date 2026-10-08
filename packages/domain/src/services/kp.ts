/*
 * Commercial offers (KP_SPEC §8). The server stores parameters and the template version, not a PDF:
 * the document is reproduced exactly from them.
 */
import { msg } from '@mig/i18n';
import type { KpDocument, KpParams, Policy, SessionUser } from '@mig/contracts';
import type { KpDefaults } from '@mig/contracts/dto';
import { kpParamsSchema } from '@mig/contracts/forms';
import { can } from '../auth/permissions';
import { KP_TEMPLATE_VERSION, kpNumber, kpTotalPremium, renewalPremiumPerPerson } from '../kp';
import { PROGRAMS } from '../programs';
import { randomId } from '../lib/random';
import { DAY, isoDay, parseIso, startOfDay, tzIso } from '../lib/time';
import type { ClientRow } from '../store/db';
import { audit, conflict, DomainError, forbidden, notFound, requirePermission, validate, type AuthCtx, type BaseCtx } from './kernel';
import { isUuid } from './list';
import { loadParams } from './params';
import { currentAssistance } from './assistance';
import { latestQuote } from './lifecycle';
import { ensureRenewalDeal } from './deals';

const DEFAULT_SUM = 200_000_000;
const DEFAULT_PREMIUM = 5_000_000;

async function findClient(ctx: BaseCtx, id: string): Promise<ClientRow> {
  const c = await ctx.repos.clients.get(id);
  if (!c) throw notFound();
  return c;
}

/** Staff with `kp.read`, or HR of the client's company for sent offers. Anything else is 404. */
async function readableKp(ctx: AuthCtx, id: string): Promise<KpDocument> {
  const { user } = ctx;
  if (!can(user, 'kp.read')) throw forbidden();
  const kp = await ctx.repos.kp.get(id);
  if (!kp) throw notFound();
  if (user.role === 'hr' && (!['sent', 'accepted', 'declined'].includes(kp.status) || !can(user, 'kp.read', { companyId: kp.clientId }))) throw notFound();
  return kp;
}

async function writableKp(ctx: AuthCtx, id: string, action: 'kp.create' | 'kp.send'): Promise<KpDocument> {
  requirePermission(ctx.user, action);
  const kp = await ctx.repos.kp.get(id);
  if (!kp) throw notFound();
  return kp;
}

/** `?policyId=` of the client, else its active policy. */
async function policyFor(ctx: BaseCtx, client: ClientRow, qs: URLSearchParams): Promise<Policy | undefined> {
  const requested = qs.get('policyId');
  const id = requested && isUuid(requested) ? requested : client.activePolicyId;
  const p = id ? await ctx.repos.policies.get(id) : null;
  return p && p.clientId === client.id ? p : undefined;
}

async function staffEmail(ctx: BaseCtx, user: SessionUser): Promise<string> {
  return (await ctx.repos.staff.get(user.id))?.email ?? '';
}

function roundK(n: number): number {
  return Math.max(1000, Math.round(n / 1000) * 1000);
}

async function assistanceGuard(ctx: BaseCtx, params: KpParams): Promise<void> {
  if (params.assistanceId && !(await ctx.repos.assistances.get(params.assistanceId))) {
    throw new DomainError(422, 'validation', 'srv.kp.assistanceNotFound', { fields: { assistanceId: msg('srv.kp.chooseAssistance') } });
  }
}

export async function kpDefaults(ctx: AuthCtx, clientId: string, qs: URLSearchParams): Promise<KpDefaults> {
  const { user } = ctx;
  requirePermission(user, 'kp.create');
  const P = await loadParams(ctx);
  const client = await findClient(ctx, clientId);
  const policy = await policyFor(ctx, client, qs);
  const active = await ctx.repos.insured.list({ where: { clientId: client.id, status: 'active' } });
  const perPerson = policy && policy.premium > 0 ? roundK(renewalPremiumPerPerson(policy.premium, policy.insuredCount, active)) : DEFAULT_PREMIUM;
  const program = policy?.program ?? client.program;
  const sum = program ? Object.values(PROGRAMS[program].limits).reduce((s, v) => s + v, 0) : DEFAULT_SUM;
  const today = startOfDay(ctx.now());
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
    validUntil: isoDay(today + P.dmsParam('kpValidityDays') * DAY),
    paymentTerms: 'quarterly',
    assistanceId: policy ? await currentAssistance(ctx, policy.id) : null,
  };
  return {
    params,
    letter: {
      clientName: client.name,
      clientLegalForm: client.legalForm,
      clientInn: client.inn,
      policyId: policy?.id,
      createdByName: user.displayName,
      createdByEmail: await staffEmail(ctx, user),
    },
  };
}

export async function listClientKp(ctx: AuthCtx, clientId: string): Promise<KpDocument[]> {
  requirePermission(ctx.user, 'clients.read');
  requirePermission(ctx.user, 'kp.read');
  const client = await findClient(ctx, clientId);
  return (await ctx.repos.kp.list({ where: { clientId: client.id } })).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function createKp(ctx: AuthCtx, clientId: string, qs: URLSearchParams, body: unknown): Promise<KpDocument> {
  const { user } = ctx;
  requirePermission(user, 'kp.create');
  const client = await findClient(ctx, clientId);
  const params = validate(kpParamsSchema, body);
  await assistanceGuard(ctx, params);
  const P = await loadParams(ctx);
  const now = ctx.now();
  const seq = await ctx.repos.seq.next('kp');
  const kp: KpDocument = {
    id: randomId(),
    number: kpNumber(new Date(now).getFullYear(), seq, P.numbering()),
    clientId: client.id,
    clientName: client.name,
    clientLegalForm: client.legalForm,
    clientInn: client.inn,
    policyId: (await policyFor(ctx, client, qs))?.id,
    params,
    templateVersion: KP_TEMPLATE_VERSION[params.templateId],
    totalPremium: kpTotalPremium(params),
    status: 'draft',
    createdById: user.id,
    createdByName: user.displayName,
    createdByEmail: await staffEmail(ctx, user),
    createdAt: tzIso(now),
  };
  await ctx.repos.kp.insert(kp, { at: 'start' });
  await audit(ctx, user, 'kp_created', { targetType: 'kp', targetId: kp.id, targetLabel: kp.number });
  return kp;
}

export async function getKp(ctx: AuthCtx, id: string): Promise<KpDocument> {
  return readableKp(ctx, id);
}

export async function patchKp(ctx: AuthCtx, id: string, body: unknown): Promise<KpDocument> {
  const kp = await writableKp(ctx, id, 'kp.create');
  if (kp.status !== 'draft') throw conflict('srv.kp.locked');
  const params = validate(kpParamsSchema, body);
  await assistanceGuard(ctx, params);
  kp.params = params;
  kp.totalPremium = kpTotalPremium(params);
  await ctx.repos.kp.update(kp.id, { params: kp.params, totalPremium: kp.totalPremium });
  return kp;
}

export async function sendKp(ctx: AuthCtx, id: string): Promise<KpDocument> {
  const { user } = ctx;
  const kp = await writableKp(ctx, id, 'kp.send');
  if (kp.status !== 'draft') throw conflict('srv.kp.sendDraftOnly');
  if (kp.params.validUntil < isoDay(startOfDay(ctx.now()))) throw conflict('srv.kp.expired');
  // An offer of a deal goes out only on an approved quote (LIFECYCLE_SPEC §5).
  if (kp.dealId) {
    const q = await latestQuote(ctx, kp.dealId);
    if (!q || q.status !== 'approved') throw conflict('srv.kp.needsApprovedQuote');
  }
  kp.status = 'sent';
  kp.sentAt = tzIso(ctx.now());
  await ctx.repos.kp.update(kp.id, { status: kp.status, sentAt: kp.sentAt });
  // A renewal offer opens (or moves) a renewal deal (LIFECYCLE_SPEC §3).
  await ensureRenewalDeal(ctx, kp, user);
  await audit(ctx, user, 'kp_sent', { targetType: 'kp', targetId: kp.id, targetLabel: kp.number });
  return kp;
}

export async function revokeKp(ctx: AuthCtx, id: string): Promise<KpDocument> {
  const kp = await writableKp(ctx, id, 'kp.send');
  if (kp.status === 'revoked') throw conflict('srv.kp.alreadyRevoked');
  kp.status = 'revoked';
  await ctx.repos.kp.update(kp.id, { status: kp.status });
  await audit(ctx, ctx.user, 'kp_revoked', { targetType: 'kp', targetId: kp.id, targetLabel: kp.number });
  return kp;
}

export async function kpDownloaded(ctx: AuthCtx, id: string): Promise<void> {
  const kp = await readableKp(ctx, id);
  await audit(ctx, ctx.user, 'kp_downloaded', { targetType: 'kp', targetId: kp.id, targetLabel: kp.number });
}
