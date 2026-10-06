/* `?create=<what>` opens a page's create dialog (the start points of «+ Создать»); the param is then dropped. */
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/** `set` is a state setter (stable), called with `value` when the URL asks for it and the user may create. */
export function useCreateIntent<T>(what: string, allowed: boolean, set: (v: T) => void, value: T): void {
  const [params, setParams] = useSearchParams();
  const hit = params.get('create') === what;
  useEffect(() => {
    if (!hit) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('create');
        return next;
      },
      { replace: true },
    );
    if (allowed) set(value);
    // `value` is a literal at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hit, allowed, set, setParams]);
}
