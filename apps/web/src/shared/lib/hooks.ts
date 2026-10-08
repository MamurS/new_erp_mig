import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Only statuses, ids and numbers may live in the URL — never names, PINFL or phones (SPEC §8). */
const SAFE_VALUE = /^[a-z0-9_:,.-]{1,400}$/i;

export function isSafeUrlValue(v: string): boolean {
  return SAFE_VALUE.test(v);
}

/** Filter state in query params, limited to an allow-list of keys with safe values. */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams();
  const values = useMemo(() => {
    const out = {} as Record<K, string>;
    for (const k of keys) {
      const v = params.get(k) ?? '';
      out[k] = isSafeUrlValue(v) ? v : '';
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, keys.join('|')]);

  const set = useCallback(
    (patch: Partial<Record<K, string | number | null | undefined>>, resetPage = true) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch) as [K, string | number | null | undefined][]) {
            const s = v === null || v === undefined ? '' : String(v);
            if (s && isSafeUrlValue(s)) next.set(k, s);
            else next.delete(k);
          }
          if (resetPage && !('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [values, set] as const;
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · MIG`;
  }, [title]);
}

/** Seconds left until `deadline` (ms epoch), ticking every second. */
export function useCountdown(deadline: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadline]);
  if (!deadline) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}
