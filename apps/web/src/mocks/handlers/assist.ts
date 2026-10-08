/*
 * Assistance company portal API (/api/assist/...), ASSISTANCE_SPEC §6. The logic is the shared service
 * (packages/domain/src/services/assistPortal.ts); this is the MSW adapter.
 */
import { http } from 'msw';
import * as svc from '@mig/domain/services/assistPortal';
import { DEMO_PASSWORD } from '@mig/seed/credentials';
import { db } from '../db';
import { API, authCtx, forbidden, notFound, param, readJson, requirePermission, requireSession, route } from '../http';
import { isAssistRole } from '@mig/domain/labels';
import { partnerIntegrationHandlers } from './partner-integration';

const A = `${API}/assist`;

export const assistHandlers = [
  // ---- desktop ----
  http.get(`${A}/overview`, route(async ({ request }) => svc.overview(await authCtx(request)))),

  // ---- insured persons ----
  http.get(`${A}/insured`, route(async ({ request, url }) => svc.searchInsured(await authCtx(request), url.searchParams))),
  http.get(`${A}/insured/:id`, route(async (c) => svc.insuredDetail(await authCtx(c.request), param(c, 'id')))),
  http.post(`${A}/insured/:id/reveal`, route(async (c) => svc.revealPii(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.post(`${A}/insured/:id/reveal-copied`, route(async (c) => svc.revealCopied(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.post(`${A}/insured/:id/medical-access`, route(async (c) => svc.medicalAccess(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),
  http.get(`${A}/insured/:id/medical`, route(async (c) => svc.medical(await authCtx(c.request), param(c, 'id'), c.request.headers.get('x-medical-grant') ?? ''))),

  // ---- cases ----
  http.get(`${A}/cases`, route(async ({ request, url }) => svc.listCases(await authCtx(request), url.searchParams))),
  http.get(`${A}/cases/:id`, route(async (c) => svc.getCase(await authCtx(c.request), param(c, 'id')))),
  http.post(`${A}/cases`, route(async ({ request }) => svc.createCase(await authCtx(request), await readJson(request)))),
  http.patch(`${A}/cases/:id`, route(async (c) => svc.updateCase(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),

  // ---- appointments ----
  http.get(`${A}/appointments`, route(async ({ request, url }) => svc.listAppointments(await authCtx(request), url.searchParams.get('view')))),
  http.post(`${A}/appointments`, route(async ({ request }) => svc.createAssistAppointment(await authCtx(request), await readJson(request)))),
  ...(['confirm', 'reschedule', 'decline'] as const).map((kind) =>
    http.post(
      `${A}/appointments/:id/${kind}`,
      route(async (c) => svc.answerAppointment(await authCtx(c.request), kind, param(c, 'id'), kind === 'confirm' ? undefined : await readJson(c.request))),
    ),
  ),

  // ---- chat with insured persons ----
  http.get(`${A}/chat`, route(async ({ request }) => svc.chatThreads(await authCtx(request)))),
  http.get(`${A}/chat/:insuredId`, route(async (c) => svc.chatMessages(await authCtx(c.request), param(c, 'insuredId')))),
  http.post(`${A}/chat/:insuredId`, route(async (c) => svc.sendChat(await authCtx(c.request), param(c, 'insuredId'), await readJson(c.request)))),

  // ---- guarantee letters ----
  http.get(`${A}/guarantees`, route(async ({ request, url }) => svc.listGuarantees(await authCtx(request), url.searchParams.get('status')))),
  http.post(`${A}/guarantees`, route(async ({ request }) => svc.requestGuaranteeOnCall(await authCtx(request), await readJson(request)))),
  http.get(`${A}/guarantees/:id`, route(async (c) => svc.getGuarantee(await authCtx(c.request), param(c, 'id')))),
  http.post(`${A}/guarantees/:id/decision`, route(async (c) => svc.decideGuarantee(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),

  // ---- clinic registries: own sub-registries ----
  http.get(`${A}/registries`, route(async ({ request }) => svc.listRegistries(await authCtx(request)))),
  http.get(`${A}/registries/:id`, route(async (c) => svc.getRegistry(await authCtx(c.request), param(c, 'id')))),
  http.post(
    `${A}/registries/:id/lines/:lineId/decision`,
    route(async (c) => svc.decideRegistryLine(await authCtx(c.request), param(c, 'id'), param(c, 'lineId'), await readJson(c.request))),
  ),
  http.post(`${A}/registries/:id/payments`, route(async (c) => svc.payRegistry(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),

  // ---- rebills to MIG ----
  http.get(`${A}/rebills`, route(async ({ request }) => svc.listRebills(await authCtx(request)))),
  http.get(`${A}/rebills/:id`, route(async (c) => svc.getRebill(await authCtx(c.request), param(c, 'id')))),
  http.post(`${A}/rebills`, route(async ({ request }) => svc.createRebill(await authCtx(request), await readJson(request)))),
  http.post(`${A}/rebills/:id/submit`, route(async (c) => svc.sendRebill(await authCtx(c.request), param(c, 'id')))),
  http.post(
    `${A}/rebills/:id/lines/:lineId/dispute`,
    route(async (c) => svc.disputeLine(await authCtx(c.request), param(c, 'id'), param(c, 'lineId'), await readJson(c.request))),
  ),

  // ---- network clinics and their prices for this assistance ----
  http.get(`${A}/clinics`, route(async ({ request }) => svc.clinics(await authCtx(request)))),

  // ---- users (asst_admin) ----
  http.get(`${A}/users`, route(async ({ request }) => svc.listUsers(await authCtx(request)))),
  http.post(`${A}/users`, route(async ({ request }) => svc.inviteUser(await authCtx(request), await readJson(request), { initialPassword: DEMO_PASSWORD }))),
  http.patch(`${A}/users/:id`, route(async (c) => svc.patchUser(await authCtx(c.request), param(c, 'id'), await readJson(c.request)))),

  // ---- integration (asst_admin): the same partner framework as clinics ----
  // partner-integration.ts is not ported yet: its resolver is synchronous and takes the in-memory database.
  // When it moves to the services, this becomes `svc.integrationPartner(await authCtx(request))`.
  ...partnerIntegrationHandlers(`${A}/integration`, (request) => {
    const { user } = requireSession(request);
    if (!isAssistRole(user.role) || !user.assistanceId) throw forbidden();
    requirePermission(user, 'assist.integration.manage', { assistanceId: user.assistanceId });
    const d = db();
    const a = d.assistances.find((x) => x.id === user.assistanceId);
    if (!a) throw notFound();
    return { actor: user, partnerId: user.assistanceId, partnerType: 'assistance' as const, mode: a.integrationMode, d };
  }),
];
