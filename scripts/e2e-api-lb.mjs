#!/usr/bin/env node
/*
 * A round-robin HTTP balancer for e2e against several API replicas (E2E_API_REPLICAS, apps/web/playwright.config.ts):
 * every request goes to the next replica, so state kept in one process (a sign-in step, the demo knobs, a test
 * code of the SMS hook) would break the suite. Test tooling only — production runs Caddy in front of API_REPLICAS.
 *
 *   node scripts/e2e-api-lb.mjs <listen port> <target port> [<target port> …]
 */
import http from 'node:http';

const [listen, ...targets] = process.argv.slice(2).map(Number);
if (!listen || targets.length === 0 || targets.some((t) => !t)) {
  console.error('usage: e2e-api-lb.mjs <listen port> <target port> [<target port> …]');
  process.exit(2);
}

let next = 0;
const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });

http
  .createServer((req, res) => {
    const port = targets[next++ % targets.length];
    const up = http.request(
      { host: '127.0.0.1', port, method: req.method, path: req.url, headers: req.headers, agent },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.rawHeaders);
        r.pipe(res);
      },
    );
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('replica unavailable');
    });
    req.pipe(up);
  })
  .listen(listen, '0.0.0.0', () => console.log(`e2e-api-lb :${listen} → ${targets.join(', ')}`));
