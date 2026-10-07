/*
 * Generated from the SPEC §4 table (plus two clinic columns, all ✗) and the CLINIC_SPEC §8 table:
 * one test per cell. Both tables are verbatim copies.
 */
import { describe, expect, it } from 'vitest';
import { ACTIONS, can, ruleFor, type Action } from './permissions';
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

/** POLICY_SPEC §2, verbatim (new rows only; `policies.write` is in the SPEC table). Last column: both clinic roles. */
const POLICY_TABLE = `
| \`policy_changes.read\` | ✓ | ✓ | ✗ | ✓ | ✗ | своя компания | ✗ | ✗ |
| \`policy_changes.request\` | ✗ | ✗ | ✗ | ✗ | ✗ | своя компания | ✗ | ✗ |
| \`policy_changes.decide\` | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
`;

/** ASSISTANCE_SPEC §10, verbatim, except `rebills.review` × operator: LIFECYCLE_SPEC §14 moved it to claims_officer. Columns: asst_operator, asst_doctor, asst_billing, asst_admin, operator, doctor_expert, accountant, underwriter, admin. */
const ASSIST_TABLE = `
| \`assist.insured.search\` | свои | свои | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ |
| \`assist.insured.reveal_pii\` | свои, причина | свои, причина | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ |
| \`assist.medical.read\` | ✗ | свои, причина | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| \`assist.cases.manage\` | свои | свои | ✗ | ✗ | чтение и жалобы | ✗ | ✗ | ✗ | ✗ |
| \`assist.appointments.manage\` | свои | ✗ | ✗ | ✗ | без ассистанса | ✗ | ✗ | ✗ | ✗ |
| \`assist.guarantees.decide\` | ✗ | свои, до лимита | ✗ | ✗ | ✗ | эскалации и без ассистанса | ✗ | ✗ | ✗ |
| \`assist.registries.review\` | ✗ | свои | свои | ✗ | без ассистанса | ✗ | ✗ | ✗ | ✗ |
| \`assist.clinic_payments.record\` | ✗ | ✗ | свои | ✗ | ✗ | ✗ | без ассистанса | ✗ | ✗ |
| \`assist.rebills.submit\` | ✗ | ✗ | свои | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`rebills.review\` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`rebills.pay\` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓, не тот, кто принял | ✗ | ✗ |
| \`qa.review\` | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| \`assistance.assign\` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| \`assistance.manage\` (компании, договоры) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| \`assist.users.manage\`, \`assist.integration.manage\` | ✗ | ✗ | ✗ | свои | ✗ | ✗ | ✗ | ✗ | отзыв ключей |
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
    id: `00000000-0000-4000-8000-0000000000${String([...ROLES, ...ASSIST_ROLES].indexOf(role)).padStart(2, '0')}`,
    role,
    displayName: role,
    companyId: role === 'hr' ? COMPANY : undefined,
    insuredId: role === 'insured' ? INSURED : undefined,
    clinicId: role === 'clinic_registrar' || role === 'clinic_admin' ? CLINIC : undefined,
    assistanceId: ASSIST_ROLES.includes(role) ? ASSIST : undefined,
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
/** DMS business parameters (DECISIONS: «Параметры ДМС»). Columns: all 13 roles. */
const PARAMS_TABLE = `
| \`dms_params.read\` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`dms_params.propose\` | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`dms_params.approve\` | ✗ | ✓, кроме своих | ✗ | ✗ | ✓, кроме своих | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
`;
/** LIFECYCLE_SPEC §14, verbatim. Columns: sales_manager, underwriter, legal, claims_officer, operator, doctor_expert, accountant, hr. */
const LIFECYCLE_TABLE = `
| \`leads.manage\`, \`deals.manage\` | ✓ (свои и общие) | чтение | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`census.upload\` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`quotes.calculate\` | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`quotes.approve\` | ✗ | в пределах полномочий | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`kp.send\` | ✓ (по утверждённой котировке) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`kp.respond\` | отметка вручную | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | своя компания |
| \`contracts.draft\` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`contracts.legal_approve\` | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`contracts.sign_mig\` | только подписант | только подписант | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`contracts.sign_client\` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | своя компания |
| \`contracts.verify_scan\`, \`contracts.originals\` | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| \`payments.record\` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| \`endorsements.manage\` | ✓ | утверждение сумм | ✗ | ✗ | ✗ | ✗ | ✗ | заявки своей компании |
| \`claims.decide\` | ✗ | ✗ | ✗ | в пределах полномочий | ✗ | ✗ | ✗ | ✗ |
| \`claims.medical_opinion\` | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| \`claims.reserves\` | ✗ | чтение | ✗ | ✓ | ✗ | ✗ | чтение | ✗ |
| \`rebills.review\` | ✗ | ✗ | ✗ | ✓ (было у operator) | ✗ | ✗ | ✗ | ✗ |
| \`staff.authority.manage\` | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ (только \`admin\` + второй) |
`;
/** Read rights the lifecycle screens need, not named in §14 (DECISIONS: «Жизненный цикл»). Same columns. */
const LIFECYCLE_READ_TABLE = `
| \`contracts.read\` | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | своя компания |
| \`invoices.read\` | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ | своя компания |
`;
const multi = (table: string) =>
  table
    .trim()
    .split('\n')
    .map((line) => line.split('|').slice(1, -1).map((c) => c.trim()))
    .flatMap(([action, ...cells]) => [...action!.matchAll(/`([^`]+)`/g)].map((m) => ({ action: m[1] as Action, cells })));
/** AI_COVERAGE_SPEC §5, verbatim: action → who. */
const AI_TABLE: Record<string, string> = {
  'ai.coverage.self': '`insured`: только свой полис',
  'ai.coverage.clinic': '`clinic_*`: только через визит',
  'ai.coverage.assist': '`asst_doctor`, `asst_operator`: свои застрахованные',
  'ai.coverage.mig': '`claims_officer`, `doctor_expert`, `operator`',
  'ai.feedback': 'все, кто видит подсказку в рабочих экранах',
  'ai.admin': '`admin` (с подтверждением второго)',
};
const AI_ACTIONS = Object.keys(AI_TABLE) as Action[];
/** Transfer of the existing portfolio (DECISIONS: «Перенос портфеля»): admin only, the second admin applies. */
const MIGRATION_ACTIONS: Action[] = ['migration.manage', 'migration.approve'];
/** Family members (FAMILY_SPEC, DECISIONS «Члены семьи»): the insured app's self-service, HR's decision on app requests. */
const FAMILY_ACTIONS: Action[] = ['family.self_service', 'family.requests.decide'];
/** Next steps of empty sections (DECISIONS «Пустые состояния»): tasks between roles and HR requests. */
const TASK_ACTIONS: Action[] = ['tasks.ask', 'tasks.receive', 'tasks.request_hr'];
const lifecycleRows = [...multi(LIFECYCLE_TABLE), ...multi(LIFECYCLE_READ_TABLE)];
const rows = parse(TABLE);
const paramRows = parse(PARAMS_TABLE);
const clinicRows = parse(CLINIC_TABLE);
const policyRows = parse(POLICY_TABLE);
/** A row may name several actions (`a`, `b`): one entry per action. */
const assistRows = ASSIST_TABLE.trim()
  .split('\n')
  .map((line) => line.split('|').slice(1, -1).map((c) => c.trim()))
  .flatMap(([action, ...cells]) => [...action!.matchAll(/`([^`]+)`/g)].map((m) => ({ action: m[1] as Action, cells })));
const ASSIST = '77777777-7777-4777-8777-777777777777';
const OTHER_ASSIST = '88888888-8888-4888-8888-888888888888';
const ASSIST_ROLES: Role[] = ['asst_operator', 'asst_doctor', 'asst_billing', 'asst_admin'];

describe('permissions matrix (SPEC §4)', () => {
  it('covers every action exactly', () => {
    const earlier = [...rows, ...clinicRows, ...policyRows, ...assistRows, ...paramRows].map((r) => r.action);
    // LIFECYCLE §14 also restates `kp.send` and `rebills.review` of the earlier tables.
    const added = lifecycleRows.map((r) => r.action).filter((a) => !earlier.includes(a));
    expect([...earlier, ...added, ...AI_ACTIONS, ...MIGRATION_ACTIONS, ...FAMILY_ACTIONS, ...TASK_ACTIONS].sort()).toEqual([...ACTIONS].sort());
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

describe('policy permissions matrix (POLICY_SPEC §2)', () => {
  const columns: Role[][] = [['operator'], ['underwriter'], ['doctor_expert'], ['accountant'], ['admin'], ['hr'], ['insured'], ['clinic_registrar', 'clinic_admin']];
  for (const { action, cells } of policyRows) {
    columns.forEach((roles, i) => {
      const cell = cells[i]!;
      for (const role of roles) {
        it(`${action} × ${role} = ${cell}`, () => {
          const user = userFor(role);
          if (cell === '✗') {
            expect(can(user, action)).toBe(false);
            expect(can(user, action, { companyId: COMPANY })).toBe(false);
            return;
          }
          if (cell === '✓') {
            expect(can(user, action)).toBe(true);
            return;
          }
          expect(cell).toBe('своя компания');
          expect(can(user, action, { companyId: COMPANY })).toBe(true);
          expect(can(user, action, { companyId: OTHER_COMPANY })).toBe(false);
        });
      }
    });
  }
});

describe('assistance permissions matrix (ASSISTANCE_SPEC §10)', () => {
  const columns: Role[] = ['asst_operator', 'asst_doctor', 'asst_billing', 'asst_admin', 'operator', 'doctor_expert', 'accountant', 'underwriter', 'admin'];
  const others: Role[] = ['hr', 'insured', 'clinic_registrar', 'clinic_admin'];
  for (const { action, cells } of assistRows) {
    columns.forEach((role, i) => {
      const cell = cells[i]!;
      it(`${action} × ${role} = ${cell}`, () => {
        const user = userFor(role);
        if (cell === '✗') {
          expect(can(user, action)).toBe(false);
          expect(can(user, action, { assistanceId: ASSIST })).toBe(false);
          expect(can(user, action, { assistanceId: null })).toBe(false);
          return;
        }
        if (cell === '✓') {
          expect(can(user, action)).toBe(true);
          return;
        }
        if (cell.startsWith('свои')) {
          // «свои», «свои, причина», «свои, до лимита»: only the user's assistance on the event date; the reason and the limit are checked by the data layer
          expect(can(user, action)).toBe(true);
          expect(can(user, action, { assistanceId: ASSIST })).toBe(true);
          expect(can(user, action, { assistanceId: OTHER_ASSIST })).toBe(false);
          expect(can(user, action, { assistanceId: null })).toBe(false);
          return;
        }
        if (cell === 'без ассистанса') {
          expect(can(user, action, { assistanceId: null })).toBe(true);
          expect(can(user, action, { assistanceId: ASSIST })).toBe(false);
          return;
        }
        if (cell === 'эскалации и без ассистанса') {
          expect(can(user, action, { assistanceId: null })).toBe(true);
          expect(can(user, action, { assistanceId: ASSIST, escalated: true })).toBe(true);
          expect(can(user, action, { assistanceId: ASSIST })).toBe(false);
          return;
        }
        if (cell === 'чтение и жалобы') {
          expect(can(user, action, { sub: 'read' })).toBe(true);
          expect(can(user, action, { sub: 'complaint' })).toBe(true);
          expect(can(user, action, { sub: 'create' })).toBe(false);
          expect(can(user, action)).toBe(false);
          return;
        }
        if (cell === '✓, не тот, кто принял') {
          expect(can(user, action, { createdById: '99999999-9999-4999-8999-999999999999' })).toBe(true);
          expect(can(user, action, { createdById: user.id })).toBe(false);
          return;
        }
        expect(cell).toBe('отзыв ключей');
        expect(can(user, action)).toBe(false);
        expect(can(user, action, { sub: 'revoke_keys' })).toBe(true);
        expect(can(user, action, { sub: 'anything_else' })).toBe(false);
      });
    });
    for (const role of others) {
      it(`${action} × ${role} = ✗`, () => {
        expect(can(userFor(role), action)).toBe(false);
        expect(can(userFor(role), action, { assistanceId: null })).toBe(false);
      });
    }
  }

  it('assistance roles have none of the rights of the earlier tables', () => {
    // The AI actions of assistances (AI_COVERAGE_SPEC §5) are tested in their own block.
    const own = new Set([...assistRows.map((r) => r.action), 'ai.coverage.assist', 'ai.feedback']);
    for (const role of ASSIST_ROLES)
      for (const action of ACTIONS.filter((a) => !own.has(a))) {
        expect(can(userFor(role), action), `${role} ${action}`).toBe(false);
        expect(can(userFor(role), action, { companyId: COMPANY, insuredId: INSURED, clinicId: CLINIC })).toBe(false);
      }
  });
});

describe('DMS parameters permissions', () => {
  const columns: Role[] = [...ROLES, ...ASSIST_ROLES];
  for (const { action, cells } of paramRows) {
    columns.forEach((role, i) => {
      const cell = cells[i]!;
      it(`${action} × ${role} = ${cell}`, () => {
        const user = userFor(role);
        if (cell === '✗') {
          expect(can(user, action)).toBe(false);
          expect(can(user, action, { createdById: '99999999-9999-4999-8999-999999999999' })).toBe(false);
          return;
        }
        if (cell === '✓') {
          expect(can(user, action)).toBe(true);
          return;
        }
        expect(cell).toBe('✓, кроме своих');
        expect(can(user, action, { createdById: '99999999-9999-4999-8999-999999999999' })).toBe(true);
        expect(can(user, action, { createdById: user.id })).toBe(false);
      });
    });
  }
});

describe('lifecycle permissions matrix (LIFECYCLE_SPEC §14)', () => {
  const columns: Role[] = ['sales_manager', 'underwriter', 'legal', 'claims_officer', 'operator', 'doctor_expert', 'accountant', 'hr'];
  const others: Role[] = ['admin', 'insured', 'clinic_registrar', 'clinic_admin', ...ASSIST_ROLES];
  const signer = (role: Role, canSign: boolean): SessionUser => ({ ...userFor(role), canSign });
  for (const { action, cells } of lifecycleRows) {
    columns.forEach((role, i) => {
      const cell = cells[i]!;
      it(`${action} × ${role} = ${cell}`, () => {
        const user = userFor(role);
        if (cell.startsWith('✗')) {
          expect(can(user, action)).toBe(false);
          expect(can(user, action, { companyId: COMPANY })).toBe(false);
          expect(can(user, action, { sub: 'read' })).toBe(false);
          return;
        }
        if (cell.startsWith('✓') || cell === 'в пределах полномочий') {
          // «в пределах полномочий»: the amount is checked by the data layer against StaffAuthority
          expect(can(user, action)).toBe(true);
          return;
        }
        if (cell === 'только подписант') {
          expect(can(signer(role, true), action)).toBe(true);
          expect(can(signer(role, false), action)).toBe(false);
          return;
        }
        const sub = { чтение: 'read', 'отметка вручную': 'manual', 'утверждение сумм': 'approve_amounts' }[cell];
        if (sub) {
          expect(can(user, action)).toBe(false);
          expect(can(user, action, { sub })).toBe(true);
          expect(can(user, action, { sub: 'anything_else' })).toBe(false);
          return;
        }
        expect(['своя компания', 'заявки своей компании']).toContain(cell);
        expect(can(user, action, { companyId: COMPANY })).toBe(true);
        expect(can(user, action, { companyId: OTHER_COMPANY })).toBe(false);
      });
    });
    if (action !== 'staff.authority.manage')
      for (const role of others)
        it(`${action} × ${role} = ✗`, () => {
          expect(can(userFor(role), action)).toBe(false);
          expect(can(userFor(role), action, { companyId: COMPANY, insuredId: INSURED, clinicId: CLINIC, assistanceId: ASSIST, sub: 'read' })).toBe(false);
        });
  }
  it('staff.authority.manage: only an admin, and the second person is never the proposer', () => {
    const admin = userFor('admin');
    expect(can(admin, 'staff.authority.manage')).toBe(true);
    expect(can(admin, 'staff.authority.manage', { sub: 'approve', createdById: '99999999-9999-4999-8999-999999999999' })).toBe(true);
    expect(can(admin, 'staff.authority.manage', { sub: 'approve', createdById: admin.id })).toBe(false);
  });
});

describe('AI permissions (AI_COVERAGE_SPEC §5)', () => {
  const ALL: Role[] = [...ROLES, ...ASSIST_ROLES, 'sales_manager', 'legal', 'claims_officer'];
  const allowed = (action: Action) => ALL.filter((r) => can({ ...userFor(r), canSign: true }, action, { insuredId: INSURED, companyId: COMPANY, clinicId: CLINIC, assistanceId: ASSIST, createdById: '99999999-9999-4999-8999-999999999999' }));
  it('only the roles of the table', () => {
    expect(allowed('ai.coverage.self')).toEqual(['insured']);
    expect(allowed('ai.coverage.clinic')).toEqual(['clinic_registrar', 'clinic_admin']);
    expect(allowed('ai.coverage.assist')).toEqual(['asst_operator', 'asst_doctor']);
    expect(allowed('ai.coverage.mig').sort()).toEqual(['claims_officer', 'doctor_expert', 'operator']);
    // «все, кто видит подсказку в рабочих экранах»: the hint is shown to MIG and assistance decision makers
    expect(allowed('ai.feedback').sort()).toEqual(['asst_doctor', 'asst_operator', 'claims_officer', 'doctor_expert', 'operator']);
    expect(allowed('ai.admin')).toEqual(['admin']);
    expect(Object.keys(AI_TABLE)).toHaveLength(6);
  });
  it('scopes: own policy, own clinic, own assistance; the admin never confirms own change; HR has nothing', () => {
    expect(can(userFor('insured'), 'ai.coverage.self', { insuredId: OTHER_INSURED })).toBe(false);
    expect(can(userFor('clinic_registrar'), 'ai.coverage.clinic', { clinicId: OTHER_CLINIC })).toBe(false);
    expect(can(userFor('asst_doctor'), 'ai.coverage.assist', { assistanceId: OTHER_ASSIST })).toBe(false);
    const admin = userFor('admin');
    expect(can(admin, 'ai.admin', { createdById: admin.id })).toBe(false);
    for (const a of AI_ACTIONS) expect(can(userFor('hr'), a, { companyId: COMPANY })).toBe(false);
  });
});

describe('portfolio migration permissions', () => {
  const ALL: Role[] = [...ROLES, ...ASSIST_ROLES, 'sales_manager', 'legal', 'claims_officer'];
  const OTHER = '99999999-9999-4999-8999-999999999999';
  it('only an admin prepares and applies a batch', () => {
    const allowed = (action: Action) => ALL.filter((r) => can({ ...userFor(r), canSign: true }, action, { createdById: OTHER, companyId: COMPANY, insuredId: INSURED, clinicId: CLINIC, assistanceId: ASSIST }));
    expect(allowed('migration.manage')).toEqual(['admin']);
    expect(allowed('migration.approve')).toEqual(['admin']);
  });
  it('four-eyes: the author never applies own batch', () => {
    const admin = userFor('admin');
    expect(can(admin, 'migration.approve', { createdById: OTHER })).toBe(true);
    expect(can(admin, 'migration.approve', { createdById: admin.id })).toBe(false);
    expect(can(admin, 'migration.manage', { createdById: admin.id })).toBe(true);
  });
});

describe('claim registration (SPEC §4 `claims.create` + DECISIONS: «Регистрация убытка урегулировщиком»)', () => {
  const ALL: Role[] = [...ROLES, ...ASSIST_ROLES, 'sales_manager', 'legal', 'claims_officer'];
  it('MIG staff: the operator and the claims officer; the insured person only for themselves', () => {
    const staff = ALL.filter((r) => r !== 'insured' && can(userFor(r), 'claims.create', { companyId: COMPANY, clinicId: CLINIC, assistanceId: ASSIST }));
    expect(staff.sort()).toEqual(['claims_officer', 'operator']);
    expect(ruleFor('claims_officer', 'claims.create')).toBe(true);
    expect(can(userFor('insured'), 'claims.create', { insuredId: INSURED })).toBe(true);
    expect(can(userFor('insured'), 'claims.create', { insuredId: OTHER_INSURED })).toBe(false);
  });
  it('the claims officer registers the claim together with its reserve; the operator has no reserve right', () => {
    expect(can(userFor('claims_officer'), 'claims.reserves')).toBe(true);
    expect(can(userFor('operator'), 'claims.reserves')).toBe(false);
  });
});

describe('family members permissions (FAMILY_SPEC)', () => {
  const ALL: Role[] = [...ROLES, ...ASSIST_ROLES, 'sales_manager', 'legal', 'claims_officer'];
  it('the self-service of the app: the insured person only, for their own record', () => {
    for (const role of ALL) expect(can(userFor(role), 'family.self_service'), role).toBe(role === 'insured');
    expect(can(userFor('insured'), 'family.self_service', { insuredId: INSURED })).toBe(true);
    expect(can(userFor('insured'), 'family.self_service', { insuredId: OTHER_INSURED })).toBe(false);
  });
  it('requests from the app are decided by HR of the company only', () => {
    for (const role of ALL) expect(can(userFor(role), 'family.requests.decide'), role).toBe(role === 'hr');
    expect(can(userFor('hr'), 'family.requests.decide', { companyId: COMPANY })).toBe(true);
    expect(can(userFor('hr'), 'family.requests.decide', { companyId: OTHER_COMPANY })).toBe(false);
  });
});

describe('next steps: tasks between roles (DECISIONS «Пустые состояния со следующим шагом»)', () => {
  const ALL: Role[] = [...ROLES, ...ASSIST_ROLES, 'sales_manager', 'legal', 'claims_officer'];
  const STAFF: Role[] = ['operator', 'underwriter', 'doctor_expert', 'accountant', 'admin', 'sales_manager', 'legal', 'claims_officer'];
  it('«Попросить …»: every MIG employee; HR only about its own company; partners and the insured never', () => {
    for (const role of ALL) expect(can(userFor(role), 'tasks.ask', { companyId: COMPANY }), role).toBe(STAFF.includes(role) || role === 'hr');
    expect(can(userFor('hr'), 'tasks.ask', { companyId: OTHER_COMPANY })).toBe(false);
  });
  it('tasks are received by MIG roles and by HR of its own company', () => {
    for (const role of ALL) expect(can(userFor(role), 'tasks.receive', { companyId: COMPANY }), role).toBe(STAFF.includes(role) || role === 'hr');
    expect(can(userFor('hr'), 'tasks.receive', { companyId: OTHER_COMPANY })).toBe(false);
  });
  it('«Запросить у HR»: the manager and the underwriter (those who prepare the contract)', () => {
    expect(ALL.filter((r) => can(userFor(r), 'tasks.request_hr')).sort()).toEqual(['sales_manager', 'underwriter']);
  });
});
