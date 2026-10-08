/*
 * Conformance memory ↔ postgres (BACKEND_SPEC §4.4): the same scenarios run through the same route table and
 * services once over the memory repositories and once over the Postgres repositories (the Fastify app, row-level
 * security on), both from the same seed, with the same clock and the same random numbers; every answer must be
 * identical (status and body).
 *
 * Needs DATABASE_URL (CI job `api`); skipped otherwise.
 */
import { writeFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ROUTES } from '@mig/domain/http/routes';
import { DEMO_PASSWORD } from '@mig/domain/auth/demo';
import { devPiiCrypto } from '@mig/domain/store/pii';
import type { Db } from '@mig/domain/store/db';
import { DEMO_ASSIST2_OPERATOR, DEMO_ASSIST_USERS, DEMO_CLINIC_USERS, DEMO_HR, DEMO_INSURED_PHONE, DEMO_SPOUSE_PHONE, DEMO_STAFF } from '@mig/seed/credentials';
import { createSeed } from '@mig/seed/seed';
import { buildApp } from './app';
import { fastifyClient, hasDb, loadSeed, memoryClient, multipart, signIn, testDeps, testPool, type Answer, type CallOptions, type Client, type Who } from './test/support';

// ---------------------------------------------------------------- deterministic randomness

/** mulberry32 */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rand = prng(1);
function seedRandom(n: number): void {
  rand = prng(n);
}
vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(arr: T): T => {
  if (arr) {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(rand() * 256);
  }
  return arr;
});
vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
  const h = Array.from({ length: 16 }, () => Math.floor(rand() * 256));
  h[6] = (h[6]! & 0x0f) | 0x40;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}` as `${string}-${string}-${string}-${string}-${string}`;
});

// ---------------------------------------------------------------- the two sides

const T = Math.floor(Date.now() / 60_000) * 60_000;

let pool: pg.Pool;
let app: FastifyInstance;
let mem: Client;
let pgc: Client;
let seed: Db;
let step = 1000;
const mismatches: string[] = [];
/** Unexpected errors of the Postgres side (500s), for the report. */
const errors: string[] = [];
const diffs: { label: string; method: string; path: string; mem: Answer; pg: Answer }[] = [];

interface Pair {
  mem: Answer;
  pg: Answer;
}

/** Runs one request on both sides with the same random numbers; records a difference. */
async function both(label: string, method: string, path: string, o: { mem?: CallOptions; pg?: CallOptions } = {}): Promise<Pair> {
  const n = ++step;
  seedRandom(n);
  const a = await mem.call(method, path, o.mem);
  seedRandom(n);
  const b = await pgc.call(method, path, o.pg);
  try {
    expect(b.status).toBe(a.status);
    expect(b.body).toEqual(a.body);
  } catch {
    mismatches.push(`${label} ${method} ${path}: memory ${a.status} ${a.text.slice(0, 300)} | postgres ${b.status} ${b.text.slice(0, 300)}`);
    diffs.push({ label, method, path, mem: a, pg: b });
  }
  return { mem: a, pg: b };
}

/** Signs in on both sides; the same random numbers give the same session id. */
async function session(who: Who): Promise<string> {
  const n = ++step;
  seedRandom(n);
  const a = await signIn(mem, who);
  seedRandom(n);
  const b = await signIn(pgc, who);
  expect(b).toBe(a);
  return a;
}

// ---------------------------------------------------------------- ids for detail routes

function ids(db: Db): Record<string, string | undefined> {
  const me = db.insured.find((i) => i.phone === DEMO_INSURED_PHONE)!;
  const clinicId = db.clinicUsers[0]?.clinicId;
  const assistanceId = db.assistUsers[0]?.assistanceId;
  return {
    clients: me.clientId,
    policies: me.policyId,
    insured: me.id,
    employees: me.id,
    chat: me.id,
    claims: db.claims.find((c) => c.insuredId === me.id)?.id ?? db.claims[0]?.id,
    kp: db.kp[0]?.id,
    deals: db.deals[0]?.id,
    quotes: db.quotes[0]?.id,
    contracts: db.contracts[0]?.id,
    endorsements: db.endorsements[0]?.id,
    guarantees: db.guarantees.find((g) => g.clinicId === clinicId)?.id,
    registries: db.registries.find((r) => r.clinicId === clinicId)?.id,
    rebills: db.rebills.find((r) => r.assistanceId === assistanceId)?.id,
    assistance: assistanceId,
    clinics: clinicId,
    visits: db.visits.find((v) => v.clinicId === clinicId)?.id,
    files: db.files[0]?.id,
    batches: db.migrationBatches[0]?.id,
    cases: db.cases.find((c) => c.assistanceId === assistanceId)?.id,
  };
}

/** GET paths of the table with their parameters filled in (routes whose parameters cannot be filled are left out). */
function readPaths(db: Db): string[] {
  const known = ids(db);
  const out: string[] = [];
  for (const r of ROUTES) {
    if (r.method !== 'GET' || r.auth !== 'session') continue;
    let ok = true;
    const path = r.path.replace(/([^/]+)\/:(\w+)/g, (_m, seg: string, name: string) => {
      const v = name === 'anchor' ? 'getting-started' : name === 'insuredId' ? known.insured : known[seg];
      if (!v) ok = false;
      return `${seg}/${v}`;
    });
    if (ok) out.push(path);
  }
  return out;
}

const ACCOUNTS: [string, Who][] = [
  ...DEMO_STAFF.map((s): [string, Who] => [s.email, { email: s.email }]),
  ['hr', { email: DEMO_HR.email }],
  ['insured', { phone: DEMO_INSURED_PHONE }],
  ['spouse', { phone: DEMO_SPOUSE_PHONE }],
  ...DEMO_CLINIC_USERS.map((u): [string, Who] => [u.email, { email: u.email }]),
  ...DEMO_ASSIST_USERS.map((u): [string, Who] => [u.email, { email: u.email }]),
  [DEMO_ASSIST2_OPERATOR.email, { email: DEMO_ASSIST2_OPERATOR.email }],
];

describe.skipIf(!hasDb)('conformance: memory ↔ postgres', () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: T });
    const deps = testDeps();
    seed = createSeed({ now: T });
    pool = testPool();
    await loadSeed(pool, createSeed({ now: T }));
    app = await buildApp({ pool, crypto: devPiiCrypto(), deps, demoPassword: DEMO_PASSWORD, now: () => Date.now(), onError: (e, route) => errors.push(`${route}: ${e instanceof Error ? e.message : String(e)}`) });
    mem = memoryClient(seed, deps, () => Date.now());
    pgc = fastifyClient(app);
  });

  afterAll(async () => {
    // A full list of differences for debugging: CONFORMANCE_OUT=<file>.
    if (process.env.CONFORMANCE_OUT) writeFileSync(process.env.CONFORMANCE_OUT, JSON.stringify({ errors, diffs: diffs.map((d) => ({ ...d, mem: d.mem.body, pg: d.pg.body, ms: d.mem.status, ps: d.pg.status })) }, null, 1));
    vi.useRealTimers();
    await app?.close();
    await pool?.end();
  });

  it('reads: every list and detail route for every demo account', async () => {
    const paths = readPaths(createSeed({ now: T }));
    for (const [label, who] of ACCOUNTS) {
      const sid = await session(who);
      for (const p of paths) await both(label, 'GET', p, { mem: { session: sid }, pg: { session: sid } });
    }
    expect(mismatches).toEqual([]);
  });

  it('writes: flows of every portal', async () => {
    const d = createSeed({ now: T });
    const today = new Date(T + 5 * 3600_000).toISOString().slice(0, 10);
    const plusDays = (n: number) => new Date(T + 5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
    const me = d.insured.find((i) => i.phone === DEMO_INSURED_PHONE)!;
    const as = async (who: Who) => {
      const sid = await session(who);
      return (label: string, method: string, path: string, body?: unknown, headers?: Record<string, string>) =>
        both(label, method, path, { mem: { session: sid, body, headers }, pg: { session: sid, body, headers } });
    };
    const staff = (role: string) => ({ email: DEMO_STAFF.find((s) => s.role === role)!.email });

    // ---- operator: a claim to review, personal data revealed, the access log
    const operator = await as(staff('operator'));
    const newClaim = d.claims.find((c) => c.status === 'new')!;
    await operator('operator', 'POST', `/claims/${newClaim.id}/transition`, { to: 'review', comment: 'Принято в работу' });
    await operator('operator', 'GET', `/claims/${newClaim.id}`);
    await operator('operator', 'POST', `/insured/${me.id}/reveal`, { field: 'pinfl', reason: 'Проверка по звонку клиента' });
    await operator('operator', 'POST', `/insured/${me.id}/reveal`, { field: 'phone', reason: 'Проверка по звонку клиента' });
    await operator('operator', 'GET', `/insured/${me.id}/access-log`);
    const limit = await operator('operator', 'POST', '/limit-requests', { policyId: me.policyId, insuredId: me.id, category: 'dental', to: 9_000_000, justification: 'Справка от стоматолога о лечении' });

    // ---- underwriter: the second pair of eyes on the limit
    const underwriter = await as(staff('underwriter'));
    const limitId = (limit.mem.body as { id?: string }).id;
    if (limitId) await underwriter('underwriter', 'POST', `/limit-requests/${limitId}/approve`);
    await underwriter('underwriter', 'GET', '/limit-requests');

    // ---- doctor: medical data by a grant
    const doctor = await as(staff('doctor_expert'));
    const grant = await doctor('doctor', 'POST', `/insured/${me.id}/medical-access`, { reason: 'Экспертиза обращения по убытку' });
    const grantId = (grant.mem.body as { grantId?: string }).grantId ?? '';
    await doctor('doctor', 'GET', `/insured/${me.id}/medical`, undefined, { 'x-medical-grant': grantId });

    // ---- the insured person: chat, card code, an appointment
    const insured = await as({ phone: DEMO_INSURED_PHONE });
    await insured('insured', 'POST', '/me/chat', { text: 'Здравствуйте, как записаться к стоматологу?' });
    await insured('insured', 'GET', '/me/chat');
    await insured('insured', 'GET', '/me/card-token');
    const clinic = d.clinics.find((c) => c.specialties.includes('therapist'))!;
    const appt = await insured('insured', 'POST', '/me/appointments', { clinicId: clinic.id, specialty: 'therapist', startsAt: `${plusDays(3)}T10:00:00+05:00` });
    const apptId = (appt.mem.body as { id?: string }).id;
    if (apptId) await insured('insured', 'POST', `/me/appointments/${apptId}/cancel`);
    await insured('insured', 'GET', '/me/appointments');
    await insured('insured', 'GET', '/notifications');

    // ---- HR: a new employee (a change for the underwriter)
    const hr = await as({ email: DEMO_HR.email });
    await hr('hr', 'POST', '/hr/employees', { fullName: 'Testov Test Testovich', birthDate: '1990-05-05', pinfl: '31234567890123', phone: '+998901112233', position: 'Инженер', startDate: plusDays(7) });
    await hr('hr', 'GET', '/hr/employees');
    await underwriter('underwriter', 'GET', '/policy-changes');

    // ---- sales: a task for the underwriter, taken and done
    const sales = await as(staff('sales_manager'));
    const deal = d.deals[0]!;
    const task = await sales('sales', 'POST', '/tasks', { toRole: 'underwriter', action: 'quote_calculate', subjectType: 'deal', subjectId: deal.id, comment: 'Посчитать котировку' });
    const taskId = (task.mem.body as { id?: string }).id;
    if (taskId) {
      await underwriter('underwriter', 'POST', `/tasks/${taskId}/take`);
      await underwriter('underwriter', 'POST', `/tasks/${taskId}/done`, { comment: 'Готово' });
    }
    await sales('sales', 'GET', '/notifications');
    await sales('sales', 'POST', '/notifications/read');

    // ---- clinic: a patient check opens a visit; a key of the partner API; the API itself
    const registrar = await as({ email: DEMO_CLINIC_USERS[0]!.email });
    const patient = d.insured.find((i) => i.status === 'active' && i.id !== me.id && d.policies.some((p) => p.id === i.policyId && p.status === 'active'))!;
    const policyNumber = d.policies.find((p) => p.id === patient.policyId)!.number;
    await registrar('registrar', 'POST', '/clinic/check', { policyNumber, pinfl: patient.pinfl });
    await registrar('registrar', 'GET', '/clinic/visits');
    const clinicAdmin = await as({ email: DEMO_CLINIC_USERS[1]!.email });
    const key = await clinicAdmin('clinic_admin', 'POST', '/clinic/integration/keys', { name: 'Test MIS', scopes: ['coverage:check'] });
    const { clientId, clientSecret } = key.mem.body as { clientId?: string; clientSecret?: string };
    if (clientId && clientSecret) {
      const token = await both('partner', 'POST', '/integration/v1/oauth/token', {
        mem: { raw: { contentType: 'application/x-www-form-urlencoded', text: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString() } },
        pg: { raw: { contentType: 'application/x-www-form-urlencoded', text: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString() } },
      });
      const bearer = { authorization: `Bearer ${(token.mem.body as { access_token?: string }).access_token ?? ''}` };
      await both('partner', 'POST', '/integration/v1/coverage/check', { mem: { body: { policyNumber, pinfl: patient.pinfl }, headers: bearer }, pg: { body: { policyNumber, pinfl: patient.pinfl }, headers: bearer } });
    }
    await clinicAdmin('clinic_admin', 'GET', '/clinic/integration/logs');

    // ---- assistance: a case for a person of its roster
    const asstOperator = await as({ email: DEMO_ASSIST_USERS[0]!.email });
    const roster = await asstOperator('asst_operator', 'GET', '/assist/insured');
    const person = (roster.mem.body as { id: string }[])[0];
    if (person) await asstOperator('asst_operator', 'POST', '/assist/cases', { insuredId: person.id, type: 'consultation', channel: 'phone', description: 'Консультация по покрытию' });
    await asstOperator('asst_operator', 'GET', '/assist/cases');

    // ---- the insured person: consent, payout card, a receipt (multipart)
    await insured('insured', 'POST', '/me/consent', { version: '1.0' });
    await insured('insured', 'POST', '/me/payout-card', { card: '8600 1234 5678 4417' });
    await insured('insured', 'GET', '/me');
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64'));
    const form = new FormData();
    form.set('category', 'medicines');
    form.set('amount', '125000');
    form.set('serviceDate', plusDays(-2));
    form.set('providerName', 'Apteka Test');
    form.append('files', new File([png], 'receipt.png', { type: 'image/png' }));
    const raw = await multipart(form);
    const sid = await session({ phone: DEMO_INSURED_PHONE });
    await both('insured', 'POST', '/me/claims', { mem: { session: sid, raw }, pg: { session: sid, raw } });
    await both('insured', 'GET', '/me/claims', { mem: { session: sid }, pg: { session: sid } });

    // ---- staff: a client, a user
    await underwriter('underwriter', 'POST', '/clients', { legalForm: 'llc', name: 'Test Logistics', inn: '305123456', status: 'draft' });
    await underwriter('underwriter', 'GET', '/clients?q=Test%20Logistics');
    const admin = await as(staff('admin'));
    await admin('admin', 'POST', '/admin/users', { email: 'new.operator@demo.mig.uz', fullName: 'Novikov Ivan Petrovich', role: 'operator' });
    await admin('admin', 'GET', '/admin/users');
    await hr('hr', 'POST', '/hr/employees/invite', { ids: 'all_not_in_app' });

    // ---- clinic: a guarantee letter for the open visit; a colleague
    const visits = await registrar('registrar', 'GET', '/clinic/visits');
    const visitId = (visits.mem.body as { id: string }[])[0]?.id;
    if (visitId) await registrar('registrar', 'POST', '/clinic/guarantees', { visitId, serviceCode: 'DG-310', icd10: 'M54.5', estimatedCost: 1_845_000, comment: 'МРТ по направлению' });
    await registrar('registrar', 'GET', '/clinic/guarantees');
    await clinicAdmin('clinic_admin', 'POST', '/clinic/users', { email: 'nurse@demo-clinic.uz', fullName: 'Karimova Nodira', role: 'clinic_registrar' });

    // ---- HR answers an offer; the assistance doctor decides a letter
    const hrCompany = d.hrUsers.find((h) => h.email === DEMO_HR.email)!.companyId;
    const sentKp = d.kp.find((k) => k.clientId === hrCompany && k.status === 'sent');
    if (sentKp) await hr('hr', 'POST', `/kp/${sentKp.id}/accept`);
    await hr('hr', 'GET', '/tasks/mine');
    const asstDoctor = await as({ email: DEMO_ASSIST_USERS[1]!.email });
    const letters = await asstDoctor('asst_doctor', 'GET', '/assist/guarantees?status=requested');
    const letter = (letters.mem.body as { id: string; estimatedCost: number }[])[0];
    if (letter) await asstDoctor('asst_doctor', 'POST', `/assist/guarantees/${letter.id}/decision`, { action: 'approve', amount: letter.estimatedCost, validUntil: plusDays(30) });
    await sales('sales', 'GET', `/deals/${sentKp?.dealId ?? deal.id}`);

    // ---- sign-out everywhere
    await underwriter('underwriter', 'POST', '/auth/logout?all=1');
    await underwriter('underwriter', 'GET', '/auth/me');
    void today;
    expect(mismatches).toEqual([]);
  });
});
