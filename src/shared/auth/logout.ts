import { request } from '@/shared/api/client';
import { queryClient } from '@/shared/api/queryClient';
import { clearSession } from './session';

/** Logout: server call, cache wipe, session wipe, cross-tab broadcast. Guards then redirect to login. */
export async function logout(notice?: string): Promise<void> {
  try {
    await request('/auth/logout', { method: 'POST' });
  } catch {
    /* the session is dropped locally regardless */
  }
  queryClient.clear();
  clearSession({ notice, broadcast: true });
}

/** Local-only logout (401 or another tab already logged out). */
export function localLogout(notice?: string): void {
  queryClient.clear();
  clearSession({ notice, broadcast: false });
}
