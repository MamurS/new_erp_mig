const ALLOWED = new Set(['http:', 'https:', 'mailto:', 'tel:']);
export const BLANK = 'about:blank';

/**
 * Returns the URL if it is http(s)/mailto/tel or a relative path, otherwise `about:blank`.
 * Control characters and whitespace are stripped first, as browsers do when parsing schemes.
 */
export function safeUrl(input: string | null | undefined): string {
  if (typeof input !== 'string') return BLANK;
  // eslint-disable-next-line no-control-regex
  const cleaned = input.replace(/[\u0000- \u007f-\u009f]/g, '');
  if (!cleaned) return BLANK;
  const trimmed = input.trim();
  // Relative paths: `/x`, `./x`, `../x`, `?q`, `#h` — but not protocol-relative `//host` or `/\host`.
  if (/^(\/(?![/\\])|\.\.?\/|[?#])/.test(cleaned)) return trimmed;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned);
  if (!scheme) return BLANK;
  const protocol = `${scheme[1]!.toLowerCase()}:`;
  if (!ALLOWED.has(protocol)) return BLANK;
  try {
    const url = new URL(cleaned);
    return ALLOWED.has(url.protocol) ? url.href : BLANK;
  } catch {
    return BLANK;
  }
}

/** True when the URL is an absolute http(s) link usable for linkification. */
export function isSafeHttpUrl(input: string): boolean {
  const out = safeUrl(input);
  return out.startsWith('http://') || out.startsWith('https://');
}
