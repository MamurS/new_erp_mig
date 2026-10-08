/*
 * The cookie session and its CSRF rule, the same in both adapters (BACKEND_SPEC §7): the session is an HttpOnly
 * cookie, and every mutating request of the portals carries `X-Requested-With: mig-web` (403 otherwise). The
 * partner API (its own bearer tokens, no cookie) is exempt.
 */
import { PARTNER_BASE, type RouteDef } from './routes';

/** The header every mutating request of the web app sends, and its value. */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'mig-web';

/** Cookie-authenticated mutations need the CSRF header; the partner API (bearer tokens) does not. */
export const needsCsrf = (r: Pick<RouteDef, 'method' | 'path' | 'auth'>): boolean =>
  r.method !== 'GET' && r.auth !== 'partner' && !r.path.startsWith(`${PARTNER_BASE}/`);

/** Whether a request passes the CSRF rule. */
export const hasCsrfHeader = (headers: Headers): boolean => headers.get(CSRF_HEADER) === CSRF_VALUE;

/** The value of a cookie in a `Cookie` header. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}
