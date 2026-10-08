import { setupServer } from 'msw/node';
import { handlers } from './handlers';
import { demoHandlers } from './handlers/demo';
import { initMockDb } from './setup';
import { resetDb } from './db';
import { enableCookieJar } from './http';
import { setMockCookie } from './persist';

/** `cookieJar`: the session cookie kept on the mock's side, as the browser keeps it (component tests). */
export function createMockServer(o: { cookieJar?: boolean } = {}) {
  enableCookieJar(!!o.cookieJar);
  setMockCookie(null);
  initMockDb({ restore: false });
  resetDb();
  return setupServer(...demoHandlers, ...handlers);
}
