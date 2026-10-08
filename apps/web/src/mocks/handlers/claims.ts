/*
 * Claims, their files and the operator's appointments. The logic is the shared service
 * (packages/domain/src/services/claims.ts); this is the MSW adapter: it reads the multipart form and
 * builds the file responses (seeded receipts are drawn on a canvas here).
 */
import { http, HttpResponse } from 'msw';
import * as claims from '@mig/domain/services/claims';
import { API, authCtx, param, readJson, route } from '../http';
import { formFiles, formText, readForm } from '../uploads';
import { renderReceiptPng } from '../receipt';

async function fileResponse(f: claims.FileContent): Promise<Response> {
  const bytes = f.bytes ?? (await renderReceiptPng(f.seedText ?? []));
  return new HttpResponse(bytes, {
    headers: {
      'Content-Type': f.mime,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(f.download ? { 'Content-Disposition': `attachment; filename="${f.download}"` } : {}),
    },
  });
}

export const claimHandlers = [
  http.get(`${API}/claims`, route(async ({ request, url }) => claims.listClaims(await authCtx(request), url.searchParams))),
  http.get(`${API}/claims/:id`, route(async (c) => claims.claimDetail(await authCtx(c.request), param(c, 'id')))),
  http.post(`${API}/claims/:id/transition`, route(async (c) => claims.transition(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.post(
    `${API}/claims`,
    route(async ({ request }) => {
      const ctx = await authCtx(request);
      const form = await readForm(request);
      const fields = {
        insuredId: formText(form, 'insuredId'),
        intakeChannel: formText(form, 'intakeChannel'),
        category: formText(form, 'category'),
        amount: formText(form, 'amount'),
        serviceDate: formText(form, 'serviceDate'),
        providerName: formText(form, 'providerName'),
      };
      return claims.createClaim(ctx, fields, await formFiles(form, 'files'));
    }),
  ),
  // ---- files ----
  http.get(`${API}/files/:id`, route(async (c) => fileResponse(await claims.getFile(await authCtx(c.request), param(c, 'id'))))),
  // ---- appointments (staff) ----
  http.get(`${API}/appointments`, route(async ({ request, url }) => claims.listAppointments(await authCtx(request), url.searchParams))),
  http.post(`${API}/appointments/:id/confirm`, route(async (c) => claims.confirmAppointment(await authCtx(c.request), param(c, 'id')))),
  http.post(`${API}/appointments/:id/decline`, route(async (c) => claims.declineAppointment(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.post(`${API}/appointments`, route(async ({ request }) => claims.createAppointment(await authCtx(request), await readJson(request)))),
];
