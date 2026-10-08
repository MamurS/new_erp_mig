/* Sign-in and sessions. The logic is the shared service (packages/domain/src/services/auth.ts); this is the MSW adapter. */
import { http } from 'msw';
import * as auth from '@mig/domain/services/auth';
import { API, authCtx, baseCtx, readJson, route } from '../http';

export const authHandlers = [
  http.post(`${API}/auth/login`, route(async ({ request }) => auth.login(baseCtx(), await readJson(request)))),
  http.post(`${API}/auth/resend`, route(async ({ request }) => auth.resend(baseCtx(), await readJson(request)))),
  http.post(`${API}/auth/otp`, route(async ({ request }) => auth.otp(baseCtx(), await readJson(request)))),
  http.post(`${API}/auth/phone`, route(async ({ request }) => auth.phoneLogin(baseCtx(), await readJson(request)))),
  http.post(`${API}/auth/phone/verify`, route(async ({ request }) => auth.phoneVerify(baseCtx(), await readJson(request)))),
  http.post(
    `${API}/auth/logout`,
    route(async ({ request, url }) => auth.logout(await authCtx(request).catch(() => null), url.searchParams.get('all') === '1')),
  ),
  http.get(`${API}/auth/me`, route(async ({ request }) => auth.me(await authCtx(request)))),
];
