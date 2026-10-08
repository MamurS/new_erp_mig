import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';
import { initMockDb } from './setup';
import { enableCookieJar } from './http';
import { logger } from '@/shared/lib/logger';

export async function startMocks(): Promise<void> {
  initMockDb({ restore: true });
  // The session cookie lives on the mock's side of this tab (http.ts), never in document.cookie.
  enableCookieJar(true);
  // A background update check of the mock worker can be interrupted by navigation (NotFoundError).
  // It is harmless: the active worker keeps serving; do not surface it as an uncaught error.
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { name?: string; message?: string } | undefined;
    if (r?.name === 'NotFoundError' && /ServiceWorker/.test(r.message ?? '')) {
      e.preventDefault();
      logger.warn('Mock service worker update skipped');
    }
  });
  // Demo endpoints exist only in demo builds: without the flag this import is dropped from the bundle.
  const demo = import.meta.env.VITE_DEMO_MODE === 'true' ? (await import('./handlers/demo')).demoHandlers : [];
  const worker = setupWorker(...demo, ...handlers);
  await worker.start({
    serviceWorker: { url: '/mockServiceWorker.js' },
    onUnhandledRequest: 'bypass',
    quiet: true,
  });
}
