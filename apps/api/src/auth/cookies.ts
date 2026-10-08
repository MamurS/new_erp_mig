/*
 * The session cookie of the BFF (BACKEND_SPEC §2.4, §7): `__Host-mig_session` with `HttpOnly; Secure;
 * SameSite=Strict; Path=/` and no Domain, so it is bound to the API's own origin. Local development over plain
 * http (APP_ENV=development only) may use `mig_session` without `Secure` (browsers refuse `__Host-` cookies
 * without it). No cookie library: one name, one opaque value.
 */
export const SESSION_COOKIE = '__Host-mig_session';
export const DEV_SESSION_COOKIE = 'mig_session';

export interface CookiePolicy {
  name: string;
  secure: boolean;
}

export function cookiePolicy(insecureDev: boolean): CookiePolicy {
  return insecureDev ? { name: DEV_SESSION_COOKIE, secure: false } : { name: SESSION_COOKIE, secure: true };
}

/** `Set-Cookie` for the session (a browser-session cookie: the server ends it on idle and on logout). */
export function sessionCookie(p: CookiePolicy, value: string): string {
  return `${p.name}=${value}; Path=/; HttpOnly;${p.secure ? ' Secure;' : ''} SameSite=Strict`;
}

/** `Set-Cookie` removing the session cookie. */
export function clearedCookie(p: CookiePolicy): string {
  return `${p.name}=; Path=/; HttpOnly;${p.secure ? ' Secure;' : ''} SameSite=Strict; Max-Age=0`;
}

export { readCookie } from '@mig/domain/http/csrf';
