/* Demo-only endpoints: reset data and failure simulation. Registered only with VITE_DEMO_MODE. */
import { http } from 'msw';
import { z } from 'zod';
import { db, resetDb } from '../db';
import { API, body, route } from '../http';
import { mockConfig } from '../config';
import { clearSnapshot } from '../persist';
import { DEMO_INSURED_PHONE } from '../credentials';
import { forbidden, notFound, requireSession } from '../http';
import { randomToken } from '../rng';
import { CARD_TOKEN_TTL_MS, formatShortCode, shortCodeFrom } from '@/shared/domain/clinics';
import { currentAssistance } from '../assistance-core';

export const demoHandlers = [
  http.post(
    `${API}/__demo/reset`,
    route(() => {
      const sessions = db().sessions;
      clearSnapshot();
      const fresh = resetDb();
      fresh.sessions = sessions;
      return { ok: true as const };
    }),
  ),
  http.post(
    `${API}/__demo/failures`,
    route(async ({ request }) => {
      const { enabled } = await body(request, z.object({ enabled: z.boolean() }));
      mockConfig.failures = enabled;
      return { ok: true as const, enabled };
    }),
  ),
  // MIS simulator: a card code of the demo insured person, as if the patient showed the app at the desk.
  http.post(
    `${API}/__demo/mis-card`,
    route(({ request, url }) => {
      const { user } = requireSession(request);
      if (user.role !== 'clinic_admin') throw forbidden();
      const d = db();
      // `?who=mig`: a patient of a client without an assistance, to show sub-registries of two payers.
      const me =
        url.searchParams.get('who') === 'mig'
          ? d.insured.find((i) => i.status === 'active' && !currentAssistance(d, i.policyId) && d.policies.some((p) => p.id === i.policyId && p.status === 'active'))
          : d.insured.find((i) => i.phone === DEMO_INSURED_PHONE);
      if (!me) throw notFound();
      const bytes = new Uint8Array(8);
      crypto.getRandomValues(bytes);
      const row = { token: randomToken(18), shortCode: shortCodeFrom(bytes), insuredId: me.id, expiresAt: Date.now() + CARD_TOKEN_TTL_MS };
      d.cardTokens.push(row);
      return { shortCode: formatShortCode(row.shortCode) };
    }),
  ),
  http.get(
    `${API}/__demo/failures`,
    route(() => ({ ok: true as const, enabled: mockConfig.failures })),
  ),
];
