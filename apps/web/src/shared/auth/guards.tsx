import type { ReactNode } from 'react';
import { Navigate, useLocation, useNavigation } from 'react-router-dom';
import type { Role } from '@mig/contracts';
import { can, type Action } from '@mig/domain/auth/permissions';
import { useSession } from './session';
import { homeFor, loginPathFor, portalRoles, type Portal } from '@mig/domain/auth/home';

/**
 * While a navigation is under way (e.g. to the home page of a role just switched to), a guard of the page
 * being left must not start a competing redirect: it would interrupt that navigation.
 */
function useLeaving(): boolean {
  return useNavigation().state !== 'idle';
}

export function RequireAuth({ portal, children }: { portal: Portal; children: ReactNode }) {
  const session = useSession();
  const loc = useLocation();
  const leaving = useLeaving();
  if (!session) {
    const next = encodeURIComponent(loc.pathname + loc.search);
    return <Navigate to={`${loginPathFor(portal)}?next=${next}`} replace />;
  }
  if (!portalRoles(portal)(session.user.role)) return leaving ? null : <Navigate to="/403" replace />;
  if (portal === 'app' && !session.user.consentGivenAt && loc.pathname !== '/app/consent') {
    return <Navigate to={`/app/consent?next=${encodeURIComponent(loc.pathname)}`} replace />;
  }
  return <>{children}</>;
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const session = useSession();
  const leaving = useLeaving();
  if (!session || !roles.includes(session.user.role)) return leaving ? null : <Navigate to="/403" replace />;
  return <>{children}</>;
}

export function RequirePermission({ action, children }: { action: Action; children: ReactNode }) {
  const session = useSession();
  const leaving = useLeaving();
  if (!session || !can(session.user, action)) return leaving ? null : <Navigate to="/403" replace />;
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
