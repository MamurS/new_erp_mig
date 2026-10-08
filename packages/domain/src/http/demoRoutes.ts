/*
 * Demo-only routes of the shared table (auth kind `demo`): they exist only in demo, ci and staging
 * deployments, never in production (BACKEND_SPEC §12.3). Kept apart from routes.ts so that a web build
 * without VITE_DEMO_MODE contains none of their code (apps/web/tests/no-demo-build.test.ts).
 * Mock-only demo endpoints that touch the in-memory database (reset, failure simulation) stay in apps/web.
 */
import { CARD_TOKEN_TTL_MS, formatShortCode, shortCodeFrom } from '../clinics';
import { randomToken } from '../lib/random';
import { currentAssistance } from '../services/assistance';
import { forbidden, notFound, systemRepos } from '../services/kernel';
import type { InsuredRow } from '../store/db';
import type { SessionRoute } from './routes';

export interface DemoRouteOptions {
  /** Phone of the demo insured person (packages/seed credentials). */
  insuredPhone: string;
}

export function demoRoutes(o: DemoRouteOptions): SessionRoute[] {
  return [
    // MIS simulator: a card code of the demo insured person, as if the patient showed the app at the desk.
    {
      method: 'POST',
      path: '/__demo/mis-card',
      auth: 'demo',
      body: 'none',
      result: 'json',
      async call(ctx, req) {
        if (ctx.user.role !== 'clinic_admin') throw forbidden();
        // A clinic does not see patients without a visit: the demo helper picks one as the system.
        const repos = systemRepos(ctx, 'demo: card code of a demo patient for the MIS simulator');
        const sys = { ...ctx, repos };
        // `?who=mig`: a patient of a client without an assistance, to show sub-registries of two payers.
        let me: InsuredRow | null = null;
        if (req.query.get('who') === 'mig') {
          for (const i of await repos.insured.list({ where: { status: 'active' } })) {
            if ((await currentAssistance(sys, i.policyId)) || !(await repos.policies.exists({ id: i.policyId, status: 'active' }))) continue;
            me = i;
            break;
          }
        } else me = await repos.insured.first({ where: { phone: o.insuredPhone } });
        if (!me) throw notFound();
        const bytes = new Uint8Array(8);
        crypto.getRandomValues(bytes);
        const row = { token: randomToken(18), shortCode: shortCodeFrom(bytes), insuredId: me.id, expiresAt: ctx.now() + CARD_TOKEN_TTL_MS };
        await repos.cardTokens.insert(row);
        return { shortCode: formatShortCode(row.shortCode) };
      },
    },
  ];
}
