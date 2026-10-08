/* Mock server plumbing: sessions, permissions, validation, errors, latency, pagination. */
import { delay, HttpResponse, type DefaultBodyType, type HttpResponseResolver, type PathParams } from 'msw';
import type { ZodTypeAny, z } from 'zod';
import type { ApiError, AuditAction, AuditEntry, Role, SessionUser } from '@mig/contracts';
import { can, type Action, type PermissionContext } from '@mig/domain/auth/permissions';
import { idleLimitsFor } from '@mig/domain/auth/home';
import { db } from './db';
import type { Db, SessionRow } from './db';
import { mockConfig } from './config';
import { saveSessions, scheduleSaveDb } from './persist';
import { DomainError as HttpError, forbidden, notFound, unauthorized, type AuthCtx, type BaseCtx } from '@mig/domain/services/kernel';
import { resolveSession } from '@mig/domain/services/session';
import { memoryRepos } from '@mig/domain/store/memory';
import { randomId } from '@mig/seed/rng';
import { tzIso } from '@mig/seed/time';

// The mock answers only at the API address. A pattern with any prefix before /api would also catch
// the dev server's own modules (/src/shared/api/queries/params.ts) and answer them with a 404.
function apiBase(): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api';
  if (/^https?:\/\//.test(base)) return base.replace(/\/$/, '');
  return typeof location !== 'undefined' ? `${location.origin}${base}` : `*${base}`;
}
export const API = apiBase();

// Errors, validation and list helpers are shared with the API server (packages/domain/src/services).
export { DomainError as HttpError, unauthorized, forbidden, notFound, conflict, messageKey, errorOf as httpErrorOf } from '@mig/domain/services/kernel';

export function errorResponse(e: HttpError): Response {
  return HttpResponse.json(e.body(), { status: e.status });
}

// ---------- the service adapter ----------
/** The repositories over the in-memory database (the same services run on Postgres in the API). */
export const repos = memoryRepos(db);

export function baseCtx(): BaseCtx {
  return { repos, now: () => Date.now(), env: { demo: import.meta.env.VITE_DEMO_MODE === 'true' } };
}

function bearer(request: Request): string | null {
  const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(request.headers.get('authorization') ?? '');
  return m?.[1] ?? null;
}

/** The signed-in person of the request (401 otherwise), as the services' context. */
export function authCtx(request: Request): Promise<AuthCtx> {
  return resolveSession(baseCtx(), bearer(request), { background: request.headers.get('X-Background') === '1' });
}

export interface Ctx {
  request: Request;
  params: PathParams;
  url: URL;
}

function isMutation(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

/**
 * Wraps a handler with latency, failure injection, error mapping and persistence.
 * `noFailures`: the simulated 500s never hit this route (the demo controls themselves).
 * `writes`: a GET that changes data, persisted like a mutation.
 */
export function route(
  fn: (ctx: Ctx) => Promise<unknown> | unknown,
  opts: { noFailures?: boolean; writes?: boolean } = {},
): HttpResponseResolver<PathParams, DefaultBodyType, DefaultBodyType> {
  return async ({ request, params }) => {
    const [lo, hi] = mockConfig.latency;
    if (hi > 0) await delay(lo + Math.floor(Math.random() * (hi - lo)));
    const url = new URL(request.url);
    if (mockConfig.failures && !opts.noFailures && Math.random() < 0.1) {
      return HttpResponse.json(
        { code: 'server', key: 'errors.server' } satisfies ApiError,
        { status: 500 },
      );
    }
    try {
      const out = await fn({ request, params, url });
      if (out instanceof Response) return out;
      if (out === undefined) return new HttpResponse(null, { status: 204 });
      return HttpResponse.json(out as DefaultBodyType);
    } catch (e) {
      if (e instanceof HttpError) return errorResponse(e);
      return HttpResponse.json(
        { code: 'server', key: 'errors.internal' } satisfies ApiError,
        { status: 500 },
      );
    } finally {
      const d = db();
      saveSessions(d);
      if (isMutation(request.method) || opts.writes) scheduleSaveDb(db);
    }
  };
}

// ---------- sessions ----------
export interface Auth {
  user: SessionUser;
  session: SessionRow;
}

export function sessionUserFor(d: Db, userId: string, role: Role): SessionUser | null {
  if (role === 'hr') {
    const h = d.hrUsers.find((u) => u.id === userId);
    return h ? { id: h.id, role, displayName: h.fullName, companyId: h.companyId } : null;
  }
  if (role === 'clinic_registrar' || role === 'clinic_admin') {
    const u = d.clinicUsers.find((x) => x.id === userId);
    if (!u || !u.active) return null;
    // Role and clinic always come from the server-side record.
    return { id: u.id, role: u.role, displayName: u.fullName, clinicId: u.clinicId };
  }
  if (role === 'asst_operator' || role === 'asst_doctor' || role === 'asst_billing' || role === 'asst_admin') {
    const u = d.assistUsers.find((x) => x.id === userId);
    if (!u || !u.active) return null;
    // Role and assistance company always come from the server-side record.
    return { id: u.id, role: u.role, displayName: u.fullName, assistanceId: u.assistanceId };
  }
  if (role === 'insured') {
    const i = d.insured.find((x) => x.userId === userId);
    if (!i || i.status !== 'active') return null;
    const first = i.fullName.split(' ')[1] ?? i.fullName;
    return { id: i.userId, role, displayName: first, insuredId: i.id, consentGivenAt: i.consentGivenAt };
  }
  const s = d.staff.find((u) => u.id === userId);
  if (!s || !s.active) return null;
  // Role, authority and the signatory flag are always taken from the server-side record, never from the request.
  return { id: s.id, role: s.role, displayName: s.fullName, authority: s.authority, ...(s.signatory?.canSign ? { canSign: true } : {}) };
}

/** Resolves the session from the bearer token. Client-supplied role headers are ignored. */
export function requireSession(request: Request): Auth {
  const header = request.headers.get('authorization') ?? '';
  const m = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(header);
  if (!m) throw unauthorized();
  const d = db();
  const session = d.sessions.find((s) => s.id === m[1]);
  if (!session) throw unauthorized();
  const now = Date.now();
  const { timeoutMs } = idleLimitsFor(session.role);
  if (now - session.lastActivity > timeoutMs + 60_000) {
    d.sessions = d.sessions.filter((s) => s !== session);
    throw unauthorized();
  }
  const user = sessionUserFor(d, session.userId, session.role);
  if (!user) {
    d.sessions = d.sessions.filter((s) => s !== session);
    throw unauthorized();
  }
  session.role = user.role;
  // A background poll (X-Background: 1, e.g. the notifications bell) is not the person's activity.
  if (request.headers.get('X-Background') !== '1') session.lastActivity = now;
  return { user, session };
}

export function requirePermission(user: SessionUser, action: Action, ctx?: PermissionContext): void {
  if (!can(user, action, ctx)) throw forbidden();
}

/** For scoped resources: an out-of-scope id is reported as missing (anti-enumeration). */
export function requireOwn(user: SessionUser, action: Action, ctx: PermissionContext): void {
  if (!can(user, action)) throw forbidden();
  if (!can(user, action, ctx)) throw notFound();
}

// ---------- validation ----------
export async function readJson(request: Request): Promise<unknown> {
  try {
    const text = await request.text();
    if (text.length > 1_000_000) throw new HttpError(413 as number, 'validation', 'errors.tooLarge');
    return text ? (JSON.parse(text) as unknown) : {};
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'validation', 'errors.badJson');
  }
}

export function validate<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data as z.output<S>;
  const fields: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  throw new HttpError(422, 'validation', 'errors.validation', { fields });
}

export async function body<S extends ZodTypeAny>(request: Request, schema: S): Promise<z.output<S>> {
  return validate(schema, await readJson(request));
}

// ---------- audit ----------
export function audit(
  actor: Pick<SessionUser, 'id' | 'displayName' | 'role'> & { assistanceId?: string },
  action: AuditAction,
  target: Pick<AuditEntry, 'targetType'> & Partial<Pick<AuditEntry, 'targetId' | 'targetLabel' | 'reason' | 'assistanceId'>>,
): void {
  // Actions of assistance users are tagged with their company (ASSISTANCE_SPEC §3).
  const assistanceId = actor.assistanceId ?? target.assistanceId;
  db().audit.unshift({
    id: randomId(),
    at: tzIso(Date.now()),
    actorId: actor.id,
    actorName: actor.displayName,
    actorRole: actor.role,
    action,
    ...target,
    ...(assistanceId ? { assistanceId } : {}),
  });
}

export function insuredLabel(id: string): string {
  return `Застрахованный #${id.slice(0, 4)}`;
}

// ---------- lists ----------
export { pageParams, paginate, sortBy, byLegalName, byLegalForm, legalFormsParam, filterLegalForm, q } from '@mig/domain/services/list';

export function param(ctx: Ctx, key: string): string {
  const v = ctx.params[key];
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw notFound();
  return v;
}
