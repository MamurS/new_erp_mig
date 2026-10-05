// @vitest-environment node
/*
 * DMS business parameters on the mock server: reading by role, four-eyes on changes, audit with the
 * old and the new value, and the new value reaching the code that uses it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuditEntry, DmsParamChange, DmsParamValues } from '@/shared/types';
import type { AssistOverview, DmsParamsView, SessionResponse } from '@/shared/types/dto';
import { DMS_DEFAULTS, DMS_PARAM_KEYS } from '@/shared/config/dmsParameters';
import { translate, type I18nKey, type Params } from '@/i18n/core';
import { createMockServer } from './node';
import { db, resetDb } from './db';
import { dmsParam } from './params';

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
    expect(dmsParam('guaranteeDualApprovalThreshold')).toBe(20_000_000);
    expect((await propose(admin, 'guaranteeDualApprovalThreshold', 30_000_000)).status).toBe(409);

    expect((await call(`/params/changes/${p.data.id}/approve`, { method: 'POST', sid: admin })).status).toBe(403);
    const doctor = await login('doctor@demo.mig.uz');
    expect((await call(`/params/changes/${p.data.id}/approve`, { method: 'POST', sid: doctor })).status).toBe(403);
    const uw = await login('underwriter@demo.mig.uz');
    const ok = await call<DmsParamChange>(`/params/changes/${p.data.id}/approve`, { method: 'POST', sid: uw });
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ status: 'applied', decidedByName: 'Дмитрий Соколов' });
    expect((await call(`/params/changes/${p.data.id}/approve`, { method: 'POST', sid: uw })).status).toBe(409);

    expect(dmsParam('guaranteeDualApprovalThreshold')).toBe(25_000_000);
    const view = await call<DmsParamsView>('/params', { sid: uw });
    const row = view.data.parameters.find((x) => x.key === 'guaranteeDualApprovalThreshold')!;
    expect(row).toMatchObject({ value: 25_000_000, isDemo: false });
    expect(row.changedByName).toContain('Тимур Алиев');
    expect(row.changedByName).toContain('Дмитрий Соколов');

    const audit = db().audit.filter((e: AuditEntry) => e.targetType === 'parameter');
    const changed = audit.find((e) => e.action === 'dms_param_changed')!;
    expect(changed.actorName).toBe('Дмитрий Соколов');
    expect(changed.targetLabel).toMatch(/Порог двух подписей на ГП: 20\s000\s000\sUZS → 25\s000\s000\sUZS/);
    expect(changed.reason).toContain('Тимур Алиев');
    expect(changed.at).toBeTruthy();
    expect(audit.some((e) => e.action === 'dms_param_proposed' && e.actorName === 'Тимур Алиев')).toBe(true);
  });

  it('a rejected change does not apply and is audited with the reason', async () => {
    const admin = await login('admin@demo.mig.uz');
    const p = await propose(admin, 'kpValidityDays', 45);
    const uw = await login('underwriter@demo.mig.uz');
    expect((await call(`/params/changes/${p.data.id}/reject`, { method: 'POST', sid: uw, json: { reason: '' } })).status).toBe(422);
    const r = await call<DmsParamChange>(`/params/changes/${p.data.id}/reject`, { method: 'POST', sid: uw, json: { reason: 'Нет решения правления' } });
    expect(r.data).toMatchObject({ status: 'rejected', rejectReason: 'Нет решения правления' });
    expect(dmsParam('kpValidityDays')).toBe(DMS_DEFAULTS.kpValidityDays);
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
