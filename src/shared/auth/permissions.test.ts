/*
 * Generated from the SPEC §4 table (plus two clinic columns, all ✗) and the CLINIC_SPEC §8 table:
 * one test per cell. Both tables are verbatim copies.
 */
import { describe, expect, it } from 'vitest';
import { ACTIONS, can, type Action } from './permissions';
import type { ClaimStatus, Role, SessionUser } from '@/shared/types';

const TABLE = `
| \`clients.read\` | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| \`clients.write\` | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`policies.read\` | ✓ | ✓ | ✗ | ✓ | ✗ | свои | свой | ✗ | ✗ |
| \`policies.write\` (создать, продлить, КП) | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`insured.read\` | маск. | маск. | маск. | только ФИО | ✗ | свои, маск. | себя, маск. | ✗ | ✗ |
| \`insured.reveal_pii\` (с причиной) | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`medical.read\` (с причиной, 15 мин) | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`claims.read\` | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | свои | ✗ | ✗ |
| \`claims.transition\` | new→review→medical_review / approved / rejected | ✗ | medical_review→approved / rejected | approved→to_pay→paid | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`claims.create\` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | свои | ✗ | ✗ |
| \`appointments.read\` | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | свои | ✗ | ✗ |
| \`appointments.manage\` (подтвердить, отклонить) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | создать, отменить свои | ✗ | ✗ |
| \`clinics.read\` | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ |
| \`limits.request_change\` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`limits.approve_change\` | ✗ | ✓, кроме своих | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`reports.read\` | ✗ | ✓ | ✗ | ✓ | ✗ | агрегаты своих | ✗ | ✗ | ✗ |
| \`exports.create\` | ✗ | ✓ | ✗ | ✓ | ✗ | свои сотрудники | ✗ | ✗ | ✗ |
| \`audit.read\` | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| \`users.manage\` | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| \`hr.employees.manage\` | ✗ | ✗ | ✗ | ✗ | ✗ | свои | ✗ | ✗ | ✗ |
| \`kp.create\` (создать, изменить черновик) | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`kp.send\` (отправить, отозвать) | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`kp.read\` (просмотр и скачивание) | ✓ | ✓ | ✗ | ✓ | ✓ | свои | ✗ | ✗ | ✗ |
`;

const ROLES: Role[] = ['operator', 'underwriter', 'doctor_expert', 'accountant', 'admin', 'hr', 'insured', 'clinic_registrar', 'clinic_admin'];
const STATUSES: ClaimStatus[] = ['new', 'review', 'medical_review', 'approved', 'rejected', 'to_pay', 'paid'];

const COMPANY = '11111111-1111-4111-8111-111111111111';
const OTHER_COMPANY = '22222222-2222-4222-8222-222222222222';
const INSURED = '33333333-3333-4333-8333-333333333333';
const OTHER_INSURED = '44444444-4444-4444-8444-444444444444';
const CLINIC = '55555555-5555-4555-8555-555555555555';
const OTHER_CLINIC = '66666666-6666-4666-8666-666666666666';

/** CLINIC_SPEC §8, verbatim. Columns: registrar, clinic_admin, operator, doctor_expert, accountant, admin. */
const CLINIC_TABLE = `
| \`clinic.check_patient\` | своя клиника | своя клиника | ✗ | ✗ | ✗ | ✗ |
| \`clinic.appointments.manage\` | своя | своя | ✓ как запасной вариант | ✗ | ✗ | ✗ |
| \`guarantees.request\` | через визит | через визит | ✗ | ✗ | ✗ | ✗ |
| \`guarantees.read\` | своя клиника | своя клиника | ✓ | ✓ | ✗ | ✗ |
| \`guarantees.decide\` | ✗ | ✗ | ✗ | ✓, выше порога нужен второй | ✗ | ✗ |
| \`registries.submit\` | ✗ | своя | ✗ | ✗ | ✗ | ✗ |
| \`registries.review\` | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| \`registries.pay\` | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| \`clinic.integration.manage\` | ✗ | своя | ✗ | ✗ | ✗ | отзыв ключей |
| \`clinic.users.manage\` | ✗ | своя | ✗ | ✗ | ✗ | первый admin клиники |
| \`clinics.manage\` | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
`;
const CLINIC_COLUMNS: Role[] = ['clinic_registrar', 'clinic_admin', 'operator', 'doctor_expert', 'accountant', 'admin'];
/** «Роли HR и застрахованного к этим действиям доступа не имеют»; the underwriter is absent from the table too. */
const CLINIC_NO_ACCESS: Role[] = ['underwriter', 'hr', 'insured'];

function userFor(role: Role): SessionUser {
  return {
    id: `00000000-0000-4000-8000-00000000000${ROLES.indexOf(role)}`,
    role,
    displayName: role,
    companyId: role === 'hr' ? COMPANY : undefined,
    insuredId: role === 'insured' ? INSURED : undefined,
    clinicId: role === 'clinic_registrar' || role === 'clinic_admin' ? CLINIC : undefined,
  };
}

/** Parses `new→review→medical_review / approved / rejected` into pairs. */
function parseTransitions(cell: string): [ClaimStatus, ClaimStatus][] {
  const [chain, ...alts] = cell.split('/').map((s) => s.trim());
  const nodes = chain!.split('→').map((s) => s.trim()) as ClaimStatus[];
  const pairs: [ClaimStatus, ClaimStatus][] = [];
  for (let i = 0; i + 1 < nodes.length; i++) pairs.push([nodes[i]!, nodes[i + 1]!]);
  // alternatives branch from the second-to-last node of the chain
  const branchFrom = nodes[nodes.length - 2]!;
  for (const alt of alts) pairs.push([branchFrom, alt as ClaimStatus]);
  return pairs;
}

const parse = (table: string) =>
  table
    .trim()
    .split('\n')
    .map((line) => line.split('|').slice(1, -1).map((c) => c.trim()))
    .map(([action, ...cells]) => ({ action: /`([^`]+)`/.exec(action!)![1] as Action, cells }));
const rows = parse(TABLE);
const clinicRows = parse(CLINIC_TABLE);

describe('permissions matrix (SPEC §4)', () => {
  it('covers every action exactly', () => {
    expect([...rows, ...clinicRows].map((r) => r.action).sort()).toEqual([...ACTIONS].sort());
  });

  for (const { action, cells } of rows) {
    ROLES.forEach((role, i) => {
      const cell = cells[i]!;
      const user = userFor(role);
      it(`${action} × ${role} = ${cell}`, () => {
        if (cell === '✗') {
          expect(can(user, action)).toBe(false);
          return;
        }
        if (cell === '✓' || cell.startsWith('маск.') || cell === 'только ФИО') {
          expect(can(user, action)).toBe(true);
          return;
        }
        if (cell.includes('→')) {
          const pairs = parseTransitions(cell);
          for (const from of STATUSES)
            for (const to of STATUSES) {
              const expected = pairs.some(([f, t]) => f === from && t === to);
              expect(can(user, action, { from, to }), `${from}→${to}`).toBe(expected);
            }
          return;
        }
        if (cell === '✓, кроме своих') {
          expect(can(user, action, { createdById: '99999999-9999-4999-8999-999999999999' })).toBe(true);
          expect(can(user, action, { createdById: user.id })).toBe(false);
          return;
        }
        // own-scoped cells: свои / свой / себя / агрегаты своих / свои сотрудники / создать, отменить свои
        expect(can(user, action)).toBe(true);
        if (role === 'hr') {
          expect(can(user, action, { companyId: COMPANY })).toBe(true);
          expect(can(user, action, { companyId: OTHER_COMPANY })).toBe(false);
        } else {
          expect(can(user, action, { insuredId: INSURED })).toBe(true);
          expect(can(user, action, { insuredId: OTHER_INSURED })).toBe(false);
        }
      });
    });
  }

  it('denies anonymous users', () => {
    for (const action of ACTIONS) expect(can(null, action)).toBe(false);
  });
});

describe('clinic permissions matrix (CLINIC_SPEC §8)', () => {
  for (const { action, cells } of clinicRows) {
    CLINIC_COLUMNS.forEach((role, i) => {
      const cell = cells[i]!;
      const user = userFor(role);
      it(`${action} × ${role} = ${cell}`, () => {
        if (cell === '✗') {
          expect(can(user, action)).toBe(false);
          expect(can(user, action, { clinicId: CLINIC })).toBe(false);
          return;
        }
        if (cell.startsWith('✓')) {
          expect(can(user, action)).toBe(true);
          return;
        }
        if (cell === 'отзыв ключей' || cell === 'первый admin клиники') {
          expect(can(user, action)).toBe(false);
          expect(can(user, action, { sub: cell === 'отзыв ключей' ? 'revoke_keys' : 'first_admin' })).toBe(true);
          expect(can(user, action, { sub: 'anything_else' })).toBe(false);
          return;
        }
        // своя клиника / своя / через визит: only the user's own clinic
        expect(['своя клиника', 'своя', 'через визит']).toContain(cell);
        expect(can(user, action)).toBe(true);
        expect(can(user, action, { clinicId: CLINIC })).toBe(true);
        expect(can(user, action, { clinicId: OTHER_CLINIC })).toBe(false);
      });
    });
    for (const role of CLINIC_NO_ACCESS) {
      it(`${action} × ${role} = ✗`, () => {
        expect(can(userFor(role), action)).toBe(false);
        expect(can(userFor(role), action, { clinicId: CLINIC })).toBe(false);
      });
    }
  }

  it('clinic users never reach data of companies or insured persons', () => {
    for (const role of ['clinic_registrar', 'clinic_admin'] as const)
      for (const action of ACTIONS) {
        expect(can(userFor(role), action, { companyId: COMPANY })).toBe(false);
        expect(can(userFor(role), action, { insuredId: INSURED })).toBe(false);
      }
  });
});
