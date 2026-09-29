import { useEffect } from 'react';
import { setUnauthorizedHandler } from '@/shared/api/client';
import { queryClient } from '@/shared/api/queryClient';
import { localLogout } from '@/shared/auth/logout';
import { initSessionSync, subscribeSession, getSession } from '@/shared/auth/session';

/** 401 → logout; session gone (any tab) → wipe the query cache. */
export function AuthSync() {
  useEffect(() => {
    initSessionSync();
    setUnauthorizedHandler(() => localLogout('Сессия завершена, войдите снова'));
    return subscribeSession(() => {
      if (!getSession()) queryClient.clear();
    });
  }, []);
  return null;
}
