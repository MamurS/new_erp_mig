import { http } from 'msw';
import { authHandlers } from './auth';
import { dashboardHandlers } from './dashboard';
import { clientHandlers } from './clients';
import { insuredHandlers } from './insured';
import { claimHandlers } from './claims';
import { staffMiscHandlers } from './staff-misc';
import { hrHandlers } from './hr';
import { meHandlers } from './me';
import { demoHandlers } from './demo';
import { API, notFound, route } from '../http';

export const handlers = [
  ...authHandlers,
  ...(import.meta.env.VITE_DEMO_MODE === 'true' || import.meta.env.MODE === 'test' ? demoHandlers : []),
  ...dashboardHandlers,
  ...clientHandlers,
  ...insuredHandlers,
  ...claimHandlers,
  ...staffMiscHandlers,
  ...hrHandlers,
  ...meHandlers,
  // Unknown API routes behave like a real server: 404.
  http.all(
    `${API}/*`,
    route(() => {
      throw notFound();
    }),
  ),
];
