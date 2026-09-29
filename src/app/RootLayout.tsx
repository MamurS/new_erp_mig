import { Outlet, ScrollRestoration } from 'react-router-dom';
import { getDemo } from '@/shared/demo';
import { AuthSync } from './AuthSync';
import { OfflineBanner } from './OfflineBanner';

export function RootLayout() {
  const demo = getDemo();
  return (
    <>
      <AuthSync />
      {demo && <demo.DemoBanner />}
      <OfflineBanner />
      <Outlet />
      <ScrollRestoration />
    </>
  );
}
