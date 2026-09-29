/* Component-test helpers: real mock API (msw/node) + providers + memory router. */
import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import type { Role } from '@/shared/types';
import { request } from '@/shared/api/client';
import * as S from '@/shared/api/schemas';
import { clearSession, setSession } from '@/shared/auth/session';
import { TooltipProvider } from '@/shared/ui/tooltip';
import { Toaster } from '@/shared/ui/toast';
import { I18nProvider } from '@/i18n';
import { DEMO_CODE, DEMO_HR, DEMO_INSURED_PHONE, DEMO_PASSWORD, DEMO_STAFF } from '@/mocks/credentials';

export { createMockServer } from '@/mocks/node';

/** Logs in through the mock API exactly like the UI does and stores the session. */
export async function loginAs(role: Role): Promise<void> {
  clearSession();
  if (role === 'insured') {
    const c = await request('/auth/phone', { method: 'POST', body: { phone: DEMO_INSURED_PHONE }, schema: S.challenge });
    const s = await request('/auth/phone/verify', { method: 'POST', body: { challengeId: c.challengeId, code: DEMO_CODE }, schema: S.sessionResponse });
    setSession({ ...s, user: { ...s.user, consentGivenAt: s.user.consentGivenAt ?? new Date().toISOString() } });
    return;
  }
  const email = role === 'hr' ? DEMO_HR.email : DEMO_STAFF.find((x) => x.role === role)!.email;
  const c = await request('/auth/login', { method: 'POST', body: { email, password: DEMO_PASSWORD }, schema: S.challenge });
  const s = await request('/auth/otp', { method: 'POST', body: { challengeId: c.challengeId, code: DEMO_CODE }, schema: S.sessionResponse });
  setSession(s);
}

export function renderRoutes(routes: RouteObject[], initialEntry: string, opts: { i18n?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 0 } } });
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });
  const tree: ReactElement = (
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
  const utils = render(opts.i18n ? <I18nProvider>{tree}</I18nProvider> : tree);
  return { ...utils, router, queryClient: qc };
}
