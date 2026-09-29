import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/fonts';
import '@/styles/index.css';
import { registerDemo } from '@/shared/demo';
import { App } from '@/app/App';

async function start(): Promise<void> {
  if (import.meta.env.VITE_USE_MOCKS === 'true') {
    const { startMocks } = await import('./mocks/browser');
    await startMocks();
  }
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    const demo = await import('./demo');
    registerDemo(demo.demoModule);
  }
  const root = document.getElementById('root');
  if (!root) return;
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
