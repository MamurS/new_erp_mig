/*
 * Generated from the SPEC §4 table: one test per cell. The table below is a verbatim copy.
 */
import { describe, expect, it } from 'vitest';
import { ACTIONS, can, type Action } from './permissions';
import type { ClaimStatus, Role, SessionUser } from '@/shared/types';

const TABLE = `
| \`clients.read\` | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ |
| \`clients.write\` | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`policies.read\` | ✓ | ✓ | ✗ | ✓ | ✗ | свои | свой |
| \`policies.write\` (создать, продлить, КП) | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`insured.read\` | маск. | маск. | маск. | только ФИО | ✗ | свои, маск. | себя, маск. |
| \`insured.reveal_pii\` (с причиной) | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| \`medical.read\` (с причиной, 15 мин) | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| \`claims.read\` | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | свои |
| \`claims.transition\` | new→review→medical_review / approved / rejected | ✗ | medical_review→approved / rejected | approved→to_pay→paid | ✗ | ✗ | ✗ |
| \`claims.create\` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | свои |
| \`appointments.read\` | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | свои |
| \`appointments.manage\` (подтвердить, отклонить) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | создать, отменить свои |
| \`clinics.read\` | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ |
| \`limits.request_change\` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`limits.approve_change\` | ✗ | ✓, кроме своих | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`reports.read\` | ✗ | ✓ | ✗ | ✓ | ✗ | агрегаты своих | ✗ |
| \`exports.create\` | ✗ | ✓ | ✗ | ✓ | ✗ | свои сотрудники | ✗ |
| \`audit.read\` | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| \`users.manage\` | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| \`hr.employees.manage\` | ✗ | ✗ | ✗ | ✗ | ✗ | свои | ✗ |
| \`kp.create\` (создать, изменить черновик) | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`kp.send\` (отправить, отозвать) | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`kp.read\` (просмотр и скачивание) | ✓ | ✓ | ✗ | ✓ | ✓ | свои | ✗ |
`;

const ROLES: Role[] = ['operator', 'underwriter', 'doctor_expert', 'accountant', 'admin', 'hr', 'insured'];
const STATUSES: ClaimStatus[] = ['new', 'review', 'medical_review', 'approved', 'rejected', 'to_pay', 'paid'];

const COMPANY = '11111111-1111-4111-8111-111111111111';
const OTHER_COMPANY = '22222222-2222-4222-8222-222222222222';
const INSURED = '33333333-3333-4333-8333-333333333333';
const OTHER_INSURED = '44444444-4444-4444-8444-444444444444';

function userFor(role: Role): SessionUser {
  return {
    id: `00000000-0000-4000-8000-00000000000${ROLES.indexOf(role)}`,
    role,
    displayName: role,
    companyId: role === 'hr' ? COMPANY : undefined,
    insuredId: role === 'insured' ? INSURED : undefined,
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

const rows = TABLE.trim()
  .split('\n')
  .map((line) => line.split('|').slice(1, -1).map((c) => c.trim()))
  .map(([action, ...cells]) => ({ action: /`([^`]+)`/.exec(action!)![1] as Action, cells }));

describe('permissions matrix (SPEC §4)', () => {
  it('covers every action exactly', () => {
    expect(rows.map((r) => r.action).sort()).toEqual([...ACTIONS].sort());
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
