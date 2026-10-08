import { QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from './client';

/** In-memory only (no persistence). PII-bearing queries are dropped within 5 minutes. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 5 * 60_000,
      staleTime: 20_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => err instanceof ApiRequestError && err.status >= 500 && count < 1,
    },
    mutations: { retry: 0 },
  },
});
