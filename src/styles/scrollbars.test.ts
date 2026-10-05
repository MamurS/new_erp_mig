// @vitest-environment node
/* Chromium ignores ::-webkit-scrollbar once scrollbar-width/color are set: the two must never meet. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Without comments: they may name the selector.
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('scrollbars', () => {
  it('use the standard thin warm scrollbar everywhere', () => {
    expect(css).toMatch(
      /\*\s*\{\s*scrollbar-width:\s*thin;\s*scrollbar-color:\s*var\(--scroll-thumb\)\s+transparent;/,
    );
  });

  it('keep ::-webkit-scrollbar only as the fallback for browsers without scrollbar-color', () => {
    const start = css.indexOf('@supports not (scrollbar-color: auto)');
    expect(start).toBeGreaterThan(-1);
    const end = css.indexOf('\n}\n', start);
    const outside = css.slice(0, start) + css.slice(end);
    expect(outside).not.toContain('::-webkit-scrollbar');
    expect(css.slice(start, end)).toContain('::-webkit-scrollbar-thumb');
  });
});
