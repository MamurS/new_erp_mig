/*
 * The service layer's plumbing (BACKEND_SPEC §4): services are functions `(ctx, input) → result` that
 * throw a DomainError; an adapter (MSW in the browser, Fastify on the server) turns the result or the
 * error into the same HTTP answer. Nothing here knows about HTTP requests.
 */
import type { ZodTypeAny, z } from 'zod';
import type { ApiError, AuditAction, AuditEntry, SessionUser } from '@mig/contracts';
import { hasKey, unpack, type I18nKey, type Params } from '@mig/i18n';
import { can, type Action, type PermissionContext } from '../auth/permissions';
import { isStaffRole } from '../labels';
import { randomId } from '../lib/random';
import { isoDay, tzIso } from '../lib/time';
import type { SessionRow } from '../store/db';
import type { Repos } from '../store/repo';

/**
 * Errors carry only a code, a message key and its params (no text): the client picks the text in its
 * language. Field errors are packed keys, see msg() in @mig/i18n.
 */
export class DomainError extends Error {
  readonly params?: Params;
  readonly fields?: Record<string, string>;
  constructor(
    readonly status: number,
    readonly code: ApiError['code'],
    readonly key: I18nKey,
    opts: { params?: Params; fields?: Record<string, string> } = {},
  ) {
    super(key);
    this.params = opts.params;
    this.fields = opts.fields;
  }

  /** The JSON body of the HTTP answer. */
  body(): ApiError {
    const b: ApiError = { code: this.code, key: this.key };
    if (this.params) b.params = this.params;
    if (this.fields) b.fields = this.fields;
    return b;
  }
}

export const unauthorized = () => new DomainError(401, 'unauthorized', 'errors.unauthorized');
export const forbidden = () => new DomainError(403, 'forbidden', 'errors.forbidden');
export const notFound = () => new DomainError(404, 'not_found', 'errors.notFound');
export const conflict = (key: I18nKey, params?: Params) => new DomainError(409, 'conflict', key, { params });

/**
 * A message produced by shared code (domain rules): a packed key from msg(), or plain text while that
 * code still returns text (sent as `srv.text` with the text as a param).
 */
export function messageKey(message: string): { key: I18nKey; params?: Params } {
  const { key, params } = unpack(message);
  return hasKey(key) ? { key: key as I18nKey, params } : { key: 'srv.text', params: { text: message } };
}

/** DomainError from a shared-code message (see messageKey). */
export function errorOf(status: number, code: ApiError['code'], message: string, fields?: Record<string, string>): DomainError {
  const { key, params } = messageKey(message);
  return new DomainError(status, code, key, { params, fields });
}

/** Validates input with the same zod schema as the form; 422 with field errors otherwise. */
export function validate<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data as z.output<S>;
  const fields: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  throw new DomainError(422, 'validation', 'errors.validation', { fields });
}

/** What every service gets: the storage, the clock and the deployment's switches. */
export interface BaseCtx {
  repos: Repos;
  now(): number;
  env: ServiceEnv;
  /**
   * The narrow privileged capability (BACKEND_SPEC §2.3): repositories that bypass row-level security, for
   * the few cross-scope side effects a role's RLS does not allow by design (docs/backend/RLS.md, «systemDb»).
   * Absent in the mock (one database without RLS). Use only through `systemRepos()`; every use is listed in
   * docs/DECISIONS.md.
   */
  system?: { repos: Repos };
}

/**
 * Repositories for a cross-scope side effect the person's own access does not cover (RLS in the API): the
 * privileged ones when the adapter provides them, the ordinary ones in the mock. `why` documents the use.
 */
export function systemRepos(ctx: BaseCtx, why: string): Repos {
  void why;
  return ctx.system?.repos ?? ctx.repos;
}

/** The context with `systemRepos` (for helpers that take a context). */
export function asSystem<C extends BaseCtx>(ctx: C, why: string): C {
  return { ...ctx, repos: systemRepos(ctx, why) };
}

export interface ServiceEnv {
  /** Demo deployment (demo accounts, demo endpoints). */
  demo: boolean;
}

/** A signed-in person: resolved by the adapter from the session before the service runs. */
export interface AuthCtx extends BaseCtx {
  user: SessionUser;
  session: SessionRow;
}

export function requirePermission(user: SessionUser, action: Action, pctx?: PermissionContext): void {
  if (!can(user, action, pctx)) throw forbidden();
}

/** Only MIG staff (403 otherwise); returns the person. */
export function requireStaff(ctx: Pick<AuthCtx, 'user'>): SessionUser {
  if (!isStaffRole(ctx.user.role)) throw forbidden();
  return ctx.user;
}

/** For scoped resources: an out-of-scope id is reported as missing (anti-enumeration). */
export function requireOwn(user: SessionUser, action: Action, pctx: PermissionContext): void {
  if (!can(user, action)) throw forbidden();
  if (!can(user, action, pctx)) throw notFound();
}

export { tzIso } from '../lib/time';

/** Today's date (`YYYY-MM-DD`, Tashkent) of the context's clock. */
export const todayIso = (ctx: Pick<BaseCtx, 'now'>): string => isoDay(ctx.now());

export type AuditActor = Pick<SessionUser, 'id' | 'displayName' | 'role'> & { assistanceId?: string };
export type AuditTarget = Pick<AuditEntry, 'targetType'> & Partial<Pick<AuditEntry, 'targetId' | 'targetLabel' | 'reason' | 'assistanceId'>>;

/** Writes an audit entry (newest first). */
export async function audit(ctx: BaseCtx, actor: AuditActor, action: AuditAction, target: AuditTarget): Promise<void> {
  // Actions of assistance users are tagged with their company (ASSISTANCE_SPEC §3).
  const assistanceId = actor.assistanceId ?? target.assistanceId;
  await ctx.repos.audit.insert(
    {
      id: randomId(),
      at: tzIso(ctx.now()),
      actorId: actor.id,
      actorName: actor.displayName,
      actorRole: actor.role,
      action,
      ...target,
      ...(assistanceId ? { assistanceId } : {}),
    },
    { at: 'start' },
  );
}

export function insuredLabel(id: string): string {
  return `Застрахованный #${id.slice(0, 4)}`;
}
