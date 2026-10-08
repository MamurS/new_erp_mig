#!/usr/bin/env node
/*
 * Load test of the API on seed volumes (BACKEND_SPEC §13: the server estimate of the final report). No
 * dependencies: Node's fetch and a closed loop of virtual users.
 *
 *   node scripts/loadtest.mjs --base http://127.0.0.1:8787 --users 10,50,100 --duration 60 [--think 0] [--out file.json]
 *
 * Needs an API with the demo routes (APP_ENV=ci or staging, never production): every virtual user signs in with
 * `POST /api/__demo/login-as` as one of the demo accounts (staff roles, HR, clinic, assistance, insured) — a real
 * Supabase Auth sign-in behind the BFF cookie — and then repeats its role's scenario until the stage ends: the
 * main lists and detail cards (ids taken from the lists) and a few writes (revealing personal data with a reason —
 * an audit record on the hash chain; a chat message of the insured person; marking notifications read).
 *
 * Sessions are made once for the largest stage and reused by every stage (signed out at the end). Each account signs
 * in at most --sessions-per-account (3) times — the server's sign-in limits per account and phone are real; more users
 * of one account share its sessions.
 * Reported per stage: requests, RPS, errors, latency p50/p95/p99/max overall and per endpoint, and CPU/memory of
 * the API process (`--api-pid`, else found by `pgrep -f dist/server.js`; /proc, Linux only) and of the Docker
 * containers whose name matches `--containers` (default `supabase_`; `docker stats`). `--think <ms>` adds a pause
 * between the requests of one user (0 = back to back: saturation, not real people).
 */
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

function args() {
  const out = {
    base: 'http://127.0.0.1:8787',
    users: [10],
    duration: 30,
    think: 0,
    containers: 'supabase_',
    apiPid: null,
    out: null,
    loginConcurrency: 4,
    sessionsPerAccount: 3,
  };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    const v = a[i + 1];
    if (k === '--base') out.base = v;
    else if (k === '--users') out.users = v.split(',').map(Number);
    else if (k === '--duration') out.duration = Number(v);
    else if (k === '--think') out.think = Number(v);
    else if (k === '--containers') out.containers = v;
    else if (k === '--api-pid') out.apiPid = Number(v);
    else if (k === '--out') out.out = v;
    else if (k === '--login-concurrency') out.loginConcurrency = Number(v);
    else if (k === '--sessions-per-account') out.sessionsPerAccount = Number(v);
    else if (k === '--no-phones') {
      out.noPhones = true;
      continue;
    } else if (k === '--help') {
      process.stdout.write(
        readFileSync(new URL(import.meta.url))
          .toString()
          .split('*/')[0],
      );
      process.exit(0);
    } else continue;
    i++;
  }
  return out;
}

const opt = args();
// --no-phones: without the insured person (a demo phone code is caught by the API process that asked for it; with
// several API containers on staging the «Send SMS» hook may reach another one).
const API = `${opt.base.replace(/\/$/, '')}/api`;
const HEADERS = { 'content-type': 'application/json', 'x-requested-with': 'mig-web' };

// ---------------------------------------------------------------- accounts and scenarios

/** The mix of virtual users: mostly staff (the portal is the heaviest), some HR, clinics, assistance and insured. */
const ACCOUNTS = [
  'operator@demo.mig.uz',
  'underwriter@demo.mig.uz',
  'claims@demo.mig.uz',
  'accountant@demo.mig.uz',
  'sales@demo.mig.uz',
  'doctor@demo.mig.uz',
  'admin@demo.mig.uz',
  'legal@demo.mig.uz',
  'hr@demo-client.uz',
  'registrar@demo-clinic.uz',
  'asst-operator@demo-assist.uz',
  '+998900000001',
].filter((a) => !(opt.noPhones && a.startsWith('+')));

const itemsOf = (body) =>
  Array.isArray(body)
    ? body
    : Array.isArray(body?.items)
      ? body.items
      : Array.isArray(body?.rows)
        ? body.rows
        : [];
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const idsOf = (body) =>
  itemsOf(body)
    .map((x) => x?.id)
    .filter((x) => typeof x === 'string');

/**
 * One step: `[label, method, path | (state) => path | null, body?]`. A list step can remember ids for detail
 * steps (`keep`). A step whose path is null (no id yet) is skipped.
 */
const STAFF_COMMON = [
  ['GET /auth/me', 'GET', '/auth/me'],
  ['GET /notifications', 'GET', '/notifications'],
  ['GET /dashboard', 'GET', '/dashboard'],
  ['GET /queue', 'GET', '/queue'],
  ['GET /tasks/mine', 'GET', '/tasks/mine'],
];
const SCENARIOS = {
  operator: [
    ...STAFF_COMMON,
    ['GET /appointments', 'GET', '/appointments', null, 'appointments'],
    ['GET /insured', 'GET', '/insured?page=1&pageSize=50', null, 'insured'],
    ['GET /insured/:id', 'GET', (s) => s.insured && `/insured/${pick(s.insured)}`],
    ['GET /clinics', 'GET', '/clinics'],
    [
      'POST /insured/:id/reveal',
      'POST',
      (s) => s.insured && `/insured/${pick(s.insured)}/reveal`,
      { field: 'phone', reason: 'Load test: call back about the appointment' },
    ],
  ],
  underwriter: [
    ...STAFF_COMMON,
    ['GET /clients', 'GET', '/clients', null, 'clients'],
    ['GET /clients/:id', 'GET', (s) => s.clients && `/clients/${pick(s.clients)}`],
    ['GET /policies', 'GET', '/policies', null, 'policies'],
    ['GET /policies/:id', 'GET', (s) => s.policies && `/policies/${pick(s.policies)}`],
    ['GET /deals', 'GET', '/deals'],
    ['GET /reports/loss-ratio-by-client', 'GET', '/reports/loss-ratio-by-client'],
  ],
  claims_officer: [
    ...STAFF_COMMON,
    ['GET /claims', 'GET', '/claims', null, 'claims'],
    ['GET /claims/:id', 'GET', (s) => s.claims && `/claims/${pick(s.claims)}`],
    ['GET /insured', 'GET', '/insured?page=1&pageSize=50', null, 'insured'],
    ['GET /insured/:id', 'GET', (s) => s.insured && `/insured/${pick(s.insured)}`],
    [
      'POST /insured/:id/reveal',
      'POST',
      (s) => s.insured && `/insured/${pick(s.insured)}/reveal`,
      { field: 'pinfl', reason: 'Load test: checking the claim of this person' },
    ],
  ],
  accountant: [
    ...STAFF_COMMON,
    ['GET /invoices', 'GET', '/invoices'],
    ['GET /payments/queue', 'GET', '/payments/queue'],
    ['GET /claims', 'GET', '/claims?status=to_pay'],
    ['GET /registries', 'GET', '/registries'],
  ],
  sales_manager: [
    ...STAFF_COMMON,
    ['GET /deals', 'GET', '/deals', null, 'deals'],
    ['GET /deals/:id', 'GET', (s) => s.deals && `/deals/${pick(s.deals)}`],
    ['GET /clients', 'GET', '/clients'],
    ['GET /contracts', 'GET', '/contracts'],
  ],
  doctor_expert: [
    ...STAFF_COMMON,
    ['GET /guarantees', 'GET', '/guarantees'],
    ['GET /claims', 'GET', '/claims?status=medical_review'],
    ['GET /qa', 'GET', '/qa'],
  ],
  admin: [
    ...STAFF_COMMON,
    ['GET /audit', 'GET', '/audit'],
    ['GET /admin/users', 'GET', '/admin/users'],
    ['GET /params', 'GET', '/params'],
    ['POST /notifications/read', 'POST', '/notifications/read', {}],
  ],
  legal: [
    ...STAFF_COMMON,
    ['GET /contracts', 'GET', '/contracts', null, 'contracts'],
    ['GET /contracts/:id', 'GET', (s) => s.contracts && `/contracts/${pick(s.contracts)}`],
    ['GET /endorsements', 'GET', '/endorsements'],
  ],
  hr: [
    ['GET /auth/me', 'GET', '/auth/me'],
    ['GET /hr/overview', 'GET', '/hr/overview'],
    ['GET /hr/employees', 'GET', '/hr/employees', null, 'employees'],
    ['GET /hr/employees/:id', 'GET', (s) => s.employees && `/hr/employees/${pick(s.employees)}`],
    ['GET /hr/invoices', 'GET', '/hr/invoices'],
    ['GET /hr/stats', 'GET', '/hr/stats'],
  ],
  clinic_registrar: [
    ['GET /auth/me', 'GET', '/auth/me'],
    ['GET /clinic/overview', 'GET', '/clinic/overview'],
    ['GET /clinic/appointments', 'GET', '/clinic/appointments'],
    ['GET /clinic/visits', 'GET', '/clinic/visits'],
    ['GET /clinic/guarantees', 'GET', '/clinic/guarantees'],
  ],
  asst_operator: [
    ['GET /auth/me', 'GET', '/auth/me'],
    ['GET /assist/overview', 'GET', '/assist/overview'],
    ['GET /assist/cases', 'GET', '/assist/cases', null, 'cases'],
    ['GET /assist/cases/:id', 'GET', (s) => s.cases && `/assist/cases/${pick(s.cases)}`],
    ['GET /assist/insured', 'GET', '/assist/insured'],
    ['GET /assist/appointments', 'GET', '/assist/appointments'],
  ],
  insured: [
    ['GET /auth/me', 'GET', '/auth/me'],
    ['GET /me', 'GET', '/me'],
    ['GET /me/policy', 'GET', '/me/policy'],
    ['GET /me/limits', 'GET', '/me/limits'],
    ['GET /me/claims', 'GET', '/me/claims'],
    ['GET /me/appointments', 'GET', '/me/appointments'],
    ['GET /me/chat', 'GET', '/me/chat'],
    ['POST /me/chat', 'POST', '/me/chat', { text: 'Load test message' }],
  ],
};

// ---------------------------------------------------------------- HTTP

async function signIn(login) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(`${API}/__demo/login-as`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ login }),
    });
    const text = await r.text();
    if (r.ok) {
      const cookie = r.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ');
      const role = JSON.parse(text)?.user?.role;
      if (!cookie || !role) throw new Error(`login-as ${login}: no session in the answer`);
      return { cookie, role };
    }
    if (r.status === 404)
      throw new Error(
        'The demo routes are off (APP_ENV=production?): the load test signs in through /api/__demo/login-as',
      );
    if (attempt >= 5) throw new Error(`login-as ${login}: ${r.status} ${text.slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, 500 * attempt));
  }
}

const quantile = (sorted, q) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;

class Stats {
  constructor() {
    this.all = [];
    this.byLabel = new Map();
    this.errors = 0;
    this.errorKinds = new Map();
  }
  add(label, ms, ok, kind) {
    this.all.push(ms);
    let s = this.byLabel.get(label);
    if (!s) this.byLabel.set(label, (s = { ms: [], errors: 0 }));
    s.ms.push(ms);
    if (!ok) {
      this.errors++;
      s.errors++;
      const k = `${label} → ${kind}`;
      this.errorKinds.set(k, (this.errorKinds.get(k) ?? 0) + 1);
    }
  }
  summary(seconds) {
    const sorted = [...this.all].sort((a, b) => a - b);
    const sum = (list) => {
      const s = [...list].sort((a, b) => a - b);
      return {
        n: s.length,
        p50: quantile(s, 0.5),
        p95: quantile(s, 0.95),
        p99: quantile(s, 0.99),
        max: s.at(-1) ?? 0,
      };
    };
    return {
      requests: sorted.length,
      rps: +(sorted.length / seconds).toFixed(1),
      errors: this.errors,
      errorKinds: Object.fromEntries(this.errorKinds),
      ...sum(sorted),
      endpoints: Object.fromEntries(
        [...this.byLabel].map(([k, v]) => [k, { ...sum(v.ms), errors: v.errors }]),
      ),
    };
  }
}

async function virtualUser(session, deadline, stats) {
  const steps = SCENARIOS[session.role] ?? STAFF_COMMON;
  const state = {};
  const headers = { ...HEADERS, cookie: session.cookie };
  while (Date.now() < deadline) {
    for (const [label, method, pathOf, body, keep] of steps) {
      if (Date.now() >= deadline) return;
      const path = typeof pathOf === 'function' ? pathOf(state) : pathOf;
      if (!path) continue;
      const started = performance.now();
      let ok = false;
      let kind = '';
      try {
        const r = await fetch(`${API}${path}`, {
          method,
          headers,
          ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
        });
        const text = await r.text();
        ok = r.ok;
        kind = String(r.status);
        if (ok && keep) {
          const ids = idsOf(JSON.parse(text));
          if (ids.length) state[keep] = ids.slice(0, 50);
        }
      } catch (e) {
        kind = e instanceof Error ? e.message : 'error';
      }
      stats.add(label, performance.now() - started, ok, kind);
      if (opt.think > 0) await new Promise((res) => setTimeout(res, opt.think * (0.5 + Math.random())));
    }
  }
}

// ---------------------------------------------------------------- resources

async function apiPid() {
  if (opt.apiPid) return opt.apiPid;
  try {
    const { stdout } = await run('pgrep', ['-f', 'dist/server.js']);
    const pids = stdout.trim().split('\n').map(Number).filter(Boolean);
    return pids.length === 1 ? pids[0] : null;
  } catch {
    return null;
  }
}

function procSample(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ticks = Number(f[11]) + Number(f[12]);
    const rssPages = Number(f[21]);
    return { ticks, rssMb: (rssPages * 4096) / 2 ** 20, at: performance.now() };
  } catch {
    return null;
  }
}

function toMb(s) {
  const m = /^([\d.]+)\s*([KMG]i?B|B)/.exec(s.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  return m[2].startsWith('G')
    ? n * 1024
    : m[2].startsWith('M')
      ? n
      : m[2].startsWith('K')
        ? n / 1024
        : n / 2 ** 20;
}

async function dockerSample() {
  try {
    const { stdout } = await run('docker', [
      'stats',
      '--no-stream',
      '--format',
      '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}',
    ]);
    const out = {};
    for (const line of stdout.trim().split('\n')) {
      const [name, cpu, mem] = line.split('\t');
      if (!name || !name.includes(opt.containers)) continue;
      out[name] = { cpu: Number.parseFloat(cpu), memMb: toMb(mem.split('/')[0]) };
    }
    return out;
  } catch {
    return {};
  }
}

/** Samples CPU (% of one core) and memory every ~2 s until `stop()`; returns peaks and means. */
function monitor(pid) {
  let stopped = false;
  const api = [];
  const containers = new Map();
  let prev = pid ? procSample(pid) : null;
  const hz = 100;
  const loop = (async () => {
    while (!stopped) {
      const docker = await dockerSample();
      for (const [name, v] of Object.entries(docker)) {
        const list = containers.get(name) ?? [];
        list.push(v);
        containers.set(name, list);
      }
      if (pid) {
        const cur = procSample(pid);
        if (cur && prev)
          api.push({
            cpu: ((cur.ticks - prev.ticks) / hz / ((cur.at - prev.at) / 1000)) * 100,
            memMb: cur.rssMb,
          });
        prev = cur;
      }
      await new Promise((res) => setTimeout(res, 1000));
    }
  })();
  const agg = (list) => ({
    cpuMean: +(list.reduce((s, x) => s + x.cpu, 0) / Math.max(1, list.length)).toFixed(0),
    cpuPeak: +Math.max(0, ...list.map((x) => x.cpu)).toFixed(0),
    memPeakMb: +Math.max(0, ...list.map((x) => x.memMb)).toFixed(0),
  });
  return {
    async stop() {
      stopped = true;
      await loop;
      return {
        api: pid ? agg(api) : null,
        containers: Object.fromEntries([...containers].map(([k, v]) => [k, agg(v)])),
      };
    },
  };
}

// ---------------------------------------------------------------- stages

/**
 * Sessions for `n` virtual users: user i plays ACCOUNTS[i % ACCOUNTS.length]. Each account signs in at most
 * `--sessions-per-account` times (the server's sign-in limits per account and per phone are real); further users of
 * that account share its sessions round robin.
 */
async function signInAll(n) {
  const perAccount = new Map();
  const wanted = [];
  for (let i = 0; i < n; i++) {
    const account = ACCOUNTS[i % ACCOUNTS.length];
    const k = perAccount.get(account) ?? 0;
    perAccount.set(account, k + 1);
    // A phone gets one one-time code a minute (Supabase Auth: GOTRUE_SMS_MAX_FREQUENCY): one session per phone.
    if (k < (account.startsWith('+') ? 1 : opt.sessionsPerAccount)) wanted.push(account);
  }
  const signed = new Array(wanted.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(opt.loginConcurrency, wanted.length) }, async () => {
      while (next < wanted.length) {
        const i = next++;
        signed[i] = { account: wanted[i], ...(await signIn(wanted[i])) };
      }
    }),
  );
  const byAccount = new Map();
  for (const s of signed) byAccount.set(s.account, [...(byAccount.get(s.account) ?? []), s]);
  const used = new Map();
  return Array.from({ length: n }, (_, i) => {
    const account = ACCOUNTS[i % ACCOUNTS.length];
    const list = byAccount.get(account);
    const k = used.get(account) ?? 0;
    used.set(account, k + 1);
    return list[k % list.length];
  });
}

async function signOut(sessions) {
  await Promise.all(
    [...new Set(sessions)].map((s) =>
      fetch(`${API}/auth/logout`, {
        method: 'POST',
        headers: { ...HEADERS, cookie: s.cookie },
        body: '{}',
      }).catch(() => undefined),
    ),
  );
}

const results = [];
const pid = await apiPid();
const t0 = Date.now();
const allSessions = await signInAll(Math.max(...opt.users));
const loginSec = (Date.now() - t0) / 1000;
for (const users of opt.users) {
  const sessions = allSessions.slice(0, users);
  const stats = new Stats();
  const mon = monitor(pid);
  const started = Date.now();
  const deadline = started + opt.duration * 1000;
  await Promise.all(sessions.map((s) => virtualUser(s, deadline, stats)));
  const seconds = (Date.now() - started) / 1000;
  const resources = await mon.stop();
  const summary = {
    users,
    think: opt.think,
    durationSec: +seconds.toFixed(1),
    signInSec: +loginSec.toFixed(1),
    ...stats.summary(seconds),
    resources,
  };
  results.push(summary);
  const r = (x) => Math.round(x);
  process.stdout.write(
    `users=${users} requests=${summary.requests} rps=${summary.rps} errors=${summary.errors} p50=${r(summary.p50)}ms p95=${r(summary.p95)}ms p99=${r(summary.p99)}ms max=${r(summary.max)}ms` +
      (resources.api
        ? ` api_cpu_mean=${resources.api.cpuMean}% api_cpu_peak=${resources.api.cpuPeak}% api_rss_peak=${resources.api.memPeakMb}MB`
        : '') +
      Object.entries(resources.containers)
        .map(
          ([k, v]) =>
            ` ${k.replace(opt.containers, '')}_cpu_mean=${v.cpuMean}% ${k.replace(opt.containers, '')}_mem_peak=${v.memPeakMb}MB`,
        )
        .join('') +
      '\n',
  );
  if (summary.errors) process.stdout.write(`  errors: ${JSON.stringify(summary.errorKinds)}\n`);
}
await signOut(allSessions);
if (opt.out) writeFileSync(opt.out, `${JSON.stringify(results, null, 2)}\n`);
