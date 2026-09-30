/*
 * The only way screens talk to the API. Adds the bearer session, normalises errors into ApiError,
 * validates responses with zod and turns 401 into a logout.
 */
import type { z } from 'zod';
import type { ApiError } from '@/shared/types';
import { clearSession, getSessionId } from '@/shared/auth/session';
import { markActivity } from '@/shared/auth/activity';
import { logger } from '@/shared/lib/logger';

export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api';

export class ApiRequestError extends Error implements ApiError {
  readonly code: ApiError['code'];
  readonly status: number;
  readonly fields?: Record<string, string>;
  constructor(status: number, err: ApiError) {
    super(err.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = err.code;
    this.fields = err.fields;
  }
}

const GENERIC: Record<ApiError['code'], string> = {
  unauthorized: 'Сессия завершена, войдите снова',
  forbidden: 'Недостаточно прав для этого действия',
  not_found: 'Не найдено',
  validation: 'Проверьте заполнение полей',
  conflict: 'Действие невозможно в текущем состоянии',
  rate_limited: 'Слишком много попыток. Попробуйте позже',
  server: 'Сервис временно недоступен. Повторите попытку',
};

function codeFromStatus(status: number): ApiError['code'] {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 422 || status === 400) return 'validation';
  if (status === 429) return 'rate_limited';
  return 'server';
}

type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions<S extends z.ZodTypeAny | undefined> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
  schema?: S;
  /** Return raw text (CSV) or blob (files) instead of JSON. */
  as?: 'json' | 'text' | 'blob';
  signal?: AbortSignal;
}

export function buildUrl(path: string, query?: Query): string {
  const qs = new URLSearchParams();
  if (query)
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      qs.set(k, String(v));
    }
  const s = qs.toString();
  return `${API_BASE}${path}${s ? `?${s}` : ''}`;
}

let onUnauthorized: () => void = () => {
  clearSession({ notice: 'Сессия завершена, войдите снова', broadcast: false });
};
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

const AUTH_PATHS = ['/auth/login', '/auth/otp', '/auth/phone', '/auth/phone/verify'];

export async function request<S extends z.ZodTypeAny | undefined = undefined>(
  path: string,
  opts: RequestOptions<S> = {},
): Promise<S extends z.ZodTypeAny ? z.infer<S> : unknown> {
  markActivity();
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  const sid = getSessionId();
  if (sid) headers.Authorization = `Bearer ${sid}`;
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData || opts.body instanceof Blob) body = opts.body;
  else if (typeof opts.body === 'string' && opts.headers?.['Content-Type']) body = opts.body;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body,
      signal: opts.signal,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiRequestError(0, {
      code: 'server',
      message: 'Нет соединения с сервером. Проверьте интернет и повторите',
    });
  }

  if (!res.ok) {
    let err: ApiError = { code: codeFromStatus(res.status), message: GENERIC[codeFromStatus(res.status)] };
    try {
      const data = (await res.json()) as Partial<ApiError>;
      if (data && typeof data.message === 'string' && typeof data.code === 'string') err = data as ApiError;
    } catch {
      /* non-JSON error body */
    }
    // A 401 for a request sent with an older session (e.g. in flight during a role switch) must not end the new one.
    if (res.status === 401 && !AUTH_PATHS.includes(path) && sid === getSessionId()) onUnauthorized();
    throw new ApiRequestError(res.status, err);
  }

  if (opts.as === 'text') return (await res.text()) as never;
  if (opts.as === 'blob') return (await res.blob()) as never;
  if (res.status === 204) return undefined as never;
  const data: unknown = await res.json();
  if (!opts.schema) return data as never;
  const parsed = opts.schema.safeParse(data);
  if (!parsed.success) {
    logger.warn(`Response validation failed for ${path.replace(/[0-9a-f-]{36}/g, ':id')}`, {
      issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    throw new ApiRequestError(500, { code: 'server', message: 'Сервер вернул неожиданный ответ. Повторите позже' });
  }
  return parsed.data as never;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  return 'Что-то пошло не так. Повторите попытку';
}

export interface IntegrationCallResult {
  status: number;
  requestId: string | null;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * Call of the clinic integration API (/api/integration/v1) on behalf of a MIS: OAuth access token,
 * never the user's session, and a 401 here must not log the user out. Used by the sandbox and the
 * demo MIS simulator only.
 */
export async function integrationCall(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  opts: { token?: string; body?: unknown; form?: boolean; headers?: Record<string, string> } = {},
): Promise<IntegrationCallResult> {
  markActivity();
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    if (opts.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(opts.body as Record<string, string>).toString();
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
  }
  const res = await fetch(`${API_BASE}/integration/v1${path}`, { method, headers, body, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  const picked: Record<string, string> = {};
  for (const h of ['content-type', 'x-request-id', 'retry-after', 'idempotency-replayed', 'www-authenticate']) {
    const v = res.headers.get(h);
    if (v) picked[h] = v;
  }
  return { status: res.status, requestId: res.headers.get('x-request-id'), headers: picked, body: parsed };
}

/** Static JSON shipped with the app (e.g. the OpenAPI document of the integration API). */
export async function fetchPublicJson(path: string): Promise<unknown> {
  if (!/^\/docs\/[a-z0-9/_-]+\.json$/.test(path)) throw new Error('Unexpected static path');
  const res = await fetch(path, { credentials: 'omit', cache: 'no-cache', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new ApiRequestError(res.status, { code: codeFromStatus(res.status), message: 'Документация недоступна' });
  return res.json();
}
