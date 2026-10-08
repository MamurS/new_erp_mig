/*
 * Sessions: the signed-in person is always rebuilt from the server-side record (role, company, clinic,
 * authority), never taken from the request. Idle sessions end on the server.
 */
import type { Role, SessionUser } from '@mig/contracts';
import { idleLimitsFor } from '../auth/home';
import type { SessionRow } from '../store/db';
import { unauthorized, type AuthCtx, type BaseCtx } from './kernel';

export async function sessionUserFor(ctx: BaseCtx, userId: string, role: Role): Promise<SessionUser | null> {
  const r = ctx.repos;
  if (role === 'hr') {
    const h = await r.hrUsers.get(userId);
    return h ? { id: h.id, role, displayName: h.fullName, companyId: h.companyId } : null;
  }
  if (role === 'clinic_registrar' || role === 'clinic_admin') {
    const u = await r.clinicUsers.get(userId);
    if (!u || !u.active) return null;
    // Role and clinic always come from the server-side record.
    return { id: u.id, role: u.role, displayName: u.fullName, clinicId: u.clinicId };
  }
  if (role === 'asst_operator' || role === 'asst_doctor' || role === 'asst_billing' || role === 'asst_admin') {
    const u = await r.assistUsers.get(userId);
    if (!u || !u.active) return null;
    // Role and assistance company always come from the server-side record.
    return { id: u.id, role: u.role, displayName: u.fullName, assistanceId: u.assistanceId };
  }
  if (role === 'insured') {
    const i = await r.insured.first({ where: { userId } });
    if (!i || i.status !== 'active') return null;
    const first = i.fullName.split(' ')[1] ?? i.fullName;
    return { id: i.userId, role, displayName: first, insuredId: i.id, consentGivenAt: i.consentGivenAt };
  }
  const s = await r.staff.get(userId);
  if (!s || !s.active) return null;
  // Role, authority and the signatory flag are always taken from the server-side record, never from the request.
  return { id: s.id, role: s.role, displayName: s.fullName, authority: s.authority, ...(s.signatory?.canSign ? { canSign: true } : {}) };
}

/**
 * The session of a request. `background`: a poll that is not the person's activity (X-Background: 1,
 * e.g. the notifications bell) does not extend the session.
 */
export async function resolveSession(ctx: BaseCtx, sessionId: string | null, opts: { background: boolean }): Promise<AuthCtx> {
  if (!sessionId) throw unauthorized();
  const session = await ctx.repos.sessions.get(sessionId);
  if (!session) throw unauthorized();
  const now = ctx.now();
  const { timeoutMs } = idleLimitsFor(session.role);
  if (now - session.lastActivity > timeoutMs + 60_000) {
    await ctx.repos.sessions.remove(session.id);
    throw unauthorized();
  }
  const user = await sessionUserFor(ctx, session.userId, session.role);
  if (!user) {
    await ctx.repos.sessions.remove(session.id);
    throw unauthorized();
  }
  const patch: Partial<SessionRow> = { role: user.role };
  if (!opts.background) patch.lastActivity = now;
  const updated = await ctx.repos.sessions.update(session.id, patch);
  return { ...ctx, user, session: updated };
}
