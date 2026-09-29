import { Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { getDemo } from '@/shared/demo';
import { AuthSync } from './AuthSync';
import { OfflineBanner } from './OfflineBanner';

export function RootLayout() {
  const demo = getDemo();
  // The insured app has its own translated offline notice.
  const inApp = useLocation().pathname.startsWith('/app');
  return (
    <>
      <AuthSync />
      {demo && <demo.DemoBanner />}
      {!inApp && <OfflineBanner />}
      <Outlet />
      <ScrollRestoration />
    </>
  );
}
