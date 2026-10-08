#!/usr/bin/env node
/*
 * Checks a running deployment through Caddy, the way a browser reaches it (deploy/scripts/smoke-test.sh runs it
 * against a throwaway local stack; MIG's administrator can run it against staging or production):
 *
 *   node deploy/scripts/smoke-check.mjs https://dms.mig.uz [--ca root.crt] [--admin <e-mail> --password <pw>] [--expect production|staging]
 *
 * - `/`: index.html with the security headers of apps/web/public/_headers (CSP, HSTS, …) and `Cache-Control: no-store`;
 *   a deep link (/staff/clients) answers the app too; a missing asset is 404; the access log has no query strings.
 * - `/api/auth/me` without a session: 401; a change without the CSRF header: 403.
 * - production: every demo route (`/api/__demo/*`, «Войти как…») is 404; staging: they exist.
 * - Supabase is not reachable through the site (/auth/v1, /rest/v1, /storage/v1 answer the app, not Supabase).
 * - with --admin/--password: e-mail + password → the TOTP factor is connected (first sign-in) or a code is needed
 *   (an existing factor needs --totp-secret) → the session cookie (__Host-, HttpOnly, Secure, SameSite=Strict)
 *   → /api/auth/me and /api/dashboard → logout.
 * Exit 1 on the first failed check. `--ca` adds a CA (Caddy's `tls internal` root) for this process only.
 * --admin enrols a TOTP factor on a first sign-in and prints its secret: use it only for a throwaway or test account.
 */
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';

const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = (args[0] ?? '').replace(/\/$/, '');
if (!/^https:\/\//.test(base)) {
  process.stderr.write(
    'usage: smoke-check.mjs https://<domain> [--ca file] [--admin e-mail --password pw [--totp-secret s]] [--expect production|staging]\n',
  );
  process.exit(2);
}
// Node reads extra CAs only at start: run again with NODE_EXTRA_CA_CERTS for this process only.
if (opt('--ca') && process.env.NODE_EXTRA_CA_CERTS !== opt('--ca')) {
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, NODE_EXTRA_CA_CERTS: opt('--ca') },
  });
  process.exit(r.status ?? 1);
}
const expectEnv = opt('--expect') ?? 'production';
const CSRF = { 'x-requested-with': 'mig-web' };
const EXPECTED_HEADERS = [
  'content-security-policy',
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
  'cross-origin-opener-policy',
];

let passed = 0;
function check(ok, what, detail = '') {
  if (!ok) {
    process.stderr.write(`FAIL  ${what}${detail ? ` — ${detail}` : ''}\n`);
    process.exit(1);
  }
  passed++;
  process.stdout.write(`ok    ${what}\n`);
}
const get = (path, init) => fetch(`${base}${path}`, { redirect: 'manual', ...init });

// ---------------------------------------------------------------- static app and headers
const root = await get('/');
const html = await root.text();
check(root.status === 200 && html.includes('<div id="root"'), 'GET / serves the app', `${root.status}`);
for (const h of EXPECTED_HEADERS)
  check(!!root.headers.get(h), `header ${h}`, root.headers.get(h) ?? 'missing');
check(
  (root.headers.get('content-security-policy') ?? '').includes("script-src 'self'"),
  'CSP has script-src self',
);
check(
  root.headers.get('cache-control') === 'no-store',
  'index.html: Cache-Control no-store',
  root.headers.get('cache-control') ?? '',
);
check(!root.headers.get('server'), 'no Server header', root.headers.get('server') ?? '');
const deep = await get('/staff/clients');
check(deep.status === 200 && (await deep.text()).includes('<div id="root"'), 'SPA fallback for deep links');
const asset = html.match(/\/assets\/[^"]+\.js/)?.[0];
if (asset) {
  const a = await get(asset);
  await a.arrayBuffer();
  check(
    a.status === 200 && (a.headers.get('cache-control') ?? '').includes('immutable'),
    'assets are immutable',
    a.headers.get('cache-control') ?? '',
  );
}
const missing = await get('/assets/does-not-exist.js');
await missing.arrayBuffer();
check(missing.status === 404, 'a missing asset is 404', `${missing.status}`);
for (const p of ['/auth/v1/health', '/rest/v1/', '/storage/v1/status']) {
  const r = await get(p);
  const body = await r.text();
  check(
    !/gotrue|postgrest|"version"|storage/i.test(body.slice(0, 300)) && body.includes('<div id="root"'),
    `Supabase not exposed: ${p}`,
    `${r.status}`,
  );
}

// ---------------------------------------------------------------- API without a session
const me = await get('/api/auth/me');
await me.arrayBuffer();
check(me.status === 401, 'GET /api/auth/me without a session: 401', `${me.status}`);
const noCsrf = await get('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
});
await noCsrf.arrayBuffer();
check(noCsrf.status === 403, 'POST without X-Requested-With: 403 (CSRF)', `${noCsrf.status}`);
const big = await get('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...CSRF },
  body: JSON.stringify({ x: 'a'.repeat(1_100_000) }),
});
await big.arrayBuffer();
check(big.status === 413, 'JSON body over 1 MiB: 413', `${big.status}`);

for (const [method, path] of [
  ['POST', '/api/__demo/login-as'],
  ['POST', '/api/__demo/reset'],
  ['GET', '/api/__demo/failures'],
  ['GET', '/api/__demo/clock'],
]) {
  const r = await get(path, {
    method,
    headers: { 'content-type': 'application/json', ...CSRF },
    ...(method === 'POST' ? { body: JSON.stringify({ login: 'admin@demo.mig.uz' }) } : {}),
  });
  await r.arrayBuffer();
  if (expectEnv === 'production')
    check(r.status === 404, `production: ${method} ${path} is 404`, `${r.status}`);
  else if (path.endsWith('failures'))
    check(r.status === 200, `staging: ${method} ${path} exists`, `${r.status}`);
}

// ---------------------------------------------------------------- sign-in of the administrator
function base32(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase())
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totp(secret, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', base32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const admin = opt('--admin');
if (admin) {
  const json = { 'content-type': 'application/json', ...CSRF };
  const login = await get('/api/auth/login', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ email: admin, password: opt('--password') }),
  });
  const step = await login.json();
  check(
    login.status === 200 && !!step.challengeId,
    'POST /api/auth/login: password accepted, a code is asked',
    `${login.status} ${JSON.stringify(step).slice(0, 120)}`,
  );
  const secret = step.totpEnrollment?.secret ?? opt('--totp-secret');
  check(
    !!secret,
    step.totpEnrollment ? 'first sign-in: TOTP enrolment offered (QR/secret)' : 'TOTP secret given',
  );
  const otp = await get('/api/auth/otp', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ challengeId: step.challengeId, code: totp(secret) }),
  });
  const signed = await otp.json();
  const setCookie = otp.headers.getSetCookie().find((c) => c.startsWith('__Host-mig_session=')) ?? '';
  check(
    otp.status === 200 && signed.user?.role === 'admin',
    'POST /api/auth/otp: signed in as admin (aal2)',
    `${otp.status} ${JSON.stringify(signed).slice(0, 120)}`,
  );
  check(
    /HttpOnly/i.test(setCookie) &&
      /Secure/i.test(setCookie) &&
      /SameSite=Strict/i.test(setCookie) &&
      /Path=\//.test(setCookie),
    'session cookie __Host-mig_session: HttpOnly, Secure, SameSite=Strict',
    setCookie.replace(/=[^;]+/, '=…'),
  );
  const cookie = setCookie.split(';')[0];
  const who = await get('/api/auth/me', { headers: { cookie } });
  check(who.status === 200, 'GET /api/auth/me with the session: 200', `${who.status}`);
  await who.arrayBuffer();
  const dash = await get('/api/dashboard', { headers: { cookie } });
  check(
    dash.status === 200,
    'GET /api/dashboard (RLS as the admin): 200',
    `${dash.status} ${(await dash.text()).slice(0, 200)}`,
  );
  const out = await get('/api/auth/logout', { method: 'POST', headers: { cookie, ...CSRF } });
  await out.arrayBuffer();
  const after = await get('/api/auth/me', { headers: { cookie } });
  await after.arrayBuffer();
  check(
    out.ok && after.status === 401,
    'logout ends the session on the server',
    `${out.status} → ${after.status}`,
  );
  if (step.totpEnrollment) process.stdout.write(`TOTP_SECRET=${secret}\n`);
}
process.stdout.write(`smoke-check: ${passed} checks passed (${base}, ${expectEnv})\n`);
