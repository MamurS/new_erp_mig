// @vitest-environment node
/*
 * Transfer of the existing portfolio through the mock API: admin only, dry run per file with errors
 * by row and field, the load order, explicit exclusion of rows with errors, four-eyes, reconciliation,
 * the insured person's limits after the transfer, search by the old number, and the rollback rules.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ContractView, SessionResponse } from '@/shared/types/dto';
import type { LimitUsage } from '@/shared/types';
import type { MigrationBatchSummary, MigrationBatchView, MigrationStep } from '@/shared/types/migration';
import { MIGRATION_COLUMNS, MIGRATION_STEPS } from '@/shared/domain/migration';
import { toCsv } from '@/shared/lib/csv';
import { MIGRATION_DEMO_DATE, MIGRATION_DEMO_PHONE, migrationDemoFiles } from '@/demo/migrationSamples';
import { createMockServer } from './node';
import { db, resetDb } from './db';
import { annualOf } from './lifecycle-core';
import { defaultTariff } from '@/shared/domain/policies';

const BASE = 'http://localhost/api';
const server = createMockServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
});

type Res<T = Record<string, unknown>> = { status: number; data: T };

async function call<T = Record<string, unknown>>(path: string, init: { method?: string; sid?: string; json?: unknown } = {}): Promise<Res<T>> {
  const headers = new Headers();
  if (init.sid) headers.set('Authorization', `Bearer ${init.sid}`);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${BASE}${path}`, { method: init.method ?? 'GET', headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T };
}

async function login(email: string): Promise<string> {
  const a = await call<{ challengeId: string }>('/auth/login', { method: 'POST', json: { email, password: 'Demo-2026!' } });
  const b = await call<SessionResponse>('/auth/otp', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
  expect(b.status).toBe(200);
  return b.data.sessionId;
}

async function loginPhone(phone: string): Promise<string> {
  const a = await call<{ challengeId: string }>('/auth/phone', { method: 'POST', json: { phone } });
  const b = await call<SessionResponse>('/auth/phone/verify', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
  expect(b.status).toBe(200);
  return b.data.sessionId;
}

const files = migrationDemoFiles();
const M = '/admin/migration';
const step = (v: MigrationBatchView, s: MigrationStep) => v.steps.find((x) => x.step === s)!;

async function uploadAll(sid: string, id: string, stopAfter: MigrationStep = 'invoices'): Promise<MigrationBatchView> {
  let view!: MigrationBatchView;
  for (const s of MIGRATION_STEPS) {
    const up = await call<MigrationBatchView>(`${M}/batches/${id}/steps/${s}`, { method: 'POST', sid, json: { csv: files[s] } });
    expect(up.status, s).toBe(200);
    const conf = await call<MigrationBatchView>(`${M}/batches/${id}/steps/${s}/confirm`, { method: 'POST', sid, json: { excludeErrors: true } });
    expect(conf.status, s).toBe(200);
    view = conf.data;
    if (s === stopAfter) break;
  }
  return view;
}

async function appliedBatch(): Promise<{ admin: string; admin2: string; view: MigrationBatchView }> {
  const admin = await login('admin@demo.mig.uz');
  const admin2 = await login('admin2@demo.mig.uz');
  const b = await call<MigrationBatchView>(`${M}/batches`, { method: 'POST', sid: admin, json: { migrationDate: MIGRATION_DEMO_DATE } });
  await uploadAll(admin, b.data.id);
  expect((await call(`${M}/batches/${b.data.id}/submit`, { method: 'POST', sid: admin })).status).toBe(200);
  const ok = await call<MigrationBatchView>(`${M}/batches/${b.data.id}/approve`, { method: 'POST', sid: admin2 });
  expect(ok.status).toBe(200);
  return { admin, admin2, view: ok.data };
}

describe('portfolio migration', () => {
  it('admin only: other roles get 403 on every endpoint', async () => {
    for (const email of ['operator@demo.mig.uz', 'underwriter@demo.mig.uz', 'sales@demo.mig.uz', 'hr@demo-client.uz']) {
      const sid = await login(email);
      expect((await call(`${M}/batches`, { sid })).status, email).toBe(403);
      expect((await call(`${M}/batches`, { method: 'POST', sid, json: { migrationDate: MIGRATION_DEMO_DATE } })).status, email).toBe(403);
      expect((await call(`${M}/manual`, { method: 'POST', sid, json: { migrationDate: MIGRATION_DEMO_DATE, row: {} } })).status, email).toBe(403);
    }
    expect((await call(`${M}/batches`)).status).toBe(401);
  });

  it('dry run: errors by row and field, warnings, nothing written; later steps wait for earlier ones', async () => {
    const sid = await login('admin@demo.mig.uz');
    const before = { clients: db().clients.length, insured: db().insured.length, contracts: db().contracts.length };
    const b = await call<MigrationBatchView>(`${M}/batches`, { method: 'POST', sid, json: { migrationDate: MIGRATION_DEMO_DATE } });
    expect(b.status).toBe(201);
    const id = b.data.id;
    // The order: contracts cannot be checked before the clients are confirmed.
    expect((await call(`${M}/batches/${id}/steps/contracts`, { method: 'POST', sid, json: { csv: files.contracts } })).status).toBe(409);
    const up = await call<MigrationBatchView>(`${M}/batches/${id}/steps/clients`, { method: 'POST', sid, json: { csv: files.clients } });
    const clients = step(up.data, 'clients');
    expect(clients).toMatchObject({ status: 'validated', total: 6, valid: 5, errorRows: 1 });
    expect(clients.issues).toContainEqual({ row: 5, field: 'stir', level: 'error', message: 'v.innFormat' });
    // Rows with errors are never written: confirming needs their explicit exclusion.
    expect((await call(`${M}/batches/${id}/steps/clients/confirm`, { method: 'POST', sid, json: { excludeErrors: false } })).status).toBe(409);
    expect((await call(`${M}/batches/${id}/steps/clients/confirm`, { method: 'POST', sid, json: { excludeErrors: true } })).status).toBe(200);
    const v = await uploadAll(sid, id);
    expect(step(v, 'contracts')).toMatchObject({ total: 5, valid: 5, errorRows: 0 });
    const insured = step(v, 'insured');
    // A row per person: 204 employees (4 with errors) and 204 family members.
    expect(insured).toMatchObject({ total: 408, valid: 404, errorRows: 4 });
    expect(insured.issues.filter((i) => i.level === 'error').map((i) => [i.field, i.message.split('|')[0]])).toEqual([
      ['pinfl', 'v.pinflFormat'],
      ['contractOldNumber', 'migration.v.contractNotFound'],
      ['premium', 'migration.v.noPremium'],
      ['inclusionDate', 'migration.v.outsideTerm'],
    ]);
    // Before applying: the contract whose insured premiums do not add up is a warning and a highlighted row.
    expect(insured.issues.filter((i) => i.message.startsWith('migration.v.premiumMismatch')).map((i) => i.message)).toEqual([
      'migration.v.premiumMismatch|{"contract":"MIG-2026/0504","sum":"221 400 000","total":"223 900 000"}',
    ]);
    expect(v.contractPremiums.map((c) => [c.oldNumber, c.match])).toEqual([
      ['MIG-2026/0501', true],
      ['MIG-2026/0502', true],
      ['MIG-2026/0503', true],
      ['MIG-2026/0504', false],
      ['MIG-2026/0505', true],
    ]);
    expect(insured.issues.filter((i) => i.message === 'migration.v.noPhone')).toHaveLength(5);
    expect(insured.issues.some((i) => i.message === 'migration.v.pinflBirthDate')).toBe(true);
    expect(step(v, 'limits')).toMatchObject({ total: 40, valid: 40, errorRows: 0 });
    expect(step(v, 'claims')).toMatchObject({ total: 11, valid: 10, errorRows: 1 });
    expect(step(v, 'claims').issues).toContainEqual({ row: 7, field: 'status', level: 'error', message: 'migration.v.openStatus' });
    expect(step(v, 'invoices')).toMatchObject({ total: 3, valid: 3, errorRows: 0, warningRows: 1 });
    // No personal data in the report: row numbers, columns and message keys only.
    expect(JSON.stringify(v.steps)).not.toContain(MIGRATION_DEMO_PHONE);
    // Nothing reached the business tables.
    expect({ clients: db().clients.length, insured: db().insured.length, contracts: db().contracts.length }).toEqual(before);
    // Re-uploading an earlier file resets the later steps.
    const again = await call<MigrationBatchView>(`${M}/batches/${id}/steps/contracts`, { method: 'POST', sid, json: { csv: files.contracts } });
    expect(step(again.data, 'insured').status).toBe('empty');
    expect(step(again.data, 'contracts').status).toBe('validated');
  });

  it('file problems: missing columns, wrong references, rows of earlier files only without errors', async () => {
    const sid = await login('admin@demo.mig.uz');
    const b = await call<MigrationBatchView>(`${M}/batches`, { method: 'POST', sid, json: { migrationDate: MIGRATION_DEMO_DATE } });
    const bad = await call<{ key: string; params: Record<string, string> }>(`${M}/batches/${b.data.id}/steps/clients`, { method: 'POST', sid, json: { csv: 'name,stir\nAcme,123456789\n' } });
    expect(bad.status).toBe(422);
    expect(bad.data.key).toBe('migration.v.missingColumns');
    // Skip clients: contracts refer to the error-free clients of the database only.
    expect((await call(`${M}/batches/${b.data.id}/steps/clients/skip`, { method: 'POST', sid })).status).toBe(200);
    const existing = db().clients[0]!;
    const csv = `oldNumber,clientStir,startDate,endDate,program,premium\nOLD-1,${existing.inn},2026-01-01,2026-12-31,standard,1000000\nOLD-2,409100001,2026-01-01,2026-12-31,standard,1000000\n`;
    const v = await call<MigrationBatchView>(`${M}/batches/${b.data.id}/steps/contracts`, { method: 'POST', sid, json: { csv } });
    const c = step(v.data, 'contracts');
    expect(c).toMatchObject({ total: 2, valid: 1, errorRows: 1 });
    expect(c.issues).toContainEqual({ row: 3, field: 'clientStir', level: 'error', message: 'migration.v.clientNotFound' });
  });

  it('four-eyes, reconciliation, the app limits and search by the old number', async () => {
    const admin = await login('admin@demo.mig.uz');
    const admin2 = await login('admin2@demo.mig.uz');
    const b = await call<MigrationBatchView>(`${M}/batches`, { method: 'POST', sid: admin, json: { migrationDate: MIGRATION_DEMO_DATE } });
    const id = b.data.id;
    await uploadAll(admin, id);
    const sub = await call<MigrationBatchView>(`${M}/batches/${id}/submit`, { method: 'POST', sid: admin });
    expect(sub.data.status).toBe('pending_approval');
    expect(sub.data.canApprove).toBe(false);
    const own = await call<{ key: string }>(`${M}/batches/${id}/approve`, { method: 'POST', sid: admin });
    expect(own.status).toBe(403);
    expect(own.data.key).toBe('srv.migration.fourEyes');
    expect((await call<MigrationBatchView>(`${M}/batches/${id}`, { sid: admin2 })).data.canApprove).toBe(true);
    const ok = await call<MigrationBatchView>(`${M}/batches/${id}/approve`, { method: 'POST', sid: admin2 });
    expect(ok.status).toBe(200);
    expect(ok.data.status).toBe('applied');
    const recon = Object.fromEntries(ok.data.reconciliation.map((r) => [r.metric, r]));
    expect(recon.clients).toMatchObject({ file: 6, excluded: 1, loaded: 5, match: false });
    expect(recon.contracts).toMatchObject({ file: 5, loaded: 5, match: true });
    expect(recon.premium).toMatchObject({ file: 1_444_559_999, loaded: 1_444_559_999, match: true });
    expect(recon.insured).toMatchObject({ file: 408, excluded: 4, loaded: 404, match: false });
    // Per contract, from the premiums stored on the transferred persons: only MIG-2026/0504 does not add up.
    const premiums = Object.fromEntries(ok.data.contractPremiums.map((c) => [c.oldNumber, c]));
    expect(premiums['MIG-2026/0504']).toMatchObject({ insured: 54, total: 223_900_000, insuredSum: 221_400_000, diff: -2_500_000, match: false });
    expect(premiums['MIG-2026/0503']).toMatchObject({ insured: 91, individual: 91, diff: 0, match: true });
    expect(premiums['MIG-2026/0505']).toMatchObject({ individual: 2, diff: 1, match: true });
    expect(Object.values(premiums).every((c) => /^DMS-D-/.test(c.number ?? ''))).toBe(true);
    expect(recon.limitsUsed!.match).toBe(true);
    expect(recon.claims).toMatchObject({ file: 11, loaded: 10, match: false });
    expect(recon.reserves!.match).toBe(false);
    expect(recon.reserves!.file - recon.reserves!.loaded).toBe(600_000);
    expect(recon.invoices).toMatchObject({ file: 3, loaded: 3, match: true });
    expect(recon.invoicesOutstanding).toMatchObject({ loaded: 101_375_000, match: true });

    // Records are marked, contracts are in force with a new number and the old one kept.
    const d = db();
    expect(d.clients.filter((c) => c.migration?.batchId === id)).toHaveLength(5);
    expect(d.clients.some((c) => c.name === 'Andijon Mebel Savdo')).toBe(false);
    expect(d.insured.filter((i) => i.migration?.batchId === id && i.status === 'active')).toHaveLength(404);
    expect(d.insured.some((i) => i.externalCertificateNumber === 'C-0999-0001')).toBe(false);
    expect(d.claims.some((c) => c.externalNumber === 'CL-2026-7799')).toBe(false);
    const migrated = d.contracts.filter((c) => c.migration?.batchId === id);
    expect(migrated.every((c) => c.status === 'active' && !!c.policyId && /^DMS-D-\d{4}-\d{6}$/.test(c.number))).toBe(true);
    expect(migrated.map((c) => c.externalNumber).sort()).toEqual(['MIG-2026/0501', 'MIG-2026/0502', 'MIG-2026/0503', 'MIG-2026/0504', 'MIG-2026/0505']);
    const demo = d.insured.find((i) => i.phone === MIGRATION_DEMO_PHONE)!;
    expect(demo.certificateNumber).toMatch(/^SERT-/);
    // Premiums: by type (3 600 000 per employee, 2 880 000 per family member) or individual; never an even split.
    expect(demo.migratedPremium).toEqual({ amount: 3_600_000, source: 'type' });
    // A row per person: the family members are insured persons under the employee.
    const demoFamily = d.insured.filter((i) => i.principalId === demo.id);
    expect(demoFamily.every((i) => i.relation !== 'employee' && i.contractId === demo.contractId && i.migratedPremium?.amount === 2_880_000 && !!i.certificateNumber)).toBe(true);
    const c0501 = migrated.find((c) => c.externalNumber === 'MIG-2026/0501')!;
    expect(c0501.params).toMatchObject({ premiumEmployee: 3_600_000, premiumFamily: 2_880_000, total: 406_080_000 });
    expect(annualOf(c0501, demo)).toBe(demo.migratedPremium!.amount);
    const c0503 = migrated.find((c) => c.externalNumber === 'MIG-2026/0503')!;
    const p0503 = d.insured.filter((i) => i.contractId === c0503.id);
    expect(p0503.every((i) => i.migratedPremium?.source === 'individual')).toBe(true);
    expect(new Set(p0503.map((i) => i.migratedPremium!.amount)).size).toBeGreaterThan(1);
    // Without premiums by type in the file, later changes of the list use the program's base tariff.
    expect(c0503.params).toMatchObject({ premiumEmployee: defaultTariff('basic').employee, premiumFamily: defaultTariff('basic').family });

    // Contracts list search finds a transferred contract by its old number.
    const uw = await login('underwriter@demo.mig.uz');
    const found = await call<ContractView[]>(`/contracts?q=${encodeURIComponent('mig-2026/0501')}`, { sid: uw });
    expect(found.data.map((c) => c.externalNumber)).toEqual(['MIG-2026/0501']);
    expect(found.data[0]!.migration?.byName).toBe('Aliyev Temur Farhodovich');

    // The insured person signs in to the app: the remaining limit counts what was used before the transfer.
    const me = await loginPhone(MIGRATION_DEMO_PHONE);
    const limits = await call<LimitUsage[]>('/me/limits', { sid: me });
    const out = limits.data.find((l) => l.category === 'outpatient')!;
    expect(out).toMatchObject({ limit: 10_500_000, used: 2_500_000 });
    expect(out.limit - out.used).toBe(8_000_000);

    // The audit has the whole story.
    expect(d.audit.filter((e) => e.targetId === id).map((e) => e.action)).toEqual(expect.arrayContaining(['migration_validated', 'migration_submitted', 'migration_applied']));
    const list = await call<{ items: MigrationBatchSummary[] }>(`${M}/batches`, { sid: admin });
    expect(list.data.items[0]).toMatchObject({ id, status: 'applied', decidedByName: 'Nazarov Sardor Ravshanovich' });
  });

  it('rollback removes everything of the batch while nobody acted on it', async () => {
    const base = { clients: db().clients.length, contracts: db().contracts.length, policies: db().policies.length, insured: db().insured.length, claims: db().claims.length, invoices: db().invoices.length, deals: db().deals.length, documents: db().documents.length };
    const { admin, view } = await appliedBatch();
    expect(view.rollback).toEqual({ allowed: true, blockers: [] });
    const r = await call<MigrationBatchView>(`${M}/batches/${view.id}/rollback`, { method: 'POST', sid: admin, json: { reason: 'Ошибка в выгрузке старой системы' } });
    expect(r.status).toBe(200);
    expect(r.data.status).toBe('rolled_back');
    const d = db();
    expect({ clients: d.clients.length, contracts: d.contracts.length, policies: d.policies.length, insured: d.insured.length, claims: d.claims.length, invoices: d.invoices.length, deals: d.deals.length, documents: d.documents.length }).toEqual(base);
    expect(r.data.reconciliation.find((x) => x.metric === 'contracts')).toMatchObject({ loaded: 0, match: false });
    // The per-contract premium check stays as it was when the batch was applied.
    expect(r.data.contractPremiums).toEqual(view.contractPremiums);
    // A rolled back batch's insured person no longer signs in.
    const a = await call<{ challengeId: string }>('/auth/phone', { method: 'POST', json: { phone: MIGRATION_DEMO_PHONE } });
    expect((await call('/auth/phone/verify', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } })).status).toBe(401);
  });

  it('rollback is blocked after a new action on the transferred data', async () => {
    const { admin, view } = await appliedBatch();
    const claim = db().claims.find((c) => c.migration?.batchId === view.id)!;
    const officer = await login('claims@demo.mig.uz');
    expect((await call(`/claims/${claim.id}/reserve`, { method: 'PATCH', sid: officer, json: { amount: 100_000, reason: 'Уточнение по документам' } })).status).toBe(200);
    const v = await call<MigrationBatchView>(`${M}/batches/${view.id}`, { sid: admin });
    expect(v.data.rollback?.allowed).toBe(false);
    expect(v.data.rollback?.blockers).toContainEqual(expect.objectContaining({ kind: 'audit', action: 'claim_reserve_changed', actorName: 'Hasanov Bobur Ilhomovich' }));
    // Reconciliation now shows that the reserves in the system differ from the files.
    expect(v.data.reconciliation.find((x) => x.metric === 'reserves')!.loaded).not.toBe(v.data.reconciliation.find((x) => x.metric === 'reserves')!.file - 600_000);
    const r = await call<{ key: string }>(`${M}/batches/${view.id}/rollback`, { method: 'POST', sid: admin, json: { reason: 'Ошибка в выгрузке' } });
    expect(r.status).toBe(409);
    expect(r.data.key).toBe('srv.migration.rollbackBlocked');
    // The insured person's consent in the app is a new action too.
    const me = await loginPhone(MIGRATION_DEMO_PHONE);
    await call('/me/consent', { method: 'POST', sid: me, json: { version: '1.0' } });
    const v2 = await call<MigrationBatchView>(`${M}/batches/${view.id}`, { sid: admin });
    expect(v2.data.rollback?.blockers.some((x) => x.kind === 'consent')).toBe(true);
  });

  it('manual contract: same checks, one-row batch, second admin, rollback', async () => {
    const admin = await login('admin@demo.mig.uz');
    const admin2 = await login('admin2@demo.mig.uz');
    const client = db().clients.find((c) => !c.activePolicyId)!;
    const before = { status: client.status, activePolicyId: client.activePolicyId };
    const row = { oldNumber: 'MIG-2025/0042', clientStir: client.inn, startDate: '2026-02-01', endDate: '2027-01-31', program: 'standard', premium: '45000000', paymentFrequency: 'single', assistance: '' };
    const bad = await call<{ fields: Record<string, string> }>(`${M}/manual`, { method: 'POST', sid: admin, json: { migrationDate: MIGRATION_DEMO_DATE, row: { ...row, clientStir: '409999999', program: 'gold' } } });
    expect(bad.status).toBe(422);
    expect(bad.data.fields).toMatchObject({ program: 'migration.v.program' });
    const ok = await call<MigrationBatchView>(`${M}/manual`, { method: 'POST', sid: admin, json: { migrationDate: MIGRATION_DEMO_DATE, row } });
    expect(ok.status).toBe(201);
    expect(ok.data).toMatchObject({ kind: 'manual', status: 'pending_approval', rows: 1 });
    expect(db().contracts.some((c) => c.externalNumber === 'MIG-2025/0042')).toBe(false);
    expect((await call(`${M}/batches/${ok.data.id}/approve`, { method: 'POST', sid: admin })).status).toBe(403);
    const applied = await call<MigrationBatchView>(`${M}/batches/${ok.data.id}/approve`, { method: 'POST', sid: admin2 });
    expect(applied.data.contracts).toHaveLength(1);
    const c = db().contracts.find((x) => x.externalNumber === 'MIG-2025/0042')!;
    expect(c.status).toBe('active');
    expect(db().clients.find((x) => x.id === client.id)!.activePolicyId).toBe(c.policyId);
    const rb = await call<MigrationBatchView>(`${M}/batches/${ok.data.id}/rollback`, { method: 'POST', sid: admin2, json: { reason: 'Введён по ошибке' } });
    expect(rb.data.status).toBe('rolled_back');
    expect(db().contracts.some((x) => x.externalNumber === 'MIG-2025/0042')).toBe(false);
    expect(db().clients.find((x) => x.id === client.id)).toMatchObject(before);
  });

  it('a pending batch that became stale goes back to the draft instead of writing rows with errors', async () => {
    const admin = await login('admin@demo.mig.uz');
    const admin2 = await login('admin2@demo.mig.uz');
    const one = await call<MigrationBatchView>(`${M}/batches`, { method: 'POST', sid: admin, json: { migrationDate: MIGRATION_DEMO_DATE } });
    await uploadAll(admin, one.data.id, 'contracts');
    for (const s of ['insured', 'limits', 'claims', 'invoices']) await call(`${M}/batches/${one.data.id}/steps/${s}/skip`, { method: 'POST', sid: admin });
    expect((await call(`${M}/batches/${one.data.id}/submit`, { method: 'POST', sid: admin })).status).toBe(200);
    // The second admin prepares the same clients in another batch and the first admin applies it.
    const two = await call<MigrationBatchView>(`${M}/batches`, { method: 'POST', sid: admin2, json: { migrationDate: MIGRATION_DEMO_DATE } });
    await uploadAll(admin2, two.data.id, 'clients');
    for (const s of ['contracts', 'insured', 'limits', 'claims', 'invoices']) await call(`${M}/batches/${two.data.id}/steps/${s}/skip`, { method: 'POST', sid: admin2 });
    expect((await call(`${M}/batches/${two.data.id}/submit`, { method: 'POST', sid: admin2 })).status).toBe(200);
    expect((await call(`${M}/batches/${two.data.id}/approve`, { method: 'POST', sid: admin })).status).toBe(200);
    const stale = await call<{ key: string }>(`${M}/batches/${one.data.id}/approve`, { method: 'POST', sid: admin2 });
    expect(stale.status).toBe(409);
    expect(stale.data.key).toBe('srv.migration.stale');
    const v = await call<MigrationBatchView>(`${M}/batches/${one.data.id}`, { sid: admin });
    expect(v.data.status).toBe('draft');
    expect(step(v.data, 'clients')).toMatchObject({ status: 'validated', errorRows: 6 });
  });

  it('contracts below the minimum group and of a form not allowed are loaded with a warning and a mark', async () => {
    const admin = await login('admin@demo.mig.uz');
    const admin2 = await login('admin2@demo.mig.uz');
    const csv = (step: MigrationStep, rows: Record<string, string>[]) => toCsv(MIGRATION_COLUMNS[step], rows.map((r) => MIGRATION_COLUMNS[step].map((c) => r[c] ?? '')));
    const client = (name: string, legalForm: string, stir: string, k: number) => ({ name, legalForm, stir, bank: 'Demo Bank ATB', account: `202080009001003000${k}0`, mfo: '00014', director: 'Karimov Anvar Rustamovich', hrName: 'Saidova Malika Bahodirovna', hrPhone: `+99871300000${k}`, hrEmail: `hr@small${k}.example.uz` });
    const contract = (oldNumber: string, clientStir: string, n: number) => ({ oldNumber, clientStir, startDate: '2026-03-01', endDate: '2027-02-28', program: 'standard', premium: String(n * 3_500_000), premium_employee: '3500000', premium_family: '2800000', paymentFrequency: 'single' });
    const NAMES = ['Jasur', 'Bobur', 'Otabek', 'Sanjar', 'Temur', 'Aziz', 'Farrux', 'Sardor', 'Javohir', 'Nodir'];
    const people = (oldNumber: string, n: number, base: number) =>
      Array.from({ length: n }, (_, k) => ({ fullName: `Rahimov ${NAMES[k % NAMES.length]!} ${NAMES[Math.floor(k / NAMES.length) % NAMES.length]!}ovich`, birthDate: '1988-05-14', pinfl: `3140588${String(base + k).padStart(7, '0')}`, oldCertificate: `C-${base + k}`, inclusionDate: '2026-03-01', contractOldNumber: oldNumber, relation: 'employee' }));
    const b = await call<MigrationBatchView>(`${M}/batches`, { method: 'POST', sid: admin, json: { migrationDate: MIGRATION_DEMO_DATE } });
    const id = b.data.id;
    const up = async (s: MigrationStep, rows: Record<string, string>[]) => {
      const u = await call<MigrationBatchView>(`${M}/batches/${id}/steps/${s}`, { method: 'POST', sid: admin, json: { csv: csv(s, rows) } });
      expect(u.status, s).toBe(200);
      expect(step(u.data, s).issues.filter((i) => i.level === 'error'), s).toEqual([]);
      const conf = await call<MigrationBatchView>(`${M}/batches/${id}/steps/${s}/confirm`, { method: 'POST', sid: admin, json: { excludeErrors: false } });
      expect(conf.status, s).toBe(200);
      return conf.data;
    };
    await up('clients', [client('Kichik Savdo', 'llc', '409200001', 1), client('Karimov Anvar Rustamovich', 'sole_proprietor', '409200002', 2)]);
    const afterContracts = await up('contracts', [contract('MIG-2026/0601', '409200001', 6), contract('MIG-2026/0602', '409200002', 12)]);
    // The form is known from the clients file: a warning already at the contracts step, never an error.
    expect(step(afterContracts, 'contracts')).toMatchObject({ valid: 2, errorRows: 0, warningRows: 1 });
    const v = await up('insured', [...people('MIG-2026/0601', 6, 1), ...people('MIG-2026/0602', 12, 101)]);
    // One warning per contract, with its number and the reason.
    expect(step(v, 'contracts').issues).toEqual([
      { row: 2, field: 'oldNumber', level: 'warning', message: 'migration.v.belowMinGroup|{"contract":"MIG-2026/0601","n":6,"min":10}' },
      { row: 3, field: 'clientStir', level: 'warning', message: 'migration.v.formNotAllowed|{"contract":"MIG-2026/0602","form":"ИП"}' },
    ]);
    expect(step(v, 'contracts')).toMatchObject({ valid: 2, errorRows: 0, warningRows: 2, status: 'confirmed' });
    for (const s of ['limits', 'claims', 'invoices']) await call(`${M}/batches/${id}/steps/${s}/skip`, { method: 'POST', sid: admin });
    expect((await call(`${M}/batches/${id}/submit`, { method: 'POST', sid: admin })).status).toBe(200);
    const applied = await call<MigrationBatchView>(`${M}/batches/${id}/approve`, { method: 'POST', sid: admin2 });
    expect(applied.status).toBe(200);
    // Both contracts are loaded (they are in force); the applied report keeps the warnings.
    expect(applied.data.contracts).toHaveLength(2);
    expect(step(applied.data, 'contracts').issues.map((i) => i.message.split('|')[0])).toEqual(['migration.v.belowMinGroup', 'migration.v.formNotAllowed']);
    const small = db().contracts.find((c) => c.externalNumber === 'MIG-2026/0601')!;
    const yatt = db().contracts.find((c) => c.externalNumber === 'MIG-2026/0602')!;
    expect(small.status).toBe('active');
    expect(small.migration).toMatchObject({ warnings: ['below_min_group'], group: { size: 6, min: 10, countsFamily: false } });
    expect(yatt.migration?.warnings).toEqual(['form_not_allowed']);
    expect(db().clients.find((c) => c.inn === '409200001')!.migration?.warnings).toEqual(['below_min_group']);
    expect(db().clients.find((c) => c.inn === '409200002')!.migration?.warnings).toEqual(['form_not_allowed']);
    // Through the API (the response schemas carry the marks).
    const uw = await login('underwriter@demo.mig.uz');
    const view = await call<ContractView>(`/contracts/${small.id}`, { sid: uw });
    expect(view.status).toBe(200);
    expect(view.data.migration).toMatchObject({ warnings: ['below_min_group'], group: { size: 6, min: 10 } });
    const card = await call<{ migration?: { warnings?: string[] } }>(`/clients/${yatt.clientId}`, { sid: uw });
    expect(card.status).toBe(200);
    expect(card.data.migration?.warnings).toEqual(['form_not_allowed']);
  });
});
