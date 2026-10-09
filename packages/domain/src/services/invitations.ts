/*
 * Invitations of e-mail accounts (stage 1.5, README «Приглашения», docs/DECISIONS.md): staff of MIG, HR of a client, users of a clinic
 * or of an assistance company get an e-mail with a single-use link (valid `inviteValidityDays`, a DMS parameter). The
 * link opens `/invite`: the person sets a password; the first sign-in then asks for a TOTP authenticator (the API) and
 * the person is in. Whoever manages the account sees «Приглашение отправлено / истекло» in the user list and may send
 * it again: the new link revokes the old one.
 *
 * Only the SHA-256 of the token is kept for the lookup (repo `invitations`); the token itself leaves in the e-mail
 * (services/system/invitations.ts: the mail job) and is then dropped.
 */
import type { InvitationBrief, InvitationCheck, InvitationView, UUID } from '@mig/contracts';
import { invitationAcceptSchema, invitationCheckSchema } from '@mig/contracts/forms';
import { can } from '../auth/permissions';
import { maskEmail } from '../lib/mask';
import { randomId, randomToken } from '../lib/random';
import { tzIso } from '../lib/time';
import { sha256Hex } from '../lib/webhook';
import type { InvitationRow } from '../store/repo';
import { audit, conflict, DomainError, notFound, validate, type AuditActor, type AuthCtx, type BaseCtx } from './kernel';
import { loadParams } from './params';
import { invitedAccount, type InvitedAccount } from './system/invitations';

const DAY = 24 * 3600_000;

/** A new invitation of the account (the old open one is revoked); the mail job sends it. Audited as sent. */
export async function issueInvitation(ctx: BaseCtx, account: { id: string; fullName: string }, actor: AuditActor): Promise<void> {
  const P = await loadParams(ctx);
  const token = randomToken(32);
  const now = ctx.now();
  await ctx.repos.invitations.issue({ id: randomId(), userId: account.id, tokenHash: await sha256Hex(token), token, createdAt: now, expiresAt: now + P.dmsParam('inviteValidityDays') * DAY });
  await audit(ctx, actor, 'invitation_sent', { targetType: 'user', targetId: account.id, targetLabel: account.fullName });
}

const brief = (x: InvitationRow, now: number): InvitationBrief => ({
  status: x.expiresAt > now ? 'pending' : 'expired',
  expiresAt: tzIso(x.expiresAt),
  ...(x.sentAt !== undefined ? { sentAt: tzIso(x.sentAt) } : {}),
});

/** The open invitations of the accounts by id (for the user lists: «Приглашение отправлено / истекло»). */
export async function invitationBriefs(ctx: BaseCtx, userIds: readonly string[]): Promise<Map<string, InvitationBrief>> {
  if (!userIds.length) return new Map();
  const now = ctx.now();
  return new Map((await ctx.repos.invitations.open(userIds)).map((x) => [x.userId, brief(x, now)]));
}

/** Adds `invitation` to the views of a user list. */
export async function withInvitations<V extends { id: string }>(ctx: BaseCtx, views: V[]): Promise<(V & { invitation?: InvitationBrief })[]> {
  const briefs = await invitationBriefs(ctx, views.map((v) => v.id));
  return views.map((v) => {
    const b = briefs.get(v.id);
    return b ? { ...v, invitation: b } : v;
  });
}

const invalid = () => new DomainError(404, 'not_found', 'srv.invite.invalid');

/** The invitation of a token while it can be accepted (404 unknown or revoked, 409 used or expired) and its account. */
async function openInvitation(ctx: BaseCtx, token: string): Promise<{ inv: InvitationRow; account: InvitedAccount }> {
  const inv = await ctx.repos.invitations.byTokenHash(await sha256Hex(token));
  if (!inv || inv.revokedAt !== undefined) throw invalid();
  if (inv.usedAt !== undefined) throw new DomainError(409, 'conflict', 'srv.invite.accepted');
  if (inv.expiresAt <= ctx.now()) throw conflict('srv.invite.expired');
  const account = await invitedAccount(ctx, inv.userId);
  if (!account || !account.active) throw new DomainError(404, 'not_found', 'srv.invite.noAccount');
  return { inv, account };
}

/** POST /auth/invitation: what the invitation page shows before the password is set (the e-mail, masked). */
export async function checkInvitation(ctx: BaseCtx, body: unknown): Promise<InvitationCheck> {
  const { token } = validate(invitationCheckSchema, body);
  const { inv, account } = await openInvitation(ctx, token);
  return { email: maskEmail(account.email), expiresAt: tzIso(inv.expiresAt) };
}

/**
 * POST /auth/invitation/accept: the password of the account. The invitation is used once (a conditional update: of two
 * submits only one passes); the API sets the password in Supabase Auth and removes TOTP factors, so the first sign-in
 * sets up the authenticator. In the mock the account row keeps the password.
 */
export async function acceptInvitation(ctx: BaseCtx, body: unknown): Promise<{ ok: true }> {
  const { token, password } = validate(invitationAcceptSchema, body);
  const { inv, account } = await openInvitation(ctx, token);
  if (!(await ctx.repos.invitations.use(inv.id, ctx.now()))) throw invalid();
  if (ctx.env.credentials) await ctx.env.credentials.setPassword(account.id, password);
  else await setMockPassword(ctx, account, password);
  await audit(ctx, { id: account.id, displayName: account.fullName, role: account.role as AuditActor['role'] }, 'invitation_accepted', { targetType: 'user', targetId: account.id, targetLabel: account.fullName });
  return { ok: true };
}

/** The mock signs in with the password of the account row (the API keeps no password: Supabase Auth does). */
async function setMockPassword(ctx: BaseCtx, a: InvitedAccount, password: string): Promise<void> {
  const r = ctx.repos;
  if (a.portal === 'staff') await r.staff.update(a.id, { password });
  else if (a.portal === 'hr') await r.hrUsers.update(a.id, { password });
  else if (a.portal === 'clinic') await r.clinicUsers.update(a.id, { password });
  else await r.assistUsers.update(a.id, { password });
}

/**
 * Who may send an invitation again: the MIG administrator (`users.manage`) — any account; the administrator of a clinic
 * or of an assistance company — the users of their own organisation.
 */
function mayResend(ctx: AuthCtx, a: InvitedAccount): boolean {
  const u = ctx.user;
  if (can(u, 'users.manage')) return true;
  if (a.portal === 'clinic' && u.role === 'clinic_admin') return u.clinicId === a.clinicId;
  if (a.portal === 'assist' && u.role === 'asst_admin') return u.assistanceId === a.assistanceId;
  return false;
}

/** POST /invitations/:userId/resend: a new link (the old one stops working); only while the password is not set. */
export async function resendInvitation(ctx: AuthCtx, userId: UUID): Promise<InvitationBrief> {
  const account = await invitedAccount(ctx, userId);
  if (!account || !mayResend(ctx, account)) throw notFound();
  if (!account.active) throw conflict('srv.invite.noAccount');
  if (!(await ctx.repos.invitations.open([account.id])).length) throw conflict('srv.invite.accepted');
  await issueInvitation(ctx, account, ctx.user);
  const b = (await invitationBriefs(ctx, [account.id])).get(account.id);
  if (!b) throw notFound();
  return b;
}

/** GET /invitations: the open invitations of every portal (the MIG administrator). */
export async function listInvitations(ctx: AuthCtx): Promise<InvitationView[]> {
  if (!can(ctx.user, 'users.manage')) throw notFound();
  const now = ctx.now();
  const out: InvitationView[] = [];
  for (const x of await ctx.repos.invitations.open()) {
    const a = await invitedAccount(ctx, x.userId);
    if (!a || !a.active) continue;
    out.push({ ...brief(x, now), userId: a.id, fullName: a.fullName, email: a.email, portal: a.portal, ...(a.organization ? { organization: a.organization } : {}) });
  }
  return out.sort((a, b) => b.expiresAt.localeCompare(a.expiresAt));
}
