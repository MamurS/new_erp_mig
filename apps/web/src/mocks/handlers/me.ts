/*
 * The insured person's app (/api/me/...). The logic is the shared service (packages/domain/src/services/me.ts);
 * this is the MSW adapter: it reads multipart forms into plain values for the service.
 */
import { delay, http } from 'msw';
import * as me from '@mig/domain/services/me';
import { mockConfig } from '../config';
import { API, authCtx, param, readJson, route } from '../http';
import { readForm } from '../uploads';

const personId = (url: URL): string | null => url.searchParams.get('personId');

/** Reads the request's multipart form when the service asks for it. */
const formOf =
  (request: Request): me.ReadForm =>
  async () => {
    const form = await readForm(request);
    const out: me.FormInput = { fields: {}, files: {} };
    for (const [name, value] of form.entries()) {
      if (typeof value === 'string') {
        if (!(name in out.fields)) out.fields[name] = value;
      } else {
        (out.files[name] ??= []).push({ name: value.name, type: value.type, bytes: new Uint8Array(await value.arrayBuffer()) });
      }
    }
    return out;
  };

export const meHandlers = [
  http.get(`${API}/me`, route(async ({ request }) => me.profile(await authCtx(request)))),
  http.post(`${API}/me/consent`, route(async ({ request }) => me.giveConsent(await authCtx(request), await readJson(request)))),
  http.get(`${API}/me/policy`, route(async ({ request, url }) => me.policy(await authCtx(request), personId(url)))),
  http.get(`${API}/me/limits`, route(async ({ request, url }) => me.limits(await authCtx(request), personId(url)))),
  // ---- family members (FAMILY_SPEC): the profiles of the switcher, consent, payout card, add requests ----
  http.get(`${API}/me/family`, route(async ({ request }) => me.family(await authCtx(request)))),
  http.post(`${API}/me/family/consent`, route(async ({ request }) => me.setFamilyConsent(await authCtx(request), await readJson(request)))),
  http.post(`${API}/me/payout-card`, route(async ({ request }) => me.setPayoutCard(await authCtx(request), await readJson(request)))),
  http.get(`${API}/me/family/requests`, route(async ({ request }) => me.familyRequests(await authCtx(request)))),
  http.post(`${API}/me/family/requests`, route(async ({ request }) => me.createFamilyRequest(await authCtx(request), await readJson(request)))),
  // A GET that writes: persisted like a mutation, or a reload would lose the code on screen.
  http.get(`${API}/me/card-token`, route(async ({ request, url }) => me.cardToken(await authCtx(request), personId(url)), { writes: true })),
  http.get(`${API}/me/claims`, route(async ({ request, url }) => me.claims(await authCtx(request), personId(url)))),
  http.get(`${API}/me/claims/:id`, route(async (c) => me.claim(await authCtx(c.request), param(c, 'id')))),
  http.post(
    `${API}/me/claims/recognize`,
    route(async ({ request }) => {
      const out = await me.recognize(await authCtx(request), formOf(request));
      if (mockConfig.latency[1] > 0) await delay(1000);
      return out;
    }),
  ),
  http.post(`${API}/me/claims`, route(async ({ request, url }) => me.submitClaim(await authCtx(request), personId(url), formOf(request)))),
  http.get(`${API}/me/appointments`, route(async ({ request, url }) => me.appointments(await authCtx(request), personId(url)))),
  http.post(`${API}/me/appointments`, route(async ({ request, url }) => me.requestAppointment(await authCtx(request), personId(url), await readJson(request)))),
  http.post(`${API}/me/appointments/:id/cancel`, route(async (c) => me.cancelAppointment(await authCtx(c.request), param(c, 'id')))),
  http.post(`${API}/me/appointments/:id/accept-proposal`, route(async (c) => me.acceptProposal(await authCtx(c.request), param(c, 'id')))),
  // «Ваш ассистанс 24/7» on the home screen (ASSISTANCE_SPEC §5.1); null — MIG serves the client.
  http.get(`${API}/me/assistance`, route(async ({ request }) => me.assistance(await authCtx(request)))),
  http.get(`${API}/me/chat`, route(async ({ request }) => me.chat(await authCtx(request)))),
  http.post(`${API}/me/chat`, route(async ({ request }) => me.sendChat(await authCtx(request), await readJson(request)))),
];
