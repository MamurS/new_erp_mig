#!/usr/bin/env node
/*
 * Latency of the list endpoints on seed volumes (docs/backend/LOAD.md «Списки»): one request at a time (no
 * concurrency), so the numbers are the cost of one list answer, not of a queue. No dependencies.
 *
 *   node scripts/listbench.mjs --base http://127.0.0.1:8787 [--runs 20] [--warmup 3] [--out file.json] [--only /hr/employees]
 *
 * Needs an API with the demo routes (APP_ENV=ci or staging and ALLOW_TEST_TOTP=true): every account signs in
 * once with `POST /api/__demo/login-as`. For each list: the first page with the default sort, and one search
 * (`?q=`) where the list has one. Prints a Markdown table of p50/p95 (ms) and the size of the answer.
 */
import { writeFileSync } from 'node:fs';

function args() {
  const out = { base: 'http://127.0.0.1:8787', runs: 20, warmup: 3, out: null, only: null };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 2) {
    const k = a[i];
    const v = a[i + 1];
    if (k === '--base') out.base = v;
    else if (k === '--runs') out.runs = Number(v);
    else if (k === '--warmup') out.warmup = Number(v);
    else if (k === '--out') out.out = v;
    else if (k === '--only') out.only = v;
  }
  return out;
}

const opt = args();
const API = `${opt.base.replace(/\/$/, '')}/api`;
const HEADERS = { 'content-type': 'application/json', 'x-requested-with': 'mig-web' };

/** [account, path]: the default first page and a search (a common syllable of the seed's names). */
const CASES = [
  ['hr@demo-client.uz', '/hr/employees'],
  ['hr@demo-client.uz', '/hr/employees?q=ali'],
  ['underwriter@demo.mig.uz', '/clients'],
  ['underwriter@demo.mig.uz', '/clients?q=tosh'],
  ['underwriter@demo.mig.uz', '/policies'],
  ['underwriter@demo.mig.uz', '/policies?q=tosh'],
  ['operator@demo.mig.uz', '/insured'],
  ['operator@demo.mig.uz', '/insured?q=ali'],
  ['operator@demo.mig.uz', '/insured?sort=clientName:desc&page=3'],
  ['operator@demo.mig.uz', '/appointments'],
  ['operator@demo.mig.uz', '/appointments?q=ali'],
  ['operator@demo.mig.uz', '/clinics'],
  ['operator@demo.mig.uz', '/clinics?q=med'],
  ['claims@demo.mig.uz', '/claims'],
  ['claims@demo.mig.uz', '/claims?q=ali'],
  ['claims@demo.mig.uz', '/claims?sort=reserve:desc&page=2'],
  ['sales@demo.mig.uz', '/deals'],
  ['sales@demo.mig.uz', '/contracts'],
  ['accountant@demo.mig.uz', '/invoices'],
  ['accountant@demo.mig.uz', '/payments/queue'],
  ['accountant@demo.mig.uz', '/registries'],
  ['legal@demo.mig.uz', '/endorsements'],
  ['legal@demo.mig.uz', '/change-requests'],
  ['doctor@demo.mig.uz', '/guarantees'],
  ['admin@demo.mig.uz', '/audit'],
  ['admin@demo.mig.uz', '/audit?q=insured'],
  ['admin@demo.mig.uz', '/assistance'],
  ['admin@demo.mig.uz', '/rebills'],
  ['admin@demo.mig.uz', '/policy-changes'],
  ['asst-operator@demo-assist.uz', '/assist/cases'],
  ['asst-operator@demo-assist.uz', '/assist/insured'],
  ['asst-operator@demo-assist.uz', '/assist/insured?q=ali'],
  ['asst-operator@demo-assist.uz', '/assist/appointments'],
  ['asst-operator@demo-assist.uz', '/assist/guarantees'],
  ['registrar@demo-clinic.uz', '/clinic/visits'],
  ['registrar@demo-clinic.uz', '/clinic/appointments'],
  ['registrar@demo-clinic.uz', '/clinic/guarantees'],
].filter(([, p]) => !opt.only || p.startsWith(opt.only));

async function signIn(login) {
  const r = await fetch(`${API}/__demo/login-as`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ login }) });
  const text = await r.text();
  if (!r.ok) throw new Error(`login-as ${login}: ${r.status} ${text.slice(0, 200)}`);
  return r.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);

const cookies = new Map();
const rows = [];
for (const [login, path] of CASES) {
  if (!cookies.has(login)) cookies.set(login, await signIn(login));
  const headers = { ...HEADERS, cookie: cookies.get(login) };
  const times = [];
  let status = 0;
  let size = 0;
  let items = '';
  for (let i = 0; i < opt.warmup + opt.runs; i++) {
    const t0 = performance.now();
    const r = await fetch(`${API}${path}`, { headers });
    const body = await r.text();
    const ms = performance.now() - t0;
    status = r.status;
    size = body.length;
    if (i === 0 && r.ok) {
      const j = JSON.parse(body);
      items = Array.isArray(j) ? `${j.length}` : Array.isArray(j?.items) ? `${j.items.length}/${j.total ?? '?'}` : '';
    }
    if (i >= opt.warmup) times.push(ms);
  }
  times.sort((a, b) => a - b);
  const row = { login, path, status, items, bytes: size, p50: Math.round(quantile(times, 0.5)), p95: Math.round(quantile(times, 0.95)) };
  rows.push(row);
  process.stderr.write(`${path} ${status} p50=${row.p50} p95=${row.p95}\n`);
}

console.log('| Запрос | Роль | Строк (страница/всего) | p50, мс | p95, мс |');
console.log('| --- | --- | --- | --- | --- |');
for (const r of rows) console.log(`| \`GET ${r.path}\` | ${r.login.split('@')[0]} | ${r.items} | ${r.p50} | ${r.p95} |`);
if (opt.out) writeFileSync(opt.out, JSON.stringify(rows, null, 1));
