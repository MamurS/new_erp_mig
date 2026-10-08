/* Pages publish their breadcrumbs and main action to the staff top bar. */
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { Crumb } from '@/shared/ui/page';

interface TopbarState {
  crumbs: Crumb[];
  action: ReactNode;
}

let state: TopbarState = { crumbs: [], action: null };
const listeners = new Set<() => void>();

export function useTopbar(crumbs: Crumb[], action: ReactNode = null): void {
  const key = crumbs.map((c) => `${c.label}|${c.to ?? ''}`).join('/');
  useEffect(() => {
    state = { crumbs, action };
    listeners.forEach((l) => l());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, action]);
}

export function useTopbarState(): TopbarState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}
