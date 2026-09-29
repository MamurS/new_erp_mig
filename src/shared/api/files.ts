/* Authenticated file download → blob: URL (img src cannot carry the bearer token). */
import { useEffect, useState } from 'react';
import { request } from './client';

export function useFileUrl(url: string | null | undefined): { src: string | null; error: boolean } {
  const [state, setState] = useState<{ src: string | null; error: boolean }>({ src: null, error: false });
  useEffect(() => {
    if (!url) return;
    if (url.startsWith('blob:')) {
      setState({ src: url, error: false });
      return;
    }
    if (!url.startsWith('/api/files/')) {
      setState({ src: null, error: true });
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    request(url.replace(/^\/api/, ''), { as: 'blob' })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob as Blob);
        setState({ src: objectUrl, error: false });
      })
      .catch(() => !cancelled && setState({ src: null, error: true }));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);
  return state;
}
