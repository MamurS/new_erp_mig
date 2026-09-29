import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';
import { initMockDb } from './setup';
import { logger } from '@/shared/lib/logger';

export async function startMocks(): Promise<void> {
  initMockDb({ restore: true });
  // A background update check of the mock worker can be interrupted by navigation (NotFoundError).
  // It is harmless: the active worker keeps serving; do not surface it as an uncaught error.
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { name?: string; message?: string } | undefined;
    if (r?.name === 'NotFoundError' && /ServiceWorker/.test(r.message ?? '')) {
      e.preventDefault();
      logger.warn('Mock service worker update skipped');
    }
  });
  const worker = setupWorker(...handlers);
  await worker.start({
    serviceWorker: { url: '/mockServiceWorker.js' },
    onUnhandledRequest: 'bypass',
    quiet: true,
  });
}
