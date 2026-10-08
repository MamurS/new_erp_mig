/*
 * TEST HELPER of the mock's Node tests: a client of the mock that behaves like a browser of the API — it sends the
 * CSRF header and the session cookie, and remembers the cookie the last sign-in answer set (the answers carry no
 * session id, BACKEND_SPEC §7).
 */
import { MOCK_SESSION_COOKIE } from './http';

let last: string | null = null;

/**
 * Headers of a request with the session `sid` (the cookie; an empty one without a session) and the CSRF header of
 * the web app. MSW in Node emulates a cookie jar and appends the cookies it saw set to every request; the mock reads
 * the first `mig_session`, so the one given here wins and «no session» stays no session.
 */
export function withSession(headers: Headers, sid?: string | null): Headers {
  headers.set('X-Requested-With', 'mig-web');
  headers.set('Cookie', `${MOCK_SESSION_COOKIE}=${sid ?? ''}`);
  return headers;
}

/** Remembers the session cookie an answer sets. */
export function track(res: Response): Response {
  const set = res.headers.get('set-cookie') ?? '';
  const m = new RegExp(`(?:^|,\\s*)${MOCK_SESSION_COOKIE}=([^;]*)`).exec(set);
  if (m?.[1]) last = m[1];
  return res;
}

/** The session the last sign-in answer set (its value of the cookie). */
export function lastSession(): string {
  if (!last) throw new Error('no session cookie was set');
  const v = last;
  last = null;
  return v;
}
