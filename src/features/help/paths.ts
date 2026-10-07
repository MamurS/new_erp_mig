/*
 * Addresses of the help screen. Every portal has its own `/<portal>/help/<article>#<subsection>`: the
 * anchors are stable Latin slugs of the guide (no personal data can end up in the URL).
 */
import type { Role } from '@/shared/types';
import { portalOfRole, type Portal } from './routeMap';

export const helpBaseOf = (portal: Portal): string => `/${portal}/help`;

export const helpBase = (role: Role): string => helpBaseOf(portalOfRole(role));

const ANCHOR = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A valid anchor of the guide, or null (anything else from the URL is ignored). */
export function cleanAnchor(raw: string | null | undefined): string | null {
  const a = (raw ?? '').replace(/^#/, '');
  return ANCHOR.test(a) ? a : null;
}

/** `/staff/help/finance#manual-allocation`; the hash is left out when it names the article itself. */
export function helpHref(base: string, articleAnchor: string, sectionAnchor?: string | null): string {
  return sectionAnchor && sectionAnchor !== articleAnchor ? `${base}/${articleAnchor}#${sectionAnchor}` : `${base}/${articleAnchor}`;
}
