// @vitest-environment node
/* Limits and rules of the initial list of insured persons (POLICY_SPEC §4, §10). */
import { describe, expect, it } from 'vitest';
import { POLICY_CSV_MAX_ROWS } from '@/shared/domain/policies';
import { tm, translate } from '@/i18n/core';
import { HttpError } from './http';
import { parsePolicyList } from './policy-core';

const HEADER = 'fullName,birthDate,pinfl,phone,position,familyMembers';
function failure(fn: () => unknown): HttpError {
  try {
    fn();
  } catch (e) {
    if (e instanceof HttpError) return e;
    throw e;
  }
  throw new Error('expected an HttpError');
}
const row = (k: number, family = '') => `Тестов Тест Тестович,15.03.1990,${String(31503900000000 + k)},901112233,Инженер,${family}`;

describe('initial list of insured persons', () => {
  it('reads family members (empty = 0), reports duplicates and bad values by line', () => {
    const r = parsePolicyList([HEADER, row(1, '2'), row(2), row(1), row(3, '11')].join('\n'));
    expect(r.total).toBe(4);
    expect(r.rows.map((x) => x.familyMembers)).toEqual([2, 0]);
    expect(r.errors.map((e) => ({ ...e, message: tm(e.message) }))).toEqual([
      { row: 4, field: 'pinfl', message: 'ПИНФЛ повторяется в файле' },
      { row: 5, field: 'familyMembers', message: 'Число от 0 до 10' },
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
