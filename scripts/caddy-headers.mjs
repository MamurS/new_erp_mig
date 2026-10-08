#!/usr/bin/env node
/*
 * The security headers and the CSP have one source: apps/web/public/_headers (the Cloudflare demo site reads it
 * as is). deploy/Caddyfile carries the same headers in generated blocks between `# BEGIN generated …` and
 * `# END generated …` markers:
 *
 *   node scripts/caddy-headers.mjs          # checks that deploy/Caddyfile matches _headers (exit 1 if not)
 *   node scripts/caddy-headers.mjs --write  # rewrites the generated blocks from _headers
 *
 * `/*` of _headers becomes the site-wide `header` block; every other path becomes `header <path> …` lines in the
 * static-files route (after the SPA fallback, so `/index.html` also covers deep links answered with index.html).
 * The test scripts/caddy-headers.test.ts runs the check in `npm test`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const HEADERS_FILE = resolve(root, 'apps/web/public/_headers');
export const CADDYFILE = resolve(root, 'deploy/Caddyfile');

/** Parses the Cloudflare `_headers` format: a path line, then indented `Name: value` lines. */
export function parseHeaders(text) {
  const rules = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = { path: line.trim(), headers: [] };
      rules.push(current);
      continue;
    }
    if (!current) throw new Error(`_headers: a header before any path: ${line}`);
    const i = line.indexOf(':');
    if (i < 0) throw new Error(`_headers: not a header line: ${line}`);
    current.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
  }
  return rules;
}

const quote = (v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** The two generated blocks, indented as they sit in deploy/Caddyfile. */
export function caddyBlocks(rules) {
  const site = rules.find((r) => r.path === '/*');
  if (!site) throw new Error('_headers: no /* rule');
  const siteBlock = [
    '\theader {',
    ...site.headers.map(([n, v]) => `\t\t${n} ${quote(v)}`),
    '\t\t-Server',
    '\t}',
  ];
  const pathBlock = rules
    .filter((r) => r.path !== '/*')
    .flatMap((r) => r.headers.map(([n, v]) => `\t\t\theader ${r.path} ${n} ${quote(v)}`));
  return { site: siteBlock.join('\n'), paths: pathBlock.join('\n') };
}

function replaceBlock(text, name, body) {
  const re = new RegExp(
    `([ \\t]*# BEGIN generated: ${name}[^\\n]*\\n)([\\s\\S]*?)([ \\t]*# END generated: ${name})`,
  );
  if (!re.test(text))
    throw new Error(`deploy/Caddyfile: no "# BEGIN generated: ${name}" … "# END generated: ${name}" block`);
  return text.replace(re, (_m, begin, _old, end) => `${begin}${body}\n${end}`);
}

/** deploy/Caddyfile with its generated blocks rebuilt from `_headers`. */
export function renderCaddyfile(caddyfile, headersText) {
  const blocks = caddyBlocks(parseHeaders(headersText));
  return replaceBlock(replaceBlock(caddyfile, 'site headers', blocks.site), 'path headers', blocks.paths);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const current = readFileSync(CADDYFILE, 'utf8');
  const expected = renderCaddyfile(current, readFileSync(HEADERS_FILE, 'utf8'));
  if (process.argv.includes('--write')) {
    if (expected !== current) writeFileSync(CADDYFILE, expected);
    process.stdout.write(
      expected === current
        ? 'deploy/Caddyfile: headers already in sync\n'
        : 'deploy/Caddyfile: headers rewritten from _headers\n',
    );
  } else if (expected !== current) {
    process.stderr.write(
      'deploy/Caddyfile: the headers differ from apps/web/public/_headers — run `node scripts/caddy-headers.mjs --write`\n',
    );
    process.exit(1);
  } else {
    process.stdout.write('deploy/Caddyfile: headers match apps/web/public/_headers\n');
  }
}
