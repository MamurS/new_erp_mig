/**
 * Validates a `?next=` target. Only same-origin absolute paths are allowed:
 * must start with `/`, must not start with `//` or `/\`, and must not contain control chars.
 */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (typeof next !== 'string' || next.length === 0 || next.length > 512) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  try {
    const url = new URL(next, 'https://mig.invalid');
    if (url.origin !== 'https://mig.invalid') return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
