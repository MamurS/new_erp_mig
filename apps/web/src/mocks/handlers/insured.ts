/* Insured people in the staff portal. The logic is the shared service (packages/domain/src/services/insured.ts); this is the MSW adapter. */
import { http } from 'msw';
import * as insured from '@mig/domain/services/insured';
import { API, authCtx, param, readJson, route } from '../http';

export const insuredHandlers = [
  http.get(`${API}/insured`, route(async ({ request, url }) => insured.list(await authCtx(request), url))),
  http.get(`${API}/insured/:id`, route(async (c) => insured.detail(await authCtx(c.request), param(c, 'id')))),
  http.get(`${API}/insured/:id/limits`, route(async (c) => insured.limits(await authCtx(c.request), param(c, 'id')))),
  http.get(`${API}/insured/:id/claims`, route(async (c) => insured.claims(await authCtx(c.request), param(c, 'id')))),
  http.get(`${API}/insured/:id/documents`, route(async (c) => insured.documents(await authCtx(c.request), param(c, 'id')))),
  http.get(`${API}/insured/:id/access-log`, route(async (c) => insured.accessLog(await authCtx(c.request), param(c, 'id')))),
  http.post(`${API}/insured/:id/reveal`, route(async (c) => insured.reveal(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.post(`${API}/insured/:id/reveal-copied`, route(async (c) => insured.revealCopied(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.post(`${API}/insured/:id/medical-access`, route(async (c) => insured.medicalAccess(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.get(
    `${API}/insured/:id/medical`,
    route(async (c) => insured.medical(await authCtx(c.request), param(c, 'id'), c.request.headers.get('x-medical-grant') ?? '')),
  ),
  http.post(`${API}/insured/:id/guarantee-letters`, route(async (c) => insured.issueGuaranteeLetter(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
];
