/*
 * Demo-only endpoints, registered only with VITE_DEMO_MODE: reset data and failure simulation (mock-only: they
 * touch the in-memory database and the mock's switches) and the demo routes of the shared table.
 */
import { http } from 'msw';
import { z } from 'zod';
import { db, resetDb } from '../db';
import { API, readJson, route, validate } from '../http';
import { mockConfig } from '../config';
import { clearSnapshot } from '../persist';
import { DEMO_INSURED_PHONE } from '@mig/seed/credentials';
import { demoRoutes } from '@mig/domain/http/demoRoutes';
import { toMsw } from './index';

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
  // Demo routes of the shared table (the MIS simulator's card code).
  ...demoRoutes({ insuredPhone: DEMO_INSURED_PHONE }).map((r) => toMsw(r, DEMO)),
  http.get(
    `${API}/__demo/failures`,
    route(() => ({ ok: true as const, enabled: mockConfig.failures }), DEMO),
  ),
];
