// @vitest-environment node
/*
 * DMS business parameters on the mock server: reading by role, four-eyes on changes, audit with the
 * old and the new value, and the new value reaching the code that uses it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuditEntry, DmsParamChange, DmsParamValues } from '@mig/contracts';
import type { AssistOverview, ContractView, DmsParamsView, SessionResponse } from '@mig/contracts/dto';
import { DEFAULT_NUMBERING, DOC_NUMBER_KINDS } from '@mig/domain/numbering';
import { DMS_DEFAULTS, DMS_PARAM_KEYS } from '@mig/domain/config/dmsParameters';
import { tm, translate, type I18nKey, type Params } from '@mig/i18n';
import { createMockServer } from './node';
import { lastSession, track, withSession } from './test-session';
import { db, resetDb } from './db';
import { loadParams } from '@mig/domain/services/params';
import { dealKp } from '@mig/domain/services/lifecycle';
import { baseCtx, repos } from './http';

/** The DMS parameters in force, as the services read them. */
const params = () => loadParams(baseCtx());

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
  withSession(headers, init.sid);
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  const res = track(await fetch(`${BASE}${path}`, { method: init.method ?? 'GET', headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) }));
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T };
}

async function login(email: string): Promise<string> {
  const a = await call<{ challengeId: string }>('/auth/login', { method: 'POST', json: { email, password: 'Demo-2026!' } });
  const b = await call<SessionResponse>('/auth/otp', { method: 'POST', json: { challengeId: a.data.challengeId, code: '000000' } });
  expect(b.status).toBe(200);
  return lastSession();
}

const propose = (sid: string, key: string, value: number, reason = 'Решение правления № 12') => call<DmsParamChange>('/params/changes', { method: 'POST', sid, json: { key, value, reason } });

describe('DMS parameters', () => {
  it('every MIG role reads them; all start as demo values; other portals get only the shared ones', async () => {
    for (const email of ['operator@demo.mig.uz', 'underwriter@demo.mig.uz', 'doctor@demo.mig.uz', 'accountant@demo.mig.uz', 'admin@demo.mig.uz']) {
      const sid = await login(email);
      const r = await call<DmsParamsView>('/params', { sid });
      expect(r.status, email).toBe(200);
      expect(r.data.parameters.map((p) => p.key).sort()).toEqual([...DMS_PARAM_KEYS].sort());
      expect(r.data.parameters.every((p) => p.isDemo && p.value === DMS_DEFAULTS[p.key])).toBe(true);
    }
    const clinic = await login('registrar@demo-clinic.uz');
    expect((await call('/params', { sid: clinic })).status).toBe(403);
    const values = await call<Partial<DmsParamValues>>('/params/values', { sid: clinic });
    expect(values.data.limitLowShare).toBe(DMS_DEFAULTS.limitLowShare);
    expect(values.data.pinflChecksPerHour).toBe(DMS_DEFAULTS.pinflChecksPerHour);
    expect(values.data.assistanceGuaranteeAuthority).toBeUndefined();
    expect(values.data.guaranteeDualApprovalThreshold).toBeUndefined();
    expect((await call('/params/values')).status).toBe(401);
  });

  it('only an admin proposes; the value is validated against its range', async () => {
    const uw = await login('underwriter@demo.mig.uz');
    expect((await propose(uw, 'qaSampleShare', 0.1)).status).toBe(403);
    const admin = await login('admin@demo.mig.uz');
    expect((await propose(admin, 'qaSampleShare', 0.9)).status).toBe(422);
    expect((await propose(admin, 'rebillReviewWorkdays', 7.5)).status).toBe(422);
    expect((await propose(admin, 'unknownKey', 1)).status).toBe(422);
    expect((await propose(admin, 'qaSampleShare', DMS_DEFAULTS.qaSampleShare)).status).toBe(422);
    expect((await propose(admin, 'qaSampleShare', 0.1, 'x')).status).toBe(422);
  });

  it('four-eyes: the proposer cannot confirm; a second person (underwriter) applies it; audit keeps old and new value', async () => {
    const admin = await login('admin@demo.mig.uz');
    const p = await propose(admin, 'guaranteeDualApprovalThreshold', 25_000_000);
    expect(p.status).toBe(201);
    expect(p.data).toMatchObject({ status: 'pending', from: 20_000_000, to: 25_000_000 });
    // Not applied yet.
    expect((await params()).dmsParam('guaranteeDualApprovalThreshold')).toBe(20_000_000);
    expect((await propose(admin, 'guaranteeDualApprovalThreshold', 30_000_000)).status).toBe(409);

    expect((await call(`/params/changes/${p.data.id}/approve`, { method: 'POST', sid: admin })).status).toBe(403);
    const doctor = await login('doctor@demo.mig.uz');
    expect((await call(`/params/changes/${p.data.id}/approve`, { method: 'POST', sid: doctor })).status).toBe(403);
    const uw = await login('underwriter@demo.mig.uz');
    const ok = await call<DmsParamChange>(`/params/changes/${p.data.id}/approve`, { method: 'POST', sid: uw });
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ status: 'applied', decidedByName: 'Sokolov Dmitriy Aleksandrovich' });
    expect((await call(`/params/changes/${p.data.id}/approve`, { method: 'POST', sid: uw })).status).toBe(409);

    expect((await params()).dmsParam('guaranteeDualApprovalThreshold')).toBe(25_000_000);
    const view = await call<DmsParamsView>('/params', { sid: uw });
    const row = view.data.parameters.find((x) => x.key === 'guaranteeDualApprovalThreshold')!;
    expect(row).toMatchObject({ value: 25_000_000, isDemo: false });
    expect(row.changedByName).toContain('Aliyev Temur Farhodovich');
    expect(row.changedByName).toContain('Sokolov Dmitriy Aleksandrovich');

    const audit = db().audit.filter((e: AuditEntry) => e.targetType === 'parameter');
    const changed = audit.find((e) => e.action === 'dms_param_changed')!;
    expect(changed.actorName).toBe('Sokolov Dmitriy Aleksandrovich');
    expect(changed.targetLabel).toMatch(/Порог двух подписей на ГП: 20\s000\s000\s(?:сум|UZS) → 25\s000\s000\s(?:сум|UZS)/);
    expect(changed.reason).toContain('Aliyev Temur Farhodovich');
    expect(changed.at).toBeTruthy();
    expect(audit.some((e) => e.action === 'dms_param_proposed' && e.actorName === 'Aliyev Temur Farhodovich')).toBe(true);
  });

  it('a rejected change does not apply and is audited with the reason', async () => {
    const admin = await login('admin@demo.mig.uz');
    const p = await propose(admin, 'kpValidityDays', 45);
    const uw = await login('underwriter@demo.mig.uz');
    expect((await call(`/params/changes/${p.data.id}/reject`, { method: 'POST', sid: uw, json: { reason: '' } })).status).toBe(422);
    const r = await call<DmsParamChange>(`/params/changes/${p.data.id}/reject`, { method: 'POST', sid: uw, json: { reason: 'Нет решения правления' } });
    expect(r.data).toMatchObject({ status: 'rejected', rejectReason: 'Нет решения правления' });
    expect((await params()).dmsParam('kpValidityDays')).toBe(DMS_DEFAULTS.kpValidityDays);
    expect(db().audit.some((e) => e.action === 'dms_param_rejected' && e.reason === 'Нет решения правления')).toBe(true);
  });

  it('the applied value reaches the code: assistance authority without an individual contract value', async () => {
    const d = db();
    const a1 = d.assistances[0]!;
    const a2 = d.assistances[1]!;
    expect(a1.contract.guaranteeAuthorityLimit).toBeUndefined();
    expect(a2.contract.guaranteeAuthorityLimit).toBeDefined();
    const asst = await login('asst-doctor@demo-assist.uz');
    expect((await call<AssistOverview>('/assist/overview', { sid: asst })).data.authorityLimit).toBe(DMS_DEFAULTS.assistanceGuaranteeAuthority);

    const admin = await login('admin@demo.mig.uz');
    const p = await propose(admin, 'assistanceGuaranteeAuthority', 15_000_000);
    const uw = await login('underwriter@demo.mig.uz');
    await call(`/params/changes/${p.data.id}/approve`, { method: 'POST', sid: uw });
    expect((await call<AssistOverview>('/assist/overview', { sid: asst })).data.authorityLimit).toBe(15_000_000);
    // The individual contract value wins over the parameter.
    const asst2 = await login('asst-operator@demo-assist2.uz');
    expect((await call<AssistOverview>('/assist/overview', { sid: asst2 })).data.authorityLimit).toBe(a2.contract.guaranteeAuthorityLimit);
  });

  it('login lock follows the parameters', async () => {
    const admin = await login('admin@demo.mig.uz');
    const p = await propose(admin, 'loginMaxAttempts', 3);
    const uw = await login('underwriter@demo.mig.uz');
    await call(`/params/changes/${p.data.id}/approve`, { method: 'POST', sid: uw });
    for (let i = 0; i < 3; i++) expect((await call('/auth/login', { method: 'POST', json: { email: 'operator@demo.mig.uz', password: 'wrong-password-1' } })).status).toBe(401);
    const locked = await call<{ key: I18nKey; params?: Params }>('/auth/login', { method: 'POST', json: { email: 'operator@demo.mig.uz', password: 'Demo-2026!' } });
    expect(locked.status).toBe(429);
    expect(locked.data).toMatchObject({ key: 'srv.auth.locked', params: { minutes: DMS_DEFAULTS.loginLockMinutes } });
    expect(translate('ru', locked.data.key, locked.data.params)).toContain(`на ${DMS_DEFAULTS.loginLockMinutes} мин`);
  });
});

describe('numbering templates («Нумерация документов»)', () => {
  const proposeTemplate = (sid: string, kind: string, value: unknown, reason = 'Приказ о нумерации № 3') =>
    call<DmsParamChange & { fields?: Record<string, string> }>('/params/changes', { method: 'POST', sid, json: { key: `numbering.${kind}`, value, reason } });

  it('every kind starts with its demo template', async () => {
    const r = await call<DmsParamsView>('/params', { sid: await login('operator@demo.mig.uz') });
    expect(r.data.numbering.map((n) => n.kind)).toEqual([...DOC_NUMBER_KINDS]);
    expect(r.data.numbering.every((n) => n.isDemo && n.value === DEFAULT_NUMBERING[n.kind])).toBe(true);
  });

  it('an invalid template is rejected with the message key, on the server too', async () => {
    const admin = await login('admin@demo.mig.uz');
    const cyrillic = await proposeTemplate(admin, 'contract', 'ДМС-Д-{YYYY}-{N:6}');
    expect(cyrillic.status).toBe(422);
    expect(cyrillic.data.fields?.value).toBe('dom.numbering.chars');
    const spaces = await proposeTemplate(admin, 'contract', 'DMS D {N}');
    expect(spaces.data.fields?.value).toBe('dom.numbering.chars');
    const missing = await proposeTemplate(admin, 'endorsement', 'DS-{N}');
    expect(missing.status).toBe(422);
    expect(missing.data.fields?.value).toMatch(/^dom\.numbering\.missing/);
    expect(tm(missing.data.fields?.value)).toContain('{N}, {REF}');
    expect((await proposeTemplate(admin, 'contract', 123)).status).toBe(422);
    expect((await proposeTemplate(admin, 'unknown', 'X-{N}')).status).toBe(422);
    expect((await proposeTemplate(admin, 'contract', DEFAULT_NUMBERING.contract)).status).toBe(422);
    expect(db().dmsParams.changes.some((c) => c.key === 'numbering.contract')).toBe(false);
  });

  it('four-eyes: a valid template applies after a second person confirms; audited; a new contract gets the new format', async () => {
    const admin = await login('admin@demo.mig.uz');
    const p = await proposeTemplate(admin, 'contract', '  MIG-{YYYY}/{N:5}  ');
    expect(p.status).toBe(201);
    expect(p.data).toMatchObject({ key: 'numbering.contract', from: DEFAULT_NUMBERING.contract, to: 'MIG-{YYYY}/{N:5}', status: 'pending' });
    expect((await params()).numberingTemplate('contract')).toBe(DEFAULT_NUMBERING.contract);
    expect((await call(`/params/changes/${p.data.id}/approve`, { method: 'POST', sid: admin })).status).toBe(403);
    const uw = await login('underwriter@demo.mig.uz');
    expect((await call(`/params/changes/${p.data.id}/approve`, { method: 'POST', sid: uw })).status).toBe(200);
    expect((await params()).numbering().contract).toBe('MIG-{YYYY}/{N:5}');

    const view = await call<DmsParamsView>('/params', { sid: uw });
    expect(view.data.numbering.find((n) => n.kind === 'contract')).toMatchObject({ value: 'MIG-{YYYY}/{N:5}', isDemo: false });
    const changed = db().audit.find((e) => e.action === 'dms_param_changed')!;
    expect(changed.targetLabel).toContain(`${DEFAULT_NUMBERING.contract} → MIG-{YYYY}/{N:5}`);

    // A deal with an accepted KP and no contract yet: the new contract takes the template in force.
    const d = db();
    const ctx = baseCtx();
    let deal: (typeof d.deals)[number] | undefined;
    for (const x of d.deals) {
      if (!d.contracts.some((c) => c.dealId === x.id) && (await dealKp(ctx, x.id))) {
        deal = x;
        break;
      }
    }
    expect(deal).toBeDefined();
    const kp = (await dealKp(ctx, deal!.id))!;
    await repos.kp.update(kp.id, { status: 'accepted' });
    const c = await call<ContractView>('/contracts', { method: 'POST', sid: await login('sales@demo.mig.uz'), json: { dealId: deal!.id } });
    expect(c.status).toBe(201);
    expect(c.data.number).toMatch(new RegExp(`^MIG-${new Date().getFullYear()}/\\d{5}$`));
    // Numbers of the other kinds keep their own templates.
    expect((await params()).nextDocNumber('claim', { year: 2026, n: 7 })).toBe('U-2026-000007');
  });

  it('the largest sequence is read with the template in force and the demo one', async () => {
    const P = await params();
    expect(P.maxDocSeq('claim', ['U-2026-000041', 'U-2025-000099', 'junk'])).toBe(99);
    expect(P.maxDocSeq('policy', ['DMS-2026-000140', 'DMS-2025-000500'], { year: 2026, floor: 100 })).toBe(140);
    expect(P.maxDocSeq('policy', [], { year: 2026, floor: 100 })).toBe(100);
  });
});
