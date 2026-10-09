// @vitest-environment node
/* deploy/Caddyfile serves the same security headers and CSP as apps/web/public/_headers (one source). */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CADDYFILE, HEADERS_FILE, parseHeaders, renderCaddyfile } from './caddy-headers.mjs';

describe('Caddy headers', () => {
  it('deploy/Caddyfile carries exactly the headers of _headers (node scripts/caddy-headers.mjs --write)', () => {
    const caddyfile = readFileSync(CADDYFILE, 'utf8');
    expect(renderCaddyfile(caddyfile, readFileSync(HEADERS_FILE, 'utf8'))).toBe(caddyfile);
  });

  it('every header of _headers is in the Caddyfile with its value', () => {
    const caddyfile = readFileSync(CADDYFILE, 'utf8');
    for (const rule of parseHeaders(readFileSync(HEADERS_FILE, 'utf8')))
      for (const [name, value] of rule.headers) {
        const line = rule.path === '/*' ? `${name} "${value}"` : `header ${rule.path} ${name} "${value}"`;
        expect(caddyfile, `${rule.path} ${name}`).toContain(line);
      }
  });

  it('a changed _headers makes the check fail', () => {
    const caddyfile = readFileSync(CADDYFILE, 'utf8');
    const changed = readFileSync(HEADERS_FILE, 'utf8').replace(
      'X-Frame-Options: DENY',
      'X-Frame-Options: SAMEORIGIN',
    );
    expect(renderCaddyfile(caddyfile, changed)).not.toBe(caddyfile);
  });

  it('nothing but /api and the static app is served: Supabase, Kong and Studio are not proxied', () => {
    const caddyfile = readFileSync(CADDYFILE, 'utf8').replace(/#.*$/gm, '');
    expect(caddyfile).not.toMatch(
      /kong|studio|auth:9999|rest:3000|storage:5000|:5432|\/auth\/v1|\/rest\/v1|\/storage\/v1/i,
    );
    expect([...caddyfile.matchAll(/reverse_proxy/g)]).toHaveLength(1);
  });
});
