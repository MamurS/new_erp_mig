/*
 * «+ Создать»: what each role of the matrix sees. The expectations are written out by hand from the permission
 * matrix (so a change of a cell has to be reflected here on purpose), and cross-checked against `can`.
 */
import { describe, expect, it } from 'vitest';
import type { Role } from '@/shared/types';
import { can, ruleFor } from '@/shared/auth/permissions';
import { ASSISTANCE_ROLES, CLINIC_ROLES, STAFF_ROLES } from '@/shared/domain/labels';
import { AUTO_ITEMS, CREATE_ITEMS, createMenuFor, shouldOpenOnKey, type AutoItemId, type CreateItemId } from './createItems';

const ALL_ROLES: Role[] = [...STAFF_ROLES, 'hr', 'insured', ...CLINIC_ROLES, ...ASSISTANCE_ROLES];

/** Role → enabled items (in menu order) and automatic documents explained to it. */
const EXPECTED: Record<Role, { items: CreateItemId[]; auto: AutoItemId[] }> = {
  operator: { items: ['claim'], auto: [] },
  underwriter: { items: ['client'], auto: ['policy', 'endorsement', 'kp_contract'] },
  doctor_expert: { items: [], auto: [] },
  accountant: { items: [], auto: [] },
  admin: { items: ['user', 'clinic', 'assistance'], auto: [] },
  sales_manager: { items: ['client', 'deal', 'membership'], auto: ['policy', 'endorsement', 'kp_contract'] },
  legal: { items: [], auto: [] },
  claims_officer: { items: ['claim'], auto: [] },
  hr: { items: ['membership', 'family'], auto: ['policy', 'endorsement'] },
  insured: { items: [], auto: [] },
  clinic_registrar: { items: ['guarantee'], auto: [] },
  clinic_admin: { items: ['guarantee', 'user'], auto: [] },
  asst_operator: { items: ['case'], auto: [] },
  asst_doctor: { items: ['case'], auto: [] },
  asst_billing: { items: [], auto: [] },
  asst_admin: { items: ['user'], auto: [] },
};

const userOf = (role: Role) => ({ id: '00000000-0000-4000-8000-000000000001', role });

describe('createMenuFor', () => {
  it('covers every role of the matrix', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...ALL_ROLES].sort());
  });

  it.each(ALL_ROLES)('%s sees exactly its items', (role) => {
    const m = createMenuFor(userOf(role));
    expect(m.items.map((i) => i.id)).toEqual(EXPECTED[role].items);
    expect(m.auto.map((a) => a.id)).toEqual(EXPECTED[role].auto);
  });

  it.each(ALL_ROLES)('%s: every enabled item is allowed by the matrix', (role) => {
    for (const item of createMenuFor(userOf(role)).items) {
      const def = CREATE_ITEMS.find((d) => d.id === item.id)!;
      expect(def.variants.some((v) => can(userOf(role), v.perm) && (!v.alsoPerm || can(userOf(role), v.alsoPerm)) && (v.to === item.to || v.command === item.command)), `${role} ${item.id}`).toBe(true);
    }
  });

  it.each(ALL_ROLES)('%s: automatic items only for roles that work with the document and can create something', (role) => {
    const m = createMenuFor(userOf(role));
    for (const a of m.auto) {
      const def = AUTO_ITEMS.find((d) => d.id === a.id)!;
      expect(def.relevant.some((p) => ruleFor(role, p) !== false)).toBe(true);
      expect(m.items.length).toBeGreaterThan(0);
    }
  });

  it('every item starts somewhere: a path or a command', () => {
    for (const d of CREATE_ITEMS) for (const v of d.variants) expect(Boolean(v.to) !== Boolean(v.command), d.id).toBe(true);
  });

  it('the start points the menu leads to', () => {
    const to = (role: Role, id: CreateItemId) => createMenuFor(userOf(role)).items.find((i) => i.id === id);
    expect(to('sales_manager', 'client')?.to).toBe('/staff/deals?create=lead');
    expect(to('underwriter', 'client')?.to).toBe('/staff/clients?create=client');
    expect(to('sales_manager', 'membership')?.to).toBe('/staff/endorsements?create=request');
    expect(to('hr', 'membership')?.to).toBe('/hr/employees/new');
    expect(to('hr', 'family')?.to).toBe('/hr/family/new');
    expect(to('operator', 'claim')?.command).toBe('pick-insured-for-claim');
    expect(to('claims_officer', 'claim')?.to).toBe('/staff/claims?create=claim');
    expect(to('asst_operator', 'case')?.to).toBe('/assist/insured');
    expect(to('clinic_registrar', 'guarantee')?.to).toBe('/clinic/check');
    expect(to('admin', 'user')?.to).toBe('/staff/admin/users?create=user');
    expect(to('clinic_admin', 'user')?.to).toBe('/clinic/users?create=user');
    expect(to('asst_admin', 'user')?.to).toBe('/assist/users?create=user');
  });

  it('no user → nothing', () => {
    expect(createMenuFor(null)).toEqual({ items: [], auto: [] });
  });
});

describe('hotkey C', () => {
  const noDialog = { querySelector: () => null } as unknown as Document;
  const withDialog = { querySelector: () => ({}) } as unknown as Document;
  const key = (over: Partial<KeyboardEvent> = {}) =>
    ({ code: 'KeyC', key: 'c', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, defaultPrevented: false, target: document.body, ...over }) as KeyboardEvent;

  it('opens on C, also on the Russian layout (С)', () => {
    expect(shouldOpenOnKey(key(), noDialog)).toBe(true);
    expect(shouldOpenOnKey(key({ key: 'с' }), noDialog)).toBe(true);
  });

  it('not with a modifier, not on other keys, not while a dialog is open', () => {
    expect(shouldOpenOnKey(key({ ctrlKey: true }), noDialog)).toBe(false);
    expect(shouldOpenOnKey(key({ metaKey: true }), noDialog)).toBe(false);
    expect(shouldOpenOnKey(key({ altKey: true }), noDialog)).toBe(false);
    expect(shouldOpenOnKey(key({ shiftKey: true }), noDialog)).toBe(false);
    expect(shouldOpenOnKey(key({ code: 'KeyV', key: 'v' }), noDialog)).toBe(false);
    expect(shouldOpenOnKey(key(), withDialog)).toBe(false);
  });

  it('not while typing', () => {
    for (const tag of ['input', 'textarea', 'select']) expect(shouldOpenOnKey(key({ target: document.createElement(tag) }), noDialog), tag).toBe(false);
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    editable.appendChild(inner);
    document.body.appendChild(editable);
    expect(shouldOpenOnKey(key({ target: inner }), noDialog)).toBe(false);
    editable.remove();
  });
});
