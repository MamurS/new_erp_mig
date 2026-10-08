/*
 * One request reader for both HTTP adapters (BACKEND_SPEC §4.3): the MSW adapter hands over the browser's
 * `Request`, the Fastify adapter builds a `Request` from the raw body it received. The body is read once
 * (lazily, when the service asks for it) and then served as JSON, text or a multipart form, with the same
 * limits and the same errors in both places.
 */
import { DomainError, notFound } from '../services/kernel';
import type { UploadedFile } from '../lib/uploads';

/** A multipart form as plain values: the first text value of every field, the files of every field. */
export interface FormInput {
  fields: Record<string, string>;
  files: Record<string, UploadedFile[]>;
}

/** What a route of the table (routes.ts) gets from the request. */
export interface RouteRequest {
  method: string;
  url: URL;
  query: URLSearchParams;
  /** Raw path parameters. */
  params: Readonly<Record<string, string | undefined>>;
  header(name: string): string | null;
  /** When the request arrived (before the mock's simulated latency): the partner API call log. */
  startedAt: number;
  /** A UUID path parameter; anything else is 404 (anti-enumeration, no database round trip). */
  id(key: string): string;
  /** The JSON body: `{}` when empty, 400 when not JSON, 413 above 1 MB. */
  json(): Promise<unknown>;
  /** The body as text ('' when there is none). */
  text(): Promise<string>;
  /** The multipart (or url-encoded) form; null when the body is not a readable form. */
  form(): Promise<FormInput | null>;
}

const UUID_LIKE = /^[0-9a-f-]{36}$/i;

/** A UUID-looking path parameter or 404 (the same rule as before the route table). */
export function idParam(params: RouteRequest['params'], key: string): string {
  const v = params[key];
  if (typeof v !== 'string' || !UUID_LIKE.test(v)) throw notFound();
  return v;
}

export async function parseForm(bytes: Uint8Array, contentType: string | null): Promise<FormInput | null> {
  let form: FormData;
  try {
    form = await new Response(bytes as Uint8Array<ArrayBuffer>, { headers: contentType ? { 'content-type': contentType } : {} }).formData();
  } catch {
    return null;
  }
  const out: FormInput = { fields: {}, files: {} };
  for (const [name, value] of form.entries()) {
    if (typeof value === 'string') {
      if (!(name in out.fields)) out.fields[name] = value;
    } else {
      (out.files[name] ??= []).push({ name: value.name, type: value.type, bytes: new Uint8Array(await value.arrayBuffer()) });
    }
  }
  return out;
}

/**
 * The reader over a Fetch `Request` (`params`: the router's path parameters). The body stream is consumed
 * at most once.
 */
export function routeRequest(request: Request, params: Readonly<Record<string, string | readonly string[] | undefined>>, startedAt = Date.now()): RouteRequest {
  const url = new URL(request.url);
  let bytes: Promise<Uint8Array> | null = null;
  const body = () => (bytes ??= request.arrayBuffer().then((b) => new Uint8Array(b)));
  const text = async () => new TextDecoder().decode(await body());
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(params)) flat[k] = typeof v === 'string' ? v : undefined;
  return {
    method: request.method,
    url,
    query: url.searchParams,
    params: flat,
    header: (name) => request.headers.get(name),
    startedAt,
    id: (key) => idParam(flat, key),
    text,
    async json() {
      try {
        const t = await text();
        if (t.length > 1_000_000) throw new DomainError(413, 'validation', 'errors.tooLarge');
        return t ? (JSON.parse(t) as unknown) : {};
      } catch (e) {
        if (e instanceof DomainError) throw e;
        throw new DomainError(400, 'validation', 'errors.badJson');
      }
    },
    async form() {
      return parseForm(await body(), request.headers.get('content-type'));
    },
  };
}

/** The form or 400 (`srv.form.invalid`). */
export async function requireForm(req: RouteRequest): Promise<FormInput> {
  const f = await req.form();
  if (!f) throw new DomainError(400, 'validation', 'srv.form.invalid');
  return f;
}

/** A text field of a form (`null` when absent). */
export const formText = (form: FormInput, field: string): string | null => form.fields[field] ?? null;

/** The files of a form field. */
export const formFiles = (form: FormInput, field: string): UploadedFile[] => form.files[field] ?? [];

/** The first file of a form field with its size. */
export function formFile(form: FormInput, field: string): { size: number; bytes: Uint8Array } | null {
  const f = form.files[field]?.[0];
  return f ? { size: f.bytes.length, bytes: f.bytes } : null;
}
