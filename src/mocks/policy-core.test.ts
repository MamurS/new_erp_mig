// @vitest-environment node
/* Limits and rules of the initial list of insured persons (POLICY_SPEC §4, §10). */
import { describe, expect, it } from 'vitest';
import { POLICY_CSV_MAX_ROWS } from '@/shared/domain/policies';
import { tm, translate } from '@/i18n/core';
import { HttpError } from './http';
import { parsePolicyList } from './policy-core';

const HEADER = 'fullName,birthDate,pinfl,phone,position,relation,principal_pinfl';
function failure(fn: () => unknown): HttpError {
  try {
    fn();
  } catch (e) {
    if (e instanceof HttpError) return e;
    throw e;
  }
  throw new Error('expected an HttpError');
}
const row = (k: number, relation = '', principal = '') => `Тестов Тест Тестович,15.03.1990,${String(31503900000000 + k)},901112233,Инженер,${relation},${principal}`;
/** A child: no phone and no position, the employee's PINFL. */
const child = (k: number, principal: number) => `Тестов Малыш Тестович,01.02.2016,${String(30102160000000 + k)},,,child,${String(31503900000000 + principal)}`;

describe('initial list of insured persons', () => {
  it('a row per person: relation (empty = employee) and the employee of a family member; duplicates and bad values by line', () => {
    const r = parsePolicyList([HEADER, row(1), child(5, 1), row(1), row(3, 'cousin'), row(4, 'spouse'), child(6, 9)].join('\n'));
    expect(r.total).toBe(6);
    expect(r.rows.map((x) => [x.relation, x.principal_pinfl ?? ''])).toEqual([
      ['employee', ''],
      ['child', '31503900000001'],
    ]);
    expect(r.rows[1]).toMatchObject({ phone: '', position: '' });
    expect(r.errors.map((e) => ({ ...e, message: tm(e.message) }))).toEqual([
      { row: 4, field: 'pinfl', message: 'ПИНФЛ повторяется в файле' },
      { row: 5, field: 'relation', message: tm('v.relation') },
      { row: 6, field: 'principal_pinfl', message: tm('v.principalRequired') },
      { row: 7, field: 'principal_pinfl', message: tm('srv.policy.principalNotInList') },
    ]);
  });

  it(`accepts ${POLICY_CSV_MAX_ROWS} rows and rejects one more with 422`, () => {
    const rows = Array.from({ length: POLICY_CSV_MAX_ROWS }, (_, k) => row(k));
    expect(parsePolicyList([HEADER, ...rows].join('\n')).rows).toHaveLength(POLICY_CSV_MAX_ROWS);
    expect(failure(() => parsePolicyList([HEADER, ...rows, row(POLICY_CSV_MAX_ROWS)].join('\n'))).status).toBe(422);
  });

  it('rejects a file over 5 MB with 413 and a file without required columns with 422', () => {
    const big = `${HEADER}\n${'x'.repeat(5 * 1024 * 1024)}`;
    expect(failure(() => parsePolicyList(big)).status).toBe(413);
    const noColumns = failure(() => parsePolicyList('fullName,phone\nТестов Тест,901112233'));
    expect(noColumns.status).toBe(422);
    expect(noColumns.key).toBe('srv.hr.missingColumns');
    expect(translate('ru', noColumns.key, noColumns.params)).toMatch(/нет колонок: birthDate, pinfl, position/);
  });
});
