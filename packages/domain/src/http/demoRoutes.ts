/*
 * Demo-only routes of the shared table (auth kind `demo`): they exist only in demo, ci and staging
 * deployments, never in production (BACKEND_SPEC §12.3). Kept apart from routes.ts so that a web build
 * without VITE_DEMO_MODE contains none of their code (apps/web/tests/no-demo-build.test.ts).
 * Demo endpoints that touch the database or the server itself (reset, failure simulation, the test clock) belong to
 * each adapter: apps/web/src/mocks/handlers/demo.ts and apps/api/src/demo.ts.
 */
import { z } from 'zod';
import { DEMO_CODE, DEMO_PASSWORD } from '../auth/demo';
import * as auth from '../services/auth';
import { CARD_TOKEN_TTL_MS, formatShortCode, shortCodeFrom } from '../clinics';
import { randomToken } from '../lib/random';
import { currentAssistance } from '../services/assistance';
import { forbidden, notFound, systemRepos, validate } from '../services/kernel';
import type { InsuredRow } from '../store/db';
import type { OpenRoute, SessionRoute } from './routes';

export interface DemoRouteOptions {
  /** Phone of the demo insured person (packages/seed credentials). */
  insuredPhone: string;
  /** The accounts «Войти как…» may sign in as: e-mails and phones of the demo accounts (packages/seed credentials). */
  accounts: { emails: readonly string[]; phones: readonly string[] };
}

/** Bodies of the demo knobs both adapters have: reset, failure simulation, the test clock (API only). */
export const demoResetSchema = z.object({ xss: z.boolean().optional() }).strict();
export const demoFailuresSchema = z.object({ enabled: z.boolean() }).strict();
export const MAX_CLOCK_OFFSET = 400 * 24 * 3_600_000;
export const demoClockSchema = z.union([
  z.object({ offsetMs: z.number().int().min(-MAX_CLOCK_OFFSET).max(MAX_CLOCK_OFFSET) }).strict(),
  z.object({ advanceMs: z.number().int().min(0).max(MAX_CLOCK_OFFSET) }).strict(),
]);

/** The body of `POST /__demo/login-as`: the e-mail or the phone of a demo account. */
export const loginAsSchema = z.object({ login: z.string().trim().toLowerCase().min(3).max(254) });

/** Which demo account a «Войти как…» login names (null: not a demo account). */
export function demoAccount(o: DemoRouteOptions, login: string): { email: string } | { phone: string } | null {
  if (o.accounts.emails.includes(login)) return { email: login };
  const digits = login.replace(/\D/g, '');
  const phone = o.accounts.phones.find((p) => p.replace(/\D/g, '') === digits);
  return phone ? { phone } : null;
}

export function demoRoutes(o: DemoRouteOptions): (SessionRoute | OpenRoute)[] {
  return [
    // «Войти как…»: a real sign-in of a demo account in one step (the demo password and code), a new session cookie.
    // The API answers it with Supabase Auth (apps/api/src/auth/bff.ts); this is the mock's sign-in.
    {
      method: 'POST',
      path: '/__demo/login-as',
      auth: 'none',
      body: 'json',
      result: 'json',
      session: 'start',
      async call(ctx, req) {
        const { login } = validate(loginAsSchema, await req.json());
        const who = demoAccount(o, login);
        if (!who) throw notFound();
        if ('email' in who) {
          const { challengeId } = await auth.login(ctx, { email: who.email, password: DEMO_PASSWORD });
          return auth.otp(ctx, { challengeId, code: DEMO_CODE });
        }
        const { challengeId } = await auth.phoneLogin(ctx, { phone: who.phone });
        return auth.phoneVerify(ctx, { challengeId, code: DEMO_CODE });
      },
    },
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
