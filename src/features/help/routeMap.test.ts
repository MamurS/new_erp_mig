/*
 * Context help: every route of the portals has an article, the anchors exist and are visible to the
 * roles that open the route; every screen name of the map is mentioned in the guide and leads to a route
 * of the router; «Открыть раздел» respects access.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RouteObject } from 'react-router-dom';
import { routes } from '@/app/router';
import { contentFor, russianGuide } from '@/mocks/help-content';
import { ALL_ROLES } from '@/shared/help/audience';
import { canOpenRoute, helpAnchorForPath, matchRoute, portalOfRoute, ROUTE_HELP, routeRoles, SCREENS, screensMentioned } from './routeMap';

function collect(rs: readonly RouteObject[], base = ''): string[] {
  return rs.flatMap((r) => {
    const path = r.path === undefined ? base : r.path.startsWith('/') ? r.path : `${base === '/' ? '' : base}/${r.path}`;
    const self = r.path !== undefined || r.index ? [path || '/'] : [];
    return [...self, ...collect(r.children ?? [], path)];
  });
}

const ROUTES = [...new Set(collect(routes))].filter((p) => !['/', '*', '/*', '/403'].includes(p));
const GUIDE = readFileSync('docs/help/USER_GUIDE.ru.md', 'utf8');

describe('route → article', () => {
  it('every route of the router has an article, and the map has no stale routes', () => {
    expect(ROUTES.length).toBeGreaterThan(80);
    const missing = ROUTES.filter((r) => !(r in ROUTE_HELP));
    expect(missing, 'add these routes to ROUTE_HELP in src/features/help/routeMap.ts').toEqual([]);
    expect(Object.keys(ROUTE_HELP).filter((r) => !ROUTES.includes(r))).toEqual([]);
  });

  it('every anchor exists and is readable by the roles that open the route', () => {
    const anchors = new Set(russianGuide().articles.flatMap((a) => [a.anchor, ...a.sections.map((s) => s.anchor)]));
    for (const [route, anchor] of Object.entries(ROUTE_HELP)) {
      expect(anchors.has(anchor), `${route} → ${anchor}`).toBe(true);
      if (!portalOfRoute(route) || route.startsWith('/app/login') || route === '/app/consent') continue;
      const roles = routeRoles(route);
      expect(roles.length, route).toBeGreaterThan(0);
      for (const role of roles) {
        const visible = contentFor(role, 'ru').articles.some((a) => a.anchor === anchor || a.sections.some((s) => s.anchor === anchor));
        expect(visible, `${route} → ${anchor} for ${role}`).toBe(true);
      }
    }
  });

  it('finds the article of a concrete path', () => {
    expect(helpAnchorForPath('/staff/clients')).toBe('new-client');
    expect(helpAnchorForPath('/staff/clients/3f1c3a52-6a1f-4b8e-9d3a-0c1e2f3a4b5c?tab=kp')).toBe('new-client');
    expect(helpAnchorForPath('/staff/invoices/queue')).toBe('manual-allocation');
    expect(helpAnchorForPath('/clinic/registries/3f1c3a52-6a1f-4b8e-9d3a-0c1e2f3a4b5c')).toBe('monthly-registry');
    expect(helpAnchorForPath('/app/claims/new')).toBe('receipt-refund');
    // An unknown nested path falls back to its parent.
    expect(helpAnchorForPath('/hr/unknown')).toBe('guide-hr');
    expect(matchRoute('/staff/claims/:claimId', '/staff/claims/abc')).toBe(true);
    expect(matchRoute('/staff/claims/:claimId', '/staff/claims')).toBe(false);
  });
});

describe('screens mentioned in the guide', () => {
  it('every screen name is mentioned in the guide as «name» and leads to a route of the router', () => {
    for (const s of SCREENS) {
      expect(ROUTES, s.route).toContain(s.route);
      expect(portalOfRoute(s.route)).toBe(s.portal);
      expect(s.names.some((n) => GUIDE.includes(`«${n}»`)), s.names.join(' / ')).toBe(true);
      expect(routeRoles(s.route).length, s.route).toBeGreaterThan(0);
    }
  });

  it('«Открыть раздел» also finds screens in the translated guides by their interface labels', () => {
    expect(screensMentioned('Open “Manual payment matching”, then “VHI parameters”.', 'accountant').map((s) => s.route)).toEqual(['/staff/invoices/queue', '/staff/admin/parameters']);
    expect(screensMentioned('«Qoʻlda taqsimlash» va «ITS parametrlari» boʻlimlari.', 'accountant').map((s) => s.route)).toEqual(['/staff/invoices/queue', '/staff/admin/parameters']);
    const en = readFileSync('docs/help/USER_GUIDE.en.md', 'utf8');
    const uz = readFileSync('docs/help/USER_GUIDE.uz-Latn.md', 'utf8');
    for (const guide of [en, uz]) expect(screensMentioned(guide, 'admin').length).toBeGreaterThan(5);
  });

  it('«Открыть раздел» only for screens of the role\'s portal that the role may open', () => {
    const text = 'Откройте «Ручная разноска», затем «Параметры ДМС» и «Перенос портфеля»; клиника — «Реестры».';
    expect(screensMentioned(text, 'accountant').map((s) => s.route)).toEqual(['/staff/invoices/queue', '/staff/admin/parameters']);
    expect(screensMentioned(text, 'admin').map((s) => s.route)).toEqual(['/staff/admin/parameters', '/staff/admin/migration']);
    expect(screensMentioned(text, 'sales_manager').map((s) => s.route)).toEqual(['/staff/admin/parameters']);
    expect(screensMentioned(text, 'hr')).toEqual([]);
    expect(screensMentioned(text, 'clinic_admin').map((s) => s.route)).toEqual(['/clinic/registries']);
    expect(screensMentioned(text, 'clinic_registrar')).toEqual([]);
    expect(canOpenRoute('clinic_registrar', '/clinic/check')).toBe(true);
    expect(canOpenRoute('underwriter', '/staff/clients/:clientId/kp/new')).toBe(true);
    expect(canOpenRoute('sales_manager', '/staff/clients/:clientId/kp/new')).toBe(false);
    for (const role of ALL_ROLES) expect(screensMentioned(GUIDE, role).every((s) => canOpenRoute(role, s.route))).toBe(true);
  });
});
