import { useEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { queryClient } from '@/shared/api/queryClient';
import { I18nProvider, subscribeLocale } from '@/i18n';
import { TooltipProvider } from '@/shared/ui/tooltip';
import { Toaster } from '@/shared/ui/toast';
import { createRouter } from './router';
import { ErrorBoundary } from './pages';

export function App() {
  const [router] = useState(createRouter);
  // Server-made labels (packed keys aside) come in the language of the request: refetch on a switch.
  useEffect(() => subscribeLocale(() => void queryClient.invalidateQueries()), []);
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
