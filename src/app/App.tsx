import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { queryClient } from '@/shared/api/queryClient';
import { I18nProvider } from '@/i18n';
import { TooltipProvider } from '@/shared/ui/tooltip';
import { Toaster } from '@/shared/ui/toast';
import { createRouter } from './router';
import { ErrorBoundary } from './pages';

export function App() {
  const [router] = useState(createRouter);
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <TooltipProvider>
            <RouterProvider router={router} future={{ v7_startTransition: true }} />
            <Toaster />
          </TooltipProvider>
        </I18nProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
