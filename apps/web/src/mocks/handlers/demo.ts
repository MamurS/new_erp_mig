/* Demo-only endpoints: reset data and failure simulation. Registered only with VITE_DEMO_MODE. */
import { http } from 'msw';
import { z } from 'zod';
import { db, resetDb } from '../db';
import { API, authCtx, forbidden, notFound, readJson, repos, route, validate } from '../http';
import { mockConfig } from '../config';
import { clearSnapshot } from '../persist';
import { DEMO_INSURED_PHONE } from '@mig/seed/credentials';
import { randomToken } from '@mig/domain/lib/random';
import { CARD_TOKEN_TTL_MS, formatShortCode, shortCodeFrom } from '@mig/domain/clinics';
import { currentAssistance } from '@mig/domain/services/assistance';
import type { InsuredRow } from '@mig/domain/store/db';

const DEMO = { noFailures: true };

export const demoHandlers = [
  http.post(
    `${API}/__demo/reset`,
    route(() => {
      const sessions = db().sessions;
      clearSnapshot();
      const fresh = resetDb();
      fresh.sessions = sessions;
      return { ok: true as const };
    }, DEMO),
  ),
  http.post(
    `${API}/__demo/failures`,
    route(async ({ request }) => {
      const { enabled } = validate(z.object({ enabled: z.boolean() }), await readJson(request));
      mockConfig.failures = enabled;
      return { ok: true as const, enabled };
    }, DEMO),
  ),
  // MIS simulator: a card code of the demo insured person, as if the patient showed the app at the desk.
  http.post(
    `${API}/__demo/mis-card`,
    route(async ({ request, url }) => {
      const ctx = await authCtx(request);
      if (ctx.user.role !== 'clinic_admin') throw forbidden();
      // `?who=mig`: a patient of a client without an assistance, to show sub-registries of two payers.
      let me: InsuredRow | null = null;
      if (url.searchParams.get('who') === 'mig') {
        for (const i of await repos.insured.list({ where: { status: 'active' } })) {
          if ((await currentAssistance(ctx, i.policyId)) || !(await repos.policies.exists({ id: i.policyId, status: 'active' }))) continue;
          me = i;
          break;
        }
      } else me = await repos.insured.first({ where: { phone: DEMO_INSURED_PHONE } });
      if (!me) throw notFound();
      const bytes = new Uint8Array(8);
      crypto.getRandomValues(bytes);
      const row = { token: randomToken(18), shortCode: shortCodeFrom(bytes), insuredId: me.id, expiresAt: ctx.now() + CARD_TOKEN_TTL_MS };
      await repos.cardTokens.insert(row);
      return { shortCode: formatShortCode(row.shortCode) };
    }, DEMO),
  ),
  http.get(
    `${API}/__demo/failures`,
    route(() => ({ ok: true as const, enabled: mockConfig.failures }), DEMO),
  ),
];
