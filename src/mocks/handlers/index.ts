import { http } from 'msw';
import { authHandlers } from './auth';
import { dashboardHandlers } from './dashboard';
import { clientHandlers } from './clients';
import { insuredHandlers } from './insured';
import { claimHandlers } from './claims';
import { staffMiscHandlers } from './staff-misc';
import { hrHandlers } from './hr';
import { kpHandlers } from './kp';
import { clinicHandlers } from './clinic';
import { integrationHandlers } from './integration';
import { integrationAssistanceHandlers } from './integration-assistance';
import { staffClinicHandlers } from './staff-clinics';
import { policyHandlers } from './policies';
import { meHandlers } from './me';
import { assistHandlers } from './assist';
import { staffAssistanceHandlers } from './staff-assistance';
import { paramHandlers } from './params';
import { lifecycleHandlers } from './lifecycle';
import { contractHandlers } from './contracts';
import { API, notFound, route } from '../http';

/*
 * Demo-only endpoints (`./demo`) are not listed here: the browser worker imports them dynamically
 * with VITE_DEMO_MODE, and the test server adds them itself, so a build without the flag has none of their code.
 */
export const handlers = [
  ...authHandlers,
  ...dashboardHandlers,
  ...policyHandlers,
  ...clientHandlers,
  ...insuredHandlers,
  ...claimHandlers,
  ...staffMiscHandlers,
  ...kpHandlers,
  ...clinicHandlers,
  ...integrationHandlers,
  ...integrationAssistanceHandlers,
  ...staffClinicHandlers,
  ...hrHandlers,
  ...meHandlers,
  ...assistHandlers,
  ...staffAssistanceHandlers,
  ...paramHandlers,
  ...lifecycleHandlers,
  ...contractHandlers,
  // Unknown API routes behave like a real server: 404.
  http.all(
    `${API}/*`,
    route(() => {
      throw notFound();
    }),
  ),
];
