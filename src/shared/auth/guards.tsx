import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Role } from '@/shared/types';
import { can, type Action } from './permissions';
import { useSession } from './session';
import { homeFor, loginPathFor, portalRoles, type Portal } from './home';

export function RequireAuth({ portal, children }: { portal: Portal; children: ReactNode }) {
  const session = useSession();
  const loc = useLocation();
  if (!session) {
    const next = encodeURIComponent(loc.pathname + loc.search);
    return <Navigate to={`${loginPathFor(portal)}?next=${next}`} replace />;
  }
  if (!portalRoles(portal)(session.user.role)) return <Navigate to="/403" replace />;
  if (portal === 'app' && !session.user.consentGivenAt && loc.pathname !== '/app/consent') {
    return <Navigate to={`/app/consent?next=${encodeURIComponent(loc.pathname)}`} replace />;
  }
  return <>{children}</>;
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const session = useSession();
  if (!session || !roles.includes(session.user.role)) return <Navigate to="/403" replace />;
  return <>{children}</>;
}

export function RequirePermission({ action, children }: { action: Action; children: ReactNode }) {
  const session = useSession();
  if (!session || !can(session.user, action)) return <Navigate to="/403" replace />;
  return <>{children}</>;
}

/** `/` → home of the session role, or login. */
export function RootRedirect() {
  const session = useSession();
  return <Navigate to={session ? homeFor(session.user.role) : '/login'} replace />;
}

export function useCan(action: Action, ctx?: Parameters<typeof can>[2]): boolean {
  const session = useSession();
  return can(session?.user, action, ctx);
}
