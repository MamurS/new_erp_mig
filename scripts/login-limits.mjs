#!/usr/bin/env node
/*
 * Sign-in limits behind one office address (stage 1.5; docs/backend/LOAD.md «Вход с одного IP»). No dependencies.
 *
 *   node scripts/login-limits.mjs --base https://staging.dms.mig.uz --users 100 --window 300 [--out file.json]
 *
 * Needs a staging-like API (APP_ENV=staging, ALLOW_TEST_TOTP=true: the demo code 000000 stands for the current code
 * of the demo TOTP factor — Supabase Auth still runs the challenge and the verify of every sign-in) and runs
 * from ONE machine, so every request comes from one IP, as a whole office behind one address:
 *
 * 1. the administrator creates `--users` staff accounts (office.NNN@demo.mig.uz; once — they are reused);
 * 2. they sign in (e-mail, password, TOTP code, /auth/me, sign out), arrivals spread evenly over `--window` seconds;
 * 3. meanwhile one more account (office.victim@demo.mig.uz) gets `--wrong` wrong codes in a row (a new password step
 *    after every «Попыток входа до блокировки» codes), then signs in with the right code.
 *
 * Expected: every office sign-in succeeds (no 429 — the IP limits of Supabase Auth hold an office); the victim is
 * locked after «Попыток входа до блокировки» wrong codes (429) and stays locked even with the right code. Exit code 1 otherwise.
 */
import { writeFileSync } from 'node:fs';

function args() {
  const out = { base: 'http://127.0.0.1:8787', users: 100, window: 300, wrong: 20, password: 'Demo-2026!', out: null, concurrency: 20 };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 2) {
    const [k, v] = [a[i], a[i + 1]];
    if (k === '--base') out.base = v;
    else if (k === '--users') out.users = Number(v);
    else if (k === '--window') out.window = Number(v);
    else if (k === '--wrong') out.wrong = Number(v);
    else if (k === '--password') out.password = v;
    else if (k === '--out') out.out = v;
  }
  return out;
}
const opt = args();
const API = `${opt.base.replace(/\/$/, '')}/api`;
const HEADERS = { 'content-type': 'application/json', 'x-requested-with': 'mig-web' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cookieOf = (r) => r.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ');

async function call(method, path, body, cookie) {
  const r = await fetch(`${API}${path}`, { method, headers: { ...HEADERS, ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: r.status, json, cookie: cookieOf(r) };
}

const email = (n) => `office.${String(n).padStart(3, '0')}@demo.mig.uz`;
const VICTIM = 'office.victim@demo.mig.uz';

async function setup() {
  const admin = await fetch(`${API}/__demo/login-as`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ login: 'admin@demo.mig.uz' }) });
  if (!admin.ok) throw new Error(`login-as admin: ${admin.status} (a staging API with the demo routes is needed)`);
  const cookie = cookieOf(admin);
  const existing = new Set(((await call('GET', '/admin/users', undefined, cookie)).json ?? []).map((u) => u.email));
  let created = 0;
  for (const e of [...Array.from({ length: opt.users }, (_, i) => email(i + 1)), VICTIM]) {
    if (existing.has(e)) continue;
    const r = await call('POST', '/admin/users', { fullName: 'Ofis Xodimi Sinovchi', email: e, role: 'operator' }, cookie);
    if (r.status !== 201) throw new Error(`create ${e}: ${r.status}`);
    created += 1;
  }
  // The worker gives new accounts their Supabase Auth user (demo password, demo factor) within a pass or two.
  for (let i = 0; i < 60; i++) {
    const r = await call('POST', '/auth/login', { email: email(opt.users), password: opt.password });
    if (r.status === 200) break;
    await sleep(2000);
  }
  return created;
}

/** One office sign-in: password, the TOTP code, the session, sign-out. */
async function signIn(e) {
  const t0 = performance.now();
  const a = await call('POST', '/auth/login', { email: e, password: opt.password });
  if (a.status !== 200) return { step: 'password', status: a.status, ms: performance.now() - t0 };
  const b = await call('POST', '/auth/otp', { challengeId: a.json.challengeId, code: '000000' });
  if (b.status !== 200) return { step: 'code', status: b.status, ms: performance.now() - t0 };
  const me = await call('GET', '/auth/me', undefined, b.cookie);
  const ms = performance.now() - t0;
  await call('POST', '/auth/logout', undefined, b.cookie);
  return { step: me.status === 200 ? 'done' : 'me', status: me.status, ms };
}

/** Wrong codes in a row on one account (a new password step after every 5), then the right one. */
async function attack() {
  const statuses = [];
  let challenge = null;
  let tries = 0;
  for (let i = 0; i < opt.wrong; i++) {
    if (!challenge) {
      const a = await call('POST', '/auth/login', { email: VICTIM, password: opt.password });
      if (a.status !== 200) {
        statuses.push(a.status);
        continue;
      }
      challenge = a.json.challengeId;
      tries = 0;
    }
    const r = await call('POST', '/auth/otp', { challengeId: challenge, code: '123457' });
    statuses.push(r.status);
    tries += 1;
    if (r.status !== 401 || tries >= 5) challenge = null;
    await sleep(300);
  }
  const right = await signIn(VICTIM);
  return { statuses, right };
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]) : 0;
};

const created = await setup();
console.log(`accounts: ${opt.users} + victim (${created} created); sign-ins over ${opt.window} s from one address`);
const started = performance.now();
const attacker = attack();
const results = await Promise.all(
  Array.from({ length: opt.users }, async (_, i) => {
    await sleep((i * opt.window * 1000) / opt.users);
    return signIn(email(i + 1));
  }),
);
const victim = await attacker;
const seconds = Math.round((performance.now() - started) / 1000);
const ok = results.filter((r) => r.step === 'done');
const blocked = results.filter((r) => r.status === 429);
const byStep = {};
for (const r of results) byStep[`${r.step} ${r.status}`] = (byStep[`${r.step} ${r.status}`] ?? 0) + 1;
const summary = {
  users: opt.users,
  windowSeconds: opt.window,
  tookSeconds: seconds,
  signedIn: ok.length,
  blocked: blocked.length,
  byStep,
  signInMs: { p50: pct(ok.map((r) => r.ms), 50), p95: pct(ok.map((r) => r.ms), 95), max: pct(ok.map((r) => r.ms), 100) },
  victim: { wrongCodes: victim.statuses, rightCodeAfter: `${victim.right.step} ${victim.right.status}` },
};
console.log(JSON.stringify(summary, null, 2));
if (opt.out) writeFileSync(opt.out, JSON.stringify({ summary, results }, null, 2));
const lockedAfter = victim.statuses.slice(5).every((s) => s === 429) && victim.right.status === 429;
process.exit(ok.length === opt.users && blocked.length === 0 && lockedAfter ? 0 : 1);
