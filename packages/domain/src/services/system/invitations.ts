/*
 * Invitations of e-mail accounts (stage 1.5) — the system's part: the account behind an invitation, whichever portal
 * it belongs to (a MIG administrator resends an HR or clinic invitation the RLS of staff does not show), and the mail
 * job that sends the invitation e-mails (the API worker on every pass, the mock before a request). Privileged access:
 * this folder (services/system/) is on the allowlist of the lint rule against it (eslint.config.js).
 */
import type { AccountPortal } from '@mig/contracts';
import { translate } from '@mig/i18n';
import { formatDateDoc } from '../../lib/format';
import { tzIso } from '../../lib/time';
import { asSystem, type BaseCtx } from '../kernel';

export interface InvitedAccount {
  id: string;
  email: string;
  fullName: string;
  portal: AccountPortal;
  active: boolean;
  /** The company, clinic or assistance of the account. */
  organization?: string;
  clinicId?: string;
  assistanceId?: string;
  role: string;
}

/** The e-mail account `userId` in any portal (system: the reader's RLS may not show it). */
export async function invitedAccount(person: BaseCtx, userId: string): Promise<InvitedAccount | null> {
  const r = asSystem(person, 'invitations: the account of an invitation in any portal').repos;
  const s = await r.staff.get(userId);
  if (s) return { id: s.id, email: s.email, fullName: s.fullName, portal: 'staff', active: s.active, role: s.role };
  const h = await r.hrUsers.get(userId);
  if (h) {
    const c = await r.clients.get(h.companyId);
    return { id: h.id, email: h.email, fullName: h.fullName, portal: 'hr', active: true, role: 'hr', ...(c ? { organization: c.name } : {}) };
  }
  const cu = await r.clinicUsers.get(userId);
  if (cu) {
    const c = await r.clinics.get(cu.clinicId);
    return { id: cu.id, email: cu.email, fullName: cu.fullName, portal: 'clinic', active: cu.active, role: cu.role, clinicId: cu.clinicId, ...(c ? { organization: c.name } : {}) };
  }
  const au = await r.assistUsers.get(userId);
  if (au) {
    const a = await r.assistances.get(au.assistanceId);
    return { id: au.id, email: au.email, fullName: au.fullName, portal: 'assist', active: au.active, role: au.role, assistanceId: au.assistanceId, ...(a ? { organization: a.name } : {}) };
  }
  return null;
}

/** An e-mail to send (plain text: no HTML, nothing of it is interpreted). */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}
export interface Mailer {
  send(m: MailMessage): Promise<void>;
}

/** The invitation e-mail (Russian: the portals of MIG, HR, clinics and assistance are in Russian). */
export function invitationMail(a: InvitedAccount, link: string, expiresAt: number): MailMessage {
  const portal = translate('ru', `auth.invite.mail.portal.${a.portal}`);
  return {
    to: a.email,
    subject: translate('ru', 'auth.invite.mail.subject'),
    text: translate('ru', 'auth.invite.mail.body', {
      name: a.fullName,
      portal: a.organization ? `${portal} (${a.organization})` : portal,
      until: formatDateDoc(tzIso(expiresAt)),
      link,
    }),
  };
}

/** The link of an invitation: the token is in the fragment, so it never reaches a server log or a Referer. */
export function invitationLink(baseUrl: string, token: string): string {
  return `${new URL('/invite', baseUrl).toString()}#${token}`;
}

/**
 * The mail job: every open invitation whose e-mail has not left is sent (leased, so two workers never send one twice;
 * a failure is retried after the lease). An invitation of an account that is gone or deactivated is dropped unsent.
 * Returns the counts; nothing of the e-mails is logged.
 */
export async function sendInvitations(person: BaseCtx, mailer: Mailer, baseUrl: string): Promise<{ sent: number; failed: number }> {
  const ctx = asSystem(person, 'the mail job of invitations');
  const out = { sent: 0, failed: 0 };
  for (const inv of await ctx.repos.invitations.unsent(20, ctx.now())) {
    const account = await invitedAccount(ctx, inv.userId);
    if (!account || !account.active || !inv.token) {
      await ctx.repos.invitations.sent(inv.id, ctx.now());
      continue;
    }
    try {
      await mailer.send(invitationMail(account, invitationLink(baseUrl, inv.token), inv.expiresAt));
      await ctx.repos.invitations.sent(inv.id, ctx.now());
      out.sent += 1;
    } catch {
      out.failed += 1;
    }
  }
  return out;
}
