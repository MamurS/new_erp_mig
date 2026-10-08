import { describe, expect, it } from 'vitest';
import type { FamilyRequest, HrFamilyMember } from '@mig/contracts/dto';
import { employeesOf, filterFamily, requestsOf } from './familyList';

const E1 = '11111111-1111-4111-8111-111111111111';
const E2 = '22222222-2222-4222-8222-222222222222';
const row = (p: Partial<HrFamilyMember>): HrFamilyMember => ({
  id: crypto.randomUUID(),
  fullName: 'Karimov Temur Azizovich',
  relation: 'child',
  employeeId: E1,
  employeeName: 'Karimov Aziz Bahromovich',
  birthDateMasked: '••.••.2016',
  status: 'active',
  insuredFrom: '2026-01-01',
  appStatus: 'not_invited',
  ...p,
});
const rows = [
  row({}),
  row({ fullName: 'Karimova Dilnoza Rustamovna', relation: 'spouse', certificateNumber: 'SERT-2026-000001-0002' }),
  row({ fullName: 'Aliyeva Nodira', relation: 'parent', employeeId: E2, employeeName: 'Aliyev Bobur' }),
];

describe('filterFamily', () => {
  it('filters by employee and relation', () => {
    expect(filterFamily(rows, { employeeId: E1 })).toHaveLength(2);
    expect(filterFamily(rows, { relation: 'spouse' }).map((r) => r.fullName)).toEqual(['Karimova Dilnoza Rustamovna']);
    expect(filterFamily(rows, { employeeId: E2, relation: 'child' })).toHaveLength(0);
  });
  it('ignores an unknown relation value (e.g. from the URL)', () => {
    expect(filterFamily(rows, { relation: 'employee' })).toHaveLength(3);
  });
  it('searches the person, the employee and the certificate, tolerant to spelling', () => {
    expect(filterFamily(rows, { q: 'temur' })).toHaveLength(1);
    expect(filterFamily(rows, { q: 'aliyev' })).toHaveLength(1);
    expect(filterFamily(rows, { q: '000001-0002' })).toHaveLength(1);
  });
});

describe('employeesOf / requestsOf', () => {
  it('lists each employee once, by name', () => {
    expect(employeesOf(rows)).toEqual([
      { id: E2, name: 'Aliyev Bobur' },
      { id: E1, name: 'Karimov Aziz Bahromovich' },
    ]);
  });
  it('keeps the requests of one status, newest first', () => {
    const req = (status: FamilyRequest['status'], createdAt: string) => ({ id: createdAt, status, createdAt }) as FamilyRequest;
    const list = [req('pending', '2026-01-01T10:00:00+05:00'), req('approved', '2026-01-02T10:00:00+05:00'), req('pending', '2026-01-03T10:00:00+05:00')];
    expect(requestsOf(list, 'pending').map((r) => r.id)).toEqual(['2026-01-03T10:00:00+05:00', '2026-01-01T10:00:00+05:00']);
  });
});
