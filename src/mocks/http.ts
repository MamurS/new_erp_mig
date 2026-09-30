/* Mock server plumbing: sessions, permissions, validation, errors, latency, pagination. */
import { delay, HttpResponse, type DefaultBodyType, type HttpResponseResolver, type PathParams } from 'msw';
import type { ZodTypeAny, z } from 'zod';
import type { ApiError, AuditAction, AuditEntry, Role, SessionUser } from '@/shared/types';
import { can, type Action, type PermissionContext } from '@/shared/auth/permissions';
import { idleLimitsFor } from '@/shared/auth/home';
import { db } from './db';
import type { Db, SessionRow } from './db';
import { mockConfig } from './config';
import { saveSessions, scheduleSaveDb } from './persist';
import { randomId } from './rng';
import { tzIso } from './time';

export const API = '*/api';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiError['code'],
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const unauthorized = () => new HttpError(401, 'unauthorized', 'Сессия завершена, войдите снова');
export const forbidden = () => new HttpError(403, 'forbidden', 'Недостаточно прав для этого действия');
export const notFound = () => new HttpError(404, 'not_found', 'Не найдено');
export const conflict = (message: string) => new HttpError(409, 'conflict', message);

export function errorResponse(e: HttpError): Response {
  const body: ApiError = { code: e.code, message: e.message };
  if (e.fields) body.fields = e.fields;
  return HttpResponse.json(body, { status: e.status });
}

export interface Ctx {
  request: Request;
  params: PathParams;
  url: URL;
}

function isMutation(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

/** Wraps a handler with latency, failure injection, error mapping and persistence. */
export function route(
  fn: (ctx: Ctx) => Promise<unknown> | unknown,
): HttpResponseResolver<PathParams, DefaultBodyType, DefaultBodyType> {
  return async ({ request, params }) => {
    const [lo, hi] = mockConfig.latency;
    if (hi > 0) await delay(lo + Math.floor(Math.random() * (hi - lo)));
    const url = new URL(request.url);
    const isDemoEndpoint = url.pathname.startsWith('/api/__demo');
    if (mockConfig.failures && !isDemoEndpoint && Math.random() < 0.1) {
      return HttpResponse.json(
        { code: 'server', message: 'Сервис временно недоступен. Повторите попытку' } satisfies ApiError,
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
        { code: 'server', message: 'Внутренняя ошибка сервера' } satisfies ApiError,
        { status: 500 },
      );
    } finally {
      const d = db();
      saveSessions(d);
      if (isMutation(request.method)) scheduleSaveDb(db);
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
  // Role is always taken from the server-side record, never from the request.
  return { id: s.id, role: s.role, displayName: s.fullName };
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
  session.lastActivity = now;
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
    if (text.length > 1_000_000) throw new HttpError(413 as number, 'validation', 'Слишком большой запрос');
    return text ? (JSON.parse(text) as unknown) : {};
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'validation', 'Некорректный JSON');
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
  throw new HttpError(422, 'validation', 'Проверьте заполнение полей', fields);
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
export function pageParams(url: URL): { page: number; pageSize: number } {
  const page = Math.max(1, Math.min(10_000, Number(url.searchParams.get('page')) || 1));
  const pageSize = Math.max(1, Math.min(100, Number(url.searchParams.get('pageSize')) || 25));
  return { page, pageSize };
}

export function paginate<T>(items: T[], url: URL): { items: T[]; total: number; page: number; pageSize: number } {
  const { page, pageSize } = pageParams(url);
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
}

/** `?sort=premium:desc` over an allow-list of keys. */
export function sortBy<T>(items: T[], url: URL, allowed: Record<string, (x: T) => string | number | null | undefined>, fallback?: string): T[] {
  const raw = url.searchParams.get('sort') ?? fallback ?? '';
  const [key = '', dir = 'asc'] = raw.split(':');
  const get = allowed[key];
  if (!get) return items;
  const mul = dir === 'desc' ? -1 : 1;
  return [...items].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (va === vb) return 0;
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul;
    return String(va).localeCompare(String(vb), 'ru') * mul;
  });
}

export function q(url: URL): string {
  return (url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 100);
}

export function param(ctx: Ctx, key: string): string {
  const v = ctx.params[key];
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw notFound();
  return v;
}
