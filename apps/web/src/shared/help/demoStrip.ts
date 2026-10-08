/*
 * Build-time removal of demo-only articles (`<!-- audience: demo … -->` right after a `##` heading) from
 * the guide. Used by the Vite plugin in vite.config.ts for builds without VITE_DEMO_MODE, so such a build
 * does not contain the demo accounts, codes or role switcher description at all (SPEC §9.5).
 * Pure string code: it runs in Node at build time.
 */
const ARTICLE = /^##\s/;
const MARKER = /^\s*<!--\s*audience:\s*([^>]*?)\s*-->\s*$/;

export function stripDemoArticles(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let skipping = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (ARTICLE.test(line)) {
      let j = i + 1;
      while (j < lines.length && !lines[j]!.trim()) j++;
      const m = MARKER.exec(lines[j] ?? '');
      skipping = !!m && m[1]!.split(/\s+/).includes('demo');
    }
    if (!skipping) out.push(line);
  }
  return out.join('\n');
}
