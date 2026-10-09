/*
 * Demo-only endpoints, registered only with VITE_DEMO_MODE: reset data, failure simulation and the mail outbox
 * (mock-only: they touch the in-memory database and the mock's switches) and the demo routes of the shared table.
 */
import { http } from 'msw';
import { db, resetDb } from '../db';
import { API, readJson, route, validate } from '../http';
import { mockConfig } from '../config';
import { clearSnapshot } from '../persist';
import { DEMO_INSURED_PHONE, DEMO_LOGIN_AS } from '@mig/seed/credentials';
import { demoFailuresSchema, demoRoutes } from '@mig/domain/http/demoRoutes';
import { toMsw } from './index';
import { outbox } from '../outbox';

const DEMO = { noFailures: true };
const DEMO_POST = { noFailures: true, csrf: true };

export const demoHandlers = [
  http.post(
    `${API}/__demo/reset`,
    route(() => {
      const sessions = db().sessions;
      clearSnapshot();
      const fresh = resetDb();
      fresh.sessions = sessions;
      return { ok: true as const };
    }, DEMO_POST),
  ),
  http.post(
    `${API}/__demo/failures`,
    route(async ({ request }) => {
      const { enabled } = validate(demoFailuresSchema, await readJson(request));
      mockConfig.failures = enabled;
      return { ok: true as const, enabled };
    }, DEMO_POST),
  ),
  // Demo routes of the shared table (the MIS simulator's card code).
  ...demoRoutes({ insuredPhone: DEMO_INSURED_PHONE, accounts: DEMO_LOGIN_AS }).map((r) => toMsw(r, DEMO)),
  // The mock's mail (invitations): the API of ci has Mailpit instead.
  http.get(
    `${API}/__demo/outbox`,
    route(() => outbox.slice().reverse(), DEMO),
  ),
  http.get(
    `${API}/__demo/failures`,
    route(() => ({ ok: true as const, enabled: mockConfig.failures }), DEMO),
  ),
];
