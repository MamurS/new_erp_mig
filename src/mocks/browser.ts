import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';
import { initMockDb } from './setup';

export async function startMocks(): Promise<void> {
  initMockDb({ restore: true });
  const worker = setupWorker(...handlers);
  await worker.start({
    serviceWorker: { url: '/mockServiceWorker.js' },
    onUnhandledRequest: 'bypass',
    quiet: true,
  });
}
