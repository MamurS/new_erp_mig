import { describe, expect, it } from 'vitest';
import { buildSandboxRequest, SANDBOX_METHODS, sandboxDefaults } from './sandbox';

const method = (id: string) => SANDBOX_METHODS.find((m) => m.id === id)!;
const UUID = '5b9f3c2e-8a41-4d0b-9f6e-2d7c1a4e8b10';

describe('sandbox request builder', () => {
  it('puts parameters into the path, query and body and drops empty optional fields', () => {
    expect(buildSandboxRequest(method('coverage'), { qrToken: ' K7P4-QX2M ', policyNumber: '', pinfl: '' })).toEqual({ ok: true, path: '/coverage/check', body: { qrToken: 'K7P4-QX2M' } });
    expect(buildSandboxRequest(method('appointments'), { status: 'requested', from: '2026-10-01', to: '', cursor: '', limit: '20' })).toEqual({
      ok: true,
      path: '/appointments?status=requested&from=2026-10-01&limit=20',
    });
    expect(buildSandboxRequest(method('dispute'), { id: UUID, lineId: UUID, comment: 'Направление было' })).toEqual({
      ok: true,
      path: `/registries/${UUID}/lines/${UUID}/dispute`,
      body: { comment: 'Направление было' },
    });
  });

  it('parses numbers and JSON, so the defaults of every method are valid where no id is needed', () => {
    const r = buildSandboxRequest(method('guarantee-create'), { ...sandboxDefaults(method('guarantee-create')), visitId: UUID });
    expect(r).toMatchObject({ ok: true, body: { visitId: UUID, estimatedCost: 1_800_000, serviceCode: 'DG-310' } });
    const slots = buildSandboxRequest(method('slots'), sandboxDefaults(method('slots')));
    expect(slots.ok && Array.isArray(slots.body?.slots)).toBe(true);
  });

  it('reports field errors: required, UUID, number, date and JSON', () => {
    expect(buildSandboxRequest(method('visit'), { visitId: '' })).toEqual({ ok: false, errors: { visitId: 'Обязательный параметр' } });
    expect(buildSandboxRequest(method('visit'), { visitId: '../admin' })).toEqual({ ok: false, errors: { visitId: 'Нужен UUID' } });
    const r = buildSandboxRequest(method('appointments'), { status: 'nope', from: '01.10.2026', to: '', cursor: '', limit: 'ten' });
    expect(r.ok ? {} : r.errors).toEqual({ status: 'Выберите значение из списка', from: 'Дата ГГГГ-ММ-ДД', limit: 'Нужно число' });
    expect(buildSandboxRequest(method('slots'), { slots: '[{' })).toEqual({ ok: false, errors: { slots: 'Некорректный JSON' } });
  });
});
