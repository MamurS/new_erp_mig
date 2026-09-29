/* Demo-only endpoints: reset data and failure simulation. Registered only with VITE_DEMO_MODE. */
import { http } from 'msw';
import { z } from 'zod';
import { db, resetDb } from '../db';
import { API, body, route } from '../http';
import { mockConfig } from '../config';
import { clearSnapshot } from '../persist';

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
  http.get(
    `${API}/__demo/failures`,
    route(() => ({ ok: true as const, enabled: mockConfig.failures })),
  ),
];
